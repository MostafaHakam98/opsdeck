"""Consistent SQLite backups, including committed WAL changes."""
import argparse
from datetime import datetime, timezone
from pathlib import Path
import sqlite3
import sys


def backup(source: Path, destination: Path):
    if not source.is_file():
        raise FileNotFoundError("Database does not exist; start OpsDeck before backing it up")
    if source.resolve() == destination.resolve():
        raise ValueError("Backup destination must differ from the active database")
    if destination.exists():
        raise FileExistsError("Backup destination already exists; use another path")
    destination.parent.mkdir(parents=True, exist_ok=True)
    descriptor = destination.open("xb")
    descriptor.close()
    destination.chmod(0o600)
    try:
        with sqlite3.connect(source.resolve().as_uri() + "?mode=ro", uri=True) as original:
            with sqlite3.connect(destination) as copy:
                original.backup(copy)
                if copy.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                    raise RuntimeError("Backup failed integrity verification")
    except Exception:
        destination.unlink(missing_ok=True)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=Path("data/opsdeck.sqlite"))
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    destination = args.output or Path(".tmp/backups") / ("opsdeck-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ") + ".sqlite")
    backup(args.source, destination)
    sys.stdout.write(f"Verified backup: {destination}\n")


if __name__ == "__main__":
    main()
