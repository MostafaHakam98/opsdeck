"""Bounded metric history and a durable audit trail, using one SQLite connection per operation."""
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

    def connect(self):
        return sqlite3.connect(self.path, timeout=10)

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

    def events(self, limit=100):
        with self.connect() as db:
            db.row_factory = sqlite3.Row
            return [dict(r) for r in db.execute("SELECT * FROM events ORDER BY id DESC LIMIT ?", (limit,))]

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
