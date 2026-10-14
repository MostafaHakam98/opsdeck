"""Load a simple env file without shell evaluation, then run exactly one sampler worker."""
import os
from pathlib import Path
import re


def load_environment(path):
    if not path.exists():
        return
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        key, separator, value = line.partition("=")
        key = key.strip()
        if not separator or not re.fullmatch(r"[A-Z][A-Z0-9_]*", key):
            raise ValueError("Invalid environment file entry")
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
            value = value[1:-1]
        os.environ.setdefault(key, value)


if __name__ == "__main__":
    load_environment(Path(os.environ.get("OPSDECK_ENV_FILE", ".env")))
    import uvicorn
    uvicorn.run("backend.main:factory", factory=True, host=os.getenv("OPSDECK_BIND", "127.0.0.1"),
        port=int(os.getenv("OPSDECK_PORT", "8080")), workers=1, access_log=False, proxy_headers=False)
