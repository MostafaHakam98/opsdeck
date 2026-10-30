import io
import json
from pathlib import Path
import tarfile
import time
from types import SimpleNamespace

import docker
from fastapi import HTTPException
from fastapi.testclient import TestClient
import pytest

from backend.config import Settings
from backend.main import create_app
from backend.operations import image_reference

TOKEN = "operator-test-token-at-least-32-characters"
IMAGE = "sha256:" + "a" * 64


class FakeImage:
    id = IMAGE
    def __init__(self, engine):
        self.engine = engine
    def tag(self, repository, tag, force):
        assert not force
        self.engine.tags[repository + ":" + tag] = self.id
        return True
    @property
    def attrs(self):
        return {"Architecture": "amd64", "Os": "linux", "Size": 100, "RootFS": {"Layers": ["sha256:" + "b" * 64]}, "Config": {"Env": ["SAFE=fixture"]}}


class Engine:
    def __init__(self):
        self.tags = {"source:v1": IMAGE, IMAGE: IMAGE}
        self.images = SimpleNamespace(get=self.get)
        self.api = SimpleNamespace(build=self.build, load_image=self.load, get_image=self.export)
        self.builds = []
        self.reject = False
        self.loads = 0
    def info(self):
        return {"Architecture": "x86_64", "OSType": "linux"}
    def export(self, reference):
        attrs = self.get(reference).attrs
        config = {"architecture": attrs["Architecture"], "os": attrs["Os"], "config": attrs["Config"], "rootfs": {"diff_ids": attrs["RootFS"]["Layers"]}}
        return iter([archive({"manifest.json": json.dumps([{"Config": "a"*64 + ".json", "RepoTags": [reference]}]), "a"*64 + ".json": json.dumps(config)})])
    def get(self, reference):
        if reference not in self.tags:
            raise docker.errors.ImageNotFound("missing")
        image = FakeImage(self)
        image.id = self.tags[reference]
        return image
    def close(self):
        pass
    def build(self, **kwargs):
        self.builds.append(kwargs)
        yield {"stream": "Step 1/1 : FROM scratch\n"}
        if self.reject:
            yield {"error": "secret-build-output"}
        else:
            self.tags[kwargs["tag"]] = IMAGE
            yield {"aux": {"ID": IMAGE}}
    def load(self, data):
        self.loads += 1
        assert data.read(1)
        self.tags["imported:v1"] = IMAGE
        yield json.dumps({"stream": "Loaded image: imported:v1\n"}).encode()


@pytest.fixture
def operation_app(tmp_path):
    engine = Engine()
    app = create_app(Settings(token=TOKEN, operations=True, db=str(tmp_path / "db.sqlite"), image_upload_dir=str(tmp_path / "uploads")), collect=False, operation_factory=lambda: engine)
    with TestClient(app) as client:
        yield client, app, engine


def archive(files):
    result = io.BytesIO()
    with tarfile.open(fileobj=result, mode="w") as tar:
        for name, content in files.items():
            data = content.encode()
            info = tarfile.TarInfo(name)
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
    return result.getvalue()


def headers():
    return {"Authorization": "Bearer " + TOKEN}


def upload(client, kind, data):
    response = client.post("/api/operations/uploads?kind=" + kind + "&name=example.tar", headers=headers(), content=data)
    assert response.status_code == 200, response.text
    return response.json()


def execute(client, action, values):
    response = client.post("/api/operations/preview", headers=headers(), json={"action": action, "values": values})
    assert response.status_code == 200, response.text
    plan = response.json()
    result = client.post("/api/operations/execute", headers=headers(), json={"nonce": plan["nonce"], "confirmation": plan["confirmation"]})
    assert result.status_code == 200, result.text
    return plan, result.json()


def wait_job(client, identifier):
    deadline = time.monotonic() + 4
    while time.monotonic() < deadline:
        job = next(job for job in client.get("/api/operations/jobs", headers=headers()).json() if job["id"] == identifier)
        if job["status"] not in ("queued", "running"):
            return job
        time.sleep(.01)
    pytest.fail("Background image job did not finish")


def test_operation_routes_require_auth_and_opt_in(operation_app, tmp_path):
    client, _, _ = operation_app
    for path in ("capabilities", "jobs"):
        assert client.get("/api/operations/" + path).status_code == 401
    for path, payload in (("preview", {"action":"tag_image","values":{}}), ("execute", {"nonce":"x","confirmation":"x"})):
        assert client.post("/api/operations/"+path,json=payload).status_code == 401
    assert client.post("/api/operations/uploads?kind=image&name=a.tar",content=b"x").status_code == 401
    disabled = create_app(Settings(token=TOKEN, db=str(tmp_path / "disabled.sqlite")), collect=False)
    with TestClient(disabled) as other:
        assert other.post("/api/operations/preview",headers=headers(),json={"action":"load_image","values":{}}).status_code == 403
        assert other.post("/api/operations/uploads?kind=image&name=a.tar",headers=headers(),content=b"x").status_code == 403


