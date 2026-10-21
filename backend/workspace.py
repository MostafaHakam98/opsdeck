"""Bounded, outbound-only relay to the existing host workspace API.

Requests are never retried: a lost reply to a mutation has an unknown outcome.
Only the agent that owns a node can claim its requests or return their results.
"""
import asyncio
from dataclasses import dataclass
import json
from pathlib import Path
import re
import shutil
import tempfile
import time
from uuid import uuid4

from fastapi import HTTPException, Request
from fastapi.responses import Response, StreamingResponse

MAX_REPLY = 8 * 1024 * 1024
MAX_JSON = 1024 * 1024
GET_PATHS = re.compile(r"(?:snapshot|history|events|workloads|checkpoints(?:/(?:compare|[a-zA-Z0-9_-]+))?|integrations/gitlab|operations/(?:capabilities|jobs))\Z")
POST_PATHS = re.compile(r"(?:actions/(?:preview|execute)|operations/(?:preview|execute|uploads(?:/[a-zA-Z0-9_-]+/discard)?)|checkpoints|integrations/gitlab(?:/history)?)\Z")


def allowed(method, path):
    return bool((GET_PATHS if method == "GET" else POST_PATHS if method == "POST" else re.compile(r"(?!)")).fullmatch(path))


@dataclass
class Exchange:
    node: str
    method: str
    path: str
    query: str
    content_type: str
    body: object
    size: int
    future: asyncio.Future
    claimed: bool = False
    ready: bool = False


class WorkspaceRelay:
    def __init__(self, directory, upload_limit):
        self.directory = Path(directory)
        self.upload_limit = upload_limit
        self.pending = {}
        self.contacts = {}
        self.wakes = {}

    def online(self, node):
        return time.monotonic() - self.contacts.get(node, -1000) < 30

    def cancel(self, node):
        self.contacts.pop(node, None)
        for value in tuple(self.pending.values()):
            if value.node == node and not value.future.done():
                value.future.set_exception(HTTPException(409, "Host credential changed; inspect host activity before retrying"))

    async def forward(self, node, path, request: Request):
        if not allowed(request.method, path):
            raise HTTPException(404, "Unknown host workspace API route")
        if len(request.url.query) > 8192:
            raise HTTPException(414, "Workspace query is too long")
        if not self.online(node):
            raise HTTPException(503, "Host workspace is disconnected. Reconnect its agent; retained observations remain available under Agent access.")
        if len(self.pending) >= 32 or sum(v.node == node for v in self.pending.values()) >= 8:
            raise HTTPException(429, "Host workspace is busy; wait for existing requests")
        upload = path == "operations/uploads"
        limit = self.upload_limit if upload else MAX_JSON
        # At most one archive transfer globally. JSON requests retain separate capacity.
        if upload and any(v.path == path for v in self.pending.values()):
            raise HTTPException(409, "Another archive transfer is active; wait for it to finish")
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        body = tempfile.TemporaryFile(dir=self.directory)
        identifier = str(uuid4())
        exchange = Exchange(node, request.method, path, request.url.query,
                            "application/octet-stream" if upload else "application/json", body, 0,
                            asyncio.get_running_loop().create_future())
        self.pending[identifier] = exchange
        try:
            async for chunk in request.stream():
                exchange.size += len(chunk)
                if exchange.size > limit:
                    raise HTTPException(413, "Workspace request exceeds the configured size limit")
                if upload and shutil.disk_usage(self.directory).free < len(chunk) + 2 * 1024 ** 3:
                    raise HTTPException(507, "Keep at least 2 GiB free for archive relay staging")
                await asyncio.to_thread(body.write, chunk)
            body.seek(0)
            exchange.ready = True
            self.wakes.setdefault(node, asyncio.Event()).set()
            try:
                status, payload = await asyncio.wait_for(exchange.future, 900 if upload else 45)
            except TimeoutError:
                raise HTTPException(504, "Host workspace did not reply. A submitted change may have run; inspect host activity before retrying") from None
            return Response(payload, status_code=status, media_type="application/json")
        finally:
            self.pending.pop(identifier, None)
            if not exchange.future.done():
                exchange.future.cancel()
            body.close()

    async def claim(self, node, verify=None):
        self.contacts[node] = time.monotonic()
        wake = self.wakes.setdefault(node, asyncio.Event())
        for _ in range(2):
            if verify is not None:
                await asyncio.to_thread(verify)
            for identifier, value in self.pending.items():
                if value.node == node and value.ready and not value.claimed and not value.future.done():
                    value.claimed = True
                    return {"id": identifier, "method": value.method, "path": value.path,
                            "query": value.query, "content_type": value.content_type, "size": value.size}
            wake.clear()
            try:
                await asyncio.wait_for(wake.wait(), 10)
            except TimeoutError:
                break
        return None

    def owned(self, node, identifier):
        value = self.pending.get(identifier)
        if value is None or value.node != node or not value.claimed or value.future.done():
            raise HTTPException(404, "Workspace request is no longer available")
        return value

    def body(self, node, identifier):
        value = self.owned(node, identifier)
        async def chunks():
            while True:
                # Each exchange is claimed once. A cancelled client closes its temporary body.
                try:
                    chunk = await asyncio.to_thread(value.body.read, 256 * 1024)
                except ValueError:
                    return
                if not chunk:
                    return
                yield chunk
        return StreamingResponse(chunks(), media_type=value.content_type)

    async def complete(self, node, identifier, request):
        value = self.owned(node, identifier)
        try:
            status = int(request.headers.get("x-workspace-status", "502"))
        except ValueError:
            raise HTTPException(422, "Invalid workspace response status") from None
        if not 200 <= status <= 599:
            raise HTTPException(422, "Invalid workspace response status")
        payload = bytearray()
        async for chunk in request.stream():
            if len(payload) + len(chunk) > MAX_REPLY:
                raise HTTPException(413, "Workspace reply exceeds the response limit")
            payload.extend(chunk)
        try:
            json.loads(payload)
        except (ValueError, RecursionError):
            raise HTTPException(422, "Workspace response must be JSON") from None
        if not value.future.done():
            value.future.set_result((status, bytes(payload)))
        return {"accepted": True}
