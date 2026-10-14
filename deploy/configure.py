"""Create a private configuration file without changing existing credentials."""
import argparse
import os
from pathlib import Path
import secrets
import sys


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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path(".env"))
    parser.add_argument("--template", type=Path, default=Path(".env.example"))
    args = parser.parse_args()
    created = initialize(args.output, args.template)
    Path(".tmp").mkdir(exist_ok=True)
    sys.stdout.write(f"{'Created private' if created else 'Preserved existing'} configuration: {args.output}\n")


if __name__ == "__main__":
    main()