def test_local_tag_confirmation_replay_and_collision(operation_app):
    client, _, engine = operation_app
    response = client.post("/api/operations/preview",headers=headers(),json={"action":"tag_image","values":{"source_id":IMAGE,"reference":"new:v2"}})
    plan = response.json()
    assert client.post("/api/operations/execute",headers=headers(),json={"nonce":plan["nonce"],"confirmation":"wrong"}).status_code == 400
    result = client.post("/api/operations/execute",headers=headers(),json={"nonce":plan["nonce"],"confirmation":plan["confirmation"]}).json()
    assert wait_job(client,result["id"])["status"] == "success"
    assert engine.tags["new:v2"] == IMAGE
    assert client.post("/api/operations/execute",headers=headers(),json={"nonce":plan["nonce"],"confirmation":plan["confirmation"]}).status_code == 409
    assert client.post("/api/operations/preview",headers=headers(),json={"action":"tag_image","values":{"source_id":IMAGE,"reference":"new:v2"}}).status_code == 409


def test_build_archive_is_reviewed_built_and_removed_after_success(operation_app):
    client, _, engine = operation_app
    meta = upload(client,"context",archive({"Dockerfile":"FROM scratch\n"}))
    _, task = execute(client,"build_image",{"upload_id":meta["id"],"reference":"build:v1","dockerfile":"Dockerfile"})
    assert wait_job(client,task["id"])["status"] == "success"
    assert engine.builds[0]["custom_context"] is True
    assert engine.builds[0]["container_limits"]["memory"] == 2 * 1024**3
    assert client.get("/api/operations/capabilities",headers=headers()).json()["uploads"] == []


def test_bad_build_context_and_engine_stream_failures_are_visible_and_sanitized(operation_app):
    client, _, engine = operation_app
    meta = upload(client,"context",archive({"../Dockerfile":"FROM scratch\n"}))
    _, task = execute(client,"build_image",{"upload_id":meta["id"],"reference":"build:bad","dockerfile":"Dockerfile"})
    job = wait_job(client,task["id"])
    assert job["status"] == "failed" and "relative paths" in job["message"]
    assert not engine.builds
    meta = upload(client,"context",archive({"Dockerfile":"FROM scratch\n"}))
    engine.reject = True
    _, task = execute(client,"build_image",{"upload_id":meta["id"],"reference":"build:error"})
    assert wait_job(client,task["id"])["status"] == "failed"
    assert "secret-build-output" not in client.get("/api/events",headers=headers()).text
    assert "secret-build-output" not in client.get("/api/operations/jobs",headers=headers()).text


@pytest.mark.parametrize("config_digest", ["a" * 64, "c" * 64])
def test_docker_save_load_and_tag_collision_protection(operation_app, config_digest):
    client, _, engine = operation_app
    manifest = json.dumps([{"Config":config_digest+".json","RepoTags":["imported:v1"]}])
    meta = upload(client,"image",archive({"manifest.json":manifest}))
    _, task = execute(client,"load_image",{"upload_id":meta["id"]})
    assert wait_job(client,task["id"])["status"] == "success"
    engine.tags["imported:v1"] = "sha256:"+"b"*64
    meta = upload(client,"image",archive({"manifest.json":manifest}))
    _, task = execute(client,"load_image",{"upload_id":meta["id"]})
    job = wait_job(client,task["id"])
    assert job["status"] == "failed" and "replace an existing" in job["message"]


def test_upload_persistence_discard_and_failed_archive_retention(operation_app):
    client, _, _ = operation_app
    meta = upload(client,"image",b"invalid archive")
    assert client.get("/api/operations/capabilities",headers=headers()).json()["uploads"][0]["id"] == meta["id"]
    _, task = execute(client,"load_image",{"upload_id":meta["id"]})
    assert wait_job(client,task["id"])["status"] == "failed"
    assert client.post(f"/api/operations/uploads/{meta['id']}/discard",headers=headers()).status_code == 200
    assert client.get("/api/operations/capabilities",headers=headers()).json()["uploads"] == []


