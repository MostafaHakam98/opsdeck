import json
import subprocess
import sys
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from backend.collectors import DockerCollector, source
from backend.config import Settings
from backend.findings import Archive, collect_findings, load_archive, observations
from backend.main import create_app


def archive():
    return Archive(title="Example survey", recorded_on="2026-10-14", source_name="example.md",
        benchmarks=[{"pipeline_id": 1, "label": "Baseline", "status": "success", "runner_seconds": 100},
                    {"pipeline_id": 2, "label": "Optimized", "status": "success", "runner_seconds": 40}],
        job_comparisons=[{"name": "build", "seconds": [100, 40]}],
        optimizations=[{"key": "storage", "title": "Fast Docker storage", "scope": "host", "recorded_status": "prepared", "detail": "Move storage", "verify": "nvme_docker"}],
        expected_images=["example/toolchain:v1"])


def test_private_archive_validation_and_live_checks_preserve_evidence(tmp_path):
    path = tmp_path / "findings.json"
    path.write_text(archive().model_dump_json())
    loaded = load_archive(path)
    state = {"host": source({"volumes": [{"mount": "/", "device": "/dev/sda1", "fstype": "ext4"},
        {"mount": "/var/lib/docker", "device": "/dev/nvme0n1", "fstype": "ext4"}]}),
        "docker": source({"root": "/var/lib/docker", "images": [{"tags": ["example/toolchain:v1"]}]})}
    checked = observations(loaded.model_dump(), state)
    assert checked["optimizations"][0]["recorded_status"] == "prepared"
    assert checked["optimizations"][0]["current_check"]["status"] == "verified"
    assert loaded.optimizations[0].recorded_status == "prepared"
    assert checked["image_checks"][0]["present"]
    bad = loaded.model_dump()
    bad["job_comparisons"][0]["seconds"] = [1]
    path.write_text(json.dumps(bad))
    with pytest.raises(ValueError, match="columns"):
        load_archive(path)


def test_missing_archive_is_unconfigured_and_authentication_protects_it(tmp_path):
    settings = Settings(token="x" * 32, db=str(tmp_path / "db.sqlite"), findings_path=str(tmp_path / "missing.json"))
    assert collect_findings(settings)["status"] == "not_configured"
    app = create_app(settings, collect=False)
    app.state.snapshot["findings"] = source(archive().model_dump())
    with TestClient(app) as client:
        assert client.get("/api/snapshot").status_code == 401
        assert client.get("/api/snapshot", headers={"Authorization": "Bearer " + settings.token}).json()["sources"]["findings"]["data"]["title"] == "Example survey"


def test_docker_catalog_exposes_only_allowed_ci_labels(monkeypatch):
    container = {"Id": "a" * 64, "ImageID": "sha256:image", "Image": "example/toolchain:v1", "Names": ["/runner-build"],
        "State": "exited", "Status": "Exited", "Created": 1,
        "Labels": {"com.gitlab.gitlab-runner.job.id": "123", "com.gitlab.gitlab-runner.job.token": "do-not-expose"}}
    api = SimpleNamespace(containers=lambda **kw: [container], images=lambda **kw: [{"Id": "sha256:image", "RepoTags": ["example/toolchain:v1"], "Size": 1024, "Created": 1}])
    environment = {"CI_PIPELINE_ID": "456", "CI_PROJECT_ID": "3", "CI_JOB_TOKEN": "do-not-expose"}
    api.inspect_container = lambda _: {"Config": {"Env": [f"{key}={value}" for key, value in environment.items()]}}
    client = SimpleNamespace(api=api, info=lambda: {"Driver": "overlay2"}, close=lambda: None,
        df=lambda: {"Images": [], "Volumes": [{"Name": "cache", "UsageData": {"Size": -1}}]})
    monkeypatch.setattr("backend.collectors.docker.from_env", lambda **kw: client)
    result = DockerCollector().collect()
    assert result["status"] == "healthy"
    assert result["data"]["images"][0]["referencing_containers"] == 1
    assert result["data"]["containers"][0]["ci_metadata"]["job_id"] == "123"
    assert result["data"]["containers"][0]["ci_metadata"]["pipeline_id"] == "456"
    assert result["data"]["storage"]["volumes"][0]["size_bytes"] is None
    assert "do-not-expose" not in json.dumps(result)


def test_stdin_import_is_private_and_invalid_input_preserves_existing_archive(tmp_path):
    output = tmp_path / "findings.json"
    command = [sys.executable, "-m", "deploy.import_findings", "-", "--output", str(output)]
    valid = subprocess.run(command, input=archive().model_dump_json(), text=True, capture_output=True)
    assert valid.returncode == 0
    assert output.stat().st_mode & 0o777 == 0o600
    original = output.read_bytes()
    invalid = subprocess.run(command, input='{"unsupported": true}', text=True, capture_output=True)
    assert invalid.returncode != 0
    assert output.read_bytes() == original


def test_supplementary_evidence_requires_explicit_measurement_or_projection(tmp_path):
    data = archive().model_dump()
    data["measurements"] = [{"title": "Execution target", "after": "10 seconds", "kind": "projection", "evidence": "Critical-path estimate"}]
    path = tmp_path / "survey.json"
    path.write_text(json.dumps(data))
    assert load_archive(path).measurements[0].kind == "projection"
    data["measurements"][0]["kind"] = "verified"
    path.write_text(json.dumps(data))
    with pytest.raises(ValueError):
        load_archive(path)
