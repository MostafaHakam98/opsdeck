"""Host telemetry agent: no listening socket, outbound HTTPS, bounded durable retry queue."""
import argparse
import asyncio
from contextlib import contextmanager
from dataclasses import dataclass, field
import fcntl
import json
import logging
import os
from pathlib import Path
import random
import signal
import sqlite3
import time
from urllib.parse import urlsplit
from uuid import uuid4

import httpx

from backend.collectors import DockerCollector, HostCollector, failure, gpu_collect, runner_collect, services_collect
from backend.config import Settings
from backend.fleet import MAX_TELEMETRY_BYTES, SOURCE_NAMES
from backend.run import load_environment
from backend.workspace_agent import WorkspaceSettings, run_workspace

logger = logging.getLogger("opsdeck.agent")


@dataclass
class AgentSettings:
    server: str = field(default_factory=lambda: os.getenv("OPSDECK_SERVER_URL", "").rstrip("/"))
    token: str = field(default_factory=lambda: os.getenv("OPSDECK_AGENT_TOKEN", ""))
    spool: str = field(default_factory=lambda: os.getenv("OPSDECK_AGENT_SPOOL", "./data/agent.sqlite"))
    interval: int = field(default_factory=lambda: int(os.getenv("OPSDECK_SAMPLE_SECONDS", "10")))
    max_samples: int = field(default_factory=lambda: int(os.getenv("OPSDECK_AGENT_QUEUE_SAMPLES", "360")))
    max_bytes: int = field(default_factory=lambda: int(os.getenv("OPSDECK_AGENT_QUEUE_MIB", "64")) * 1024 * 1024)

    def validate(self):
        url = urlsplit(self.server)
        if (not url.hostname or url.username or url.password or url.query or url.fragment or url.path
                or url.scheme not in ("http", "https")):
            raise ValueError("OPSDECK_SERVER_URL must be an HTTPS origin without a path or credentials")
        if url.scheme != "https" and url.hostname not in ("127.0.0.1", "localhost", "::1"):
            raise ValueError("Agent connections require HTTPS; HTTP is allowed only on loopback for development")
        if len(self.token) < 64 or "." not in self.token:
            raise ValueError("Set OPSDECK_AGENT_TOKEN to the credential issued when enrolling this node")
        if not 5 <= self.interval <= 300 or not 1 <= self.max_samples <= 10000 or not MAX_TELEMETRY_BYTES <= self.max_bytes <= 1024 ** 3:
            raise ValueError("Agent limits: interval 5..300 seconds, queue 1..10000 samples, queue 2..1024 MiB")


class Spool:
    def __init__(self, settings):
        self.settings = settings
        Path(settings.spool).parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        with self.connect() as db:
            db.execute("CREATE TABLE IF NOT EXISTS queue (id INTEGER PRIMARY KEY AUTOINCREMENT, payload BLOB NOT NULL)")

    def connect(self):
        return sqlite3.connect(self.settings.spool, timeout=10)

    def push(self, payload):
        encoded = json.dumps(payload, allow_nan=False, separators=(",", ":")).encode()
        if len(encoded) > MAX_TELEMETRY_BYTES:
            logger.warning("Sample exceeds the 2 MiB ingestion limit; reduce host inventory")
            return False
        removed = 0
        with self.connect() as db:
            db.execute("INSERT INTO queue(payload) VALUES (?)", (encoded,))
            count, size = db.execute("SELECT COUNT(*),COALESCE(SUM(length(payload)),0) FROM queue").fetchone()
            while count > self.settings.max_samples or size > self.settings.max_bytes:
                identifier, length = db.execute("SELECT id,length(payload) FROM queue ORDER BY id LIMIT 1").fetchone()
                db.execute("DELETE FROM queue WHERE id=?", (identifier,))
                count, size, removed = count - 1, size - length, removed + 1
        if removed:
            logger.warning("Retry queue full; discarded %d oldest samples", removed)
        return True

    def pending(self):
        with self.connect() as db:
            # Send current health first, then drain older history in bounded batches.
            rows = db.execute("SELECT id,payload FROM queue ORDER BY id LIMIT 19").fetchall()
            newest = db.execute("SELECT id,payload FROM queue ORDER BY id DESC LIMIT 1").fetchone()
        return ([newest] + [row for row in rows if row[0] != newest[0]]) if newest else []

    def acknowledge(self, identifier):
        with self.connect() as db:
            db.execute("DELETE FROM queue WHERE id=?", (identifier,))


