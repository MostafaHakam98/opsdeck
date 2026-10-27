"""Outbound-only fleet ingestion. Operator and per-node credentials have separate scopes."""
import asyncio
from contextlib import asynccontextmanager
import hashlib
import hmac
import json
import math
import secrets
import sqlite3
import time
from typing import Literal
from uuid import UUID, uuid4

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from pydantic import BaseModel, ConfigDict, Field, JsonValue, ValidationError, field_validator

from backend.store import Store
from backend.web import HashedAssets, SelectiveGZip
from backend.workspace import WorkspaceRelay
from backend.auth import AdminAuth

MAX_TELEMETRY_BYTES = 2 * 1024 * 1024
SOURCE_NAMES = ("host", "docker", "gpu", "runner", "services")
METRICS = ("cpu", "memory", "gpu", "rx", "tx", "io_pressure", "ci_running")
PULSE = ("cpu", "memory", "gpu")
NODE_COLUMNS = "id,name,cluster,created_at,revoked,last_seen,collected_at,summary,notes,maintenance,ignored_sources"
IGNORABLE = ("docker", "gpu", "runner", "services")
# (metric, title, label, critical, warning); all three are percentages.
ALERT_METRICS = (("cpu", "High CPU load", "CPU", 90, 80), ("memory", "High memory use", "Memory", 90, 80),
                 ("io_pressure", "High I/O pressure", "I/O pressure (avg60)", 25, 10))
SOURCE_LABELS = {"host": "Host", "docker": "Docker", "gpu": "GPU", "runner": "Runner", "services": "Services"}


class NodeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    name: str = Field(min_length=1, max_length=120)
    cluster: str = Field(min_length=1, max_length=120)


class NodeSettingsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    name: str | None = Field(default=None, min_length=1, max_length=120)
    cluster: str | None = Field(default=None, min_length=1, max_length=120)
    notes: str | None = Field(default=None, max_length=500)
    maintenance: bool | None = None
    # The host source is the agent itself and cannot be ignored.
    ignored_sources: list[Literal["docker", "gpu", "runner", "services"]] | None = Field(default=None, max_length=4)

    @field_validator("ignored_sources")
    @classmethod
    def canonical(cls, value):
        return None if value is None else [name for name in IGNORABLE if name in value]


