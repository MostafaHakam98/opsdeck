import fcntl
import hashlib
import json
import socket
import socketserver
import threading
import tomllib

import pytest

from scripts.runner.admin import capacity_config
from scripts.runner.control import Conflict, Handler, RunnerControl
from backend.operations import RunnerClient
CONFIG = '''concurrent = 4
[[runners]]
name = "heavy"
token = "keep-this-secret"
limit = 2
request_concurrency = 1
[runners.docker]
cpus = "8"
memory = "32g"
[[runners]]
name = "light"
token = "another-secret"
request_concurrency = 1
''' 


def test_capacity_edits_preserve_secrets_metrics_other_registrations_and_quotas():
    text = 'listen_address = "127.0.0.1:9252"\n' + CONFIG
    original = tomllib.loads(text)
    global_change = tomllib.loads(capacity_config(text, 16))
    assert global_change == {**original, "concurrent": 16}
    edited = tomllib.loads(capacity_config(text, 12, "heavy", limit=0, requests=4))
    expected = {**original, "concurrent": 12}
    expected["runners"][0].update(limit=0, request_concurrency=4)
    assert edited == expected


@pytest.mark.parametrize("kwargs", [{"concurrent": 0}, {"concurrent": True}, {"concurrent": 33}, {"concurrent": 8, "limit": 1}, {"concurrent": 8, "runner": "missing"}, {"concurrent": 8, "runner": "heavy", "requests": 9}])
def test_capacity_refuses_unsupported_inputs(kwargs):
    with pytest.raises(ValueError):
        capacity_config(CONFIG, **kwargs)


def test_capacity_helper_lock_revision_backup_and_real_socket(tmp_path):
    config = tmp_path / "config.toml"
    config.write_text(CONFIG)
    config.chmod(0o600)
    lock = tmp_path / "lock"
    control = RunnerControl(config, tmp_path / "facts.json", lock)
    state = control.handle({"operation": "state"})
    assert "secret" not in json.dumps(state)
    preview = {"operation": "preview", "revision": state["revision"], "concurrent": 16}
    assert control.handle(preview)["after"]["concurrent"] == 16
    with lock.open("a") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with pytest.raises(Conflict):
            control.handle(preview)
    config.write_text(CONFIG + "\n# manual change\n")
    with pytest.raises(Conflict):
        control.handle({**preview, "operation": "apply"})
    preview["revision"] = hashlib.sha256(config.read_bytes()).hexdigest()
    control.handle({**preview, "operation": "apply"})
    assert tomllib.loads(config.read_text())["concurrent"] == 16
    backup = next(tmp_path.glob("config.toml.bak-*"))
    assert backup.stat().st_mode & 0o777 == 0o600
    assert "secret" not in (tmp_path / "facts.json").read_text()
    path = str(tmp_path / "control.sock")
    with socketserver.UnixStreamServer(path, Handler) as server:
        server.control = control
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            result = RunnerClient(path).call("state")
            assert result["facts"]["concurrent"] == 16
            with socket.socket(socket.AF_UNIX) as connection:
                connection.connect(path)
                connection.sendall(b'{"operation":"shell","command":"id"}\n')
                response = json.loads(connection.makefile("rb").readline())
                assert response["status"] == 400
        finally:
            server.shutdown()
            thread.join()
