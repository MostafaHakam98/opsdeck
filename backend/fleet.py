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
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, JsonValue, ValidationError

from backend.store import Store
from backend.workspace import WorkspaceRelay

MAX_TELEMETRY_BYTES = 2 * 1024 * 1024
SOURCE_NAMES = ("host", "docker", "gpu", "runner", "services")
METRICS = ("cpu", "memory", "gpu", "rx", "tx", "io_pressure", "ci_running")


class NodeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    name: str = Field(min_length=1, max_length=120)
    cluster: str = Field(min_length=1, max_length=120)


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


class Fleet(Store):
    def __init__(self, path):
        super().__init__(path)
        with self.connect() as db:
            db.execute("CREATE TABLE IF NOT EXISTS fleet_nodes (id TEXT PRIMARY KEY, name TEXT NOT NULL, cluster TEXT NOT NULL, token_hash TEXT NOT NULL, created_at REAL NOT NULL, revoked INTEGER NOT NULL DEFAULT 0, last_seen REAL, collected_at REAL, snapshot TEXT, summary TEXT)")
            db.execute("CREATE TABLE IF NOT EXISTS fleet_samples (node_id TEXT NOT NULL, sample_id TEXT NOT NULL, ts REAL NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(node_id,sample_id))")
            db.execute("CREATE INDEX IF NOT EXISTS fleet_sample_time ON fleet_samples(node_id,ts)")
            db.execute("CREATE INDEX IF NOT EXISTS fleet_retention ON fleet_samples(ts)")

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

    def nodes(self, interval):
        now = time.time()
        with self.connect() as db:
            db.row_factory = sqlite3.Row
            rows = db.execute("SELECT id,name,cluster,created_at,revoked,last_seen,collected_at,summary FROM fleet_nodes ORDER BY cluster,name,id").fetchall()
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
            result.append(value)
        return result

    def snapshot(self, identifier, interval):
        node = next((n for n in self.nodes(interval) if n["id"] == identifier), None)
        if node is None:
            raise HTTPException(404, "Node not found")
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

    def prune(self, retention):
        with self.connect() as db:
            cutoff = time.time() - retention * 86400
            db.execute("DELETE FROM fleet_samples WHERE ts < ?", (cutoff,))
            db.execute("UPDATE fleet_nodes SET snapshot=NULL,summary=NULL WHERE collected_at < ? AND snapshot IS NOT NULL", (cutoff,))


def create_fleet_app(settings):
    fleet = Fleet(settings.db)
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
    app.state.fleet = fleet
    app.state.workspace = relay

    def bearer(authorization):
        return authorization[7:] if authorization and authorization.startswith("Bearer ") else ""

    def authenticate(request: Request, authorization: str | None = Header(default=None)):
        key = request.client.host if request.client else "unknown"
        recent = [t for t in attempts.get(key, []) if time.monotonic() - t < 60]
        if not hmac.compare_digest(bearer(authorization).encode(), settings.token.encode()):
            if len(recent) >= 30:
                raise HTTPException(429, "Too many authentication failures; wait one minute")
            if len(attempts) > 1024:
                attempts.clear()
            attempts[key] = recent + [time.monotonic()]
            raise HTTPException(401, "Operator access token required")
        attempts.pop(key, None)

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
        return {"status": "ok", "mode": "central"}

    @app.get("/api/snapshot", dependencies=[Depends(authenticate)])
    @app.get("/api/fleet", dependencies=[Depends(authenticate)])
    def overview():
        return {"mode": "central", "nodes": fleet.nodes(settings.interval), "server_time": time.time(),
                "sample_seconds": settings.interval, "retention_days": settings.retention, "actions_enabled": False}

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

    @app.get("/api/fleet/nodes/{identifier}", dependencies=[Depends(authenticate)])
    def node(identifier: UUID):
        return {**fleet.snapshot(str(identifier), settings.interval), "workspace_connected": relay.online(str(identifier))}

    @app.get("/api/fleet/nodes/{identifier}/history", dependencies=[Depends(authenticate)])
    def history(identifier: UUID, hours: int = Query(default=1, ge=1, le=720)):
        return fleet.node_history(str(identifier), hours)

    @app.api_route("/api/fleet/nodes/{identifier}/workspace/{path:path}", methods=["GET", "POST"], dependencies=[Depends(authenticate)])
    async def workspace(identifier: UUID, path: str, request: Request):
        node = next((n for n in fleet.nodes(settings.interval) if n["id"] == str(identifier)), None)
        if node is None:
            raise HTTPException(404, "Node not found")
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
    def events():
        return fleet.events()

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
        app.mount("/assets", StaticFiles(directory=settings.static / "assets"), name="assets")

        @app.get("/{path:path}")
        def frontend(path: str):
            if path.startswith("api/"):
                raise HTTPException(404, "Unknown API route")
            return FileResponse(settings.static / "index.html")
    else:
        @app.get("/")
        def unbuilt():
            return JSONResponse({"message": "Build the frontend with npm run build --prefix frontend"}, status_code=503)
    return app