class TelemetrySource(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    status: Literal["healthy", "degraded", "unavailable", "not_configured", "collecting"]
    data: dict[str, JsonValue] | list[JsonValue] | None = None
    message: str | None = Field(default=None, max_length=2000)
    updated_at: float | None = Field(default=None, ge=0)
    collection_method: str | None = Field(default=None, max_length=40)


class Telemetry(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    schema_version: Literal[1] = 1
    sample_id: UUID
    collected_at: float = Field(ge=0)
    sources: dict[Literal["host", "docker", "gpu", "runner", "services"], TelemetrySource] = Field(min_length=5, max_length=5)


def numeric(value):
    return value if type(value) in (int, float) and math.isfinite(value) else None


def source_data(sources, name, default):
    data = sources.get(name, {}).get("data")
    return data if isinstance(data, type(default)) else default


def metric_values(sources):
    host = source_data(sources, "host", {})
    cpu = host.get("cpu") if isinstance(host.get("cpu"), dict) else {}
    memory = host.get("memory") if isinstance(host.get("memory"), dict) else {}
    gpu = source_data(sources, "gpu", [])
    network = host.get("network") if isinstance(host.get("network"), list) else []
    pressure = host.get("pressure") if isinstance(host.get("pressure"), dict) else {}
    io = pressure.get("io") if isinstance(pressure.get("io"), dict) else {}
    some = io.get("some") if isinstance(io.get("some"), dict) else {}
    def rate(key):
        values = [numeric(row.get(key)) for row in network if isinstance(row, dict)
                  and not str(row.get("name", "")).startswith(("docker", "veth", "br-", "tailscale"))]
        values = [v for v in values if v is not None]
        return sum(values) if values else None
    return {"cpu": numeric(cpu.get("percent")), "memory": numeric(memory.get("percent")),
            "gpu": numeric(gpu[0].get("utilization")) if gpu and isinstance(gpu[0], dict) else None,
            "rx": rate("rx_bytes_s"), "tx": rate("tx_bytes_s"), "io_pressure": numeric(some.get("avg60")),
            "ci_running": numeric(source_data(sources, "docker", {}).get("ci_running"))}


def ignored_sources(raw):
    try:
        names = json.loads(raw or "[]")
    except ValueError:
        return []
    return [name for name in IGNORABLE if isinstance(names, list) and name in names]


def duration(seconds):
    seconds = max(0, int(seconds))
    return f"{seconds} s" if seconds < 120 else f"{seconds // 60} min" if seconds < 7200 else f"{seconds // 3600} h"


def fleet_alerts(nodes, now=None):
    """Current conditions only; maintenance, revoked, and waiting hosts are silent."""
    now = time.time() if now is None else now
    alerts = []
    for node in nodes:
        if node["maintenance"] or node["status"] in ("revoked", "waiting"):
            continue
        def add(kind, severity, title, detail, value=None, key=None):
            alerts.append({"key": node["id"] + ":" + (key or kind), "node_id": node["id"], "node_name": node["name"], "cluster": node["cluster"],
                           "severity": severity, "kind": kind, "title": title, "detail": detail, "value": value})
        # Readings from an offline or stale host are old; report the delivery problem, not old load.
        if node["status"] == "offline":
            silent = now - node["last_seen"] if node.get("last_seen") is not None else None
            add("offline", "critical", "Agent offline", (f"No agent contact for {duration(silent)}. " if silent is not None else "")
                + "Check the agent service and outbound HTTPS from the host.", round(silent) if silent is not None else None)
            continue
        if node["status"] == "stale":
            age = node.get("age_seconds")
            add("stale", "warning", "Telemetry stale", (f"Latest sample is {duration(age)} old. " if age is not None else "No sample stored yet. ")
                + "The agent is connected; check its collectors and the host clock.", round(age) if age is not None else None)
            continue
        for key, title, label, critical, warning in ALERT_METRICS:
            value = node["metrics"].get(key)
            if value is not None and value >= warning:
                severity, limit = ("critical", critical) if value >= critical else ("warning", warning)
                add(key, severity, title, f"{label} at {value:.0f}%, {severity} threshold {limit}%.", value)
        ignored, messages = node.get("ignored_sources") or [], node.get("source_messages") or {}
        for name, status in node["source_status"].items():
            if status in ("degraded", "unavailable") and name not in ignored:
                label = SOURCE_LABELS.get(name, name)
                add("source", "warning", f"{label} source {status}", messages.get(name) or f"The {label} collector reported {status}. Open the host to read the source message.", key="source:" + name)
    alerts.sort(key=lambda a: (a["severity"] != "critical", a["node_name"].lower(), a["node_id"]))
    return alerts


def fleet_summary(nodes, alerts):
    online = [n for n in nodes if n["status"] == "online"]
    def values(key):
        return [n["metrics"][key] for n in online if n["metrics"].get(key) is not None]
    def mean(key):
        found = values(key)
        return round(sum(found) / len(found), 1) if found else None
    running = values("ci_running")
    return {"hosts": len(nodes), **{status: sum(n["status"] == status for n in nodes) for status in ("online", "waiting", "stale", "offline", "revoked")},
            "maintenance": sum(bool(n["maintenance"]) for n in nodes), "clusters": len({n["cluster"] for n in nodes}),
            "ci_running": round(sum(running), 1) if running else None, "avg_cpu": mean("cpu"), "avg_memory": mean("memory"), "avg_gpu": mean("gpu"),
            "alerts_critical": sum(a["severity"] == "critical" for a in alerts), "alerts_warning": sum(a["severity"] == "warning" for a in alerts)}


def label_value(value):
    return str(value).replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")


def prometheus(nodes, alerts, version):
    gauges = (("node_up", "1 when the host agent is online, 0 otherwise", lambda n: int(n["status"] == "online")),
              ("node_cpu_percent", "Latest host CPU utilization", lambda n: n["metrics"].get("cpu")),
              ("node_memory_percent", "Latest host memory utilization", lambda n: n["metrics"].get("memory")),
              ("node_gpu_percent", "Latest utilization of the first GPU", lambda n: n["metrics"].get("gpu")),
              ("node_ci_running", "CI job containers running", lambda n: n["metrics"].get("ci_running")),
              ("node_age_seconds", "Seconds since the latest sample was collected", lambda n: n["age_seconds"]),
              ("node_maintenance", "1 while the host is in maintenance", lambda n: int(n["maintenance"])))
    lines = []
    for name, description, read in gauges:
        lines += [f"# HELP opsdeck_{name} {description}", f"# TYPE opsdeck_{name} gauge"]
        for node in nodes:
            value = read(node)
            if value is not None:
                lines.append(f'opsdeck_{name}{{node="{label_value(node["name"])}",cluster="{label_value(node["cluster"])}",node_id="{node["id"]}"}} {value}')
    lines += ["# HELP opsdeck_fleet_alerts Active fleet alerts", "# TYPE opsdeck_fleet_alerts gauge"]
    lines += [f'opsdeck_fleet_alerts{{severity="{severity}"}} {sum(a["severity"] == severity for a in alerts)}' for severity in ("critical", "warning")]
    lines += ["# HELP opsdeck_build_info OpsDeck build", "# TYPE opsdeck_build_info gauge", f'opsdeck_build_info{{version="{label_value(version)}"}} 1']
    return "\n".join(lines) + "\n"


class Fleet(Store):
    def __init__(self, path):
        super().__init__(path)
        with self.connect() as db:
            db.execute("CREATE TABLE IF NOT EXISTS fleet_nodes (id TEXT PRIMARY KEY, name TEXT NOT NULL, cluster TEXT NOT NULL, token_hash TEXT NOT NULL, created_at REAL NOT NULL, revoked INTEGER NOT NULL DEFAULT 0, last_seen REAL, collected_at REAL, snapshot TEXT, summary TEXT)")
            db.execute("CREATE TABLE IF NOT EXISTS fleet_samples (node_id TEXT NOT NULL, sample_id TEXT NOT NULL, ts REAL NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(node_id,sample_id))")
            db.execute("CREATE INDEX IF NOT EXISTS fleet_sample_time ON fleet_samples(node_id,ts)")
            db.execute("CREATE INDEX IF NOT EXISTS fleet_retention ON fleet_samples(ts)")
            # Additive, defaulted columns: the previous release still reads and writes this table.
            # Check and alter under one write lock so concurrent starts cannot both add a column.
            db.execute("BEGIN IMMEDIATE")
            columns = {row[1] for row in db.execute("PRAGMA table_info(fleet_nodes)")}
            if "notes" not in columns:
                db.execute("ALTER TABLE fleet_nodes ADD COLUMN notes TEXT NOT NULL DEFAULT ''")
            if "maintenance" not in columns:
                db.execute("ALTER TABLE fleet_nodes ADD COLUMN maintenance INTEGER NOT NULL DEFAULT 0")
            if "ignored_sources" not in columns:
                db.execute("ALTER TABLE fleet_nodes ADD COLUMN ignored_sources TEXT NOT NULL DEFAULT '[]'")

    def enroll(self, name, cluster):
        identifier, secret = str(uuid4()), secrets.token_urlsafe(32)
        token = identifier + "." + secret
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            if db.execute("SELECT COUNT(*) FROM fleet_nodes").fetchone()[0] >= 1000:
                raise HTTPException(409, "This server supports up to 1000 enrolled nodes")
            db.execute("INSERT INTO fleet_nodes(id,name,cluster,token_hash,created_at) VALUES (?,?,?,?,?)",
                       (identifier, name, cluster, hashlib.sha256(token.encode()).hexdigest(), time.time()))
            self._audit(db, "Agent enrolled", name + " in " + cluster)
        return {"id": identifier, "name": name, "cluster": cluster, "token": token}

    @staticmethod
    def _audit(db, title, detail):
        db.execute("INSERT INTO events(ts,kind,severity,title,detail) VALUES (?,?,?,?,?)", (time.time(), "action", "info", title, detail))

    def credential(self, supplied):
        identifier = supplied.partition(".")[0]
        with self.connect() as db:
            row = db.execute("SELECT token_hash,revoked FROM fleet_nodes WHERE id=?", (identifier,)).fetchone()
        digest = hashlib.sha256(supplied.encode()).hexdigest()
        if not row or row[1] or not hmac.compare_digest(row[0], digest):
            raise HTTPException(401, "Valid agent credential required")
        return identifier, digest

    def check_credential(self, credential):
        identifier, digest = credential
        with self.connect() as db:
            active = db.execute("SELECT 1 FROM fleet_nodes WHERE id=? AND token_hash=? AND revoked=0", (identifier, digest)).fetchone()
        if not active:
            raise HTTPException(401, "Valid agent credential required")

    def change_credential(self, identifier, rotate=False):
        token = identifier + "." + secrets.token_urlsafe(32)
        with self.connect() as db:
            changed = db.execute("UPDATE fleet_nodes SET revoked=?,token_hash=?,last_seen=NULL WHERE id=?",
                                 (0 if rotate else 1, hashlib.sha256(token.encode()).hexdigest(), identifier))
            if not changed.rowcount:
                raise HTTPException(404, "Node not found")
            self._audit(db, "Agent credential rotated" if rotate else "Agent revoked", identifier)
        return {"id": identifier, "token": token} if rotate else {"id": identifier, "revoked": True}

    def ingest(self, credential, body, retention):
        identifier, digest = credential
        now = time.time()
        if body.collected_at > now + 60 or body.collected_at < now - retention * 86400:
            raise HTTPException(422, "Sample timestamp is outside the retention window or ahead of server time")
        sources = {key: value.model_dump(exclude_none=True) for key, value in body.sources.items()}
        for name, item in sources.items():
            if item.get("updated_at", body.collected_at) > body.collected_at + 60:
                raise HTTPException(422, "Source timestamp is ahead of sample time")
            data = item.get("data")
            expected = list if name in ("gpu", "services") else dict
            if data is not None and not isinstance(data, expected):
                raise HTTPException(422, "Source data has an invalid shape")
        # Reject non-finite nested values before persisting or returning JSON.
        try:
            payload = json.dumps(sources, allow_nan=False)
            metrics = json.dumps(metric_values(sources), allow_nan=False)
            host = source_data(sources, "host", {})
            summary = json.dumps({"metrics": metric_values(sources),
                                  "source_status": {key: item["status"] for key, item in sources.items()},
                                  "source_messages": {key: item["message"][:300] for key, item in sources.items() if item.get("message")},
                                  "hostname": host["hostname"][:255] if isinstance(host.get("hostname"), str) else None,
                                  "scope": host["scope"][:40] if isinstance(host.get("scope"), str) else None}, allow_nan=False)
        except (ValueError, OverflowError):
            raise HTTPException(422, "Telemetry must contain finite JSON values")
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            node = db.execute("SELECT collected_at FROM fleet_nodes WHERE id=? AND token_hash=? AND revoked=0", (identifier, digest)).fetchone()
            if not node:
                raise HTTPException(401, "Valid agent credential required")
            changed = db.execute("INSERT OR IGNORE INTO fleet_samples VALUES (?,?,?,?)", (identifier, str(body.sample_id), body.collected_at, metrics))
            # A backfilled/retried sample cannot replace a newer live snapshot.
            if changed.rowcount and (node[0] is None or body.collected_at > node[0]):
                db.execute("UPDATE fleet_nodes SET collected_at=?,snapshot=?,summary=? WHERE id=?", (body.collected_at, payload, summary, identifier))
            db.execute("UPDATE fleet_nodes SET last_seen=? WHERE id=?", (now, identifier))
        return {"accepted": True, "duplicate": not bool(changed.rowcount), "server_time": now}

    def nodes(self, interval, identifier=None):
        now = time.time()
        with self.connect() as db:
            db.row_factory = sqlite3.Row
            rows = db.execute(f"SELECT {NODE_COLUMNS} FROM fleet_nodes" + (" WHERE id=?" if identifier else "") + " ORDER BY cluster,name,id",
                              (identifier,) if identifier else ()).fetchall()
        result = []
        for row in rows:
            value = dict(row)
            summary = json.loads(value.pop("summary") or "{}")
            age = max(0, now - value["collected_at"]) if value["collected_at"] is not None else None
            contact_age = now - value["last_seen"] if value["last_seen"] is not None else None
            value["status"] = ("revoked" if value["revoked"] else "waiting" if contact_age is None else
                               "offline" if contact_age > max(90, interval * 6) else
                               "stale" if age is None or age > max(45, interval * 3) else "online")
            value["age_seconds"] = age
            value["metrics"] = summary.get("metrics", dict.fromkeys(METRICS))
            value["source_status"] = summary.get("source_status", {})
            value["hostname"] = summary.get("hostname")
            value["scope"] = summary.get("scope")
            value["source_messages"] = summary.get("source_messages", {})
            value["maintenance"] = bool(value["maintenance"])
            value["ignored_sources"] = ignored_sources(value["ignored_sources"])
            result.append(value)
        return result

    def node(self, identifier, interval):
        found = self.nodes(interval, identifier)
        if not found:
            raise HTTPException(404, "Node not found")
        return found[0]

    def configure(self, identifier, changes, interval):
        """Name, cluster, notes, maintenance, and ignored sources only; the agent credential is never touched."""
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT name,cluster,notes,maintenance,ignored_sources FROM fleet_nodes WHERE id=?", (identifier,)).fetchone()
            if not row:
                raise HTTPException(404, "Node not found")
            current = {"name": row[0], "cluster": row[1], "notes": row[2], "maintenance": bool(row[3]), "ignored_sources": ignored_sources(row[4])}
            changed = {key: value for key, value in changes.items() if value is not None and value != current[key]}
            if changed:
                stored = {"maintenance": int, "ignored_sources": json.dumps}
                db.execute("UPDATE fleet_nodes SET " + ",".join(key + "=?" for key in changed) + " WHERE id=?",
                           (*(stored.get(k, str)(v) for k, v in changed.items()), identifier))
                name = changed.get("name", current["name"])
                labels = {"name": f"name (was {current['name']})",
                          "ignored_sources": f"ignored sources ({', '.join(changed.get('ignored_sources') or []) or 'none'})"}
                fields = [labels.get(key, key) for key in changed if key != "maintenance"]
                if fields:
                    self._audit(db, "Host settings changed", name + ": " + ", ".join(fields))
                if "maintenance" in changed:
                    self._audit(db, "Maintenance started" if changed["maintenance"] else "Maintenance ended", name + " in " + changed.get("cluster", current["cluster"]))
        return self.node(identifier, interval)

    def snapshot(self, identifier, interval):
        node = self.node(identifier, interval)
        with self.connect() as db:
            row = db.execute("SELECT snapshot FROM fleet_nodes WHERE id=?", (identifier,)).fetchone()
        now = time.time()
        sources = json.loads(row[0] or "{}")
        for item in sources.values():
            stamp = item.get("updated_at")
            item["age_seconds"] = max(0, now - stamp) if stamp is not None else None
            max_age = 120 if item.get("collection_method") == "host_export" else max(45, interval * 3)
            item["stale"] = stamp is None or now - stamp > max_age
        return {"node": node, "sources": sources, "server_time": now, "actions_enabled": False}

    def node_history(self, identifier, hours):
        end = time.time()
        start, width = end - hours * 3600, hours * 3600 / 599
        columns = ",".join(f"AVG(json_extract(payload,'$.{key}')) AS {key}, MAX(json_extract(payload,'$.{key}')) AS {key}_peak" for key in METRICS)
        with self.connect() as db:
            if not db.execute("SELECT 1 FROM fleet_nodes WHERE id=?", (identifier,)).fetchone():
                raise HTTPException(404, "Node not found")
            db.row_factory = sqlite3.Row
            rows = db.execute(f"SELECT MAX(ts) AS ts,{columns} FROM fleet_samples WHERE node_id=? AND ts>=? AND ts<=? GROUP BY CAST((ts-?)/? AS INTEGER) ORDER BY ts", (identifier, start, end, start, width)).fetchall()
            return [dict(row) for row in rows]

    def pulse(self, minutes, buckets):
        """Per-node bucket averages. The window ends on a bucket boundary so cells stay put between polls."""
        width = minutes * 60 / buckets
        end = (math.floor(time.time() / width) + 1) * width
        start = end - minutes * 60
        columns = ",".join(f"AVG(json_extract(payload,'$.{key}'))" for key in PULSE)
        with self.connect() as db:
            identifiers = [row[0] for row in db.execute("SELECT id FROM fleet_nodes ORDER BY cluster,name,id")]
            rows = db.execute(f"SELECT node_id,CAST((ts-?)/? AS INTEGER) AS bucket,{columns} FROM fleet_samples WHERE ts>=? AND ts<? GROUP BY node_id,bucket",
                              (start, width, start, end)).fetchall()
        nodes = {identifier: {key: [None] * buckets for key in PULSE} for identifier in identifiers}
        for identifier, bucket, *values in rows:
            if identifier in nodes and 0 <= bucket < buckets:
                for key, value in zip(PULSE, values):
                    nodes[identifier][key][bucket] = round(value, 1) if value is not None else None
        return {"start": start, "end": end, "bucket_seconds": width, "nodes": nodes}

    def fleet_history(self, hours, cluster=None):
        """Aggregate per node per bucket first, then across nodes, so busy reporters do not dominate averages."""
        end = time.time()
        start, width = end - hours * 3600, hours * 3600 / 599
        keys = ("cpu", "memory", "gpu", "ci_running")
        # Extract each value once per row; the node/bucket aggregation then reads plain columns.
        extracted = ",".join(f"json_extract(payload,'$.{key}') AS {key}" for key in keys)
        inner = ",".join([f"AVG({key}) AS {key}" for key in keys] + [f"MAX({key}) AS {key}_peak" for key in ("cpu", "memory")])
        scope = " AND node_id IN (SELECT id FROM fleet_nodes WHERE cluster=?)" if cluster else ""
        with self.connect() as db:
            db.row_factory = sqlite3.Row
            rows = db.execute("SELECT MAX(ts) AS ts,AVG(cpu) AS cpu,MAX(cpu_peak) AS cpu_peak,AVG(memory) AS memory,MAX(memory_peak) AS memory_peak,"
                              "AVG(gpu) AS gpu,ROUND(SUM(ci_running),1) AS ci_running,COUNT(*) AS hosts FROM ("
                              f"SELECT node_id,bucket,MAX(ts) AS ts,{inner} FROM (SELECT node_id,ts,CAST((ts-?)/? AS INTEGER) AS bucket,{extracted} "
                              f"FROM fleet_samples WHERE ts>=? AND ts<=?{scope}) GROUP BY node_id,bucket"
                              ") GROUP BY bucket ORDER BY bucket", (start, width, start, end, *((cluster,) if cluster else ()))).fetchall()
            return [dict(row) for row in rows]

    def prune(self, retention):
        with self.connect() as db:
            cutoff = time.time() - retention * 86400
            db.execute("DELETE FROM fleet_samples WHERE ts < ?", (cutoff,))
            db.execute("UPDATE fleet_nodes SET snapshot=NULL,summary=NULL WHERE collected_at < ? AND snapshot IS NOT NULL", (cutoff,))


def create_fleet_app(settings):
    fleet = Fleet(settings.db)
    admin = AdminAuth(settings.admin_file, settings.db, settings.token)
    attempts = {}
    relay = WorkspaceRelay(str(settings.db) + ".workspace", settings.image_upload_max_gib * 1024 ** 3)

    async def maintain():
        while True:
            await asyncio.to_thread(fleet.prune, settings.retention)
            await asyncio.sleep(60)

    @asynccontextmanager
    async def lifespan(app):
        task = asyncio.create_task(maintain())
        yield
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)

    app = FastAPI(title="OpsDeck Fleet", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(SelectiveGZip)
    app.state.fleet = fleet
    app.state.version = settings.version
    app.state.workspace = relay
    admin.routes(app)

    def bearer(authorization):
        return authorization[7:] if authorization and authorization.startswith("Bearer ") else ""

    def authenticate(request: Request, authorization: str | None = Header(default=None)):
        key = request.client.host if request.client else "unknown"
        recent = [t for t in attempts.get(key, []) if time.monotonic() - t < 60]
        if not hmac.compare_digest(bearer(authorization).encode(), settings.token.encode()) and not admin.valid(bearer(authorization)):
            if len(recent) >= 30:
                raise HTTPException(429, "Too many authentication failures; wait one minute")
            if len(attempts) > 1024:
                attempts.clear()
            attempts[key] = recent + [time.monotonic()]
            raise HTTPException(401, "Operator access token required")
        attempts.pop(key, None)

    def metrics_auth(request: Request, authorization: str | None = Header(default=None)):
        # A scrape-only credential keeps the operator token out of monitoring configuration.
        if settings.metrics_token and hmac.compare_digest(bearer(authorization).encode(), settings.metrics_token.encode()):
            return
        authenticate(request, authorization)

    def agent_auth(authorization: str | None = Header(default=None)):
        return fleet.credential(bearer(authorization))

    @app.middleware("http")
    async def headers(request, call_next):
        response = await call_next(request)
        response.headers.update({"X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer",
                                 "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"})
        if request.url.path.startswith("/api"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.get("/healthz")
    def health():
        return {"status": "ok", "mode": "central", "version": settings.version}

    @app.get("/api/snapshot", dependencies=[Depends(authenticate)])
    @app.get("/api/fleet", dependencies=[Depends(authenticate)])
    def overview():
        nodes, now = fleet.nodes(settings.interval), time.time()
        alerts = fleet_alerts(nodes, now)
        return {"mode": "central", "nodes": nodes, "summary": fleet_summary(nodes, alerts), "alerts": alerts, "server_time": now,
                "sample_seconds": settings.interval, "retention_days": settings.retention, "actions_enabled": False, "version": settings.version}

    @app.get("/api/fleet/pulse", dependencies=[Depends(authenticate)])
    def pulse(minutes: int = Query(default=60, ge=5, le=1440), buckets: int = Query(default=60, ge=10, le=120)):
        return fleet.pulse(minutes, buckets)

    @app.get("/api/fleet/history", dependencies=[Depends(authenticate)])
    def fleet_history(hours: int = Query(default=1, ge=1, le=168), cluster: str | None = Query(default=None, min_length=1, max_length=120)):
        return fleet.fleet_history(hours, cluster)

    @app.get("/api/fleet/metrics", dependencies=[Depends(metrics_auth)])
    def metrics():
        nodes = fleet.nodes(settings.interval)
        return PlainTextResponse(prometheus(nodes, fleet_alerts(nodes), settings.version), media_type="text/plain; version=0.0.4")

    @app.post("/api/fleet/nodes", dependencies=[Depends(authenticate)])
    def enroll(body: NodeRequest):
        return fleet.enroll(body.name, body.cluster)

    @app.post("/api/fleet/nodes/{identifier}/revoke", dependencies=[Depends(authenticate)])
    def revoke(identifier: UUID):
        relay.cancel(str(identifier))
        return fleet.change_credential(str(identifier))

    @app.post("/api/fleet/nodes/{identifier}/rotate", dependencies=[Depends(authenticate)])
    def rotate(identifier: UUID):
        relay.cancel(str(identifier))
        return fleet.change_credential(str(identifier), rotate=True)

    @app.post("/api/fleet/nodes/{identifier}/settings", dependencies=[Depends(authenticate)])
    def configure(identifier: UUID, body: NodeSettingsRequest):
        return fleet.configure(str(identifier), body.model_dump(exclude_unset=True), settings.interval)

    @app.get("/api/fleet/nodes/{identifier}", dependencies=[Depends(authenticate)])
    def node(identifier: UUID):
        return {**fleet.snapshot(str(identifier), settings.interval), "workspace_connected": relay.online(str(identifier))}

    @app.get("/api/fleet/nodes/{identifier}/history", dependencies=[Depends(authenticate)])
    def history(identifier: UUID, hours: int = Query(default=1, ge=1, le=720)):
        return fleet.node_history(str(identifier), hours)

    @app.api_route("/api/fleet/nodes/{identifier}/workspace/{path:path}", methods=["GET", "POST"], dependencies=[Depends(authenticate)])
    async def workspace(identifier: UUID, path: str, request: Request):
        node = fleet.node(str(identifier), settings.interval)
        if node["revoked"]:
            raise HTTPException(409, "This host's agent has been revoked")
        if request.method == "POST":
            fleet.event("action", "info", "Host workspace request", node["name"] + ": " + path)
        return await relay.forward(str(identifier), path, request)

    @app.get("/api/agent/workspace/requests")
    async def workspace_claim(credential=Depends(agent_auth)):
        return await relay.claim(credential[0], lambda: fleet.check_credential(credential))

    @app.get("/api/agent/workspace/requests/{identifier}/body")
    def workspace_body(identifier: UUID, credential=Depends(agent_auth)):
        return relay.body(credential[0], str(identifier))

    @app.post("/api/agent/workspace/requests/{identifier}/result")
    async def workspace_complete(identifier: UUID, request: Request, credential=Depends(agent_auth)):
        return await relay.complete(credential[0], str(identifier), request)

    @app.get("/api/events", dependencies=[Depends(authenticate)])
    def events(limit: int = Query(default=100, ge=1, le=1000), q: str = Query(default="", max_length=200)):
        return fleet.events(limit, q.strip())

    @app.post("/api/agent/telemetry")
    async def ingest(request: Request, credential=Depends(agent_auth)):
        payload = bytearray()
        async for chunk in request.stream():
            if len(payload) + len(chunk) > MAX_TELEMETRY_BYTES:
                raise HTTPException(413, "Telemetry exceeds 2 MiB")
            payload.extend(chunk)
        try:
            body = Telemetry.model_validate_json(payload)
        except (ValidationError, ValueError, RecursionError):
            raise HTTPException(422, "Invalid telemetry envelope")
        return await asyncio.to_thread(fleet.ingest, credential, body, settings.retention)

    if settings.static.exists():
        app.mount("/assets", HashedAssets(directory=settings.static / "assets"), name="assets")

        @app.get("/{path:path}")
        def frontend(path: str):
            if path.startswith("api/"):
                raise HTTPException(404, "Unknown API route")
            return FileResponse(settings.static / "index.html", headers={"Cache-Control": "no-cache"})
    else:
        @app.get("/")
        def unbuilt():
            return JSONResponse({"message": "Build the frontend with npm run build --prefix frontend"}, status_code=503)
    return app
