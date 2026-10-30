"""Administrator-only runner configuration edits; preserve TOML structure and secrets."""
import argparse
import copy
import json
import os
from pathlib import Path
import re
import shutil
import sys
import time
import tomllib
from types import SimpleNamespace


def replace_key(block, key, value, insert_at=0):
    pattern = rf"(?m)^(\s*){re.escape(key)}\s*=.*$"
    if re.search(pattern, block):
        return re.sub(pattern, lambda m: m[1] + key + " = " + value, block, count=1)
    return block[:insert_at] + f"{key} = {value}\n" + block[insert_at:]


def tune(text, args):
    parsed = tomllib.loads(text)
    runners = parsed.get("runners", [])
    if not runners:
        raise ValueError("No runner registrations found")
    matches = [i for i, r in enumerate(runners) if not args.runner or r.get("name") == args.runner]
    if len(matches) != 1:
        raise ValueError("Select exactly one registration with --runner NAME")
    boundaries = list(re.finditer(r"(?m)^\s*\[\[runners\]\]\s*(?:#.*)?$", text))
    if len(boundaries) != len(runners):
        raise ValueError("Unsupported runner table layout; edit manually")
    index = matches[0]
    start, end = boundaries[index].start(), boundaries[index + 1].start() if index + 1 < len(boundaries) else len(text)
    block = text[start:end]
    header = re.search(r"\[\[runners\]\].*\n", block)
    if not header:
        raise ValueError("Runner header must end with a newline")
    root_end = re.search(r"(?m)^\s*\[(?!\[runners\]\])", block[header.end():])
    split = header.end() + root_end.start() if root_end else len(block)
    root, rest = block[:split], block[split:]
    root = replace_key(root, "request_concurrency", str(args.requests), header.end())
    if args.limit is not None:
        root = replace_key(root, "limit", str(args.limit), header.end())
    if args.cpus is not None or args.memory is not None:
        docker_table = re.search(r"(?m)^\s*\[runners\.docker\]\s*(?:#.*)?$", rest)
        if not docker_table:
            raise ValueError("Selected runner has no Docker configuration")
        tail = rest[docker_table.end():]
        next_table = re.search(r"(?m)^\s*\[", tail)
        table_end = docker_table.end() + next_table.start() if next_table else len(rest)
        section = rest[docker_table.start():table_end]
        insertion = section.index("\n") + 1
        if args.cpus is not None:
            section = replace_key(section, "cpus", json.dumps(str(args.cpus)), insertion)
        if args.memory is not None:
            section = replace_key(section, "memory", json.dumps(args.memory), insertion)
        rest = rest[:docker_table.start()] + section + rest[table_end:]
    result = text[:start] + root + rest + text[end:]
    first_table = re.search(r"(?m)^\s*\[", result)
    global_end = first_table.start() if first_table else len(result)
    globals_text = replace_key(result[:global_end], "concurrent", str(args.concurrent))
    if args.metrics:
        if "listen_address" not in parsed:
            globals_text = replace_key(globals_text, "listen_address", '"127.0.0.1:9252"')
    result = globals_text + result[global_end:]
    tomllib.loads(result)  # Validate before any write.
    return result


def safe_facts(config):
    return {"updated_at": time.time(), "concurrent": config.get("concurrent"), "runners": [
        {"name": r.get("name"), "executor": r.get("executor"), "limit": r.get("limit", 0),
         "request_concurrency": r.get("request_concurrency", 1),
         "cpus": r.get("docker", {}).get("cpus"), "memory": r.get("docker", {}).get("memory"),
         "pull_policy": r.get("docker", {}).get("pull_policy", "always")}
        for r in config.get("runners", [])]}


def metrics_config(text):
    """Enable loopback metrics without changing any scheduling or registration fields."""
    original = tomllib.loads(text)
    address = "127.0.0.1:9252"
    if original.get("listen_address") == address:
        return text
    if original.get("listen_address") not in (None, ""):
        raise ValueError("A custom metrics address already exists; configure RUNNER_METRICS_URL for that address or review the config manually")
    if "listen_address" in original:
        candidate = replace_key(text, "listen_address", json.dumps(address))
    else:
        candidate = 'listen_address = "127.0.0.1:9252"\n' + text
    updated = tomllib.loads(candidate)
    if updated.pop("listen_address", None) != address or updated != {key: value for key, value in original.items() if key != "listen_address"}:
        raise ValueError("Unsupported metrics configuration layout; no changes applied")
    return candidate


def capacity_config(text, concurrent, runner=None, limit=None, requests=None):
    """Change only explicitly requested scheduling values, preserving all other TOML."""
    if type(concurrent) is not int or not 1 <= concurrent <= 32:
        raise ValueError("Global job limit must be 1..32")
    if limit is not None and (type(limit) is not int or not 0 <= limit <= 32):
        raise ValueError("Registration job limit must be 0..32; 0 shares the global limit")
    if requests is not None and (type(requests) is not int or not 1 <= requests <= 8):
        raise ValueError("Request concurrency must be 1..8")
    parsed = tomllib.loads(text)
    expected = copy.deepcopy(parsed)
    expected["concurrent"] = concurrent
    if runner is not None:
        matches = [r for r in expected.get("runners", []) if r.get("name") == runner]
        if len(matches) != 1:
            raise ValueError("Choose a uniquely named runner registration")
        selected = matches[0]
        if limit is not None:
            selected["limit"] = limit
        if requests is not None:
            selected["request_concurrency"] = requests
        # tune always writes request_concurrency; retain its original effective value.
        request_value = selected.get("request_concurrency", 1)
        selected["request_concurrency"] = request_value
        candidate = tune(text, SimpleNamespace(runner=runner, concurrent=concurrent, requests=request_value,
            limit=limit, cpus=None, memory=None, metrics=False))
    else:
        if limit is not None or requests is not None:
            raise ValueError("Choose a runner registration for registration-specific settings")
        first_table = re.search(r"(?m)^\s*\[", text)
        boundary = first_table.start() if first_table else len(text)
        candidate = replace_key(text[:boundary], "concurrent", str(concurrent)) + text[boundary:]
    if tomllib.loads(candidate) != expected:
        raise ValueError("Unsupported configuration layout; no changes applied")
    return candidate


