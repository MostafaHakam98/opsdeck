"""Bounded metric history and a durable audit trail, using one SQLite connection per operation."""
from contextlib import closing, contextmanager
import json
import sqlite3
import time
from pathlib import Path


class Store:
    def __init__(self, path: str):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        with self.connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("CREATE TABLE IF NOT EXISTS samples (ts REAL PRIMARY KEY, payload TEXT NOT NULL)")
            db.execute("CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, ts REAL, kind TEXT, severity TEXT, title TEXT, detail TEXT)")
            db.execute("CREATE TABLE IF NOT EXISTS workers (id TEXT PRIMARY KEY, first_seen REAL, last_seen REAL, payload TEXT)")
            db.execute("CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY, created_at REAL, updated_at REAL, status TEXT, payload TEXT)")
            db.execute("CREATE TABLE IF NOT EXISTS pipelines (id TEXT PRIMARY KEY, updated_at REAL, payload TEXT)")
            db.execute("CREATE TABLE IF NOT EXISTS pipeline_jobs (id TEXT PRIMARY KEY, updated_at REAL, payload TEXT)")
            db.execute("CREATE TABLE IF NOT EXISTS checkpoints (id TEXT PRIMARY KEY, created_at REAL, payload TEXT)")

    @contextmanager
    def connect(self):
        # SQLite's transaction context commits/rolls back but does not close.
        with closing(sqlite3.connect(self.path, timeout=10)) as db:
            with db:
                yield db

    def sample(self, payload: dict, retention: int):
        now = time.time()
        with self.connect() as db:
            db.execute("INSERT OR REPLACE INTO samples VALUES (?, ?)", (now, json.dumps(payload, allow_nan=False)))
            db.execute("DELETE FROM samples WHERE ts < ?", (now - retention * 86400,))
            # Keep alert events bounded; action records deliberately survive retention.
            db.execute("DELETE FROM events WHERE kind='alert' AND ts < ?", (now - retention * 86400,))

    def history(self, hours: int, limit: int = 600):
        with self.connect() as db:
            rows = db.execute("SELECT ts, payload FROM samples WHERE ts >= ? ORDER BY ts", (time.time() - hours * 3600,)).fetchall()
        if not rows:
            return []
        # Average consecutive buckets; peaks are retained separately, not silently discarded.
        width = max(1, (len(rows) + limit - 1) // limit)
        result = []
        for start in range(0, len(rows), width):
            bucket = rows[start:start + width]
            values = [json.loads(row[1]) for row in bucket]
            point = {"ts": bucket[-1][0]}
            for key in values[0]:
                numbers = [v[key] for v in values if isinstance(v.get(key), (int, float))]
                point[key] = sum(numbers) / len(numbers) if numbers else None
                point[f"{key}_peak"] = max(numbers) if numbers else None
            result.append(point)
        return result

    def event(self, kind: str, severity: str, title: str, detail: str):
        with self.connect() as db:
            db.execute("INSERT INTO events(ts,kind,severity,title,detail) VALUES (?,?,?,?,?)", (time.time(), kind, severity, title, detail))

    def events(self, limit=100, query=""):
        # instr() keeps the filter a literal substring match; LIKE would treat % and _ as wildcards.
        where, args = ("WHERE instr(lower(title),?) OR instr(lower(detail),?) ", (query.lower(),) * 2) if query else ("", ())
        with self.connect() as db:
            db.row_factory = sqlite3.Row
            return [dict(r) for r in db.execute(f"SELECT * FROM events {where}ORDER BY id DESC LIMIT ?", (*args, limit))]

    def observe_workers(self, containers, retention):
        now = time.time()
        current = {row["id"]: row for row in containers if row.get("ci")}
        with self.connect() as db:
            existing = {r[0]: json.loads(r[1]) for r in db.execute("SELECT id,payload FROM workers")}
            for identifier, row in current.items():
                prior = existing.get(identifier, {})
                payload = {**row, "cpu_peak": max(prior.get("cpu_peak") or 0, row.get("cpu_percent") or 0) if prior.get("cpu_peak") is not None or row.get("cpu_percent") is not None else None,
                    "memory_peak": max(prior.get("memory_peak") or 0, row.get("memory_bytes") or 0) if prior.get("memory_peak") is not None or row.get("memory_bytes") is not None else None}
                db.execute("INSERT INTO workers VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET last_seen=excluded.last_seen,payload=excluded.payload", (identifier, now, now, json.dumps(payload)))
            for identifier, prior in existing.items():
                if identifier not in current and prior.get("state") != "no_longer_visible":
                    prior.update({"state": "no_longer_visible", "status": "Removed between observations; job outcome unknown", "disappeared_at": now})
                    db.execute("UPDATE workers SET payload=? WHERE id=?", (json.dumps(prior), identifier))
            db.execute("DELETE FROM workers WHERE last_seen < ?", (now - retention * 86400,))

    def workers(self, limit=100):
        with self.connect() as db:
            return [{**json.loads(payload), "first_seen": first_seen, "last_seen": last_seen} for first_seen, last_seen, payload in
                db.execute("SELECT first_seen,last_seen,payload FROM workers ORDER BY last_seen DESC LIMIT ?", (limit,))]

    def operation(self, identifier, status, payload, create=False):
        now = time.time()
        with self.connect() as db:
            if create:
                db.execute("INSERT INTO operations VALUES (?,?,?,?,?)", (identifier, now, now, status, json.dumps(payload)))
                db.execute("DELETE FROM operations WHERE id NOT IN (SELECT id FROM operations ORDER BY created_at DESC LIMIT 200) AND status NOT IN ('queued','running')")
            else:
                db.execute("UPDATE operations SET updated_at=?,status=?,payload=? WHERE id=?", (now, status, json.dumps(payload), identifier))

    def operations(self, limit=50, destination=None):
        with self.connect() as db:
            where = " WHERE json_extract(payload,'$.destination')=?" if destination is not None else ""
            parameters = (destination, limit) if destination is not None else (limit,)
            return [{"id": row[0], "created_at": row[1], "updated_at": row[2], "status": row[3], **json.loads(row[4])}
                for row in db.execute("SELECT * FROM operations" + where + " ORDER BY CASE WHEN status IN ('queued','running') THEN 0 ELSE 1 END, created_at DESC LIMIT ?", parameters)]

    def operation_by_id(self, identifier):
        with self.connect() as db:
            row = db.execute("SELECT * FROM operations WHERE id=?", (identifier,)).fetchone()
            return None if row is None else {"id": row[0], "created_at": row[1], "updated_at": row[2], "status": row[3], **json.loads(row[4])}

    def recover_operations(self):
        with self.connect() as db:
            count = db.execute("SELECT COUNT(*) FROM operations WHERE status IN ('queued','running')").fetchone()[0]
            db.execute("UPDATE operations SET status='unknown',updated_at=?,payload=json_set(payload,'$.message',?) WHERE status IN ('queued','running')",
                (time.time(), "Application restarted during this operation; inspect live state before retrying"))
        return count

    def observed_project_ids(self):
        with self.connect() as db:
            rows = db.execute("SELECT DISTINCT json_extract(payload,'$.ci_metadata.project_id') FROM workers WHERE json_extract(payload,'$.ci_metadata.project_id') IS NOT NULL LIMIT 32")
            return [str(row[0]) for row in rows if str(row[0]).isdigit()]

    def observe_gitlab(self, data, retention):
        now = time.time()
        with self.connect() as db:
            for table, rows in (("pipelines", data.get("pipelines", [])), ("pipeline_jobs", data.get("jobs", []))):
                for row in rows:
                    identifier = str(row.get("project_id") or row.get("project")) + ":" + str(row["id"])
                    old = db.execute(f"SELECT payload FROM {table} WHERE id=?", (identifier,)).fetchone()
                    merged = {**(json.loads(old[0]) if old else {}), **{k: v for k, v in row.items() if v is not None}}
                    merged.update(source="gitlab", confirmed_at=now)
                    db.execute(f"INSERT OR REPLACE INTO {table} VALUES (?,?,?)", (identifier, now, json.dumps(merged)))
                db.execute(f"DELETE FROM {table} WHERE updated_at < ?", (now - retention * 86400,))

    def pipeline_records(self, jobs=False):
        table = "pipeline_jobs" if jobs else "pipelines"
        with self.connect() as db:
            return [json.loads(row[0]) for row in db.execute(f"SELECT payload FROM {table} ORDER BY updated_at DESC LIMIT 10000")]

    def save_checkpoint(self, identifier, payload):
        with self.connect() as db:
            db.execute("INSERT INTO checkpoints VALUES (?,?,?)", (identifier, payload["created_at"], json.dumps(payload, allow_nan=False)))
            db.execute("DELETE FROM checkpoints WHERE id NOT IN (SELECT id FROM checkpoints ORDER BY created_at DESC LIMIT 200)")

    def checkpoints(self):
        with self.connect() as db:
            return [{"id": row[0], "created_at": row[1], "title": row[2], "notes": row[3], "scope": json.loads(row[4]), "summary": json.loads(row[5])}
                for row in db.execute("SELECT id,created_at,json_extract(payload,'$.title'),json_extract(payload,'$.notes'),json_extract(payload,'$.scope'),json_extract(payload,'$.summary') FROM checkpoints ORDER BY created_at DESC LIMIT 200")]

    def checkpoint(self, identifier):
        with self.connect() as db:
            row = db.execute("SELECT payload FROM checkpoints WHERE id=?", (identifier,)).fetchone()
            return json.loads(row[0]) if row else None
