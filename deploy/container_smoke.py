"""Exercise Compose authentication, persistence, and Linux host scope with a disposable project."""
import argparse
import json
import os
from pathlib import Path
import secrets
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=18080)
    args = parser.parse_args()
    token = secrets.token_urlsafe(48)
    project = "opsdeck-smoke-" + secrets.token_hex(4)
    root = Path(__file__).resolve().parents[1]
    temporary_root = root / ".tmp"
    temporary_root.mkdir(exist_ok=True)
    socket_path = Path(os.getenv("DOCKER_SOCKET", "/var/run/docker.sock"))
    socket_gid = str(socket_path.stat().st_gid)
    with tempfile.TemporaryDirectory(dir=temporary_root, prefix="container-") as directory:
        config = Path(directory) / "config.env"
        config.write_text(f"OPSDECK_TOKEN = {token}\nOPSDECK_ACTIONS=false\n")
        config.chmod(0o600)
        env = {**os.environ, "OPSDECK_ENV_PATH": str(config), "OPSDECK_PORT": str(args.port), "OPSDECK_BIND": "127.0.0.1",
            "OPSDECK_PUBLISH_IP": "127.0.0.1", "OPSDECK_DOCKER_GID": socket_gid}
        base = ["docker", "compose", "--project-directory", str(root), "-p", project, "-f", "deploy/docker/compose.yaml"]
        host = [*base, "-f", "deploy/docker/compose.host.yaml"]

        def run(command, capture=False):
            return subprocess.run(command, cwd=root, env=env, check=True, text=True,
                stdout=subprocess.PIPE if capture else None, timeout=120)

        def request(path, authenticate=True, data=None):
            headers = {"Authorization": "Bearer " + token} if authenticate else {}
            if data is not None:
                headers["Content-Type"] = "application/json"
            body = json.dumps(data).encode() if data is not None else None
            with urllib.request.urlopen(urllib.request.Request(f"http://127.0.0.1:{args.port}/{path}", headers=headers, data=body), timeout=5) as response:
                return json.load(response)

        def wait_for(predicate, timeout=45):
            deadline = time.monotonic() + timeout
            while time.monotonic() < deadline:
                try:
                    value = predicate()
                    if value:
                        return value
                except (OSError, KeyError, TypeError):
                    pass
                time.sleep(1)
            raise AssertionError("Container smoke condition did not become ready")

        def healthy_snapshot():
            snapshot = request("api/snapshot")
            return snapshot if snapshot["sources"]["host"]["status"] == "healthy" else None

        try:
            run([*base, "up", "-d", "--no-build", "--wait", "--wait-timeout", "60"])
            wait_for(lambda: request("healthz", False)["status"] == "ok")
            try:
                request("api/snapshot", False)
                raise AssertionError("Metrics accepted an unauthenticated request")
            except urllib.error.HTTPError as error:
                assert error.code == 401
            snapshot = wait_for(healthy_snapshot)
            assert snapshot["sources"]["host"]["data"]["scope"] == "container"
            assert request("api/workloads?kind=images&size=1")["size"] == 1
            assert "token" not in request("api/integrations/gitlab")
            checkpoint = request("api/checkpoints", data={"title": "Container persistence checkpoint"})
            wait_for(lambda: request("api/history"))
            run([*base, "exec", "-T", "opsdeck", "python", "-c",
                "import sqlite3; db=sqlite3.connect('/data/opsdeck.sqlite'); db.execute('CREATE TABLE smoke_marker (value INTEGER)'); db.execute('INSERT INTO smoke_marker VALUES (42)'); db.commit()"])
            run([*base, "restart", "opsdeck"])
            wait_for(lambda: request("healthz", False)["status"] == "ok")
            assert request("api/checkpoints/" + checkpoint["id"])["title"] == checkpoint["title"]
            assert request("api/checkpoints")[0]["id"] == checkpoint["id"]
            run([*base, "exec", "-T", "opsdeck", "python", "-c",
                "import os,sqlite3; assert os.getuid()==12001; db=sqlite3.connect('/data/opsdeck.sqlite'); assert db.execute('SELECT value FROM smoke_marker').fetchone()[0]==42"])
            run([*base, "down"])
            run([*host, "up", "-d", "--no-build", "--wait", "--wait-timeout", "60"])
            snapshot = wait_for(healthy_snapshot)
            assert snapshot["sources"]["host"]["data"]["scope"] == "host"
            assert any(v["mount"] == "/" for v in snapshot["sources"]["host"]["data"]["volumes"])
            wait_for(lambda: request("api/snapshot")["sources"]["docker"]["status"] == "healthy")
            assert not snapshot["actions_enabled"]
            sys.stdout.write("Compose smoke passed: authentication, non-root runtime, persistent history/checkpoints, workload API, and host/Docker scope.\n")
        except Exception:
            run([*base, "logs", "--tail", "30", "opsdeck"])
            raise
        finally:
            # This random project and its test volume were created only by this test.
            subprocess.run([*base, "down", "--volumes"], cwd=root, env=env, check=True, timeout=60)


if __name__ == "__main__":
    main()
