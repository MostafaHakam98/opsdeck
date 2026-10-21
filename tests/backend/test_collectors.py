import subprocess
from types import SimpleNamespace

import docker
import httpx
import requests

from backend.collectors import DockerCollector, failure, runner_collect, services_collect
from backend.config import Settings


def docker_client(running=3, stats_timeouts=(), df=None, containers=None, info=None):
    rows = [{"Id": f"{index:064x}", "Image": "example", "Names": [f"/job-{index}"], "State": "running", "Status": "Up", "Created": 1} for index in range(running)]
    def stats(identifier, **kwargs):
        if identifier in stats_timeouts:
            raise requests.exceptions.ReadTimeout("Read timed out")
        return {"cpu_stats": {"cpu_usage": {"total_usage": 10}, "system_cpu_usage": 100}, "memory_stats": {"usage": 2048, "limit": 4096}}
    api = SimpleNamespace(containers=containers or (lambda **kw: rows), stats=stats, images=lambda **kw: [], inspect_container=lambda _: {})
    return SimpleNamespace(api=api, info=info or (lambda: {"ServerVersion": "27.0"}), close=lambda: None,
                           df=df or (lambda: {"LayersSize": 5, "Images": [], "Volumes": [], "BuildCache": []}))


def test_docker_degrades_on_stats_and_disk_usage_timeouts_but_keeps_partial_data(monkeypatch):
    client = docker_client(running=3, stats_timeouts={f"{1:064x}"})
    monkeypatch.setattr("backend.collectors.docker.from_env", lambda **kw: client)
    collector = DockerCollector(timeout=10)
    first = collector.collect()
    assert first["status"] == "degraded"
    assert first["message"] == "Container stats timed out for 1 of 3 running containers"
    assert [row["memory_bytes"] for row in first["data"]["containers"]] == [2048, None, 2048]
    assert first["data"]["storage"]["layers_bytes"] == 5

    def slow_df():
        raise requests.exceptions.ReadTimeout("Read timed out")
    timeouts = []
    monkeypatch.setattr("backend.collectors.docker.from_env", lambda **kw: timeouts.append(kw["timeout"]) or docker_client(df=slow_df))
    collector.storage_tried -= 301
    collector.storage["updated_at"] -= 14 * 60
    second = collector.collect()
    assert timeouts == [10, 30]
    assert second["status"] == "degraded"
    assert second["message"] == "Docker disk usage timed out; showing the last result from 14 min ago"
    assert second["data"]["storage_error"] == second["message"] and second["data"]["storage"]["layers_bytes"] == 5
    assert len(second["data"]["containers"]) == 3
    # The failed query is not retried before the 5 min interval.
    assert collector.collect()["message"] == second["message"] and timeouts == [10, 30, 10]


def test_docker_degrades_without_engine_info(monkeypatch):
    def info():
        raise requests.exceptions.ConnectionError("reset")
    monkeypatch.setattr("backend.collectors.docker.from_env", lambda **kw: docker_client(running=1, info=info))
    result = DockerCollector().collect()
    assert result["status"] == "degraded" and result["message"] == "Docker engine info unavailable (ConnectionError)"
    assert result["data"]["version"] is None and len(result["data"]["containers"]) == 1


def test_docker_unavailable_names_the_phase_and_permission_problems(monkeypatch):
    def listing(**kwargs):
        raise requests.exceptions.ReadTimeout("Read timed out")
    monkeypatch.setattr("backend.collectors.docker.from_env", lambda **kw: docker_client(containers=listing))
    result = DockerCollector(timeout=10).collect()
    assert result["status"] == "unavailable"
    assert result["message"] == "Docker API did not answer within 10s while listing containers (ReadTimeout). Check how long 'docker ps' takes on the host."

    def denied(**kwargs):
        try:
            raise requests.exceptions.ConnectionError(PermissionError(13, "Permission denied"))
        except requests.exceptions.ConnectionError as exc:
            raise docker.errors.DockerException(f"Error while fetching server API version: {exc}") from exc
    monkeypatch.setattr("backend.collectors.docker.from_env", denied)
    assert DockerCollector().collect()["message"] == "Docker socket permission denied; add the agent to the socket's group (OPSDECK_DOCKER_GID)"

    def wrapped_timeout(**kwargs):
        try:
            raise requests.exceptions.ReadTimeout("Read timed out")
        except requests.exceptions.ReadTimeout as exc:
            raise docker.errors.DockerException("Error while fetching server API version") from exc
    monkeypatch.setattr("backend.collectors.docker.from_env", wrapped_timeout)
    assert DockerCollector(timeout=4).collect()["message"].startswith("Docker API did not answer within 4s while connecting to the daemon (ReadTimeout).")


