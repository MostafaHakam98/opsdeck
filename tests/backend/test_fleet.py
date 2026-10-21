import asyncio
import json
import time
from uuid import uuid4

import httpx
import pytest
from fastapi.testclient import TestClient

from backend.agent import AgentSettings, Spool, deliver, exclusive_spool
from backend.config import Settings
from backend.fleet import MAX_TELEMETRY_BYTES, Telemetry
from backend.main import create_app

TOKEN = "fleet-test-operator-token-at-least-32-characters"
OPERATOR = {"Authorization": "Bearer " + TOKEN}


def envelope(cpu=25, stamp=None):
    stamp = stamp or time.time()
    values = {"host": {"hostname": "runner.local", "scope": "native", "cpu": {"percent": cpu, "threads": 8},
                       "memory": {"percent": 50}, "network": [{"name": "eth0", "rx_bytes_s": 1024, "tx_bytes_s": None}]},
              "docker": {"ci_running": 2, "containers": []}, "gpu": [], "runner": {}, "services": []}
    return {"schema_version": 1, "sample_id": str(uuid4()), "collected_at": stamp,
            "sources": {key: {"status": "healthy", "data": value, "updated_at": stamp} for key, value in values.items()}}


@pytest.fixture
def app(tmp_path):
    return create_app(Settings(mode="central", token=TOKEN, db=str(tmp_path / "fleet.sqlite")), collect=False)


def enroll(client, name="runner-01", cluster="cluster-a"):
    result = client.post("/api/fleet/nodes", headers=OPERATOR, json={"name": name, "cluster": cluster})
    assert result.status_code == 200, result.text
    return result.json()


def agent(node):
    return {"Authorization": "Bearer " + node["token"]}


def test_central_never_instantiates_local_collectors_or_controls(tmp_path, monkeypatch):
    def forbidden(*args, **kwargs):
        pytest.fail("Central mode instantiated a local collector or control")
    for name in ("HostCollector", "DockerCollector", "Actions", "Operations"):
        monkeypatch.setattr("backend.main." + name, forbidden)
    app = create_app(Settings(mode="central", token=TOKEN, db=str(tmp_path / "central.sqlite"), host_root="/unmounted-runner", procfs_path="/unmounted-runner/proc"))
    with TestClient(app) as client:
        assert client.get("/healthz").json() == {"status": "ok", "mode": "central"}
        assert client.get("/api/fleet", headers=OPERATOR).json()["nodes"] == []
        assert client.post("/api/operations/execute", headers=OPERATOR, json={}).status_code in (404, 405)
    for key in ("actions", "operations"):
        with pytest.raises(ValueError, match="Central mode"):
            Settings(mode="central", token=TOKEN, **{key: True}).validate()


def test_enrollment_credentials_are_hashed_and_scoped(app):
    with TestClient(app) as client:
        assert client.get("/api/fleet").status_code == 401
        assert client.post("/api/fleet/nodes", json={"name": "x", "cluster": "a"}).status_code == 401
        assert client.post("/api/fleet/nodes", headers=OPERATOR, json={"name": " ", "cluster": "a"}).status_code == 422
        node = enroll(client)
        assert client.get("/api/fleet", headers=agent(node)).status_code == 401
        assert client.post("/api/agent/telemetry", headers=OPERATOR, json=envelope()).status_code == 401
        assert client.post("/api/agent/telemetry", headers=agent(node), json=envelope()).status_code == 200
        overview = client.get("/api/fleet", headers=OPERATOR)
        assert overview.headers["cache-control"] == "no-store"
        assert node["token"] not in overview.text
        assert "token_hash" not in overview.text
        row = overview.json()["nodes"][0]
        assert row["metrics"]["cpu"] == 25
        assert row["metrics"]["tx"] is None
        assert row["status"] == "online"
        with app.state.fleet.connect() as db:
            stored = db.execute("SELECT token_hash FROM fleet_nodes").fetchone()[0]
            assert stored != node["token"] and len(stored) == 64
        assert node["token"] not in client.get("/api/events", headers=OPERATOR).text


