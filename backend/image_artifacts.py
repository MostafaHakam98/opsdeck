"""Bounded image exports and idempotent, checksummed transfer chunks.

Artifacts stay on the host. The central relay carries one chunk at a time and
never needs a full image archive on its own disk.
"""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import time
import tarfile

from fastapi import HTTPException

CHUNK = 4 * 1024**2
HEADROOM = 2 * 1024**3


def identifier(value):
    if not isinstance(value, str) or not re.fullmatch(r"[a-f0-9]{32}", value):
        raise HTTPException(400, "Invalid transfer identifier")
    return value


def runtime_digest(attrs):
    config = attrs.get("Config") or {}
    keys = ("User", "Env", "Cmd", "WorkingDir", "Entrypoint", "Volumes", "Labels", "OnBuild", "ExposedPorts", "StopSignal", "Healthcheck", "Shell")
    normalized = {k: config.get(k) or None for k in keys}
    return hashlib.sha256(json.dumps(normalized, sort_keys=True).encode()).hexdigest()


class ImageArtifacts:
    def __init__(self, operations):
        self.ops = operations
        self.root = Path(operations.settings.image_upload_dir)
        self.limit = operations.settings.image_upload_max_gib * 1024**3

    def space(self, additional=0):
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        staged = 0
        for path in self.root.rglob("*"):
            try:
                if path.is_file():
                    staged += path.stat().st_size
            except FileNotFoundError:
                continue  # Another completed operation may remove its archive.
        if staged + additional > self.limit:
            raise HTTPException(413, "Image archive staging allowance is full; discard unused archives")
        if shutil.disk_usage(self.root).free < additional + HEADROOM:
            raise HTTPException(507, "Insufficient archive staging space; keep at least 2 GiB free")
        return staged

    def export(self, client, task_id, values, payload):
        self.space()
        root = self.root / "exports"
        root.mkdir(mode=0o700, exist_ok=True)
        path = root / identifier(task_id)
        image = client.images.get(values["reference"])
        if image.id != values["source_id"]:
            raise HTTPException(409, "Source tag changed; review the image again")
        self.space(image.attrs.get("Size", 0))
        digest, count, last = hashlib.sha256(), 0, 0
        payload.update(stage="exporting", message="Docker is preparing the image archive", bytes=0)
        self.ops.store.operation(task_id, "running", payload)
        try:
            with path.open("xb") as output:
                os.chmod(path, 0o600)
                stream = client.api.get_image(values["reference"])
                try:
                    for chunk in stream:
                        count += len(chunk)
                        if count > self.limit:
                            raise HTTPException(413, "Export exceeds the archive staging allowance")
                        if time.monotonic() - last > 1:
                            self.space(len(chunk))
                            payload.update(bytes=count, message=f"Exporting image: {count} bytes")
                            self.ops.store.operation(task_id, "running", payload)
                            last = time.monotonic()
                        output.write(chunk)
                        digest.update(chunk)
                finally:
                    if hasattr(stream, "close"):
                        stream.close()
            # Detect tags moved by another Docker client before publishing an export.
            with tarfile.open(path, "r:") as archive:
                manifest = json.load(archive.extractfile("manifest.json"))
                if len(manifest) != 1 or manifest[0].get("RepoTags") != [values["reference"]]:
                    raise HTTPException(409, "Exported tags differ from the reviewed tag; choose its canonical inventory tag")
                member = archive.getmember(manifest[0]["Config"])
                if member.size > 2 * 1024**2:
                    raise HTTPException(409, "Unsupported image configuration size")
                saved = json.load(archive.extractfile(member))
                if (saved.get("rootfs", {}).get("diff_ids") != image.attrs.get("RootFS", {}).get("Layers", [])
                        or runtime_digest({"Config": saved.get("config")}) != runtime_digest(image.attrs)
                        or saved.get("architecture") != image.attrs.get("Architecture")
                        or saved.get("os") != image.attrs.get("Os")):
                    raise HTTPException(409, "Exported image changed since review; no bytes sent to destination")
            meta = {"id": task_id, "bytes": count, "sha256": digest.hexdigest(), "reference": values["reference"], "source_id": values["source_id"]}
            path.with_suffix(".json").write_text(json.dumps(meta))
            path.with_suffix(".json").chmod(0o600)
            payload.update(artifact=meta, bytes=count, stage="exported")
        except BaseException:
            path.unlink(missing_ok=True)
            raise

    def chunk(self, task_id, offset):
        self.ops.require_enabled()
        path = self.root / "exports" / identifier(task_id)
        try:
            meta = json.loads(path.with_suffix(".json").read_text())
            if not 0 <= offset <= meta["bytes"]:
                raise HTTPException(400, "Invalid archive offset")
            with path.open("rb") as source:
                source.seek(offset)
                data = source.read(CHUNK)
        except (OSError, ValueError, KeyError):
            raise HTTPException(409, "Export is not ready or no longer available") from None
        return {"offset": offset, "data": base64.b64encode(data).decode(), "sha256": hashlib.sha256(data).hexdigest(), "total": meta["bytes"]}

    def receive(self, task_id, values):
        self.ops.require_enabled()
        task_id = identifier(task_id)
        path = self.ops.upload_path(task_id)
        meta_path = path.with_suffix(".json")
        with self.ops.upload_lock:
            action = values.get("step")
            if action == "begin":
                size, digest = values.get("bytes"), values.get("sha256")
                if type(size) is not int or not 0 < size <= self.limit or not re.fullmatch(r"[a-f0-9]{64}", str(digest)):
                    raise HTTPException(400, "Invalid archive size or checksum")
                if meta_path.exists():
                    meta = json.loads(meta_path.read_text())
                    if meta["bytes"] != size or meta["sha256"] != digest or meta.get("reference") != values.get("reference"):
                        raise HTTPException(409, "Transfer identity is already in use")
                    if not path.exists():
                        raise HTTPException(409, "Archive was consumed; inspect the import operation")
                    return {"offset": path.stat().st_size, "status": meta["status"]}
                self.space(size)
                with path.open("xb"):
                    os.chmod(path, 0o600)
                meta = {"id": task_id, "kind": "image", "name": "host-transfer.tar", "bytes": size, "sha256": digest,
                        "status": "receiving", "verify_sha256": True, "reference": values.get("reference")}
                meta_path.write_text(json.dumps(meta))
                meta_path.chmod(0o600)
                return {"offset": 0, "status": "receiving"}
            if not meta_path.exists() or not path.exists():
                raise HTTPException(409, "Start the archive transfer first")
            meta = json.loads(meta_path.read_text())
            size = path.stat().st_size
            if action == "finish":
                if size != meta["bytes"]:
                    raise HTTPException(409, "Archive is incomplete")
                meta["status"] = "ready"
                meta_path.write_text(json.dumps(meta))
                return {"offset": size, "status": "ready"}
            if action != "chunk" or meta["status"] != "receiving":
                raise HTTPException(409, "Transfer is not accepting chunks")
            try:
                encoded = values["data"]
                if not isinstance(encoded, str) or len(encoded) > (CHUNK + 2) // 3 * 4:
                    raise ValueError()
                data = base64.b64decode(encoded, validate=True)
                offset = values["offset"]
                if type(offset) is not int or offset < 0 or not data or hashlib.sha256(data).hexdigest() != values["sha256"]:
                    raise ValueError()
            except (KeyError, ValueError):
                raise HTTPException(400, "Invalid archive chunk or checksum") from None
            if offset + len(data) > meta["bytes"] or offset > size:
                raise HTTPException(409, "Archive offset does not match")
            if offset < size:
                with path.open("rb") as existing:
                    existing.seek(offset)
                    if existing.read(len(data)) != data:
                        raise HTTPException(409, "Repeated chunk does not match staged bytes")
                return {"offset": size}
            self.space(len(data))
            with path.open("ab") as output:
                output.write(data)
                output.flush()
                os.fsync(output.fileno())
            return {"offset": size + len(data)}

    def discard_export(self, task_id):
        self.ops.require_enabled()
        path = self.root / "exports" / identifier(task_id)
        job = self.ops.store.operation_by_id(task_id)
        if job and job["status"] in ("queued", "running"):
            raise HTTPException(409, "Export is still running")
        path.unlink(missing_ok=True)
        path.with_suffix(".json").unlink(missing_ok=True)
        return {"message": "Export archive discarded"}
