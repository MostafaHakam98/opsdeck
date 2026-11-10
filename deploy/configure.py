"""Create private configuration files without exposing or rotating credentials.

`--agent` writes a runner host's `.env.agent` from `.env.agent.example`, with the
server URL from `--server` and the per-host agent credential read from stdin, so
the credential never appears in process arguments or shell history.
"""
import argparse
import os
from pathlib import Path
import re
import secrets
import sys

# The enrollment credential: "<node uuid>.<token_urlsafe(32)>".
AGENT_CREDENTIAL = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[A-Za-z0-9_-]{20,}")
# An HTTPS origin, or HTTP on loopback for development, matching the agent's own validation.
SERVER_ORIGIN = re.compile(r"https://[A-Za-z0-9.-]+(:[0-9]{1,5})?|http://(127\.0\.0\.1|localhost|\[::1\])(:[0-9]{1,5})?")


def initialize(destination: Path, template: Path):
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        return False
    content = []
    for line in template.read_text().splitlines():
        key, separator, _ = line.partition("=")
        if separator and key.strip() == "OPSDECK_TOKEN":
            line = f"{key.strip()} = {secrets.token_urlsafe(48)}"
        content.append(line)
    descriptor = os.open(destination, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(descriptor, "w") as output:
        output.write("\n".join(content) + "\n")
    return True


def agent_environment(destination: Path, template: Path, server: str, credential: str):
    """Fill the agent template's server URL and credential, replacing any previous file (rotation)."""
    if not SERVER_ORIGIN.fullmatch(server):
        raise ValueError("The server must be an HTTPS origin without a path, or HTTP on loopback")
    if not AGENT_CREDENTIAL.fullmatch(credential):
        raise ValueError("That is not an OpsDeck agent credential; copy it from the Enroll host walkthrough")
    values = {"OPSDECK_SERVER_URL": server, "OPSDECK_AGENT_TOKEN": credential}
    content = []
    for line in template.read_text().splitlines():
        key, separator, _ = line.partition("=")
        if separator and key.strip() in values:
            line = key.strip() + separator + values.pop(key.strip())
        content.append(line)
    if values:
        raise ValueError("The template has no line for " + ", ".join(values))
    destination.parent.mkdir(parents=True, exist_ok=True)
    staged = destination.with_name(destination.name + ".new")
    staged.unlink(missing_ok=True)
    descriptor = os.open(staged, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(descriptor, "w") as output:
        output.write("\n".join(content) + "\n")
    os.replace(staged, destination)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--output", type=Path, default=None)
    parser.add_argument("--template", type=Path, default=None)
    parser.add_argument("--agent", action="store_true", help="write .env.agent; the credential is read from stdin")
    parser.add_argument("--server", default="", help="central server origin, for --agent")
    args = parser.parse_args()
    if args.agent:
        output, template = args.output or Path(".env.agent"), args.template or Path(".env.agent.example")
        try:
            agent_environment(output, template, args.server, sys.stdin.readline().strip())
        except ValueError as exc:
            sys.exit(f"opsdeck: {exc}")
        sys.stdout.write(f"Wrote private agent configuration: {output}\n")
        return
    args.output, args.template = args.output or Path(".env"), args.template or Path(".env.example")
    created = initialize(args.output, args.template)
    Path(".tmp").mkdir(exist_ok=True)
    sys.stdout.write(f"{'Created private' if created else 'Preserved existing'} configuration: {args.output}\n")


if __name__ == "__main__":
    main()