def image_policy_config(text, runner, policy):
    """Change one Docker registration's pull policy and no other values."""
    if policy not in ("always", "if-not-present"):
        raise ValueError("Choose always or if-not-present")
    parsed = tomllib.loads(text)
    expected = copy.deepcopy(parsed)
    matches = [i for i, r in enumerate(parsed.get("runners", [])) if r.get("name") == runner]
    boundaries = list(re.finditer(r"(?m)^\s*\[\[runners\]\]\s*(?:#.*)?$", text))
    if len(matches) != 1 or len(boundaries) != len(parsed.get("runners", [])):
        raise ValueError("Choose a uniquely named runner registration")
    index = matches[0]
    selected = expected["runners"][index]
    if selected.get("executor") != "docker" or "docker" not in selected:
        raise ValueError("Choose a Docker runner")
    if policy not in selected["docker"].get("allowed_pull_policies", ["always", "if-not-present"]):
        raise ValueError("Policy is restricted by this runner's allowed_pull_policies")
    selected["docker"]["pull_policy"] = policy
    start = boundaries[index].start()
    end = boundaries[index + 1].start() if index + 1 < len(boundaries) else len(text)
    block = text[start:end]
    table = re.search(r"(?m)^[ \t]*\[runners\.docker\][ \t]*(?:#.*)?\n", block)
    if not table:
        raise ValueError("Unsupported Docker table layout")
    next_table = re.search(r"(?m)^[ \t]*\[", block[table.end():])
    boundary = table.end() + next_table.start() if next_table else len(block)
    section = replace_key(block[table.start():boundary], "pull_policy", json.dumps(policy), table.end() - table.start())
    candidate = text[:start] + block[:table.start()] + section + block[boundary:] + text[end:]
    if tomllib.loads(candidate) != expected:
        raise ValueError("Unsupported configuration layout; no changes applied")
    return candidate


def write_config(path, candidate):
    """Install a validated candidate atomically with a private, unique backup."""
    backup = str(path) + ".bak-" + time.strftime("%Y%m%d-%H%M%S") + "-" + str(time.time_ns())
    with os.fdopen(os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as output:
        output.write(path.read_bytes())
    import tempfile
    descriptor, temporary_name = tempfile.mkstemp(dir=path.parent, prefix=".opsdeck-config-")
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w") as output:
            output.write(candidate)
            output.flush()
            os.fsync(output.fileno())
        shutil.copystat(path, temporary)
        os.chown(temporary, path.stat().st_uid, path.stat().st_gid)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)
    return backup


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default="/etc/gitlab-runner/config.toml")
    parser.add_argument("--runner")
    parser.add_argument("--concurrent", type=int, default=8)
    parser.add_argument("--limit", type=int)
    parser.add_argument("--requests", type=int, default=4)
    parser.add_argument("--cpus", type=float)
    parser.add_argument("--memory")
    parser.add_argument("--metrics", action="store_true")
    parser.add_argument("--metrics-only", action="store_true", help="Enable loopback metrics while preserving all runner limits and settings")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--facts")
    parser.add_argument("--export-only", action="store_true")
    args = parser.parse_args()
    if args.metrics_only and args.export_only:
        parser.error("Choose metrics configuration or export-only, not both")
    if not 1 <= args.concurrent <= 32 or not 1 <= args.requests <= 8 or (args.limit is not None and not 1 <= args.limit <= 32):
        parser.error("Concurrency must be 1..32; request concurrency 1..8")
    if args.cpus is not None and not .5 <= args.cpus <= 48:
        parser.error("CPU quota must be .5..48")
    if args.memory and not re.fullmatch(r"[1-9][0-9]*[mMgG]", args.memory):
        parser.error("Memory must be a positive size in MiB/GiB, for example 32g")
    path = Path(args.config)
    text = path.read_text()
    if args.export_only:
        candidate = text
    elif args.metrics_only:
        candidate = metrics_config(text)
    else:
        candidate = tune(text, args)
    sys.stdout.write(json.dumps(safe_facts(tomllib.loads(candidate)), indent=2) + "\n")
    if args.apply and not args.export_only and candidate != text:
        backup = write_config(path, candidate)
        sys.stdout.write("Backup: " + backup + "\n")
        sys.stdout.write("Runner reloads concurrency automatically; a new metrics listener may require a drained restart.\n")
    if args.facts:
        facts_path = Path(args.facts)
        facts_path.parent.mkdir(parents=True, exist_ok=True)
        current = tomllib.loads(path.read_text())
        facts_path.write_text(json.dumps(safe_facts(current), indent=2))
        facts_path.chmod(0o644)


if __name__ == "__main__":
    main()
