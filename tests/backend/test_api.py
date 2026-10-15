import time
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from backend.actions import Actions
from backend.collectors import HostCollector, failure, gitlab_collect, source
from backend.config import Settings
from backend.main import create_app
from backend.store import Store


TOKEN = "test-token-with-at-least-32-characters-long"


@pytest.fixture
def app(tmp_path):
    return create_app(Settings(token=TOKEN, db=str(tmp_path / "test.sqlite")), collect=False)


def test_auth_is_required_for_every_data_and_action_route(app):
    with TestClient(app) as client:
        for path in ("snapshot", "history", "events", "metrics"):
            assert client.get("/api/" + path).status_code == 401
        for path in ("preview", "execute"):
            assert client.post("/api/actions/" + path, json={}).status_code == 401
        assert client.get("/healthz").json() == {"status": "ok"}
        result = client.get("/api/snapshot", headers={"Authorization": "Bearer " + TOKEN})
        assert result.status_code == 200
        assert TOKEN not in result.text
        assert result.headers["cache-control"] == "no-store"


def test_stale_integrations_and_disabled_actions_are_explicit(app):
    app.state.snapshot["host"] = {**source({}), "updated_at": time.time() - 120}
    with TestClient(app) as client:
        headers = {"Authorization": "Bearer " + TOKEN}
        body = client.get("/api/snapshot", headers=headers).json()
        assert body["sources"]["host"]["stale"]
        assert not body["actions_enabled"]
        assert client.post("/api/actions/preview", headers=headers, json={"action": "stop", "target": "a" * 64}).status_code == 403
        assert client.get("/api/history?hours=999", headers=headers).status_code == 422


def test_history_retention_buckets_and_audit_survival(tmp_path):
    store = Store(str(tmp_path / "history.sqlite"))
    with store.connect() as db:
        db.execute("INSERT INTO samples VALUES (?, ?)", (time.time() - 3 * 86400, '{"cpu": 80}'))
    store.event("action", "info", "restart service", "Requested")
    for value in (10, 20, 30):
        store.sample({"cpu": value, "gpu": None}, retention=1)
    history = store.history(24, limit=1)
    assert len(history) == 1
    assert history[0]["cpu"] == 20
    assert history[0]["cpu_peak"] == 30
    assert history[0]["gpu"] is None
    assert store.events()[0]["kind"] == "action"
    with store.connect() as db:
        assert db.execute("SELECT COUNT(*) FROM samples").fetchone()[0] == 3


def test_minute_host_export_stays_fresh_until_export_deadline(app):
    value = {**source([]), "updated_at": time.time() - 90}
    with TestClient(app) as client:
        for method, stale in (("host_export", False), ("native", True)):
            app.state.snapshot["services"] = {**value, "collection_method": method}
            result = client.get("/api/snapshot", headers={"Authorization": "Bearer " + TOKEN})
            assert result.json()["sources"]["services"]["stale"] is stale
        app.state.snapshot["services"]["updated_at"] = time.time() - 125
        app.state.snapshot["services"]["collection_method"] = "host_export"
        assert client.get("/api/snapshot", headers={"Authorization": "Bearer " + TOKEN}).json()["sources"]["services"]["stale"]


class FakeContainer:
    id = "a" * 64
    name = "example-service"
    status = "running"
    def __init__(self, labels):
        self.attrs = {"Config": {"Labels": labels}}
        self.operations = []
    def restart(self, timeout):
        self.operations.append("restart")
    def stop(self, timeout):
        self.operations.append("stop")


def fake_client(container):
    return SimpleNamespace(containers=SimpleNamespace(get=lambda _: container), close=lambda: None)


