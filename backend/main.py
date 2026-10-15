"""Single-host application. One worker owns sampling; browsers read cached snapshots."""
import asyncio
from contextlib import asynccontextmanager
import hmac
import logging
import time

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from backend.actions import Actions
from backend.operations import Operations
from backend.gitlab_connection import GitLabConnection
from backend.workloads import Workloads, scope_values
from backend.collectors import DockerCollector, HostCollector, failure, gitlab_collect, gpu_collect, runner_collect, services_collect
from backend.config import Settings
from backend.insights import insights
from backend.store import Store
from backend.findings import collect_findings, observations

logger = logging.getLogger("opsdeck")


class PreviewRequest(BaseModel):
    action: str = Field(max_length=16)
    target: str = Field(max_length=64)


class ExecuteRequest(BaseModel):
    nonce: str = Field(max_length=128)
    confirmation: str = Field(max_length=256)


class OperationPreviewRequest(BaseModel):
    action: str = Field(max_length=32)
    values: dict = Field(default_factory=dict)


class ScopeRequest(BaseModel):
    project: str = Field(default="all", max_length=512)
    pipeline: str = Field(default="all", max_length=512)
    image: str = Field(default="all", max_length=512)
    hours: int = Field(default=24, ge=0, le=720)


class CheckpointRequest(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    notes: str = Field(default="", max_length=4000)
    scope: ScopeRequest = Field(default_factory=ScopeRequest)


class GitLabConnectionRequest(BaseModel):
    url: str = Field(default="", max_length=1024)
    token: str = Field(default="", max_length=512)
    projects: list[str] = Field(default_factory=list, max_length=32)
    auto_observed: bool = True
    enabled: bool = True


class GitLabHistoryRequest(BaseModel):
    project: str = Field(min_length=1, max_length=200)
    page: int = Field(default=1, ge=1, le=10000)


def create_app(settings=None, collect=True, action_factory=None, operation_factory=None, runner_client=None):
    settings = settings or Settings()
    settings.validate()
    store = Store(settings.db)
    state = {name: {"status": "collecting", "data": None, "updated_at": None, "message": "Waiting for the first sample"} for name in ("host", "docker", "gpu", "runner", "gitlab", "services", "findings")}
    active_alerts = set()
    auth_attempts = {}
    action_service = Actions(settings.actions, store, action_factory)
    operations = Operations(settings, store, operation_factory, runner_client)
    connection = GitLabConnection(settings, store)
    workloads = Workloads(store, state)
    gitlab_refresh = asyncio.Event()

    async def poll(name, fn, interval):
        while True:
            started = time.monotonic()
            try:
                state[name] = await asyncio.to_thread(fn)
                if name == "docker" and state[name]["status"] == "healthy":
                    await asyncio.to_thread(store.observe_workers, state[name]["data"]["containers"], settings.retention)
                if name == "gitlab" and state[name]["status"] in ("healthy", "degraded"):
                    await asyncio.to_thread(store.observe_gitlab, state[name]["data"], settings.retention)
            except Exception as exc:
                # Avoid printing exception messages with configured credentials.
                logger.warning("Collector %s failed: %s", name, type(exc).__name__)
                state[name] = failure(exc, f"{name.title()} collector failed; inspect server configuration")
            delay = max(1, interval - (time.monotonic() - started))
            if name == "gitlab":
                try:
                    await asyncio.wait_for(gitlab_refresh.wait(), delay)
                    gitlab_refresh.clear()
                except TimeoutError:
                    pass
            else:
                await asyncio.sleep(delay)

    async def record():
        nonlocal active_alerts
        while True:
            await asyncio.sleep(settings.interval)
            h = state["host"].get("data") or {}
            gpus = state["gpu"].get("data") or []
            jobs = (state["gitlab"].get("data") or {}).get("jobs", [])
            if h:
                values = {"cpu": h["cpu"]["percent"], "memory": h["memory"]["percent"],
                    "io_pressure": (h["pressure"].get("io") or {}).get("some", {}).get("avg60"),
                    "rx": sum(n["rx_bytes_s"] or 0 for n in h["network"] if not n["name"].startswith(("docker", "veth", "br-", "tailscale"))),
                    "tx": sum(n["tx_bytes_s"] or 0 for n in h["network"] if not n["name"].startswith(("docker", "veth", "br-", "tailscale"))),
                    "gpu": gpus[0].get("utilization") if gpus else None,
                    "queued": sum(j["status"] == "pending" for j in jobs) if state["gitlab"]["status"] == "healthy" else None}
                try:
                    await asyncio.to_thread(store.sample, values, settings.retention)
                    alerts, _ = insights(state)
                    keys = {a["key"] for a in alerts}
                    for alert in alerts:
                        if alert["key"] not in active_alerts:
                            await asyncio.to_thread(store.event, "alert", alert["severity"], alert["title"], alert["detail"])
                    unknown = set()
                    providers = {"disk": "host", "inode": "host", "memory": "host", "io": "host", "container": "docker", "gpu": "gpu", "queue": "gitlab", "service": "services"}
                    for resolved in active_alerts - keys:
                        provider = providers.get(resolved.split(":")[0])
                        if provider and state[provider]["status"] != "healthy":
                            unknown.add(resolved)
                            continue
                        await asyncio.to_thread(store.event, "alert", "success", "Condition cleared", resolved)
                    active_alerts = keys | unknown
                except Exception as exc:
                    logger.error("History write failed: %s", type(exc).__name__)
                    app.state.history_error = "History persistence failed; check database space and permissions"
                else:
                    app.state.history_error = None

    @asynccontextmanager
    async def lifespan(app):
        tasks = []
        app.state.loop = asyncio.get_running_loop()
        if settings.operations:
            operations.start()
        if collect:
            host, engine = HostCollector(settings.host_root, settings.procfs_path, settings.scope), DockerCollector()
            tasks = [asyncio.create_task(poll("host", host.collect, settings.interval)),
                asyncio.create_task(poll("docker", engine.collect, max(settings.interval, 15))),
                asyncio.create_task(poll("gpu", gpu_collect, max(settings.interval, 15))),
                asyncio.create_task(poll("runner", lambda: runner_collect(settings), 15)),
                asyncio.create_task(poll("gitlab", lambda: gitlab_collect(connection.settings_for_poll()), 60)),
                asyncio.create_task(poll("services", lambda: services_collect(settings), 15)), asyncio.create_task(record())]
            tasks.append(asyncio.create_task(poll("findings", lambda: collect_findings(settings), 30)))
        yield
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        operations.stop()

    app = FastAPI(title="OpsDeck", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.state.snapshot = state
    app.state.store = store
    app.state.history_error = None
    app.state.operations = operations
    app.state.workloads = workloads

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        if request.url.path == "/api/integrations/gitlab":
            return JSONResponse({"detail": "Invalid GitLab connection fields"}, status_code=422)
        return await request_validation_exception_handler(request, exc)

    @app.middleware("http")
    async def headers(request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
        if request.url.path.startswith("/api"):
            response.headers["Cache-Control"] = "no-store"
        return response

    def authenticate(request: Request, authorization: str | None = Header(default=None)):
        peer = request.client.host if request.client else "unknown"
        now = time.monotonic()
        recent = [t for t in auth_attempts.get(peer, []) if now - t < 60]
        if len(recent) >= 30:
            raise HTTPException(429, "Too many authentication failures; wait one minute")
        supplied = authorization[7:] if authorization and authorization.startswith("Bearer ") else ""
        if not hmac.compare_digest(supplied.encode(), settings.token.encode()):
            if len(auth_attempts) > 1024:
                auth_attempts.clear()
            auth_attempts[peer] = recent + [now]
            raise HTTPException(401, "Access token required", headers={"WWW-Authenticate": "Bearer"})
        auth_attempts.pop(peer, None)

    @app.get("/healthz")
    def health():
        return {"status": "ok"}

    @app.get("/api/snapshot", dependencies=[Depends(authenticate)])
    def snapshot():
        alerts, recommendations = insights(state)
        now = time.time()
        sources = {}
        for key, value in state.items():
            age = now - value["updated_at"] if value.get("updated_at") else None
            max_age = 180 if key == "gitlab" else max(45, settings.interval * 3)
            if key == "services" and value.get("collection_method") == "host_export":
                max_age = 120
            sources[key] = {**value, "age_seconds": age, "stale": age is not None and age > max_age}
        if sources["findings"].get("data"):
            sources["findings"]["data"] = observations(sources["findings"]["data"], state)
        if sources["docker"].get("data"):
            sources["docker"]["data"] = {**sources["docker"]["data"], "worker_history": store.workers()}
        return {"sources": sources, "alerts": alerts, "recommendations": recommendations,
            "server_time": now, "sample_seconds": settings.interval, "retention_days": settings.retention,
            "actions_enabled": settings.actions, "history_error": app.state.history_error, "version": "0.1.0"}

    @app.get("/api/history", dependencies=[Depends(authenticate)])
    def history(hours: int = Query(default=1, ge=1, le=720)):
        return store.history(hours)

    @app.get("/api/events", dependencies=[Depends(authenticate)])
    def events():
        return store.events()

    @app.post("/api/actions/preview", dependencies=[Depends(authenticate)])
    def preview(body: PreviewRequest):
        return action_service.preview(body.action, body.target)

    @app.post("/api/actions/execute", dependencies=[Depends(authenticate)])
    def execute(body: ExecuteRequest):
        return action_service.execute(body.nonce, body.confirmation)

    @app.get("/api/operations/capabilities", dependencies=[Depends(authenticate)])
    def capabilities():
        return operations.capabilities()

    @app.get("/api/operations/jobs", dependencies=[Depends(authenticate)])
    def operation_jobs():
        return store.operations()

    @app.post("/api/operations/preview", dependencies=[Depends(authenticate)])
    def operation_preview(body: OperationPreviewRequest):
        return operations.preview(body.action, body.values)

    @app.post("/api/operations/execute", dependencies=[Depends(authenticate)])
    def operation_execute(body: ExecuteRequest):
        return operations.execute(body.nonce, body.confirmation)

    @app.post("/api/operations/uploads", dependencies=[Depends(authenticate)])
    async def operation_upload(request: Request, kind: str = Query(pattern="^(image|context)$"), name: str = Query(max_length=120)):
        return await operations.receive_upload(request, kind, name)

    @app.post("/api/operations/uploads/{identifier}/discard", dependencies=[Depends(authenticate)])
    def discard_upload(identifier: str):
        return operations.discard_upload(identifier)

    @app.get("/api/workloads", dependencies=[Depends(authenticate)])
    def workload_view(project: str = Query(default="all", max_length=512), pipeline: str = Query(default="all", max_length=512), image: str = Query(default="all", max_length=512),
                      hours: int = Query(default=24, ge=0, le=720), kind: str = Query(default="pipelines", pattern="^(projects|pipelines|images|workers)$"),
                      query: str = Query(default="", max_length=200), status: str = Query(default="all", max_length=40), page: int = Query(default=1, ge=1), size: int = Query(default=20, ge=1, le=100)):
        return workloads.view(scope_values(project, pipeline, image, hours), kind, query, status, page, size)

    @app.get("/api/checkpoints", dependencies=[Depends(authenticate)])
    def checkpoints():
        return store.checkpoints()

    @app.post("/api/checkpoints", dependencies=[Depends(authenticate)])
    def checkpoint_create(body: CheckpointRequest):
        if not body.title.strip():
            raise HTTPException(400, "Choose a checkpoint name")
        return workloads.capture(body.title.strip(), body.notes, body.scope.model_dump())

    @app.get("/api/checkpoints/compare", dependencies=[Depends(authenticate)])
    def checkpoint_compare(baseline: str, result: str):
        return workloads.compare(baseline, result)

    @app.get("/api/checkpoints/{identifier}", dependencies=[Depends(authenticate)])
    def checkpoint_detail(identifier: str):
        value = store.checkpoint(identifier)
        if value is None:
            raise HTTPException(404, "Checkpoint not found")
        return value

    @app.get("/api/integrations/gitlab", dependencies=[Depends(authenticate)])
    def gitlab_connection_status():
        return connection.public()

    @app.post("/api/integrations/gitlab", dependencies=[Depends(authenticate)])
    def gitlab_connection_save(body: GitLabConnectionRequest):
        result = connection.save(**body.model_dump())
        app.state.loop.call_soon_threadsafe(gitlab_refresh.set)
        return result

    @app.post("/api/integrations/gitlab/history", dependencies=[Depends(authenticate)])
    def gitlab_history(body: GitLabHistoryRequest):
        configured = connection.settings_for_poll()
        if not configured.gitlab_token or not configured.gitlab_url:
            raise HTTPException(409, "Connect GitLab before importing older pipeline history")
        allowed = set(configured.projects)
        for item in (state["gitlab"].get("data") or {}).get("projects", []):
            if str(item["id"]) in allowed or item["name"] in allowed:
                allowed.update((str(item["id"]), item["name"]))
        if body.project not in allowed:
            raise HTTPException(403, "Choose a project in the configured or observed GitLab scope")
        from dataclasses import replace
        result = gitlab_collect(replace(configured, projects=[body.project]), history_page=body.page)
        data = result.get("data") or {}
        store.observe_gitlab(data, settings.retention)
        if result["status"] != "healthy":
            raise HTTPException(502, result.get("message") or "GitLab history read failed")
        store.event("action", "info", "Pipeline history read", "Read-only page import for project " + body.project)
        history = (data.get("history") or [{}])[0]
        return {"pipelines": history.get("count", 0), "page": body.page, "next_page": body.page + 1 if history.get("has_more") else None, "message": "Pipeline records retained; durations are populated where GitLab supplied them"}

    @app.get("/api/metrics", dependencies=[Depends(authenticate)])
    def metrics():
        h = state["host"].get("data") or {}
        values = {"host_cpu_percent": h.get("cpu", {}).get("percent"), "host_memory_percent": h.get("memory", {}).get("percent"),
            "host_memory_available_bytes": h.get("memory", {}).get("available"), "history_write_healthy": 0 if app.state.history_error else 1}
        lines = []
        for key, value in values.items():
            if value is not None:
                lines += [f"# TYPE opsdeck_{key} gauge", f"opsdeck_{key} {value}"]
        for name, value in state.items():
            lines += [f'opsdeck_source_healthy{{source="{name}"}} {int(value["status"] == "healthy")}']
        return PlainTextResponse("\n".join(lines) + "\n", media_type="text/plain; version=0.0.4")

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
            return JSONResponse({"message": "Frontend not built; run npm ci && npm run build in frontend/"}, status_code=503)
    return app


def factory():
    return create_app()
