"""Durable fleet image-copy coordinator; data moves in bounded agent-relay chunks."""
import asyncio
import secrets
import time
from urllib.parse import urlencode

from fastapi import HTTPException

from backend.image_artifacts import HEADROOM
from backend.operations import image_reference
from backend.store import Store


def architecture(value):
    return {"x86_64": "amd64", "aarch64": "arm64"}.get(value, value)


class ImageTransfers:
    def __init__(self, settings, fleet, relay):
        self.fleet, self.relay = fleet, relay
        self.store = Store(str(settings.db) + ".image-transfers")
        self.interval = settings.interval
        self.pending = {}

    async def call(self, node, method, path, values=None):
        state = self.fleet.node(node, self.interval)
        if state["revoked"]:
            raise HTTPException(409, "Host credential was revoked; review a new transfer")
        return await self.relay.call(node, method, path, values)

    async def readiness(self, node, reference):
        return await self.call(node, "GET", "operations/readiness?" + urlencode({"reference": reference}))

    async def preview(self, source, destination, reference, allow_emulation=False):
        image_reference(reference)
        if source == destination:
            raise HTTPException(400, "Choose two different hosts")
        source_info, target_info = await asyncio.gather(self.readiness(source, reference), self.readiness(destination, reference))
        if not source_info["present"]:
            raise HTTPException(409, "Source image is missing")
        if target_info["present"]:
            raise HTTPException(409, "Destination tag already exists; check readiness or choose a new source revision")
        if not source_info["operations_enabled"] or not target_info["operations_enabled"]:
            raise HTTPException(403, "Enable Operations on both source and destination hosts")
        if source_info.get("os") != target_info.get("engine_os"):
            raise HTTPException(409, "Image and destination operating systems differ")
        mismatch = architecture(source_info.get("architecture")) != architecture(target_info.get("engine_architecture"))
        if mismatch and not allow_emulation:
            raise HTTPException(409, "Architecture differs; explicitly confirm that the destination supports emulation")
        size = source_info.get("size", 0)
        for name, info in (("Source", source_info), ("Destination", target_info)):
            if info["staging_free"] < size + HEADROOM or info["archive_limit"] < size:
                raise HTTPException(507, name + " has insufficient archive staging capacity")
        engine_free = target_info.get("engine_disk_free")
        if engine_free is not None and engine_free < 2 * size + HEADROOM:
            raise HTTPException(507, "Destination Docker storage has insufficient space for content and unpacked layers")
        self.pending = {k: v for k, v in self.pending.items() if v["expires_at"] > time.time()}
        if len(self.pending) >= 32:
            raise HTTPException(429, "Too many pending transfer reviews")
        plan = {"source": source, "destination": destination, "reference": reference,
                "source_name": self.fleet.node(source, self.interval)["name"],
                "destination_name": self.fleet.node(destination, self.interval)["name"],
                "source_id": source_info["image_id"], "layers": source_info["layers"],
                "runtime_digest": source_info["runtime_digest"], "architecture": source_info["architecture"],
                "allow_emulation": allow_emulation, "estimated_bytes": size, "source_info": source_info, "destination_info": target_info,
                "nonce": secrets.token_urlsafe(24), "expires_at": time.time() + 60,
                "confirmation": "copy " + reference}
        self.pending[plan["nonce"]] = plan
        return plan

    def execute(self, nonce, confirmation):
        plan = self.pending.get(nonce)
        if not plan or plan["expires_at"] <= time.time():
            raise HTTPException(409, "Transfer review expired; review again")
        if confirmation != plan["confirmation"]:
            raise HTTPException(400, "Confirmation text does not match")
        if sum(j["status"] in ("queued", "running") for j in self.store.operations(200)) >= 4:
            raise HTTPException(429, "Four image transfers are already active")
        self.pending.pop(nonce)
        task_id = secrets.token_hex(16)
        payload = {k: v for k, v in plan.items() if k not in ("nonce", "expires_at", "confirmation", "source_info", "destination_info")}
        payload.update(action="copy_image", name=plan["reference"], stage="exporting", offset=0, message="Waiting for the source image export")
        self.store.operation(task_id, "queued", payload, create=True)
        self.fleet.event("action", "info", "Image transfer queued", f"{plan['source_name']} to {plan['destination_name']}: {plan['reference']}")
        return self.store.operation_by_id(task_id)

    def save(self, row, status="running", **changes):
        payload = {k: v for k, v in row.items() if k not in ("id", "created_at", "updated_at", "status")}
        payload.update(changes)
        self.store.operation(row["id"], status, payload)

    async def discard(self, task_id):
        from backend.image_artifacts import identifier
        row = self.store.operation_by_id(identifier(task_id))
        if not row:
            raise HTTPException(404, "Transfer not found")
        if row["status"] in ("queued", "running"):
            raise HTTPException(409, "Wait for the active transfer before discarding its archives")
        await self.call(row["source"], "POST", f"operations/transfers/{task_id}/discard", {})
        await self.call(row["destination"], "POST", f"operations/uploads/{task_id}/discard", {})
        self.save(row, row["status"], staging_discarded=True, source_archive_retained=False)
        self.fleet.event("action", "info", "Transfer staging discarded", row["reference"])
        return {"message": "Staged archives discarded; Docker images retained"}

    async def advance(self, row):
        task_id, stage = row["id"], row["stage"]
        source, target = row["source"], row["destination"]
        base = "operations/transfers/" + task_id + "/"
        if stage == "exporting":
            job = await self.call(source, "POST", base + "export", {"reference": row["reference"], "source_id": row["source_id"], "confirmation": "export " + row["reference"]})
            if job["status"] in ("failed", "unknown"):
                self.save(row, job["status"], message=job["message"])
            elif job["status"] == "success":
                self.save(row, stage="copying", artifact=job["artifact"], total=job["artifact"]["bytes"], message="Source archive ready; copying to destination")
            else:
                self.save(row, message=job["message"], exported_bytes=job.get("bytes", 0))
        elif stage == "copying":
            # Reconcile actual durable host offset after each reconnect or lost reply.
            ready = await self.call(target, "POST", base + "receive", {"step": "begin", "bytes": row["artifact"]["bytes"], "sha256": row["artifact"]["sha256"], "reference": row["reference"], "confirmation": "receive " + row["reference"]})
            offset = ready["offset"]
            if offset == row["total"]:
                await self.call(target, "POST", base + "receive", {"step": "finish"})
                self.save(row, stage="importing", offset=offset, message="Archive copied; verifying checksum and importing on destination")
                return
            chunk = await self.call(source, "GET", base + "chunk?offset=" + str(offset))
            if not chunk.get("data") or chunk.get("offset") != offset or chunk.get("total") != row["total"]:
                raise HTTPException(409, "Source archive changed or ended unexpectedly")
            result = await self.call(target, "POST", base + "receive", {"step": "chunk", **chunk})
            self.save(row, offset=result["offset"], message="Copying archive to destination")
        elif stage == "importing":
            job = await self.call(target, "POST", base + "import", {"reference": row["reference"], "confirmation": "load transferred image " + row["reference"]})
            if job["status"] in ("failed", "unknown"):
                self.save(row, job["status"], message=job["message"])
            elif job["status"] == "success":
                self.save(row, stage="verifying", message="Comparing destination layers and runtime configuration")
            else:
                self.save(row, message=job["message"])
        elif stage == "verifying":
            info = await self.readiness(target, row["reference"])
            if not info["present"] or info.get("layers") != row["layers"] or info.get("runtime_digest") != row["runtime_digest"]:
                raise HTTPException(409, "Destination image does not match the reviewed source; inspect live images")
            retained = False
            try:
                await self.call(source, "POST", base + "discard", {})
            except HTTPException:
                retained = True
            self.save(row, "success", stage="complete", image_id=info["image_id"], source_archive_retained=retained,
                      message="Image copied and verified. Check runner readiness before retrying its job.")
            self.fleet.event("action", "success", "Image transfer verified", f"{row['source_name']} to {row['destination_name']}: {row['reference']}")

    async def work(self):
        while True:
            rows = [r for r in self.store.operations(200) if r["status"] in ("queued", "running")]
            for row in reversed(rows):
                try:
                    await self.advance(row)
                except HTTPException as exc:
                    transient = exc.status_code in (429, 502, 503, 504)
                    self.save(row, "running" if transient else "failed", message=("Waiting for host connectivity or operation capacity; transfer bytes will resume" if transient else str(exc.detail)))
                except asyncio.CancelledError:
                    raise
                except Exception:
                    self.save(row, "failed", message="Transfer failed; inspect host operation history before starting a new copy")
            await asyncio.sleep(1 if rows else 3)
