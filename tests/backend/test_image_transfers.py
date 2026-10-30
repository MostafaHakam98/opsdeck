import asyncio
import base64
import hashlib
import json
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend.config import Settings
from backend.image_artifacts import ImageArtifacts
from backend.image_transfers import ImageTransfers
from backend.main import create_app
from backend.workspace_agent import WorkspaceSettings, handle
from tests.backend.test_operations import Engine, IMAGE, TOKEN, archive, execute, headers, wait_job, operation_app


def test_readiness_reports_missing_tags_and_never_returns_runtime_secrets(tmp_path):
    engine = Engine()
    app = create_app(Settings(token=TOKEN, db=str(tmp_path/"db"), image_upload_dir=str(tmp_path/"uploads")), collect=False, operation_factory=lambda: engine)
    with TestClient(app) as client:
        assert client.get("/api/operations/readiness?reference=source:v1").status_code == 401
        ready = client.get("/api/operations/readiness?reference=source:v1", headers=headers()).json()
        assert ready["present"] and ready["layers"] and ready["runtime_digest"]
        assert "SAFE=fixture" not in json.dumps(ready)
        assert not ready["operations_enabled"] and ready["engine_disk_free"] is None
        assert not client.get("/api/operations/readiness?reference=missing:v1", headers=headers()).json()["present"]


def test_chunk_retries_are_idempotent_and_import_requires_whole_archive_checksum(operation_app):
    client, app, engine = operation_app
    data = b"not-a-valid-image-but-checksum-is-verified-first"
    identifier = "c" * 32
    artifacts = app.state.operations.artifacts
    digest = hashlib.sha256(data).hexdigest()
    assert artifacts.receive(identifier, {"step": "begin", "bytes": len(data), "sha256": "0" * 64})["offset"] == 0
    chunk = {"step": "chunk", "offset": 0, "data": base64.b64encode(data).decode(), "sha256": digest}
    assert artifacts.receive(identifier, chunk)["offset"] == len(data)
    assert artifacts.receive(identifier, chunk)["offset"] == len(data)
    assert artifacts.receive(identifier, {"step": "begin", "bytes": len(data), "sha256": "0" * 64})["offset"] == len(data)
    with pytest.raises(HTTPException):
        artifacts.receive(identifier, {**chunk, "data": base64.b64encode(b"different").decode(), "sha256": hashlib.sha256(b"different").hexdigest()})
    artifacts.receive(identifier, {"step": "finish"})
    _, job = execute(client, "load_image", {"upload_id": identifier})
    result = wait_job(client, job["id"])
    assert result["status"] == "failed" and "checksum" in result["message"]
    assert engine.loads == 0


