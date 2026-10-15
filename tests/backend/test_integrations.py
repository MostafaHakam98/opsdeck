import json

import httpx

from backend.collectors import gitlab_collect, runner_collect
from backend.config import Settings


def test_gitlab_samples_real_fields_and_active_job_pages(monkeypatch):
    original = httpx.Client
    calls = []
    def respond(request):
        calls.append(request)
        assert request.headers["PRIVATE-TOKEN"] == "server-secret"
        path = request.url.path
        if path == "/api/v4/projects/42":
            payload = {"id": 42, "path_with_namespace": "team/project", "web_url": "https://gitlab.example/team/project"}
        elif path.endswith("/pipelines"):
            payload = [] if request.url.params.get("status") else [{"id": 9, "status": "success", "ref": "feature", "created_at": "2026-10-14T10:00:00Z"}]
        elif path.endswith("/pipelines/9"):
            payload = {"duration": 52, "queued_duration": 17}
        elif path.endswith("/jobs"):
            payload = [{"id": 10, "name": "build", "status": "success", "duration": 45, "queued_duration": None, "runner": {"description": "build-host"}}]
        else:
            return httpx.Response(404)
        return httpx.Response(200, json=payload)
    monkeypatch.setattr(httpx, "Client", lambda *args, **kwargs: original(*args, **kwargs, transport=httpx.MockTransport(respond)))
    result = gitlab_collect(Settings(gitlab_url="https://gitlab.example", gitlab_token="server-secret", projects=["42"]))
    assert result["status"] == "healthy"
    assert result["data"]["pipelines"][0]["queued_duration"] == 17
    assert result["data"]["jobs"][0]["queued_duration"] is None
    assert "server-secret" not in json.dumps(result)
    assert len(calls) == 6


def test_runner_facts_remove_nested_secrets_and_metrics_preserve_zero(tmp_path, monkeypatch):
    path = tmp_path / "facts.json"
    path.write_text(json.dumps({"concurrent": 8, "token": "global-secret", "runners": [{"name": "worker", "limit": 4, "token": "runner-secret"}]}))
    monkeypatch.setattr(httpx, "get", lambda *args, **kwargs: httpx.Response(200, text='gitlab_runner_concurrent 8\ngitlab_runner_jobs{state="running"} 0\n', request=httpx.Request("GET", "http://localhost/metrics")))
    result = runner_collect(Settings(runner_facts=str(path)))
    assert result["data"]["metrics"]["gitlab_runner_jobs"] == 0
    assert result["data"]["facts"]["runners"][0]["limit"] == 4
    assert "secret" not in json.dumps(result)


def test_runner_rejects_unrelated_http_success(monkeypatch):
    monkeypatch.setattr(httpx, "get", lambda *args, **kwargs: httpx.Response(200, text="<html>Dashboard</html>", request=httpx.Request("GET", "http://localhost/metrics")))
    result = runner_collect(Settings())
    assert result["status"] == "unavailable"
    assert "no recognized runner metrics" in result["message"]


def test_gitlab_history_reports_end_and_details_every_pipeline(monkeypatch):
    original = httpx.Client
    def respond(request):
        assert request.method == "GET"
        path = request.url.path
        if path.endswith("/projects/42"):
            payload = {"id": 42, "path_with_namespace": "team/project"}
        elif path.endswith("/pipelines"):
            assert request.url.params.get("status") or request.url.params.get("page") == "2"
            payload = [] if request.url.params.get("status") else [{"id": i, "status": "success", "ref": "feature"} for i in range(4)]
        elif path.endswith("/jobs"):
            payload = []
        else:
            payload = {"duration": 90, "queued_duration": 0}
        return httpx.Response(200, json=payload)
    monkeypatch.setattr(httpx, "Client", lambda *args, **kwargs: original(*args, **kwargs, transport=httpx.MockTransport(respond)))
    result = gitlab_collect(Settings(gitlab_url="https://gitlab.example", gitlab_token="test", projects=["42"]), history_page=2)
    assert result["status"] == "healthy"
    assert result["data"]["history"] == [{"project_id": 42, "page": 2, "count": 4, "has_more": False}]
    assert [p["duration"] for p in result["data"]["pipelines"]] == [90]*4
