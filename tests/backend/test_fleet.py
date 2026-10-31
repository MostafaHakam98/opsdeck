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
        assert client.get("/healthz").json() == {"status": "ok", "mode": "central", "version": app.state.version}
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


NOW = 1_700_000_030.0


def node_row(name="runner-01", status="online", maintenance=False, sources=None, **metrics):
    return {"id": "id-" + name, "name": name, "cluster": "cluster-a", "status": status, "maintenance": maintenance, "last_seen": NOW - 300,
            "age_seconds": 5, "metrics": {**dict.fromkeys(("cpu", "memory", "gpu", "io_pressure", "ci_running")), **metrics}, "source_status": sources or {}}


def put_samples(fleet, identifier, rows):
    with fleet.connect() as db:
        db.executemany("INSERT INTO fleet_samples VALUES (?,?,?,?)", [(identifier, str(uuid4()), ts, json.dumps(values)) for ts, values in rows])


def test_schema_migration_adds_defaulted_columns_idempotently_and_stays_rollback_compatible(tmp_path):
    import sqlite3
    from backend.fleet import Fleet
    path = str(tmp_path / "old.sqlite")
    with sqlite3.connect(path) as db:
        db.execute("CREATE TABLE fleet_nodes (id TEXT PRIMARY KEY, name TEXT NOT NULL, cluster TEXT NOT NULL, token_hash TEXT NOT NULL, created_at REAL NOT NULL, revoked INTEGER NOT NULL DEFAULT 0, last_seen REAL, collected_at REAL, snapshot TEXT, summary TEXT)")
        db.execute("INSERT INTO fleet_nodes(id,name,cluster,token_hash,created_at) VALUES ('old','legacy','a','x',1)")
    fleet = Fleet(path)
    Fleet(path)
    node = fleet.node("old", 10)
    assert (node["notes"], node["maintenance"], node["status"], node["ignored_sources"], node["source_messages"]) == ("", False, "waiting", [], {})
    with fleet.connect() as db:
        columns = [row[1] for row in db.execute("PRAGMA table_info(fleet_nodes)")]
        assert columns.count("notes") == 1 and columns.count("maintenance") == 1 and columns.count("ignored_sources") == 1
        # The previous release inserts and reads with explicit column lists only.
        db.execute("INSERT INTO fleet_nodes(id,name,cluster,token_hash,created_at) VALUES ('new','n','a','y',2)")
        assert db.execute("SELECT id,name,cluster,created_at,revoked,last_seen,collected_at,summary FROM fleet_nodes WHERE id='new'").fetchone()[0] == "new"
    assert fleet.node("new", 10)["maintenance"] is False and fleet.node("new", 10)["ignored_sources"] == []


def test_alert_rules_thresholds_suppression_and_order():
    from backend.fleet import fleet_alerts
    nodes = [node_row("zeta", cpu=95, memory=85, io_pressure=12, sources={"gpu": "unavailable", "docker": "degraded", "host": "healthy", "runner": "not_configured"}),
             node_row("alpha", cpu=80, memory=79.9, io_pressure=25),
             node_row("beta", status="offline"), node_row("gamma", status="stale"),
             node_row("delta", status="waiting"), node_row("eps", status="revoked", cpu=99),
             node_row("maint", status="offline", maintenance=True), node_row("maint2", maintenance=True, cpu=99),
             node_row("old", status="offline", cpu=99)]
    nodes[3]["age_seconds"] = 600
    alerts = fleet_alerts(nodes, NOW)
    summary = [(a["node_name"], a["severity"], a["kind"], a["title"]) for a in alerts]
    assert summary == [("alpha", "critical", "io_pressure", "High I/O pressure"), ("beta", "critical", "offline", "Agent offline"),
                       ("old", "critical", "offline", "Agent offline"), ("zeta", "critical", "cpu", "High CPU load"),
                       ("alpha", "warning", "cpu", "High CPU load"), ("gamma", "warning", "stale", "Telemetry stale"),
                       ("zeta", "warning", "memory", "High memory use"), ("zeta", "warning", "io_pressure", "High I/O pressure"),
                       ("zeta", "warning", "source", "GPU source unavailable"), ("zeta", "warning", "source", "Docker source degraded")]
    assert len({a["key"] for a in alerts}) == len(alerts)
    offline = next(a for a in alerts if a["kind"] == "offline")
    assert offline["value"] == 300 and "5 min" in offline["detail"] and offline["cluster"] == "cluster-a"
    assert next(a for a in alerts if a["kind"] == "stale")["value"] == 600
    assert next(a for a in alerts if a["kind"] == "cpu")["value"] == 95
    assert set(alerts[0]) == {"key", "node_id", "node_name", "cluster", "severity", "kind", "title", "detail", "value"}
    assert fleet_alerts([node_row(cpu=79.9, memory=10, io_pressure=9.9)], NOW) == []