def test_action_nonce_confirmation_and_replay_protection(tmp_path):
    container = FakeContainer({"opsdeck.managed": "true"})
    store = Store(str(tmp_path / "audit.sqlite"))
    actions = Actions(True, store, lambda: fake_client(container))
    plan = actions.preview("restart", container.id)
    with pytest.raises(Exception) as err:
        actions.execute(plan["nonce"], "wrong")
    assert err.value.status_code == 400
    assert not container.operations
    actions.execute(plan["nonce"], plan["confirmation"])
    assert container.operations == ["restart"]
    with pytest.raises(Exception) as err:
        actions.execute(plan["nonce"], plan["confirmation"])
    assert err.value.status_code == 409
    assert len(store.events()) == 2


@pytest.mark.parametrize("labels,name", [({}, "service"), ({"opsdeck.managed": "true"}, "runner-job"),
    ({"opsdeck.managed": "true", "com.gitlab.gitlab-runner.job.id": "1"}, "job"),
    ({"opsdeck.managed": "true", "opsdeck.application": "opsdeck"}, "dashboard")])
def test_unmanaged_ci_and_self_containers_are_protected(tmp_path, labels, name):
    container = FakeContainer(labels)
    container.name = name
    actions = Actions(True, Store(str(tmp_path / "audit.sqlite")), lambda: fake_client(container))
    with pytest.raises(Exception) as err:
        actions.preview("stop", container.id)
    assert err.value.status_code == 403
    assert not container.operations


def test_action_revalidates_labels_and_expiry(tmp_path):
    container = FakeContainer({"opsdeck.managed": "true"})
    actions = Actions(True, Store(str(tmp_path / "audit.sqlite")), lambda: fake_client(container))
    plan = actions.preview("stop", container.id)
    container.attrs["Config"]["Labels"] = {}
    with pytest.raises(Exception) as err:
        actions.execute(plan["nonce"], plan["confirmation"])
    assert err.value.status_code == 409
    assert not container.operations
    container.attrs["Config"]["Labels"] = {"opsdeck.managed": "true"}
    plan = actions.preview("stop", container.id)
    actions.pending[plan["nonce"]]["expires_at"] = time.time() - 1
    with pytest.raises(Exception) as err:
        actions.execute(plan["nonce"], plan["confirmation"])
    assert err.value.status_code == 409


def test_missing_gitlab_and_sensitive_collector_errors_are_safe():
    result = gitlab_collect(Settings(token=TOKEN, gitlab_url="", gitlab_token="", projects=[]))
    assert result["status"] == "not_configured"
    error = failure(ValueError("supersecret credential in an endpoint error"), "Connection unavailable")
    assert "supersecret" not in str(error)


def test_real_host_collector_returns_capacity_and_rates():
    collector = HostCollector()
    first = collector.collect()
    second = collector.collect()
    assert first["status"] == "healthy"
    assert first["data"]["memory"]["total"] > 0
    assert second["data"]["cpu"]["threads"] > 0
    assert 0 <= second["data"]["cpu"]["percent"] <= 100


def test_weak_token_and_insecure_gitlab_token_fail_closed():
    with pytest.raises(ValueError):
        Settings(token="short").validate()
    with pytest.raises(ValueError):
        Settings(token=TOKEN, gitlab_url="http://example.org", gitlab_token="secret").validate()


def test_action_connection_failure_returns_controlled_error_and_audit(tmp_path):
    import docker
    container = FakeContainer({"opsdeck.managed": "true"})
    store = Store(str(tmp_path / "audit.sqlite"))
    actions = Actions(True, store, lambda: fake_client(container))
    plan = actions.preview("restart", container.id)
    def unavailable():
        raise docker.errors.DockerException("sensitive endpoint information")
    actions.client_factory = unavailable
    with pytest.raises(Exception) as err:
        actions.execute(plan["nonce"], plan["confirmation"])
    assert err.value.status_code == 503
    assert "sensitive" not in err.value.detail
    assert len(store.events()) == 2
    with pytest.raises(Exception) as err:
        actions.preview("restart", container.id)
    assert err.value.status_code == 503
