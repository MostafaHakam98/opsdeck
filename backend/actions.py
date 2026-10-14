"""Two-step actions with exact container IDs, opt-in labels, revalidation and durable audit."""
import re
import secrets
import threading
import time

import docker
from fastapi import HTTPException


def eligible(container):
    labels = container.attrs.get("Config", {}).get("Labels") or {}
    name = container.name
    return (labels.get("opsdeck.managed") == "true" and labels.get("opsdeck.application") != "opsdeck"
        and not name.startswith("runner-") and not any(k.startswith("com.gitlab.gitlab-runner") for k in labels))


class Actions:
    def __init__(self, enabled, store, client_factory=None):
        self.enabled = enabled
        self.store = store
        self.client_factory = client_factory or (lambda: docker.from_env(timeout=8))
        self.pending = {}
        self.lock = threading.Lock()

    def preview(self, action, target):
        if not self.enabled:
            raise HTTPException(403, "Actions are disabled on this server")
        if action not in ("restart", "stop") or not re.fullmatch(r"[a-f0-9]{64}", target):
            raise HTTPException(400, "Choose an allowed action and a full container ID")
        client = None
        try:
            client = self.client_factory()
            container = client.containers.get(target)
            if not eligible(container):
                raise HTTPException(403, "Only explicitly managed, non-CI containers can be changed")
            if container.status != "running":
                raise HTTPException(409, "The container is no longer running")
            confirmation = f"{action} {container.name}"
            with self.lock:
                now = time.time()
                self.pending = {k: v for k, v in self.pending.items() if v["expires_at"] > now}
                if len(self.pending) >= 64:
                    raise HTTPException(429, "Too many pending actions; wait for previews to expire")
                nonce = secrets.token_urlsafe(24)
                plan = {"nonce": nonce, "action": action, "target": target, "name": container.name,
                    "confirmation": confirmation, "expires_at": now + 60, "impact": "The container's current work and connections will be interrupted."}
                self.pending[nonce] = plan
            return plan
        except docker.errors.DockerException:
            raise HTTPException(503, "Docker cannot validate the requested action") from None
        finally:
            if client is not None:
                client.close()

    def execute(self, nonce, confirmation):
        if not self.enabled:
            raise HTTPException(403, "Actions are disabled on this server")
        with self.lock:
            plan = self.pending.get(nonce)
            if not plan or plan["expires_at"] <= time.time():
                self.pending.pop(nonce, None)
                raise HTTPException(409, "Preview expired or already used; create a new preview")
            if confirmation != plan["confirmation"]:
                raise HTTPException(400, "Confirmation text does not match")
            self.pending.pop(nonce)
        client = None
        title = f"{plan['action']} {plan['name']}"
        # Persist intent before touching Docker. If storage fails, no action takes place.
        self.store.event("action", "info", title, f"Operator requested action on {plan['target']}")
        try:
            client = self.client_factory()
            container = client.containers.get(plan["target"])
            if not eligible(container) or container.name != plan["name"] or container.status != "running":
                raise HTTPException(409, "Container changed since preview; action refused")
            if plan["action"] == "restart":
                container.restart(timeout=10)
            else:
                container.stop(timeout=10)
            self.store.event("action", "success", title, "Docker accepted the operation; verify the next live sample")
            return {"status": "accepted", "message": "Operation completed; live status will refresh on the next sample"}
        except HTTPException:
            self.store.event("action", "warning", title, "Revalidation refused the operation")
            raise
        except docker.errors.DockerException:
            self.store.event("action", "critical", title, "Docker operation failed or timed out; inspect current state before retrying")
            raise HTTPException(503, "Docker operation failed or timed out; check live state before retrying") from None
        finally:
            if client is not None:
                client.close()