def test_backfill_and_retry_are_isolated_idempotent_and_do_not_regress_live_data(app):
    with TestClient(app) as client:
        a, b = enroll(client), enroll(client, "runner-02", "cluster-b")
        latest = envelope(90)
        older = envelope(10, time.time() - 30)
        assert client.post("/api/agent/telemetry", headers=agent(a), json=latest).status_code == 200
        assert client.post("/api/agent/telemetry", headers=agent(a), json=older).status_code == 200
        retry = client.post("/api/agent/telemetry", headers=agent(a), json=latest)
        assert retry.json()["duplicate"]
        assert client.get(f'/api/fleet/nodes/{a["id"]}', headers=OPERATOR).json()["sources"]["host"]["data"]["cpu"]["percent"] == 90
        assert client.get(f'/api/fleet/nodes/{b["id"]}/history', headers=OPERATOR).json() == []
        assert client.get(f'/api/fleet/nodes/{b["id"]}', headers=OPERATOR).json()["sources"] == {}
        with app.state.fleet.connect() as db:
            assert db.execute("SELECT COUNT(*) FROM fleet_samples").fetchone()[0] == 2
        forged = {**latest, "node_id": b["id"]}
        assert client.post("/api/agent/telemetry", headers=agent(a), json=forged).status_code == 422


def test_revocation_rotation_and_inflight_revocation(app):
    with TestClient(app) as client:
        node = enroll(client)
        credential = app.state.fleet.credential(node["token"])
        client.post(f'/api/fleet/nodes/{node["id"]}/revoke', headers=OPERATOR)
        assert client.post("/api/agent/telemetry", headers=agent(node), json=envelope()).status_code == 401
        with pytest.raises(Exception) as exc:
            app.state.fleet.ingest(credential, Telemetry.model_validate(envelope()), 30)
        assert exc.value.status_code == 401
        rotated = client.post(f'/api/fleet/nodes/{node["id"]}/rotate', headers=OPERATOR).json()
        assert client.post("/api/agent/telemetry", headers=agent(node), json=envelope()).status_code == 401
        assert client.post("/api/agent/telemetry", headers=agent(rotated), json=envelope()).status_code == 200
        assert client.get("/api/fleet", headers=OPERATOR).json()["nodes"][0]["status"] == "online"


def test_staleness_uses_observation_time_not_backfill_arrival(app):
    with TestClient(app) as client:
        node = enroll(client)
        assert client.get("/api/fleet", headers=OPERATOR).json()["nodes"][0]["status"] == "waiting"
        client.post("/api/agent/telemetry", headers=agent(node), json=envelope(stamp=time.time() - 300))
        assert client.get("/api/fleet", headers=OPERATOR).json()["nodes"][0]["status"] == "stale"
        with app.state.fleet.connect() as db:
            db.execute("UPDATE fleet_nodes SET last_seen=?", (time.time() - 300,))
        assert client.get("/api/fleet", headers=OPERATOR).json()["nodes"][0]["status"] == "offline"
        result = client.get(f'/api/fleet/nodes/{node["id"]}', headers=OPERATOR).json()
        assert result["sources"]["host"]["stale"]


def test_payload_limits_invalid_timestamps_and_nonfinite_values(app):
    with TestClient(app) as client:
        node = enroll(client)
        for value in (time.time() + 120, time.time() - 31 * 86400):
            assert client.post("/api/agent/telemetry", headers=agent(node), json=envelope(stamp=value)).status_code == 422
        for change in ("schema", "missing", "shape", "timestamp"):
            body = envelope()
            if change == "schema": body["schema_version"] = 2
            if change == "missing": del body["sources"]["host"]
            if change == "shape": body["sources"]["host"]["data"] = []
            if change == "timestamp": body["sources"]["host"]["updated_at"] = time.time() + 120
            assert client.post("/api/agent/telemetry", headers=agent(node), json=body).status_code == 422
        body = envelope()
        body["sources"]["host"]["data"]["cpu"]["percent"] = float("nan")
        assert client.post("/api/agent/telemetry", headers=agent(node), content=json.dumps(body)).status_code == 422
        assert client.post("/api/agent/telemetry", headers=agent(node), content=b"x" * (MAX_TELEMETRY_BYTES + 1)).status_code == 413
        assert client.post("/api/agent/telemetry", headers=agent(node), content=b"{}").status_code == 422


