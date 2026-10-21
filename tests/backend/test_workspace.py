import asyncio
from types import SimpleNamespace

import httpx
import pytest

from backend.config import Settings
from backend.main import create_app
from backend.workspace import MAX_JSON, WorkspaceRelay, allowed
from backend.workspace_agent import WorkspaceSettings, handle

OPERATOR = "workspace-operator-test-secret-over-32-characters"
HOST_SECRET = "workspace-host-test-secret-over-32-characters"


def test_workspace_allowlist_and_destination_validation(monkeypatch):
    for method, path in [("GET", "snapshot"), ("GET", "checkpoints/compare"), ("POST", "integrations/gitlab"), ("POST", "operations/uploads")]:
        assert allowed(method, path)
    for method, path in [("DELETE", "events"), ("GET", "../snapshot"), ("GET", "https://example.com"), ("POST", "snapshot"), ("GET", "healthz"), ("POST", "operations/uploads/../execute")]:
        assert not allowed(method, path)
    for url in ["http://169.254.169.254", "https://127.0.0.1", "http://user:pass@127.0.0.1", "http://127.0.0.1/path", "http://127.0.0.1?path=x", "http://127.0.0.1:invalid"]:
        with pytest.raises(ValueError):
            WorkspaceSettings(url, HOST_SECRET).validate()
    WorkspaceSettings("http://127.0.0.1:8080", HOST_SECRET).validate()
    WorkspaceSettings().validate()


def test_host_workspace_relay_preserves_api_auth_state_uploads_and_node_isolation(tmp_path):
    async def scenario():
        central = create_app(Settings(mode="central", token=OPERATOR, db=str(tmp_path / "central.sqlite")))
        local = create_app(Settings(token=HOST_SECRET, db=str(tmp_path / "host.sqlite")), collect=False)
        relay = central.state.workspace
        async with local.router.lifespan_context(local), httpx.AsyncClient(transport=httpx.ASGITransport(app=central), base_url="http://central") as operator, httpx.AsyncClient(transport=httpx.ASGITransport(app=local), base_url="http://host") as host:
            headers = {"Authorization": "Bearer " + OPERATOR}
            node = (await operator.post("/api/fleet/nodes", headers=headers, json={"name": "one", "cluster": "a"})).json()
            other = (await operator.post("/api/fleet/nodes", headers=headers, json={"name": "two", "cluster": "b"})).json()
            agent_headers = {"Authorization": "Bearer " + node["token"]}
            other_headers = {"Authorization": "Bearer " + other["token"]}
            root = "/api/fleet/nodes/" + node["id"] + "/workspace/"
            assert (await operator.get(root + "snapshot")).status_code == 401
            assert (await operator.get(root + "snapshot", headers=agent_headers)).status_code == 401
            assert (await operator.get(root + "snapshot", headers=headers)).status_code == 503
            relay.contacts[node["id"]] = __import__("time").monotonic()
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=central), base_url="http://central", headers=agent_headers) as agent:
                async def forward(path, data=None, raw=None, local_client=host):
                    request = asyncio.create_task(operator.request("POST" if data is not None or raw is not None else "GET", root + path, headers=headers, json=data, content=raw))
                    for _ in range(100):
                        await asyncio.sleep(.001)
                        if any(v.ready for v in relay.pending.values()):
                            break
                    job = (await agent.get("/api/agent/workspace/requests")).json()
                    wrong = await operator.get("/api/agent/workspace/requests/" + job["id"] + "/body", headers=other_headers)
                    assert wrong.status_code == 404
                    wrong_result = await operator.post("/api/agent/workspace/requests/" + job["id"] + "/result", headers=other_headers, json={})
                    assert wrong_result.status_code == 404
                    await handle(job, agent, local_client, SimpleNamespace(server="http://central"), WorkspaceSettings("http://host", HOST_SECRET))
                    return await request
                snapshot = await forward("snapshot")
                assert snapshot.status_code == 200
                assert HOST_SECRET not in snapshot.text and OPERATOR not in snapshot.text
                assert "sources" in snapshot.json()
                capabilities = await forward("operations/capabilities")
                assert capabilities.status_code == 200 and not capabilities.json()["enabled"]
                denied = await forward("operations/preview", {"action": "tag_image", "values": {}})
                assert denied.status_code == 403
                checkpoint = await forward("checkpoints", {"title": "Remote checkpoint", "notes": "Keep host history", "scope": {"project": "all", "pipeline": "all", "image": "all", "hours": 24}})
                assert checkpoint.status_code == 200
                rows = await forward("checkpoints")
                assert rows.json()[0]["title"] == "Remote checkpoint"
                assert (await forward("workloads?project=all&hours=24")).status_code == 200
                assert (await forward("integrations/gitlab")).status_code == 200
                # Uploads are streamed, and the host's existing permission gate is preserved.
                assert (await forward("operations/uploads?kind=context&name=test.tar", raw=b"archive")).status_code == 403
                async def uploaded(request):
                    assert request.headers["Authorization"] == "Bearer " + HOST_SECRET
                    assert request.url.path == "/api/operations/uploads"
                    assert request.url.params["name"] == "payload.tar"
                    payload = await request.aread()
                    return httpx.Response(200, json={"bytes": len(payload)})
                async with httpx.AsyncClient(transport=httpx.MockTransport(uploaded)) as upload_host:
                    uploaded_reply = await forward("operations/uploads?kind=context&name=payload.tar", raw=b"z" * (MAX_JSON * 3), local_client=upload_host)
                    assert uploaded_reply.json() == {"bytes": MAX_JSON * 3}
                assert not relay.pending
                assert (await operator.get(root + "unrecognized", headers=headers)).status_code == 404
                assert (await operator.post(root + "checkpoints", headers=headers, content=b"x" * (MAX_JSON + 1))).status_code == 413
                assert not relay.pending
    asyncio.run(scenario())


def test_credential_revocation_cancels_pending_without_replaying(tmp_path):
    async def scenario():
        relay = WorkspaceRelay(tmp_path, 1024)
        future = asyncio.get_running_loop().create_future()
        from backend.workspace import Exchange
        relay.pending["job"] = Exchange("node", "POST", "checkpoints", "", "application/json", None, 0, future, True, True)
        relay.cancel("node")
        from fastapi import HTTPException
        with pytest.raises(HTTPException, match=""):
            await future
        assert not relay.online("node")
    asyncio.run(scenario())


def test_long_poll_rechecks_credentials_before_claiming_after_rotation(tmp_path):
    async def scenario():
        from fastapi import HTTPException
        from backend.workspace import Exchange
        relay = WorkspaceRelay(tmp_path, 1024)
        valid = True
        def verify():
            if not valid:
                raise HTTPException(401, "Credential rotated")
        waiting = asyncio.create_task(relay.claim("node", verify))
        for _ in range(100):
            if "node" in relay.wakes:
                break
            await asyncio.sleep(.001)
        await asyncio.sleep(.01)
        valid = False
        future = asyncio.get_running_loop().create_future()
        relay.pending["new-job"] = Exchange("node", "GET", "snapshot", "", "application/json", None, 0, future, False, True)
        relay.wakes["node"].set()
        with pytest.raises(HTTPException) as error:
            await waiting
        assert error.value.status_code == 401
        assert not relay.pending["new-job"].claimed
    asyncio.run(scenario())
