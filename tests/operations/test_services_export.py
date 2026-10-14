import json
from types import SimpleNamespace
import time

import pytest

from backend.collectors import services_collect
from backend.config import Settings
from deploy.export_services import export


def test_native_export_and_reader_allowlist_states_and_reject_stale_data(tmp_path, monkeypatch):
    path = tmp_path / "services.json"
    monkeypatch.setattr("deploy.export_services.subprocess.run", lambda *args, **kwargs: SimpleNamespace(stdout="Id=docker.service\nLoadState=loaded\nActiveState=active\nSubState=running\nExecMainStatus=0\nMemoryCurrent=1024\nCPUUsageNSec=2000000000\nSecret=never-export\n"))
    export(path, ["docker.service"])
    assert "never-export" not in path.read_text()
    settings = Settings(services=["docker.service"], services_file=str(path))
    data = services_collect(settings)
    assert data["status"] == "healthy"
    assert data["data"][0]["cpu_seconds"] == 2
    stored = json.loads(path.read_text())
    stored["updated_at"] = time.time() - 121
    path.write_text(json.dumps(stored))
    assert services_collect(settings)["status"] == "unavailable"
    stored["updated_at"] = time.time()
    stored["services"][0]["state"] = "invented"
    path.write_text(json.dumps(stored))
    assert services_collect(settings)["status"] == "unavailable"
    with pytest.raises(ValueError):
        export(path, ["--invalid"])