def test_history_aggregation_retention_and_persistence(app):
    fleet = app.state.fleet
    node = fleet.enroll("runner", "a")
    credential = fleet.credential(node["token"])
    stamp = time.time() - 20
    for i in range(605):
        fleet.ingest(credential, Telemetry.model_validate(envelope(i % 100, stamp + i * .001)), 30)
    history = fleet.node_history(node["id"], 1)
    assert len(history) <= 600
    assert max(row["cpu_peak"] for row in history) == 99
    assert history[0]["cpu"] != history[0]["cpu_peak"]
    with fleet.connect() as db:
        db.execute("UPDATE fleet_samples SET ts=?", (time.time() - 31 * 86400,))
    fleet.prune(30)
    assert fleet.node_history(node["id"], 720) == []
    restarted = create_app(Settings(mode="central", token=TOKEN, db=fleet.path))
    assert restarted.state.fleet.nodes(10)[0]["id"] == node["id"]
    assert restarted.state.fleet.credential(node["token"])[0] == node["id"]


def test_queue_survives_restart_and_drops_oldest_with_bounded_storage(tmp_path):
    settings = AgentSettings(spool=str(tmp_path / "queue.sqlite"), max_samples=3)
    spool = Spool(settings)
    payloads = [envelope(i) for i in range(4)]
    for payload in payloads:
        spool.push(payload)
    restored = Spool(settings)
    rows = restored.pending()
    assert len(rows) == 3
    assert json.loads(rows[0][1])["sample_id"] == payloads[-1]["sample_id"]
    assert payloads[0]["sample_id"] not in str(rows)
    settings.max_bytes = len(rows[0][1]) * 2 + 10
    restored.push(envelope(5))
    with restored.connect() as db:
        assert db.execute("SELECT SUM(length(payload)) FROM queue").fetchone()[0] <= settings.max_bytes
    with exclusive_spool(settings.spool):
        with pytest.raises(ValueError, match="Another agent"):
            with exclusive_spool(settings.spool):
                pass


def test_delivery_retries_transient_failures_and_rejects_false_acknowledgement(tmp_path):
    settings = AgentSettings(server="https://opsdeck.example", token="node." + "s" * 64, spool=str(tmp_path / "queue.sqlite"))
    spool = Spool(settings)
    spool.push(envelope())
    async def attempt(status, response):
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda _: httpx.Response(status, json=response))) as client:
            return await deliver(spool, client, settings)
    assert not asyncio.run(attempt(503, {}))
    assert not asyncio.run(attempt(401, {}))
    assert not asyncio.run(attempt(200, {}))
    assert len(spool.pending()) == 1
    assert asyncio.run(attempt(200, {"accepted": True}))
    assert spool.pending() == []
    spool.push(envelope())
    assert asyncio.run(attempt(422, {}))
    assert spool.pending() == []


def test_agent_queue_delivers_to_real_ingestion_and_replay_is_acknowledged(app, tmp_path):
    node = app.state.fleet.enroll("integration-runner", "cluster-a")
    settings = AgentSettings(server="https://opsdeck.example", token=node["token"], spool=str(tmp_path / "queue.sqlite"))
    spool = Spool(settings)
    body = envelope()
    async def send():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app)) as client:
            return await deliver(spool, client, settings)
    spool.push(body)
    assert asyncio.run(send())
    spool.push(body)
    assert asyncio.run(send())
    assert spool.pending() == []
    with app.state.fleet.connect() as db:
        assert db.execute("SELECT COUNT(*) FROM fleet_samples").fetchone()[0] == 1


@pytest.mark.parametrize("server", ["http://opsdeck.example", "https://user:secret@opsdeck.example", "https://opsdeck.example/path", "https://opsdeck.example?token=x", "", "ftp://localhost"])
def test_agent_rejects_insecure_or_ambiguous_server_urls(server):
    with pytest.raises(ValueError):
        AgentSettings(server=server, token="node." + "s" * 64).validate()


def test_agent_allows_verified_https_and_loopback_development():
    for server in ("https://opsdeck.example", "http://127.0.0.1:8080", "http://[::1]:8080"):
        AgentSettings(server=server, token="node." + "s" * 64).validate()