def test_summary_counts_and_online_averages():
    from backend.fleet import fleet_alerts, fleet_summary
    nodes = [node_row("a", cpu=10, memory=20, ci_running=2), node_row("b", cpu=95, memory=None, ci_running=1.5, gpu=40),
             node_row("c", status="offline", cpu=99, ci_running=9), node_row("d", status="waiting"), node_row("e", status="revoked"),
             node_row("f", status="stale", maintenance=True)]
    nodes[-1]["cluster"] = "cluster-b"
    alerts = fleet_alerts(nodes, NOW)
    assert fleet_summary(nodes, alerts) == {"hosts": 6, "online": 2, "waiting": 1, "stale": 1, "offline": 1, "revoked": 1, "maintenance": 1,
                                            "clusters": 2, "ci_running": 3.5, "avg_cpu": 52.5, "avg_memory": 20, "avg_gpu": 40,
                                            "alerts_critical": 2, "alerts_warning": 0}
    empty = fleet_summary([node_row("x", status="offline", cpu=50)], [])
    assert (empty["avg_cpu"], empty["avg_memory"], empty["avg_gpu"], empty["ci_running"]) == (None, None, None, None)


def test_overview_carries_notes_maintenance_summary_alerts_and_version(tmp_path):
    app = create_app(Settings(mode="central", token=TOKEN, db=str(tmp_path / "fleet.sqlite"), version="1.4.0-test"), collect=False)
    with TestClient(app) as client:
        node = enroll(client)
        client.post("/api/agent/telemetry", headers=agent(node), json=envelope(cpu=97))
        body = client.get("/api/fleet", headers=OPERATOR).json()
        assert body["version"] == "1.4.0-test" and client.get("/healthz").json()["version"] == "1.4.0-test"
        assert (body["nodes"][0]["notes"], body["nodes"][0]["maintenance"]) == ("", False)
        assert body["summary"]["online"] == 1 and body["summary"]["avg_cpu"] == 97 and body["summary"]["ci_running"] == 2
        assert [(a["kind"], a["severity"], a["node_id"]) for a in body["alerts"]] == [("cpu", "critical", node["id"])]
        assert body["summary"]["alerts_critical"] == 1


def test_pulse_buckets_averages_with_null_gaps(app, monkeypatch):
    fleet = app.state.fleet
    a, b = fleet.enroll("a", "c1"), fleet.enroll("b", "c2")
    monkeypatch.setattr(time, "time", lambda: NOW)
    first = fleet.pulse(10, 10)
    start, width = first["start"], first["bucket_seconds"]
    assert width == 60 and first["end"] - start == 600 and start <= NOW - 540 and first["end"] > NOW and first["end"] % 60 == 0
    put_samples(fleet, a["id"], [(start + 1, {"cpu": 10, "memory": 40}), (start + 59, {"cpu": 30, "memory": None, "gpu": 5}),
                                 (start + 9 * 60 + 2, {"cpu": 50}), (start - 1, {"cpu": 99}), (first["end"], {"cpu": 99})])
    result = fleet.pulse(10, 10)
    assert set(result["nodes"]) == {a["id"], b["id"]}
    assert result["nodes"][a["id"]]["cpu"] == [20.0] + [None] * 8 + [50.0]
    assert result["nodes"][a["id"]]["memory"] == [40.0] + [None] * 9
    assert result["nodes"][a["id"]]["gpu"] == [5.0] + [None] * 9
    assert result["nodes"][b["id"]] == {"cpu": [None] * 10, "memory": [None] * 10, "gpu": [None] * 10}
    monkeypatch.undo()
    with TestClient(app) as client:
        assert client.get("/api/fleet/pulse").status_code == 401
        default = client.get("/api/fleet/pulse", headers=OPERATOR).json()
        assert default["bucket_seconds"] == 60 and len(default["nodes"][a["id"]]["cpu"]) == 60
        assert client.get("/api/fleet/pulse?minutes=525600", headers=OPERATOR).status_code == 200
        for query in ("minutes=4", "minutes=525601", "buckets=9", "buckets=121"):
            assert client.get("/api/fleet/pulse?" + query, headers=OPERATOR).status_code == 422


