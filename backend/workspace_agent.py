"""Forward a narrow API allowlist to a loopback workspace over outbound HTTPS."""
import asyncio
from dataclasses import dataclass, field
import logging
import os
import psutil
from urllib.parse import urlsplit

import httpx

from backend.workspace import MAX_REPLY, allowed

logger = logging.getLogger("opsdeck.workspace")


@dataclass
class WorkspaceSettings:
    url: str = field(default_factory=lambda: os.getenv("OPSDECK_WORKSPACE_URL", "").rstrip("/"))
    token: str = field(default_factory=lambda: os.getenv("OPSDECK_WORKSPACE_TOKEN", ""))

    def validate(self):
        if not self.url:
            return
        value = urlsplit(self.url)
        try:
            value.port
        except ValueError:
            raise ValueError("Invalid workspace loopback port") from None
        addresses = {address.address.split("%", 1)[0] for rows in psutil.net_if_addrs().values() for address in rows}
        if (value.scheme != "http" or value.hostname not in ({"127.0.0.1", "::1"} | addresses) or value.username
                or value.password or value.path or value.query or value.fragment or len(self.token) < 32):
            raise ValueError("Workspace requires an HTTP origin bound to this host and its private host access token")


async def handle(job, remote, local, agent, workspace):
    identifier = job["id"]
    result_url = agent.server + "/api/agent/workspace/requests/" + identifier
    # Validate again locally: an upstream request can never choose an arbitrary URL.
    if not allowed(job.get("method"), job.get("path", "")) or len(job.get("query", "")) > 8192:
        status, payload = 400, b'{"detail":"Unsupported host workspace route"}'
    else:
        try:
            url = workspace.url + "/api/" + job["path"]
            if job["query"]:
                url += "?" + job["query"]
            async with remote.stream("GET", result_url + "/body") as body:
                body.raise_for_status()
                async with local.stream(job["method"], url, content=body.aiter_bytes(), headers={
                    "Authorization": "Bearer " + workspace.token,
                    "Content-Type": job["content_type"],
                }, timeout=900 if job["path"] == "operations/uploads" else 35) as response:
                    status, data = response.status_code, bytearray()
                    async for chunk in response.aiter_bytes():
                        if len(data) + len(chunk) > MAX_REPLY:
                            raise ValueError("Workspace response too large")
                        data.extend(chunk)
                    payload = bytes(data)
        except (httpx.HTTPError, ValueError):
            status, payload = 502, b'{"detail":"Host workspace connection failed. A submitted change may have run; inspect host activity before retrying."}'
    # Deliberately one attempt. Replaying mutations after a lost result is unsafe.
    response = await remote.post(result_url + "/result", content=payload, headers={"X-Workspace-Status": str(status)})
    if response.status_code not in (200, 404):
        logger.warning("Workspace result unavailable (HTTP %d); request is not replayed", response.status_code)


async def run_workspace(agent, workspace):
    if not workspace.url:
        return
    async with httpx.AsyncClient(timeout=20, follow_redirects=False, headers={"Authorization": "Bearer " + agent.token}) as remote, httpx.AsyncClient(follow_redirects=False, trust_env=False) as local:
        async def worker():
            while True:
                try:
                    response = await remote.get(agent.server + "/api/agent/workspace/requests")
                    response.raise_for_status()
                    job = response.json()
                    if job:
                        await handle(job, remote, local, agent, workspace)
                except (httpx.HTTPError, ValueError, KeyError):
                    logger.warning("Workspace relay unavailable; reconnecting without replaying requests")
                    await asyncio.sleep(5)
        tasks = [asyncio.create_task(worker()) for _ in range(4)]
        try:
            await asyncio.gather(*tasks)
        finally:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
