"""Explicit server-only configuration; no credentials are returned to clients."""
from dataclasses import dataclass, field
import os
from pathlib import Path
from urllib.parse import urlsplit


def build_version():
    """OPSDECK_VERSION, else the SOURCE_COMMIT file written at build time, else "dev"."""
    value = os.getenv("OPSDECK_VERSION", "").strip()
    if not value:
        try:
            value = (Path(__file__).resolve().parents[1] / "SOURCE_COMMIT").read_text().strip()
        except (OSError, UnicodeDecodeError):
            value = ""
    return value[:64] or "dev"


@dataclass
class Settings:
    mode: str = field(default_factory=lambda: os.getenv("OPSDECK_MODE", "standalone"))
    fleet_url: str = field(default_factory=lambda: os.getenv("OPSDECK_FLEET_URL", "").strip().rstrip("/"))
    token: str = field(default_factory=lambda: os.getenv("OPSDECK_TOKEN", ""))
    metrics_token: str = field(default_factory=lambda: os.getenv("OPSDECK_METRICS_TOKEN", "").strip())
    admin_file: str = field(default_factory=lambda: os.getenv("OPSDECK_ADMIN_FILE", "./data/admin.json"))
    db: str = field(default_factory=lambda: os.getenv("OPSDECK_DB", "./data/opsdeck.sqlite"))
    interval: int = field(default_factory=lambda: max(5, int(os.getenv("OPSDECK_SAMPLE_SECONDS", "10"))))
    retention: int = field(default_factory=lambda: max(1, int(os.getenv("OPSDECK_RETENTION_DAYS", "30"))))
    actions: bool = field(default_factory=lambda: os.getenv("OPSDECK_ACTIONS", "false").lower() == "true")
    operations: bool = field(default_factory=lambda: os.getenv("OPSDECK_OPERATIONS", "false").lower() == "true")
    runner_control_socket: str = field(default_factory=lambda: os.getenv("OPSDECK_RUNNER_CONTROL_SOCKET", ""))
    image_upload_dir: str = field(default_factory=lambda: os.getenv("OPSDECK_IMAGE_UPLOAD_DIR", "./data/image-uploads"))
    image_upload_max_gib: int = field(default_factory=lambda: int(os.getenv("OPSDECK_IMAGE_UPLOAD_MAX_GIB", "32")))
    image_operation_timeout: int = field(default_factory=lambda: int(os.getenv("OPSDECK_IMAGE_OPERATION_TIMEOUT", "7200")))
    build_contexts_file: str = field(default_factory=lambda: os.getenv("OPSDECK_BUILD_CONTEXTS_FILE", ""))
    gitlab_url: str = field(default_factory=lambda: os.getenv("GITLAB_URL", "").rstrip("/"))
    gitlab_token: str = field(default_factory=lambda: os.getenv("GITLAB_TOKEN", ""))
    gitlab_retry_token: str = field(default_factory=lambda: os.getenv("OPSDECK_GITLAB_RETRY_TOKEN", ""))
    gitlab_connection_file: str = field(default_factory=lambda: os.getenv("OPSDECK_GITLAB_CONNECTION_FILE", "./data/gitlab-connection.json"))
    projects: list[str] = field(default_factory=lambda: [p.strip() for p in os.getenv("GITLAB_PROJECT_IDS", "").split(",") if p.strip()][:32])
    runner_url: str = field(default_factory=lambda: os.getenv("RUNNER_METRICS_URL", "http://127.0.0.1:9252/metrics"))
    runner_facts: str = field(default_factory=lambda: os.getenv("OPSDECK_RUNNER_FACTS", "./data/runner-facts.json"))
    services: list[str] = field(default_factory=lambda: [s.strip() for s in os.getenv("OPSDECK_SERVICES", "docker.service,gitlab-runner.service,tailscaled.service").split(",") if s.strip()][:12])
    docker_timeout: int = field(default_factory=lambda: min(60, max(2, int(os.getenv("OPSDECK_DOCKER_TIMEOUT", "10")))))
    services_file: str = field(default_factory=lambda: os.getenv("OPSDECK_SERVICES_FILE", ""))
    host_root: str = field(default_factory=lambda: os.getenv("OPSDECK_HOST_ROOT", "").rstrip("/"))
    procfs_path: str = field(default_factory=lambda: os.getenv("OPSDECK_PROCFS_PATH", os.getenv("OPSDECK_HOST_ROOT", "").rstrip("/") + "/proc"))
    scope: str = field(default_factory=lambda: os.getenv("OPSDECK_SCOPE", "native"))
    findings_path: str = field(default_factory=lambda: os.getenv("OPSDECK_FINDINGS_PATH", "./data/findings.json"))
    static: Path = field(default_factory=lambda: Path(__file__).resolve().parents[1] / "frontend" / "dist")
    version: str = field(default_factory=build_version)

    def validate(self):
        if self.fleet_url:
            try:
                url = urlsplit(self.fleet_url)
                url.port
                valid = (url.hostname and not url.username and not url.password and not url.path
                         and not url.query and not url.fragment and
                         (url.scheme == "https" or (url.scheme == "http" and url.hostname in ("localhost", "127.0.0.1", "::1"))))
            except ValueError:
                valid = False
            if not valid:
                raise ValueError("OPSDECK_FLEET_URL must be an HTTPS origin without credentials, path, or query; HTTP is allowed only on loopback")
        if self.mode not in ("standalone", "central"):
            raise ValueError("OPSDECK_MODE must be standalone or central")
        if self.mode == "central" and (self.actions or self.operations):
            raise ValueError("Central mode does not support host actions or operator controls")
        if len(self.token) < 32 or self.token.startswith("replace-"):
            raise ValueError("Set OPSDECK_TOKEN to a random secret of at least 32 characters")
        if self.metrics_token and (len(self.metrics_token) < 32 or self.metrics_token == self.token):
            raise ValueError("OPSDECK_METRICS_TOKEN must be a separate random secret of at least 32 characters")
        if self.gitlab_token and not self.gitlab_url.startswith("https://"):
            raise ValueError("GITLAB_URL must use HTTPS when a token is configured")
        if not 1 <= self.image_upload_max_gib <= 128:
            raise ValueError("OPSDECK_IMAGE_UPLOAD_MAX_GIB must be 1..128")
        if not 60 <= self.image_operation_timeout <= 21600:
            raise ValueError("OPSDECK_IMAGE_OPERATION_TIMEOUT must be 60..21600 seconds")
        if self.mode == "standalone" and self.host_root and (not Path(self.host_root).is_absolute() or not Path(self.procfs_path, "meminfo").is_file()):
            raise ValueError("Host monitoring requires an absolute host root and a readable host procfs mount")
