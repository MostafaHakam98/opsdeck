"""Storage must release file descriptors without waiting for garbage collection."""
from pathlib import Path
import subprocess
import sys

import pytest


@pytest.mark.parametrize("storage", ["store", "spool"])
def test_repeated_storage_operations_under_low_file_limit(tmp_path, storage):
    script = '''
import gc
import resource
import sys
from backend.agent import AgentSettings, Spool
from backend.store import Store

gc.disable()
soft, hard = resource.getrlimit(resource.RLIMIT_NOFILE)
resource.setrlimit(resource.RLIMIT_NOFILE, (min(64, soft), hard))
kind, path = sys.argv[1:]
if kind == 'store':
    store = Store(path)
    for index in range(150):
        store.sample({'cpu': index}, 30)
        assert store.history(1)[-1]['cpu'] == index
    assert Store(path).history(1)[-1]['cpu'] == 149
else:
    spool = Spool(AgentSettings(spool=path))
    for index in range(150):
        assert spool.push({'sequence': index})
        pending = spool.pending()
        assert len(pending) == 1
        spool.acknowledge(pending[0][0])
    assert Spool(AgentSettings(spool=path)).pending() == []
'''
    result = subprocess.run(
        [sys.executable, "-c", script, storage, str(tmp_path / "storage.sqlite")],
        cwd=Path(__file__).resolve().parents[2], capture_output=True, text=True, timeout=30,
    )
    assert result.returncode == 0, result.stderr
