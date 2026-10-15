"""Private, optional read-only GitLab connection. Credentials never leave this module's settings."""
from dataclasses import replace
import json
import os
from pathlib import Path
import tempfile
from urllib.parse import urlsplit

import httpx
from fastapi import HTTPException


class GitLabConnection:
    def __init__(self, settings, store):
        self.settings, self.store = settings, store

    def read(self):
        path = Path(self.settings.gitlab_connection_file)
        if not path.exists():
            return {"enabled": bool(self.settings.gitlab_token and self.settings.gitlab_url), "url": self.settings.gitlab_url,
                "token": self.settings.gitlab_token, "projects": self.settings.projects, "auto_observed": not bool(self.settings.gitlab_token and self.settings.gitlab_url)}
        try:
            value = json.loads(path.read_text())
            if not isinstance(value, dict) or not isinstance(value.get("projects"), list):
                raise ValueError()
            return value
        except (OSError, ValueError):
            raise HTTPException(503, "Private GitLab connection file is invalid or unreadable") from None

    def public(self):
        value = self.read()
        return {"enabled": value.get("enabled", False), "url": value.get("url", ""), "token_configured": bool(value.get("token")),
            "projects": value.get("projects", []), "auto_observed": value.get("auto_observed", True), "project_limit": 32}

    def settings_for_poll(self):
        value = self.read()
        projects = value.get("projects", [])
        if value.get("auto_observed"):
            projects = list(dict.fromkeys([*projects, *self.store.observed_project_ids()]))[:32]
        return replace(self.settings, gitlab_url=value.get("url", "") if value.get("enabled") else "",
            gitlab_token=value.get("token", "") if value.get("enabled") else "", projects=projects)

    def save(self, url, token, projects, auto_observed, enabled=True):
        if not enabled:
            value = {"enabled": False, "url": "", "token": "", "projects": [], "auto_observed": True}
        else:
            try:
                parsed = urlsplit(url)
                if parsed.port is not None and not 1 <= parsed.port <= 65535:
                    raise ValueError()
            except ValueError:
                raise HTTPException(400, "Invalid GitLab URL") from None
            if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
                raise HTTPException(400, "Use an HTTPS GitLab base URL without credentials, query or fragment")
            url = url.rstrip("/")
            previous = self.read()
            if not token and previous.get("url") == url:
                token = previous.get("token", "")
            if not token or len(token) > 512 or any(c.isspace() for c in token):
                raise HTTPException(400, "Enter a dedicated GitLab token with read_api access")
            if len(projects) > 32 or any(not isinstance(p, str) or not p or len(p) > 200 for p in projects):
                raise HTTPException(400, "Choose at most 32 project IDs or namespace/project paths")
            try:
                response = httpx.get(url + "/api/v4/user", headers={"PRIVATE-TOKEN": token}, timeout=8, follow_redirects=False)
                response.raise_for_status()
                if not isinstance(response.json().get("id"), int):
                    raise ValueError()
            except (httpx.HTTPError, ValueError):
                raise HTTPException(400, "GitLab connection validation failed; check HTTPS, token access and server reachability") from None
            value = {"enabled": True, "url": url, "token": token, "projects": list(dict.fromkeys(projects)), "auto_observed": auto_observed}
        path = Path(self.settings.gitlab_connection_file)
        path.parent.mkdir(parents=True, exist_ok=True)
        descriptor, name = tempfile.mkstemp(dir=path.parent, prefix=".gitlab-")
        try:
            with os.fdopen(descriptor, "w") as output:
                json.dump(value, output)
                output.flush()
                os.fsync(output.fileno())
            os.replace(name, path)
        finally:
            Path(name).unlink(missing_ok=True)
        self.store.event("action", "info", "GitLab read-only connection updated", "Enabled" if enabled else "Disabled")
        return self.public()
