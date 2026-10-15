"""Minimal local capacity control. Installed code/config must be root-owned."""
import argparse
from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
from pathlib import Path
import socketserver
import tempfile
import tomllib

try:
    from .admin import capacity_config, safe_facts, write_config
except ImportError:
    from admin import capacity_config, safe_facts, write_config


class Conflict(ValueError):
    pass


class RunnerControl:
    def __init__(self, config, facts, lock="/run/opsdeck-tune.lock"):
        self.config, self.facts, self.lock = Path(config), Path(facts), Path(lock)

    @contextmanager
    def locked(self):
        with self.lock.open("a") as handle:
            try:
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise Conflict("Another runner maintenance operation is active; try after it finishes") from None
            yield

    def export(self, text):
        self.facts.parent.mkdir(parents=True, exist_ok=True)
        descriptor, name = tempfile.mkstemp(dir=self.facts.parent, prefix=".runner-facts-")
        try:
            with os.fdopen(descriptor, "w") as output:
                json.dump(safe_facts(tomllib.loads(text)), output)
                os.fchmod(output.fileno(), 0o644)
            os.replace(name, self.facts)
        finally:
            Path(name).unlink(missing_ok=True)

    def handle(self, request):
        if not isinstance(request, dict) or set(request) - {"operation", "revision", "concurrent", "runner", "limit", "requests"}:
            raise ValueError("Unsupported control request")
        operation = request.get("operation")
        if operation not in ("state", "preview", "apply"):
            raise ValueError("Only capacity state, preview and apply are supported")
        with self.locked():
            text = self.config.read_text()
            revision = hashlib.sha256(text.encode()).hexdigest()
            before = safe_facts(tomllib.loads(text))
            if operation == "state":
                self.export(text)
                return {"revision": revision, "facts": before}
            if request.get("revision") != revision:
                raise Conflict("Runner configuration changed; create a fresh preview")
            candidate = capacity_config(text, request.get("concurrent"), request.get("runner"), request.get("limit"), request.get("requests"))
            after = safe_facts(tomllib.loads(candidate))
            if operation == "preview":
                return {"revision": revision, "before": before, "after": after}
            backup = write_config(self.config, candidate) if candidate != text else None
            self.export(candidate)
            return {"facts": after, "backup": backup, "message": "Configuration saved; the runner reloads scheduling settings automatically. Running jobs can finish."}


class Handler(socketserver.StreamRequestHandler):
    def handle(self):
        self.connection.settimeout(5)
        try:
            raw = self.rfile.readline(8193)
            if len(raw) > 8192 or not raw.endswith(b"\n"):
                raise ValueError("Invalid request size")
            result = {"ok": True, "data": self.server.control.handle(json.loads(raw))}
        except Conflict as exc:
            result = {"ok": False, "status": 409, "message": str(exc)}
        except (ValueError, TypeError):
            result = {"ok": False, "status": 400, "message": "Invalid capacity settings or unsupported configuration layout"}
        except Exception:
            result = {"ok": False, "status": 503, "message": "Runner control unavailable; inspect the host service"}
        self.wfile.write(json.dumps(result).encode() + b"\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default="/etc/gitlab-runner/config.toml")
    parser.add_argument("--facts", required=True)
    parser.add_argument("--socket", default="/run/opsdeck-control/runner.sock")
    args = parser.parse_args()
    path = Path(args.socket)
    path.unlink(missing_ok=True)
    with socketserver.UnixStreamServer(str(path), Handler) as server:
        server.control = RunnerControl(args.config, args.facts)
        path.chmod(0o660)
        server.serve_forever()


if __name__ == "__main__":
    main()