def test_docker_timeout_setting_is_clamped(monkeypatch):
    for raw, expected in (("1", 2), ("25", 25), ("600", 60)):
        monkeypatch.setenv("OPSDECK_DOCKER_TIMEOUT", raw)
        assert Settings().docker_timeout == expected
    monkeypatch.delenv("OPSDECK_DOCKER_TIMEOUT")
    assert Settings().docker_timeout == 10


def test_called_process_error_reports_a_sanitized_stderr_line():
    exc = subprocess.CalledProcessError(1, ["nvidia-smi"], stderr="\n  \n\x1b[31mNVIDIA-SMI   has failed\tbecause\x07 " + "x" * 300 + "\nsecond line")
    message = failure(exc, "GPU driver or NVIDIA device is unavailable")["message"]
    prefix = "GPU driver or NVIDIA device is unavailable (CalledProcessError): "
    assert message.startswith(prefix + "[31mNVIDIA-SMI has failed because ")
    assert len(message) == len(prefix) + 160 and "\x1b" not in message and "second" not in message
    assert failure(subprocess.CalledProcessError(1, ["x"]), "Hint")["message"] == "Hint (CalledProcessError)"
    assert failure(OSError("token=secret"), "Hint")["message"] == "Hint (OSError)"


def test_services_in_a_container_explain_the_unreachable_bus(tmp_path, monkeypatch):
    (tmp_path / "run" / "dbus").mkdir(parents=True)
    (tmp_path / "run" / "dbus" / "system_bus_socket").touch()
    def refuse(*args, **kwargs):
        raise subprocess.CalledProcessError(1, args[0], stderr="Failed to connect to bus: Permission denied\n")
    monkeypatch.setattr("backend.collectors.subprocess.run", refuse)
    result = services_collect(Settings(services=["docker.service"], host_root=str(tmp_path)))
    assert result["status"] == "unavailable"
    assert result["message"].startswith("The container cannot reach the host's systemd bus. Run the host service exporter")
    assert "OPSDECK_SERVICES=" in result["message"]
    native = services_collect(Settings(services=["docker.service"], host_root=""))
    assert native["message"] == "Systemd service status unavailable on this host (CalledProcessError): Failed to connect to bus: Permission denied"


def test_runner_refused_connection_is_not_configured_and_shows_only_host_and_port(monkeypatch):
    def refuse(*args, **kwargs):
        raise httpx.ConnectError("refused")
    monkeypatch.setattr(httpx, "get", refuse)
    result = runner_collect(Settings(runner_url="http://user:secret@127.0.0.1:9252/metrics?token=hidden", runner_facts="/nonexistent"))
    assert result["status"] == "not_configured"
    assert result["message"] == ("No runner metrics listener at 127.0.0.1:9252. If GitLab Runner runs on this host, set "
                                 'listen_address = "127.0.0.1:9252" in /etc/gitlab-runner/config.toml and restart it; '
                                 "otherwise set RUNNER_METRICS_URL= in the agent environment.")
    assert "No runner metrics listener at [::1]:80." in runner_collect(Settings(runner_url="http://[::1]/metrics", runner_facts="/nonexistent"))["message"]

    def slow(*args, **kwargs):
        raise httpx.ReadTimeout("slow")
    monkeypatch.setattr(httpx, "get", slow)
    result = runner_collect(Settings(runner_facts="/nonexistent"))
    assert result["status"] == "unavailable" and "(ReadTimeout)" in result["message"]