def test_fleet_copy_uses_real_agent_relay_resumes_and_verifies_layers(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.image_artifacts.CHUNK", 1024)
    async def scenario():
        source_engine, target_engine = Engine(), Engine()
        source_engine.tags["imported:v1"] = IMAGE
        settings = Settings(mode="central", token=TOKEN, db=str(tmp_path/"central.db"))
        central = create_app(settings)
        source = create_app(Settings(token=TOKEN, operations=True, db=str(tmp_path/"source.db"), image_upload_dir=str(tmp_path/"source")), collect=False, operation_factory=lambda: source_engine)
        target = create_app(Settings(token=TOKEN, operations=True, db=str(tmp_path/"target.db"), image_upload_dir=str(tmp_path/"target")), collect=False, operation_factory=lambda: target_engine)
        async with source.router.lifespan_context(source), target.router.lifespan_context(target), httpx.AsyncClient(transport=httpx.ASGITransport(app=central), base_url="http://central", headers=headers()) as operator:
            nodes = [(await operator.post("/api/fleet/nodes", json={"name": name, "cluster": "test"})).json() for name in ["source", "target"]]
            tasks, clients = [], []
            async def worker(remote, local):
                while True:
                    job = (await remote.get("/api/agent/workspace/requests")).json()
                    if job:
                        await handle(job, remote, local, SimpleNamespace(server="http://central"), WorkspaceSettings("http://host", TOKEN))
            for node, host in zip(nodes, [source, target]):
                remote = httpx.AsyncClient(transport=httpx.ASGITransport(app=central), base_url="http://central", headers={"Authorization": "Bearer " + node["token"]})
                local = httpx.AsyncClient(transport=httpx.ASGITransport(app=host), base_url="http://host")
                clients.extend([remote, local])
                tasks.append(asyncio.create_task(worker(remote, local)))
            try:
                await asyncio.sleep(.01)
                values = {"source": nodes[0]["id"], "destination": nodes[1]["id"], "reference": "imported:v1"}
                assert (await operator.post("/api/fleet/image-transfers/preview", json={**values, "destination": nodes[0]["id"]})).status_code == 400
                reviewed = await operator.post("/api/fleet/image-transfers/preview", json=values)
                assert reviewed.status_code == 200, reviewed.text
                plan = reviewed.json()
                result = await operator.post("/api/fleet/image-transfers/execute", json={"nonce": plan["nonce"], "confirmation": plan["confirmation"]})
                assert result.status_code == 200, result.text
                task_id = result.json()["id"]
                manager = central.state.image_transfers
                restarted = False
                original_call = manager.call
                async def lost_chunk_reply(node, method, path, values=None):
                    result = await original_call(node, method, path, values)
                    if values and values.get("step") == "chunk":
                        raise HTTPException(502, "Simulated reply lost after durable write")
                    return result
                manager.call = lost_chunk_reply
                for _ in range(150):
                    row = manager.store.operation_by_id(task_id)
                    if row["status"] in ("success", "failed", "unknown"):
                        break
                    try:
                        await manager.advance(row)
                    except HTTPException as exc:
                        assert exc.status_code == 502 and not restarted
                        assert (tmp_path/"target"/task_id).stat().st_size > row["offset"]
                        manager = ImageTransfers(settings, central.state.fleet, central.state.workspace)
                        restarted = True
                    await asyncio.sleep(.01)
                row = manager.store.operation_by_id(task_id)
                assert row["status"] == "success", row
                assert restarted and target_engine.loads == 1
                assert target_engine.tags["imported:v1"] == IMAGE
                assert not (tmp_path/"source"/"exports"/task_id).exists()
                assert not (tmp_path/"target"/task_id).exists()
                # Repeated import requests return the existing result, never replay Docker load.
                repeated = target.state.operations.queue_transfer(task_id, "load_image", {"upload_id": task_id, "reference": "imported:v1"})
                assert repeated["status"] == "success" and target_engine.loads == 1
                assert (await operator.post("/api/fleet/image-transfers/preview", json=values)).status_code == 409
            finally:
                for task in tasks: task.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)
                for client in clients: await client.aclose()
    asyncio.run(scenario())


def test_copy_preflight_rejects_architecture_and_staging_and_mutations(tmp_path):
    settings = Settings(token=TOKEN, db=str(tmp_path/"db"))
    fleet = SimpleNamespace(node=lambda n, i: {"name": n, "revoked": False})
    manager = ImageTransfers(settings, fleet, None)
    source = {"present": True, "operations_enabled": True, "os": "linux", "architecture": "amd64", "size": 100,
              "staging_free": 10*1024**3, "archive_limit": 32*1024**3, "image_id": IMAGE, "layers": ["layer"], "runtime_digest": "runtime"}
    target = {**source, "present": False, "engine_os": "linux", "engine_architecture": "aarch64", "engine_disk_free": None}
    async def readiness(node, ref): return source if node == "source" else target
    manager.readiness = readiness
    with pytest.raises(HTTPException, match="") as exc:
        asyncio.run(manager.preview("source", "target", "imported:v1"))
    assert exc.value.status_code == 409
    plan = asyncio.run(manager.preview("source", "target", "imported:v1", True))
    with pytest.raises(HTTPException): manager.execute(plan["nonce"], "wrong")
    target["staging_free"] = 1
    with pytest.raises(HTTPException) as exc:
        asyncio.run(manager.preview("source", "target", "imported:v1", True))
    assert exc.value.status_code == 507


