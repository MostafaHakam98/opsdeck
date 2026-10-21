import asyncio
import time

import httpx
import pytest
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

from backend.config import Settings
from backend.main import create_app
from backend.web import IMMUTABLE, SelectiveGZip

TOKEN = "web-delivery-operator-token-at-least-32-characters"
OPERATOR = {"Authorization": "Bearer " + TOKEN}
GZIP = {"Accept-Encoding": "gzip"}


def test_selective_gzip_skips_relay_and_agent_paths_and_small_bodies():
    inner = FastAPI()
    @inner.get("/{path:path}")
    def anything(path: str, size: int = 2048):
        return JSONResponse({"data": "x" * size})
    client = TestClient(SelectiveGZip(inner))
    assert client.get("/api/fleet", headers=GZIP).headers.get("content-encoding") == "gzip"
    assert client.get("/assets/app.js", headers=GZIP).headers.get("content-encoding") == "gzip"
    assert "content-encoding" not in client.get("/api/fleet?size=900", headers=GZIP).headers
    assert "content-encoding" not in client.get("/api/fleet", headers={"Accept-Encoding": "identity"}).headers
    for path in ("/api/agent/telemetry", "/api/agent/workspace/requests/x/body", "/api/fleet/nodes/abc/workspace/snapshot"):
        response = client.get(path, headers=GZIP)
        assert "content-encoding" not in response.headers and len(response.content) > 2048, path
    assert client.get("/api/fleet/nodes/abc/history", headers=GZIP).headers.get("content-encoding") == "gzip"


def test_fleet_api_is_compressed_but_relay_and_agent_channels_are_not(tmp_path):
    async def scenario():
        app = create_app(Settings(mode="central", token=TOKEN, db=str(tmp_path / "fleet.sqlite")), collect=False)
        relay = app.state.workspace
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://central", headers={**OPERATOR, **GZIP}) as operator:
            nodes = [(await operator.post("/api/fleet/nodes", json={"name": f"runner-{i:02}", "cluster": "a"})).json() for i in range(8)]
            overview = await operator.get("/api/fleet")
            assert overview.headers.get("content-encoding") == "gzip" and overview.json()["summary"]["hosts"] == 8
            assert len(overview.content) >= 1024
            node = nodes[0]
            relay.contacts[node["id"]] = time.monotonic()
            async with httpx.AsyncClient(transport=transport, base_url="http://central", headers={"Authorization": "Bearer " + node["token"], **GZIP}) as agent:
                request = asyncio.create_task(operator.post(f'/api/fleet/nodes/{node["id"]}/workspace/checkpoints', json={"title": "t", "notes": "n" * 3000}))
                for _ in range(200):
                    await asyncio.sleep(.001)
                    if any(v.ready for v in relay.pending.values()):
                        break
                claim = await agent.get("/api/agent/workspace/requests")
                job = claim.json()
                assert "content-encoding" not in claim.headers
                body = await agent.get(f'/api/agent/workspace/requests/{job["id"]}/body')
                assert "content-encoding" not in body.headers and len(body.content) > 3000
                done = await agent.post(f'/api/agent/workspace/requests/{job["id"]}/result', content=b'{"rows": "' + b"r" * 4000 + b'"}', headers={"X-Workspace-Status": "200"})
                assert done.status_code == 200 and "content-encoding" not in done.headers
                reply = await request
                assert reply.status_code == 200 and "content-encoding" not in reply.headers and len(reply.content) > 4000
    asyncio.run(scenario())


@pytest.fixture
def static(tmp_path):
    root = tmp_path / "dist"
    (root / "assets").mkdir(parents=True)
    (root / "index.html").write_text("<!doctype html><title>OpsDeck</title>" + "<!-- pad -->" * 200)
    (root / "assets" / "app-3f9a1c.js").write_text("console.log('opsdeck');" * 100)
    return root


@pytest.mark.parametrize("mode", ["central", "standalone"])
def test_hashed_assets_are_immutable_and_index_is_revalidated(tmp_path, static, mode):
    app = create_app(Settings(mode=mode, token=TOKEN, db=str(tmp_path / f"{mode}.sqlite"), static=static), collect=False)
    with TestClient(app) as client:
        asset = client.get("/assets/app-3f9a1c.js", headers=GZIP)
        assert asset.status_code == 200 and asset.headers["cache-control"] == IMMUTABLE
        assert asset.headers.get("content-encoding") == "gzip"
        missing = client.get("/assets/missing-000.js")
        assert missing.status_code == 404 and missing.headers.get("cache-control") != IMMUTABLE
        for path in ("/", "/fleet/hosts"):
            page = client.get(path, headers=GZIP)
            assert page.status_code == 200 and page.headers["cache-control"] == "no-cache" and "OpsDeck" in page.text
            assert page.headers.get("content-encoding") == "gzip"
        assert client.get("/api/events", headers=OPERATOR).headers["cache-control"] == "no-store"
        health = client.get("/healthz").json()
        assert health["mode"] == mode and health["version"] == Settings().version
