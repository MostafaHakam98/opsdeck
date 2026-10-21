"""Publish allowlisted native service readings for container deployments denied host DBus access.

Runs with the host's system Python (3.6 or newer) and the standard library only.
"""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time


def export(output, names):
    if not names or len(names) > 12 or any(not re.fullmatch(r"[A-Za-z0-9_.@-]+\.service", name) for name in names):
        raise ValueError("Select between one and twelve valid service unit names")
    result = subprocess.run(["systemctl", "--system", "show", "--property=Id,LoadState,ActiveState,SubState,ExecMainStatus,MemoryCurrent,CPUUsageNSec", "--", *names], check=True, universal_newlines=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10)
    rows = []
    for block in result.stdout.strip().split("\n\n"):
        values = dict(line.split("=", 1) for line in block.splitlines() if "=" in line)
        def number(key):
            value = values.get(key, "")
            return int(value) if value.isdigit() and int(value) < 2**63 else None
        if values.get("Id") in names:
            rows.append({"name": values["Id"], "load": values.get("LoadState"), "state": values.get("ActiveState"), "substate": values.get("SubState"), "exit_code": number("ExecMainStatus"), "memory_bytes": number("MemoryCurrent"), "cpu_seconds": number("CPUUsageNSec") / 1e9 if number("CPUUsageNSec") is not None else None})
    if {row["name"] for row in rows} != set(names):
        raise ValueError("Incomplete native service readings")
    output.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(dir=output.parent, prefix=".services-")
    try:
        with os.fdopen(descriptor, "w") as file:
            json.dump({"updated_at": time.time(), "services": rows}, file, allow_nan=False)
        # Contains only the selected public service measurements, no configuration or credentials.
        os.chmod(temporary, 0o644)
        os.replace(temporary, output)
    finally:
        # Python 3.6 compatible equivalent of unlink(missing_ok=True); hosts may only have their system Python.
        if os.path.exists(temporary):
            os.unlink(temporary)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--services", default="docker.service,gitlab-runner.service,tailscaled.service")
    args = parser.parse_args()
    export(args.output, args.services.split(","))


if __name__ == "__main__":
    main()
