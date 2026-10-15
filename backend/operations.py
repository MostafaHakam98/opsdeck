"""Reviewed local image operations and narrow, revision-checked runner controls."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import queue
import re
import secrets
import shutil
import socket
import tarfile
import threading
import time

import docker
from fastapi import HTTPException


class RunnerClient:
    def __init__(self, path):
        self.path = path

    def call(self, operation, **values):
        if not self.path:
            raise HTTPException(503, "Install and connect the runner capacity helper first")
        try:
            with socket.socket(socket.AF_UNIX) as connection:
                connection.settimeout(8)
                connection.connect(self.path)
                connection.sendall(json.dumps({"operation": operation, **values}).encode() + b"\n")
                raw = connection.makefile("rb").readline(65537)
            if len(raw) > 65536:
                raise ValueError("Oversized helper response")
            response = json.loads(raw)
            if not response.get("ok"):
                raise HTTPException(response.get("status", 503), response.get("message", "Runner control unavailable"))
            return response["data"]
        except (OSError, ValueError, KeyError):
            raise HTTPException(503, "Runner capacity helper unavailable; check its installation and socket permissions") from None


def image_reference(value):
    # Explicit tags prevent accidentally selecting latest. References are data, never shell text.
    if not isinstance(value, str) or len(value) > 255 or ":" not in value.rsplit("/", 1)[-1]:
        raise HTTPException(400, "Use an image name with an explicit tag, for example toolchain:base-r3")
    repository, tag = value.rsplit(":", 1)
    if not re.fullmatch(r"[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}", tag) or not re.fullmatch(r"[a-z0-9]+(?:[._:/-][a-z0-9]+)*", repository) or ".." in repository:
        raise HTTPException(400, "Invalid local image name or tag")
    return repository, tag


def relative_file(value):
    if not isinstance(value, str):
        raise HTTPException(400, "Choose a relative Dockerfile path")
    path = PurePosixPath(value)
    if not value or len(value) > 240 or path.is_absolute() or ".." in path.parts or "\\" in value:
        raise HTTPException(400, "Dockerfile must be a relative path inside the build context")
    return str(path)


class Operations:
    def __init__(self, settings, store, client_factory=None, runner=None):
        self.settings, self.store = settings, store
        self.client_factory = client_factory or (lambda: docker.from_env(timeout=8))
        self.worker_factory = client_factory or (lambda: docker.from_env(timeout=900))
        self.runner = runner or RunnerClient(settings.runner_control_socket)
        self.pending, self.lock = {}, threading.Lock()
        self.tasks = queue.Queue(maxsize=4)
        self.upload_lock = threading.Lock()
        self.thread = None
        self.stopping = threading.Event()

    def require_enabled(self):
        if not self.settings.operations:
            raise HTTPException(403, "Operator controls are disabled on this server")

    def start(self):
        if self.store.recover_operations():
            self.store.event("action", "warning", "Interrupted image operation", "Inspect live images before retrying; the previous application process stopped")
        self.thread = threading.Thread(target=self.work, name="opsdeck-image-operations", daemon=True)
        self.thread.start()

    def stop(self):
        self.stopping.set()
        # Do not pretend that daemon-side builds/imports were cancelled by a shutdown.
        if self.thread:
            self.thread.join(timeout=1)

    def profiles(self):
        if not self.settings.build_contexts_file:
            return []
        try:
            values = json.loads(Path(self.settings.build_contexts_file).read_text())
            result = []
            for value in values[:20]:
                if not re.fullmatch(r"[a-zA-Z0-9_-]{1,64}", value["id"]):
                    raise ValueError()
                path = Path(value["path"])
                dockerfile = relative_file(value.get("dockerfile", "Dockerfile"))
                if not path.is_absolute() or not path.is_dir() or not (path / dockerfile).is_file():
                    continue
                if (path / dockerfile).is_symlink() or not (path / dockerfile).resolve().is_relative_to(path.resolve()):
                    raise ValueError()
                args = value.get("buildargs", {})
                if not isinstance(args, dict) or any(not isinstance(k, str) or not isinstance(v, str) for k, v in args.items()):
                    raise ValueError()
                result.append({"id": value["id"], "label": str(value.get("label", value["id"]))[:100], "path": str(path), "dockerfile": dockerfile, "buildargs": args})
            return result
        except (OSError, ValueError, TypeError, KeyError):
            raise HTTPException(503, "Build context configuration is invalid or unavailable") from None

    def capabilities(self):
        response = {"enabled": self.settings.operations, "image_actions": ["load_image", "build_image", "tag_image"],
            "upload_max_bytes": self.settings.image_upload_max_gib * 1024**3, "runner": {"available": False, "message": "Install the runner capacity helper to change limits"}, "build_profiles": [], "uploads": []}
        if not self.settings.operations:
            return response
        try:
            response["runner"] = {"available": True, **self.runner.call("state")}
        except HTTPException as exc:
            response["runner"]["message"] = exc.detail
        try:
            response["build_profiles"] = [{k: p[k] for k in ("id", "label", "dockerfile")} for p in self.profiles()]
        except HTTPException as exc:
            response["build_profiles_message"] = exc.detail
        root = Path(self.settings.image_upload_dir)
        if root.exists():
            for path in sorted(root.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)[:50]:
                try:
                    _, meta = self.upload(path.stem)
                    response["uploads"].append(meta)
                except (HTTPException, OSError):
                    continue
        return response

    def upload_path(self, identifier):
        if not isinstance(identifier, str) or not re.fullmatch(r"[a-f0-9]{32}", identifier):
            raise HTTPException(400, "Choose a completed upload")
        return Path(self.settings.image_upload_dir) / identifier

    def upload(self, identifier):
        path = self.upload_path(identifier)
        try:
            meta = json.loads(path.with_suffix(".json").read_text())
            if meta["status"] != "ready" or not path.is_file() or path.stat().st_size != meta["bytes"]:
                raise ValueError()
            return path, meta
        except (OSError, ValueError, KeyError):
            raise HTTPException(409, "Upload unavailable or already used; upload the archive again") from None

    async def receive_upload(self, request, kind, name):
        self.require_enabled()
        if kind not in ("image", "context"):
            raise HTTPException(400, "Choose image archive or build context")
        if not self.upload_lock.acquire(blocking=False):
            raise HTTPException(409, "Another archive is uploading; wait for it to finish")
        path = None
        try:
            root = Path(self.settings.image_upload_dir)
            root.mkdir(parents=True, exist_ok=True, mode=0o700)
            limit = self.settings.image_upload_max_gib * 1024**3
            # Bound aggregate staging as well as each upload; completed unused uploads expire after 24h.
            now = time.time()
            for entry in root.iterdir():
                if re.fullmatch(r"[a-f0-9]{32}(?:\.json)?", entry.name) and now - entry.stat().st_mtime > 86400:
                    entry.unlink(missing_ok=True)
            staged = sum(entry.stat().st_size for entry in root.iterdir() if entry.is_file())
            if staged >= limit:
                raise HTTPException(413, "Archive staging is full; use or discard an existing upload")
            identifier = secrets.token_hex(16)
            path = self.upload_path(identifier)
            size, digest = 0, hashlib.sha256()
            with path.open("xb") as output:
                os.chmod(path, 0o600)
                async for chunk in request.stream():
                    size += len(chunk)
                    if size + staged > limit:
                        raise HTTPException(413, "Archive exceeds the available upload allowance")
                    if shutil.disk_usage(root).free < len(chunk) + 2 * 1024**3:
                        raise HTTPException(507, "Keep at least 2 GiB free for archive staging")
                    output.write(chunk)
                    digest.update(chunk)
            if not size:
                raise HTTPException(400, "The uploaded archive is empty")
            meta = {"id": identifier, "kind": kind, "name": Path(name).name[:120], "bytes": size, "sha256": digest.hexdigest(), "status": "ready"}
            path.with_suffix(".json").write_text(json.dumps(meta))
            path.with_suffix(".json").chmod(0o600)
            self.store.event("action", "info", "Archive uploaded", f"{kind} archive staged: {size} bytes; upload {identifier}")
            return meta
        except BaseException:
            if path:
                path.unlink(missing_ok=True)
                path.with_suffix(".json").unlink(missing_ok=True)
            raise
        finally:
            self.upload_lock.release()

    def discard_upload(self, identifier):
        self.require_enabled()
        with self.lock:
            if any(job.get("upload_id") == identifier and job["status"] in ("queued", "running") for job in self.store.operations()):
                raise HTTPException(409, "That archive is in use by a queued or running task")
            path, _ = self.upload(identifier)
            path.unlink()
            path.with_suffix(".json").unlink()
        self.store.event("action", "info", "Archive discarded", "Unused upload " + identifier)
        return {"message": "Staged archive removed"}

    @staticmethod
    def ensure_new_tag(client, reference):
        try:
            client.images.get(reference)
        except docker.errors.ImageNotFound:
            return
        raise HTTPException(409, "That local tag already exists; choose a new revision tag")

    def prepare(self, action, values):
        if action == "runner_capacity":
            if set(values) - {"concurrent", "runner", "limit", "requests", "revision"}:
                raise HTTPException(400, "Unsupported capacity settings")
            result = self.runner.call("preview", **values)
            return {"action": action, "values": values, "name": "Runner capacity", "confirmation": f"set workers {result['after']['concurrent']}",
                "impact": "Changes the shared job limit. Lowering it lets current jobs finish before more are accepted; no runner restart is issued.", "before": result["before"], "after": result["after"]}
        if action not in ("load_image", "build_image", "tag_image"):
            raise HTTPException(400, "Choose a supported local image operation")
        if set(values) - {"upload_id", "reference", "source_id", "dockerfile", "profile_id"}:
            raise HTTPException(400, "Unsupported image settings")
        result = {"action": action, "values": dict(values)}
        if action == "load_image":
            _, meta = self.upload(values.get("upload_id"))
            if meta["kind"] != "image":
                raise HTTPException(400, "Choose a docker-save image archive")
            result.update(name=meta["name"], confirmation="load image archive", impact="Imports the archive into this node's Docker image store. Existing local tags are refused; save images under new revision tags.", archive=meta)
        else:
            repository, tag = image_reference(values.get("reference"))
            client = self.client_factory()
            try:
                self.ensure_new_tag(client, values["reference"])
                if action == "tag_image":
                    if not re.fullmatch(r"sha256:[a-f0-9]{64}", str(values.get("source_id", ""))):
                        raise HTTPException(400, "Choose an exact local image ID")
                    client.images.get(values["source_id"])
                elif values.get("profile_id"):
                    profile = next((p for p in self.profiles() if p["id"] == values["profile_id"]), None)
                    if profile is None:
                        raise HTTPException(400, "Choose an available node build profile")
                    result["profile_revision"] = hashlib.sha256(json.dumps(profile, sort_keys=True).encode()).hexdigest()
                else:
                    _, meta = self.upload(values.get("upload_id"))
                    if meta["kind"] != "context":
                        raise HTTPException(400, "Choose an uploaded build context archive")
                    result["archive"] = meta
                    result["values"]["dockerfile"] = relative_file(values.get("dockerfile", "Dockerfile"))
            finally:
                client.close()
            result.update(name=values["reference"], confirmation=("build " if action == "build_image" else "tag ") + values["reference"],
                impact="Builds on this node using the files present when the task starts; downloads may be needed. Uses one image-operation slot." if action == "build_image" else "Adds a local alias to the selected image ID. No registry upload is performed.")
        return result

    def preview(self, action, values):
        self.require_enabled()
        if len(json.dumps(values)) > 8192:
            raise HTTPException(400, "Operation settings are too large")
        try:
            plan = self.prepare(action, values)
        except docker.errors.DockerException:
            raise HTTPException(503, "Docker cannot validate this operation; check the engine and selected image") from None
        with self.lock:
            now = time.time()
            self.pending = {k: v for k, v in self.pending.items() if v["expires_at"] > now}
            if len(self.pending) >= 32:
                raise HTTPException(429, "Too many pending previews; wait one minute")
            plan.update(nonce=secrets.token_urlsafe(24), expires_at=now + 60)
            self.pending[plan["nonce"]] = plan
        return {k: v for k, v in plan.items() if k not in ("profile_revision",)}

    def execute(self, nonce, confirmation):
        self.require_enabled()
        with self.lock:
            plan = self.pending.get(nonce)
            if not plan or plan["expires_at"] <= time.time():
                self.pending.pop(nonce, None)
                raise HTTPException(409, "Preview expired or already used; create a new preview")
            if confirmation != plan["confirmation"]:
                raise HTTPException(400, "Confirmation text does not match")
            if plan["action"] != "runner_capacity" and self.tasks.full():
                raise HTTPException(409, "Image-operation queue is full; wait for a task to finish")
            self.pending.pop(nonce)
            title = plan["action"] + ": " + plan["name"]
            self.store.event("action", "info", title, "Operator confirmed the reviewed operation")
            if plan["action"] == "runner_capacity":
                try:
                    result = self.runner.call("apply", **plan["values"])
                except HTTPException:
                    self.store.event("action", "warning", title, "Runner revalidation or application refused; refresh before retrying")
                    raise
                self.store.event("action", "success", title, result["message"])
                return result
            identifier = secrets.token_hex(16)
            payload = {"action": plan["action"], "name": plan["name"], "message": "Waiting for the previous image operation", "progress_events": 0, "upload_id": plan["values"].get("upload_id")}
            self.store.operation(identifier, "queued", payload, create=True)
            self.tasks.put_nowait((identifier, plan, payload))
            return {"id": identifier, "status": "queued", "message": "Task queued; progress appears below"}

    def work(self):
        while not self.stopping.is_set():
            try:
                identifier, plan, payload = self.tasks.get(timeout=.5)
            except queue.Empty:
                continue
            client = None
            try:
                self.store.operation(identifier, "running", {**payload, "message": "Validating live state"})
                fresh = self.prepare(plan["action"], plan["values"])
                if fresh.get("profile_revision") != plan.get("profile_revision"):
                    raise HTTPException(409, "Build profile changed since preview; review it again")
                client = self.worker_factory()
                self.run_image(client, identifier, plan, payload)
                payload["message"] = "Completed; the image catalog refreshes within 30 seconds"
                self.store.operation(identifier, "success", payload)
                self.store.event("action", "success", plan["action"] + ": " + plan["name"], payload["message"])
            except Exception as exc:
                payload["message"] = exc.detail if isinstance(exc, HTTPException) else "Image operation failed or timed out; inspect the archive/build context and live Docker state before retrying"
                self.store.operation(identifier, "failed", payload)
                self.store.event("action", "warning", plan["action"] + ": " + plan["name"], payload["message"])
            finally:
                if client:
                    client.close()
                self.tasks.task_done()

    def consume(self, identifier, payload, stream):
        count, last = 0, 0
        for event in stream:
            if not isinstance(event, dict):
                event = json.loads(event)
            if event.get("error") or event.get("errorDetail"):
                raise HTTPException(422, "Docker rejected the image operation; inspect archive format or Dockerfile dependencies on the node")
            count += 1
            if time.monotonic() - last > 1:
                # Never persist raw build output: Dockerfiles can print credentials.
                step = re.search(r"Step (\d+)/(\d+)", event.get("stream", ""))
                payload.update(progress_events=count, message=f"Build step {step[1]} of {step[2]}" if step else f"Processing image data ({count} engine updates)")
                self.store.operation(identifier, "running", payload)
                last = time.monotonic()
        if count == 0:
            raise HTTPException(422, "Docker returned no operation result; inspect live images before retrying")
        payload["progress_events"] = count

    def validate_archive(self, path, client=None, dockerfile=None):
        manifest = None
        found_dockerfile = False
        with tarfile.open(path, "r|*") as archive:
            for index, member in enumerate(archive):
                if index > 200000:
                    raise HTTPException(400, "Archive contains too many entries")
                name = member.name.removeprefix("./")
                if dockerfile is not None:
                    if PurePosixPath(name).is_absolute() or ".." in PurePosixPath(name).parts or member.issym() or member.islnk() or member.isdev() or member.isfifo():
                        raise HTTPException(400, "Build contexts must contain regular files/directories with relative paths, without links or device entries")
                    if name == dockerfile and member.isfile():
                        found_dockerfile = True
                elif name == "manifest.json" and member.isfile():
                    if member.size > 2 * 1024**2:
                        raise HTTPException(400, "Docker-save manifest is too large")
                    manifest = json.load(archive.extractfile(member))
                archive.members.clear()
        if dockerfile is not None:
            if not found_dockerfile:
                raise HTTPException(400, "Dockerfile was not found at the chosen path in the build context")
            return
        if not isinstance(manifest, list) or not manifest:
            raise HTTPException(400, "Expected a docker save archive with manifest.json; docker export archives cannot be loaded as images")
        for image in manifest:
            config = Path(image["Config"]).stem
            if not re.fullmatch(r"[a-f0-9]{64}", config):
                raise HTTPException(400, "Unsupported Docker-save config digest")
            for tag in image.get("RepoTags") or []:
                image_reference(tag)
                try:
                    client.images.get(tag)
                except docker.errors.ImageNotFound:
                    continue
                raise HTTPException(409, "Archive would replace an existing local image tag; retag the archive's image before saving it")
        return manifest

    def run_image(self, client, identifier, plan, payload):
        values, action = plan["values"], plan["action"]
        if action == "tag_image":
            repository, tag = image_reference(values["reference"])
            self.ensure_new_tag(client, values["reference"])
            if not client.images.get(values["source_id"]).tag(repository, tag=tag, force=False):
                raise HTTPException(422, "Docker did not create the local tag")
            return
        if action == "load_image":
            path, meta = self.upload(values["upload_id"])
            manifest = self.validate_archive(path, client=client)
            with path.open("rb") as data:
                self.consume(identifier, payload, client.api.load_image(data))
            imported = {}
            for image in manifest:
                # Newer containerd-backed engines expose manifest IDs, while older
                # engines expose config IDs. Verify every new tag through Docker.
                for tag in image.get("RepoTags") or []:
                    imported[tag] = client.images.get(tag).id
            payload["imported_images"] = imported
        else:
            self.ensure_new_tag(client, values["reference"])
            limits = {"memory": 2 * 1024**3, "cpushares": 256}
            if values.get("profile_id"):
                profile = next(p for p in self.profiles() if p["id"] == values["profile_id"])
                stream = client.api.build(path=profile["path"], dockerfile=profile["dockerfile"], buildargs=profile["buildargs"], tag=values["reference"], rm=True, decode=True, container_limits=limits)
                self.consume(identifier, payload, stream)
                path = None
            else:
                path, meta = self.upload(values["upload_id"])
                self.validate_archive(path, dockerfile=values["dockerfile"])
                with path.open("rb") as data:
                    self.consume(identifier, payload, client.api.build(fileobj=data, custom_context=True, dockerfile=values["dockerfile"], tag=values["reference"], rm=True, decode=True, container_limits=limits))
            payload["image_id"] = client.images.get(values["reference"]).id
        if path:
            # Remove a consumed archive only after Docker reports successful completion.
            path.unlink()
            path.with_suffix(".json").unlink()
