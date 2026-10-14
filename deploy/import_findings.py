"""Validate and atomically import private survey data. Nothing is baked into public source."""
import argparse
import os
from pathlib import Path
import sys
import tempfile

from backend.findings import load_archive, validate_archive


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", help="Archive path, or - to read standard input")
    parser.add_argument("--output", type=Path, default=Path("data/findings.json"))
    args = parser.parse_args()
    archive = validate_archive(sys.stdin.buffer.read(2 * 1024 * 1024 + 1)) if args.source == "-" else load_archive(args.source)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(dir=args.output.parent, prefix=".findings-")
    try:
        with os.fdopen(descriptor, "w") as output:
            output.write(archive.model_dump_json(indent=2))
        os.replace(temporary, args.output)
    finally:
        Path(temporary).unlink(missing_ok=True)
    sys.stdout.write(f"Imported {len(archive.benchmarks)} pipeline records and {len(archive.optimizations)} optimization findings into {args.output}\n")


if __name__ == "__main__":
    main()
