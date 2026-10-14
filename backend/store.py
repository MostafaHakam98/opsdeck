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
