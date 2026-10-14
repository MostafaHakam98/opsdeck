from backend.store import Store


def test_observed_workers_survive_removal_and_reopening_without_invented_job_outcome(tmp_path):
    path = str(tmp_path / "history.sqlite")
    store = Store(path)
    worker = {"id": "worker", "name": "runner-build", "ci": True, "state": "running", "cpu_percent": None, "memory_bytes": 100}
    store.observe_workers([worker], 30)
    store.observe_workers([{**worker, "cpu_percent": 200, "memory_bytes": 50}], 30)
    store.observe_workers([], 30)
    recorded = Store(path).workers()[0]
    assert recorded["state"] == "no_longer_visible"
    assert "unknown" in recorded["status"]
    assert recorded["cpu_peak"] == 200
    assert recorded["memory_peak"] == 100
    assert recorded["last_seen"] >= recorded["first_seen"]