async def deliver(spool, client, settings):
    """Return False on transient/auth failure; retain the sample until server acknowledgement."""
    for identifier, payload in await asyncio.to_thread(spool.pending):
        try:
            response = await client.post(settings.server + "/api/agent/telemetry", content=payload,
                                         headers={"Authorization": "Bearer " + settings.token, "Content-Type": "application/json"})
        except httpx.HTTPError as exc:
            logger.warning("Delivery unavailable (%s); retaining queued telemetry", type(exc).__name__)
            return False
        if response.status_code in (413, 422):
            logger.warning("Discarding rejected sample (HTTP %d); check agent version and host clock", response.status_code)
            await asyncio.to_thread(spool.acknowledge, identifier)
        elif response.status_code != 200:
            logger.warning("Delivery rejected (HTTP %d); check agent enrollment and connectivity", response.status_code)
            return False
        else:
            try:
                accepted = response.json().get("accepted") is True
            except (ValueError, AttributeError):
                accepted = False
            if not accepted:
                logger.warning("Server did not acknowledge telemetry; retaining queued sample")
                return False
            await asyncio.to_thread(spool.acknowledge, identifier)
    return True


@contextmanager
def exclusive_spool(path):
    """Prevent two local services from running against the same agent queue."""
    lock_path = Path(str(path) + ".lock")
    lock_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with lock_path.open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError("Another agent is already using this retry queue")
        yield


async def run(settings):
    local = Settings()
    workspace = WorkspaceSettings()
    workspace.validate()
    spool = Spool(settings)
    state = {name: {"status": "collecting", "data": None, "message": "Waiting for the first sample", "updated_at": None} for name in SOURCE_NAMES}
    host, engine = HostCollector(local.host_root, local.procfs_path, local.scope), DockerCollector(local.docker_timeout)
    collectors = {"host": host.collect, "docker": engine.collect, "gpu": gpu_collect,
                  "runner": lambda: runner_collect(local), "services": lambda: services_collect(local)}
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for signum in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(signum, stop.set)

    async def collect(name, fn):
        while True:
            started = time.monotonic()
            try:
                state[name] = await asyncio.to_thread(fn)
            except Exception as exc:
                state[name] = failure(exc, name.title() + " collector unavailable; check local permissions")
            await asyncio.sleep(max(1, max(settings.interval, 15 if name != "host" else 5) - (time.monotonic() - started)))

    async def sample():
        while True:
            await asyncio.sleep(settings.interval)
            try:
                await asyncio.to_thread(spool.push, {"schema_version": 1, "sample_id": str(uuid4()), "collected_at": time.time(), "sources": dict(state)})
            except (ValueError, OSError, sqlite3.Error) as exc:
                logger.warning("Cannot persist sample (%s); check queue disk and collector values", type(exc).__name__)

    async def send():
        delay = 1
        # TLS verification stays enabled. HTTPX supports SSL_CERT_FILE and HTTPS_PROXY.
        async with httpx.AsyncClient(timeout=15, follow_redirects=False) as client:
            while True:
                try:
                    success = await deliver(spool, client, settings)
                except (OSError, sqlite3.Error) as exc:
                    logger.warning("Cannot read retry queue (%s)", type(exc).__name__)
                    success = False
                delay = 1 if success else min(60, delay * 2)
                await asyncio.sleep(delay + (random.random() if not success else 0))

    tasks = [asyncio.create_task(collect(name, fn)) for name, fn in collectors.items()]
    tasks += [asyncio.create_task(sample()), asyncio.create_task(send()), asyncio.create_task(run_workspace(settings, workspace))]
    try:
        await stop.wait()
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        for signum in (signal.SIGINT, signal.SIGTERM):
            loop.remove_signal_handler(signum)


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path, default=Path(os.getenv("OPSDECK_ENV_FILE", ".env.agent")))
    args = parser.parse_args()
    load_environment(args.env_file)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    settings = AgentSettings()
    settings.validate()
    with exclusive_spool(settings.spool):
        asyncio.run(run(settings))


if __name__ == "__main__":
    main()
