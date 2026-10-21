"""Shared HTTP delivery: selective compression and cache policy for the bundled frontend."""
import re

from fastapi.staticfiles import StaticFiles
from starlette.middleware.gzip import GZipMiddleware

# Relay passthrough and agent channels carry opaque or streamed bodies; leave them byte-for-byte.
UNCOMPRESSED = re.compile(r"/api/agent/|/api/fleet/nodes/[^/]+/workspace/")
IMMUTABLE = "public, max-age=31536000, immutable"


class SelectiveGZip:
    def __init__(self, app, minimum_size=1024):
        self.app = app
        self.gzip = GZipMiddleware(app, minimum_size=minimum_size)

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and not UNCOMPRESSED.match(scope.get("path", "")):
            return await self.gzip(scope, receive, send)
        await self.app(scope, receive, send)


class HashedAssets(StaticFiles):
    """Vite emits content-hashed file names, so a successful asset response never changes."""
    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        if response.status_code in (200, 304):
            response.headers["Cache-Control"] = IMMUTABLE
        return response