def test_runner_control_revision_and_audit(tmp_path):
    class Runner:
        def __init__(self): self.calls=[]
        def call(self, operation, **values):
            self.calls.append(operation)
            if operation == "state": return {"revision":"version1","facts":{"concurrent":4,"runners":[]}}
            if values.get("revision") != "version1": raise HTTPException(409,"Configuration changed")
            if operation == "preview": return {"before":{"concurrent":4,"runners":[]},"after":{"concurrent":16,"runners":[]}}
            return {"message":"Configuration saved"}
    runner=Runner()
    app=create_app(Settings(token=TOKEN,operations=True,db=str(tmp_path/"db.sqlite")),collect=False,runner_client=runner)
    with TestClient(app) as client:
        execute(client,"runner_capacity",{"concurrent":16,"revision":"version1"})
        assert runner.calls == ["preview","apply"]
        assert client.get("/api/events",headers=headers()).json()[0]["severity"] == "success"
        assert client.post("/api/operations/preview",headers=headers(),json={"action":"runner_capacity","values":{"concurrent":16,"revision":"stale"}}).status_code == 409


def test_restart_recovers_inflight_jobs_without_replaying_mutations(tmp_path):
    from backend.store import Store
    store=Store(str(tmp_path/"db.sqlite"))
    store.operation("example","running",{"action":"load_image","message":"Working"},create=True)
    assert store.recover_operations() == 1
    assert store.operations()[0]["status"] == "unknown"
    assert "inspect live state" in store.operations()[0]["message"]


@pytest.mark.parametrize("value", ["image", "image:tag;id", "https://host/image:tag", "../image:v1", "IMAGE:v1", "image:tag with space"])
def test_image_references_are_validated(value):
    with pytest.raises(HTTPException): image_reference(value)


def test_tag_is_revalidated_after_preview_and_expired_previews_cannot_execute(operation_app):
    client, app, engine = operation_app
    values={"source_id":IMAGE,"reference":"raced:v1"}
    plan=client.post("/api/operations/preview",headers=headers(),json={"action":"tag_image","values":values}).json()
    engine.tags["raced:v1"] = "sha256:"+"b"*64
    result=client.post("/api/operations/execute",headers=headers(),json={"nonce":plan["nonce"],"confirmation":plan["confirmation"]}).json()
    assert wait_job(client,result["id"])["status"] == "failed"
    assert engine.tags["raced:v1"] != IMAGE
    plan=client.post("/api/operations/preview",headers=headers(),json={"action":"tag_image","values":{**values,"reference":"expired:v1"}}).json()
    app.state.operations.pending[plan["nonce"]]["expires_at"] = 1
    assert client.post("/api/operations/execute",headers=headers(),json={"nonce":plan["nonce"],"confirmation":plan["confirmation"]}).status_code == 409
    assert "expired:v1" not in engine.tags


def test_upload_disk_headroom_and_archive_kind_validation(operation_app, monkeypatch):
    client, _, _ = operation_app
    meta=upload(client,"context",archive({"Dockerfile":"FROM scratch\n"}))
    assert client.post("/api/operations/preview",headers=headers(),json={"action":"load_image","values":{"upload_id":meta["id"]}}).status_code == 400
    monkeypatch.setattr("backend.operations.shutil.disk_usage", lambda _: SimpleNamespace(free=1))
    response=client.post("/api/operations/uploads?kind=image&name=a.tar",headers=headers(),content=b"image data")
    assert response.status_code == 507
    assert len(client.get("/api/operations/capabilities",headers=headers()).json()["uploads"]) == 1


def test_configured_node_profile_is_built_with_its_arguments(operation_app, tmp_path):
    client, app, engine = operation_app
    root=tmp_path/"context"
    root.mkdir()
    (root/"Dockerfile").write_text("FROM scratch\n")
    config=tmp_path/"builds.json"
    config.write_text(json.dumps([{"id":"toolchain","label":"Configured toolchain","path":str(root),"buildargs":{"APT_PACKAGES":"cmake ninja-build"}}]))
    app.state.operations.settings.build_contexts_file=str(config)
    profiles=client.get("/api/operations/capabilities",headers=headers()).json()["build_profiles"]
    assert profiles == [{"id":"toolchain","label":"Configured toolchain","dockerfile":"Dockerfile"}]
    _, task=execute(client,"build_image",{"profile_id":"toolchain","reference":"profile:v1"})
    assert wait_job(client,task["id"])["status"] == "success"
    assert engine.builds[0]["buildargs"] == {"APT_PACKAGES":"cmake ninja-build"}
    assert engine.builds[0]["path"] == str(root)