def test_long_pulse_windows_use_backfilled_ingested_and_pruned_rollups(app, monkeypatch):
    from backend.fleet import Fleet, ROLLUP_SECONDS
    fleet = app.state.fleet
    node = fleet.enroll("a", "c1")
    monkeypatch.setattr(time, "time", lambda: NOW)
    start = fleet.pulse(10080, 60)["start"]
    put_samples(fleet, node["id"], [(start + 100, {"cpu": 10, "memory": 40}), (start + 200, {"cpu": 30, "memory": None})])
    # A database from the previous release has raw samples and no rollups; startup backfills them once.
    with fleet.connect() as db:
        db.execute("DROP TABLE fleet_rollups")
    fleet = Fleet(fleet.path)
    Fleet(fleet.path)
    week = fleet.pulse(10080, 60)
    assert week["bucket_seconds"] == 10080 and len(week["nodes"][node["id"]]["cpu"]) == 60
    assert week["nodes"][node["id"]]["cpu"][0] == 20.0 and week["nodes"][node["id"]]["memory"][0] == 40.0
    sample = Telemetry.model_validate(envelope(50, NOW - 5))
    credential = fleet.credential(node["token"])
    fleet.ingest(credential, sample, 30)
    fleet.ingest(credential, sample, 30)
    with fleet.connect() as db:
        assert db.execute("SELECT cpu_sum,cpu_n,gpu_n FROM fleet_rollups WHERE bucket=?", (int((NOW - 5) // ROLLUP_SECONDS),)).fetchone() == (50, 1, 0)
    week = fleet.pulse(10080, 60)["nodes"][node["id"]]
    assert (week["cpu"][-1], week["memory"][-1], week["gpu"]) == (50.0, 50.0, [None] * 60)
    year = fleet.pulse(525600, 60)["nodes"][node["id"]]["cpu"]
    assert year[-1] == 50.0 and 20.0 in year
    # Rollups follow the longer trend retention, so long windows outlive raw samples.
    monkeypatch.setattr(time, "time", lambda: NOW + 2 * 86400)
    fleet.prune(1, 366)
    with fleet.connect() as db:
        assert db.execute("SELECT COUNT(*) FROM fleet_samples").fetchone()[0] == 0
    assert 20.0 in fleet.pulse(525600, 60)["nodes"][node["id"]]["cpu"]
    fleet.prune(1, 1)
    assert fleet.pulse(525600, 60)["nodes"][node["id"]]["cpu"] == [None] * 60


def test_fleet_history_averages_hosts_not_samples_and_filters_cluster(app, monkeypatch):
    fleet = app.state.fleet
    a, b = fleet.enroll("a", "c1"), fleet.enroll("b", "c2")
    monkeypatch.setattr(time, "time", lambda: NOW)
    start, width = NOW - 3600, 3600 / 599
    base = start + width * 10 + 1
    put_samples(fleet, a["id"], [(base + i * .01, {"cpu": 10, "memory": 20, "gpu": None, "ci_running": 2}) for i in range(3)])
    put_samples(fleet, b["id"], [(base, {"cpu": 40, "memory": 60, "gpu": 30, "ci_running": 1}), (base + .5, {"cpu": 50, "memory": 70, "gpu": 30, "ci_running": 2})])
    put_samples(fleet, b["id"], [(base + width * 100, {"cpu": 5, "memory": 5, "ci_running": None})])
    rows = fleet.fleet_history(1)
    assert len(rows) == 2
    first = rows[0]
    assert (first["cpu"], first["cpu_peak"], first["memory"], first["memory_peak"], first["gpu"], first["ci_running"], first["hosts"]) == (27.5, 50, 42.5, 70, 30, 3.5, 2)
    assert first["ts"] == base + .5
    assert (rows[1]["hosts"], rows[1]["ci_running"], rows[1]["gpu"]) == (1, None, None)
    only_b = fleet.fleet_history(1, "c2")
    assert [row["hosts"] for row in only_b] == [1, 1] and only_b[0]["cpu"] == 45
    assert fleet.fleet_history(1, "missing") == []
    monkeypatch.undo()
    with TestClient(app) as client:
        assert client.get("/api/fleet/history", headers=OPERATOR).status_code == 200
        assert client.get("/api/fleet/history?hours=24&cluster=c1", headers=OPERATOR).json() == []
        for query in ("hours=0", "hours=169", "cluster="):
            assert client.get("/api/fleet/history?" + query, headers=OPERATOR).status_code == 422


def test_node_settings_update_audit_and_validation(app):
    with TestClient(app) as client:
        node = enroll(client)
        assert client.post(f'/api/fleet/nodes/{node["id"]}/settings', json={"notes": "x"}).status_code == 401
        before = len(client.get("/api/events", headers=OPERATOR).json())
        result = client.post(f'/api/fleet/nodes/{node["id"]}/settings', headers=OPERATOR, json={"notes": " Disk swap Friday ", "maintenance": True})
        assert result.status_code == 200, result.text
        updated = result.json()
        listed = client.get("/api/fleet", headers=OPERATOR).json()["nodes"][0]
        assert updated == {**listed, "age_seconds": updated["age_seconds"]}
        assert (updated["notes"], updated["maintenance"]) == ("Disk swap Friday", True)
        events = client.get("/api/events", headers=OPERATOR).json()
        assert [(e["title"], e["detail"]) for e in events[:2]] == [("Maintenance started", "runner-01 in cluster-a"), ("Host settings changed", "runner-01: notes")]
        renamed = client.post(f'/api/fleet/nodes/{node["id"]}/settings', headers=OPERATOR, json={"name": "runner-02", "cluster": "cluster-b", "maintenance": False}).json()
        assert (renamed["name"], renamed["cluster"], renamed["notes"], renamed["maintenance"]) == ("runner-02", "cluster-b", "Disk swap Friday", False)
        events = client.get("/api/events", headers=OPERATOR).json()
        assert [(e["title"], e["detail"]) for e in events[:2]] == [("Maintenance ended", "runner-02 in cluster-b"), ("Host settings changed", "runner-02: name (was runner-01), cluster")]
        unchanged = client.post(f'/api/fleet/nodes/{node["id"]}/settings', headers=OPERATOR, json={"name": "runner-02", "notes": None})
        assert unchanged.status_code == 200 and len(client.get("/api/events", headers=OPERATOR).json()) == before + 4
        # The agent credential is unaffected by identity changes.
        assert client.post("/api/agent/telemetry", headers=agent(node), json=envelope()).status_code == 200
        assert client.post("/api/fleet/nodes/" + str(uuid4()) + "/settings", headers=OPERATOR, json={"notes": "x"}).status_code == 404
        for bad in ({"name": " "}, {"cluster": ""}, {"name": "x" * 121}, {"notes": "x" * 501}, {"token": "x"}, {"maintenance": "sometimes"}):
            assert client.post(f'/api/fleet/nodes/{node["id"]}/settings', headers=OPERATOR, json=bad).status_code == 422, bad
        assert client.post(f'/api/fleet/nodes/{node["id"]}/settings', headers=OPERATOR, json={"notes": ""}).json()["notes"] == ""


def test_maintenance_silences_alerts_until_it_ends(app):
    with TestClient(app) as client:
        node = enroll(client)
        client.post("/api/agent/telemetry", headers=agent(node), json=envelope())
        with app.state.fleet.connect() as db:
            db.execute("UPDATE fleet_nodes SET last_seen=?", (time.time() - 300,))
        assert [a["kind"] for a in client.get("/api/fleet", headers=OPERATOR).json()["alerts"]] == ["offline"]
        client.post(f'/api/fleet/nodes/{node["id"]}/settings', headers=OPERATOR, json={"maintenance": True})
        body = client.get("/api/fleet", headers=OPERATOR).json()
        assert body["alerts"] == [] and body["summary"]["maintenance"] == 1 and body["summary"]["alerts_critical"] == 0


def test_events_limit_and_case_insensitive_literal_filter(app):
    fleet = app.state.fleet
    for index in range(5):
        fleet.event("action", "info", f"Title {index}", "detail")
    fleet.event("action", "info", "Disk", "Usage 100%_FULL on Runner-07")
    with TestClient(app) as client:
        assert len(client.get("/api/events?limit=2", headers=OPERATOR).json()) == 2
        assert len(client.get("/api/events", headers=OPERATOR).json()) == 6
        assert [e["title"] for e in client.get("/api/events?q=runner-07", headers=OPERATOR).json()] == ["Disk"]
        assert [e["title"] for e in client.get("/api/events?q=TITLE 3", headers=OPERATOR).json()] == ["Title 3"]
        assert [e["title"] for e in client.get("/api/events?q=0%25_f", headers=OPERATOR).json()] == ["Disk"]
        assert client.get("/api/events?q=%25", headers=OPERATOR).json()[0]["title"] == "Disk"
        assert len(client.get("/api/events?q=%25", headers=OPERATOR).json()) == 1
        assert len(client.get("/api/events?q=title&limit=3", headers=OPERATOR).json()) == 3
        for query in ("limit=0", "limit=1001", "q=" + "x" * 201):
            assert client.get("/api/events?" + query, headers=OPERATOR).status_code == 422


def test_prometheus_exposition_and_label_escaping(tmp_path):
    from backend.fleet import label_value
    app = create_app(Settings(mode="central", token=TOKEN, db=str(tmp_path / "fleet.sqlite"), version='v"1'), collect=False)
    fleet = app.state.fleet
    node = fleet.enroll('run"ner\\01', "cluster\na")
    fleet.ingest(fleet.credential(node["token"]), Telemetry.model_validate(envelope(cpu=95)), 30)
    idle = fleet.enroll("idle", "b")
    assert label_value('a\\b"c\nd') == 'a\\\\b\\"c\\nd'
    with TestClient(app) as client:
        assert client.get("/api/fleet/metrics").status_code == 401
        result = client.get("/api/fleet/metrics", headers=OPERATOR)
        assert result.headers["content-type"].startswith("text/plain; version=0.0.4")
        lines = result.text.splitlines()
        labels = f'node="run\\"ner\\\\01",cluster="cluster\\na",node_id="{node["id"]}"'
        for line in (f"opsdeck_node_up{{{labels}}} 1", f"opsdeck_node_cpu_percent{{{labels}}} 95", f"opsdeck_node_memory_percent{{{labels}}} 50",
                     f"opsdeck_node_ci_running{{{labels}}} 2", f"opsdeck_node_maintenance{{{labels}}} 0",
                     f'opsdeck_node_up{{node="idle",cluster="b",node_id="{idle["id"]}"}} 0',
                     'opsdeck_fleet_alerts{severity="critical"} 1', 'opsdeck_fleet_alerts{severity="warning"} 0',
                     'opsdeck_build_info{version="v\\"1"} 1', "# TYPE opsdeck_node_up gauge"):
            assert line in lines, line
        assert any(line.startswith(f"opsdeck_node_age_seconds{{{labels}}} ") for line in lines)
        assert not any(line.startswith("opsdeck_node_gpu_percent{") for line in lines)
        assert not any(f'node_id="{idle["id"]}"' in line for line in lines if line.startswith("opsdeck_node_cpu_percent"))
        assert result.text.endswith("\n") and all(line.startswith(("#", "opsdeck_")) for line in lines)


def test_build_version_sources(tmp_path, monkeypatch):
    import backend.config as config
    monkeypatch.setattr(config, "__file__", str(tmp_path / "backend" / "config.py"))
    monkeypatch.delenv("OPSDECK_VERSION", raising=False)
    assert config.build_version() == "dev"
    (tmp_path / "SOURCE_COMMIT").write_text("abc1234\n")
    assert config.build_version() == "abc1234" and Settings().version == "abc1234"
    monkeypatch.setenv("OPSDECK_VERSION", " 2.0.0 ")
    assert config.build_version() == "2.0.0"


def test_single_node_lookup_and_unknown_workspace_node(app):
    with TestClient(app) as client:
        node = enroll(client)
        enroll(client, "runner-02")
        assert app.state.fleet.node(node["id"], 10)["name"] == "runner-01"
        assert client.get("/api/fleet/nodes/" + str(uuid4()), headers=OPERATOR).status_code == 404
        assert client.get("/api/fleet/nodes/" + str(uuid4()) + "/workspace/snapshot", headers=OPERATOR).status_code == 404
        assert client.get(f'/api/fleet/nodes/{node["id"]}', headers=OPERATOR).json()["node"]["name"] == "runner-01"


def test_metrics_token_is_scrape_only_and_validated(tmp_path):
    scrape = "s" * 40
    app = create_app(Settings(mode="central", token=TOKEN, db=str(tmp_path / "fleet.sqlite"), metrics_token=scrape), collect=False)
    with TestClient(app) as client:
        reader = {"Authorization": "Bearer " + scrape}
        assert client.get("/api/fleet/metrics", headers=reader).status_code == 200
        assert client.get("/api/fleet/metrics", headers=OPERATOR).status_code == 200
        for path in ("/api/fleet", "/api/events", "/api/fleet/pulse"):
            assert client.get(path, headers=reader).status_code == 401
        assert client.post("/api/fleet/nodes", headers=reader, json={"name": "x", "cluster": "y"}).status_code == 401
    for bad in ("short", TOKEN):
        with pytest.raises(ValueError, match="OPSDECK_METRICS_TOKEN"):
            Settings(mode="central", token=TOKEN, db=str(tmp_path / "x.sqlite"), metrics_token=bad).validate()


def test_source_messages_become_alert_details_and_ignored_sources_stay_silent(app):
    from backend.fleet import fleet_alerts, prometheus
    with TestClient(app) as client:
        node = enroll(client)
        sample = envelope()
        sample["sources"]["docker"].update(status="unavailable", message="Docker API did not answer within 10s while listing containers (ReadTimeout). " + "x" * 400)
        sample["sources"]["runner"].update(status="degraded")
        sample["sources"]["services"].update(status="unavailable", message="The container cannot reach the host's systemd bus.")
        assert client.post("/api/agent/telemetry", headers=agent(node), json=sample).status_code == 200
        body = client.get("/api/fleet", headers=OPERATOR).json()
        messages = body["nodes"][0]["source_messages"]
        assert set(messages) == {"docker", "services"} and len(messages["docker"]) == 300
        details = {a["key"].split(":")[-1]: a["detail"] for a in body["alerts"]}
        assert details == {"docker": messages["docker"], "services": "The container cannot reach the host's systemd bus.",
                           "runner": "The Runner collector reported degraded. Open the host to read the source message."}
        url = f'/api/fleet/nodes/{node["id"]}/settings'
        for bad in ({"ignored_sources": ["host"]}, {"ignored_sources": ["disk"]}, {"ignored_sources": "docker"},
                    {"ignored_sources": ["docker", "gpu", "runner", "services", "docker"]}):
            assert client.post(url, headers=OPERATOR, json=bad).status_code == 422, bad
        updated = client.post(url, headers=OPERATOR, json={"ignored_sources": ["services", "docker", "services"]})
        assert updated.status_code == 200 and updated.json()["ignored_sources"] == ["docker", "services"]
        events = client.get("/api/events", headers=OPERATOR).json()
        assert (events[0]["title"], events[0]["detail"]) == ("Host settings changed", "runner-01: ignored sources (docker, services)")
        assert client.post(url, headers=OPERATOR, json={"ignored_sources": ["docker", "services"]}).status_code == 200
        assert len(client.get("/api/events", headers=OPERATOR).json()) == len(events)
        body = client.get("/api/fleet", headers=OPERATOR).json()
        assert [a["title"] for a in body["alerts"]] == ["Runner source degraded"] and body["summary"]["alerts_warning"] == 1
        assert body["nodes"][0]["source_status"]["docker"] == "unavailable"
        assert 'opsdeck_fleet_alerts{severity="warning"} 1' in prometheus(body["nodes"], fleet_alerts(body["nodes"]), "test")
        cleared = client.post(url, headers=OPERATOR, json={"ignored_sources": []}).json()
        assert cleared["ignored_sources"] == [] and client.get("/api/events", headers=OPERATOR).json()[0]["detail"] == "runner-01: ignored sources (none)"
        assert len(client.get("/api/fleet", headers=OPERATOR).json()["alerts"]) == 3