def test_retry_uses_separate_credential_review_and_no_replay(tmp_path, monkeypatch):
    calls = []
    def handler(request):
        assert request.headers["PRIVATE-TOKEN"] == "dedicated-retry-secret"
        calls.append(request.method)
        return httpx.Response(200, json={"id": 123 if request.method == "GET" else 124, "name": "lint", "stage": "validate", "ref": "feature", "status": "failed"})
    client_class = httpx.Client
    monkeypatch.setattr("backend.gitlab_connection.httpx.Client", lambda **kwargs: client_class(transport=httpx.MockTransport(handler), **kwargs))
    app = create_app(Settings(token=TOKEN, operations=True, db=str(tmp_path/"db"), gitlab_url="https://gitlab.example", gitlab_token="read-secret", gitlab_retry_token="dedicated-retry-secret", projects=["42"], gitlab_connection_file=str(tmp_path/"gitlab.json")), collect=False)
    with TestClient(app) as client:
        plan, result = execute(client, "retry_gitlab_job", {"project": "42", "job": 123})
        assert result["job_id"] == 124 and calls == ["GET", "GET", "POST"]
        assert client.post("/api/operations/execute", headers=headers(), json={"nonce":plan["nonce"],"confirmation":plan["confirmation"]}).status_code == 409
        assert client.post("/api/operations/preview", headers=headers(), json={"action":"retry_gitlab_job","values":{"project":"not-configured","job":123}}).status_code == 400
        assert "dedicated-retry-secret" not in client.get("/api/events", headers=headers()).text


def test_read_only_gitlab_credential_cannot_retry_jobs(tmp_path):
    app = create_app(Settings(token=TOKEN, operations=True, db=str(tmp_path/"db"), gitlab_url="https://gitlab.example", gitlab_token="read-only", projects=["42"], gitlab_connection_file=str(tmp_path/"gitlab.json")), collect=False)
    with TestClient(app) as client:
        reply = client.post("/api/operations/preview", headers=headers(), json={"action":"retry_gitlab_job","values":{"project":"42","job":123}})
        assert reply.status_code == 403 and "separate" in reply.json()["detail"]


def test_export_rejects_a_different_image_config_before_publishing(operation_app):
    client, app, engine = operation_app
    bad_config = {"architecture":"amd64","os":"linux","rootfs":{"diff_ids":[]},"config":{}}
    engine.api.get_image = lambda ref: iter([archive({"manifest.json":json.dumps([{"Config":"a"*64+".json","RepoTags":[ref]}]), "a"*64+".json":json.dumps(bad_config)})])
    _, task = execute(client, "export_image", {"reference":"source:v1","source_id":IMAGE})
    result = wait_job(client, task["id"])
    assert result["status"] == "failed" and "changed since review" in result["message"]
    assert not (Path(app.state.operations.settings.image_upload_dir)/"exports"/task["id"]).exists()


def test_transfer_import_routes_require_exact_intent(operation_app):
    client, _, _ = operation_app
    base = "/api/operations/transfers/" + "f"*32
    assert client.post(base+"/import", headers=headers(), json={}).status_code == 400
    assert client.post(base+"/export", headers=headers(), json={"reference":"source:v1","source_id":IMAGE}).status_code == 400
    assert client.post(base+"/receive", headers=headers(), json={"step":"begin","reference":"source:v1","bytes":10,"sha256":"a"*64}).status_code == 400


def test_old_active_transfers_stay_visible_and_destination_history_is_scoped(tmp_path):
    from backend.store import Store
    store = Store(str(tmp_path/"history.db"))
    store.operation("active", "running", {"destination":"target", "stage":"copying"}, create=True)
    for index in range(210):
        store.operation(str(index), "success", {"destination":"other"}, create=True)
    assert store.operations(1)[0]["id"] == "active"
    assert [r["id"] for r in store.operations(destination="target")] == ["active"]
