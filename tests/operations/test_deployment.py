import os
from pathlib import Path
import sqlite3

import pytest

from backend.collectors import filesystem_path, host_partitions, pressure
from backend.config import Settings
from backend.run import load_environment
from deploy.backup import backup
from deploy.configure import initialize


def test_init_generates_private_config_and_does_not_rotate_existing_token(tmp_path, monkeypatch):
    target = tmp_path / ".env"
    template = Path(__file__).resolve().parents[2] / ".env.example"
    assert initialize(target, template)
    original = target.read_bytes()
    assert target.stat().st_mode & 0o777 == 0o600
    monkeypatch.delenv("OPSDECK_TOKEN", raising=False)
    load_environment(target)
    assert len(os.environ["OPSDECK_TOKEN"]) >= 32
    assert "replace-" not in os.environ["OPSDECK_TOKEN"]
    monkeypatch.delenv("OPSDECK_TOKEN")
    assert not initialize(target, template)
    assert target.read_bytes() == original


def test_backup_includes_wal_and_refuses_overwriting(tmp_path):
    path = tmp_path / "active.sqlite"
    with sqlite3.connect(path) as database:
        database.execute("PRAGMA journal_mode=WAL")
        database.execute("CREATE TABLE example(value INTEGER)")
        database.execute("INSERT INTO example VALUES (42)")
        database.commit()
        target = tmp_path / "backups" / "copy.sqlite"
        backup(path, target)
        with sqlite3.connect(target) as copied:
            assert copied.execute("SELECT value FROM example").fetchone()[0] == 42
        assert target.stat().st_mode & 0o777 == 0o600
        with pytest.raises(FileExistsError):
            backup(path, target)
    with pytest.raises(FileNotFoundError):
        backup(tmp_path / "missing.sqlite", tmp_path / "bad.sqlite")


def test_host_mounts_use_pid_one_and_map_into_host_root(tmp_path):
    proc = tmp_path / "proc"
    (proc / "1").mkdir(parents=True)
    (proc / "1" / "mounts").write_text('/dev/sda2 / ext4 rw 0 0\n/dev/nvme0n1 /var/lib/docker ext4 rw 0 0\n/dev/sdb /data\\040set xfs rw 0 0\nproc /proc proc rw 0 0\n')
    parts = host_partitions(str(tmp_path), str(proc))
    assert [p.mountpoint for p in parts] == ["/", "/var/lib/docker", "/data set"]
    assert filesystem_path("/host", "/var/lib/docker") == Path("/host/var/lib/docker")
    assert filesystem_path("", "/") == Path("/")


def test_pressure_reads_configured_host_procfs_and_missing_values_are_null(tmp_path):
    (tmp_path / "pressure").mkdir()
    (tmp_path / "pressure" / "cpu").write_text('some avg10=1.00 avg60=2.00 avg300=3.00 total=4\n')
    data = pressure(str(tmp_path))
    assert data["cpu"]["some"]["avg60"] == 2
    assert data["io"] is None


def test_host_mode_fails_if_required_procfs_is_missing(tmp_path):
    with pytest.raises(ValueError, match="Host monitoring"):
        Settings(token="x" * 32, host_root=str(tmp_path), procfs_path=str(tmp_path / "proc")).validate()
