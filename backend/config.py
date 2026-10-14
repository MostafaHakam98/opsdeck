"""Explicit server-only configuration; no credentials are returned to clients."""
from dataclasses import dataclass, field
import os
from pathlib import Path


@dataclass
class Settings:
    token: str = field(default_factory=lambda: os.getenv("OPSDECK_TOKEN", ""))
    db: str = field(default_factory=lambda: os.getenv("OPSDECK_DB", "./data/opsdeck.sqlite"))
    interval: int = field(default_factory=lambda: max(5, int(os.getenv("OPSDECK_SAMPLE_SECONDS", "10"))))
    retention: int = field(default_factory=lambda: max(1, int(os.getenv("OPSDECK_RETENTION_DAYS", "30"))))
    actions: bool = field(default_factory=lambda: os.getenv("OPSDECK_ACTIONS", "false").lower() == "true")
    gitlab_url: str = field(default_factory=lambda: os.getenv("GITLAB_URL", "").rstrip("/"))
    gitlab_token: str = field(default_factory=lambda: os.getenv("GITLAB_TOKEN", ""))
    projects: list[str] = field(default_factory=lambda: [p.strip() for p in os.getenv("GITLAB_PROJECT_IDS", "").split(",") if p.strip()][:8])
    runner_url: str = field(default_factory=lambda: os.getenv("RUNNER_METRICS_URL", "http://127.0.0.1:9252/metrics"))
    runner_facts: str = field(default_factory=lambda: os.getenv("OPSDECK_RUNNER_FACTS", "./data/runner-facts.json"))
    services: list[str] = field(default_factory=lambda: [s.strip() for s in os.getenv("OPSDECK_SERVICES", "docker.service,gitlab-runner.service,tailscaled.service").split(",") if s.strip()][:12])
    host_root: str = field(default_factory=lambda: os.getenv("OPSDECK_HOST_ROOT", "").rstrip("/"))
    procfs_path: str = field(default_factory=lambda: os.getenv("OPSDECK_PROCFS_PATH", os.getenv("OPSDECK_HOST_ROOT", "").rstrip("/") + "/proc"))
    scope: str = field(default_factory=lambda: os.getenv("OPSDECK_SCOPE", "native"))
    findings_path: str = field(default_factory=lambda: os.getenv("OPSDECK_FINDINGS_PATH", "./data/findings.json"))
    static: Path = field(default_factory=lambda: Path(__file__).resolve().parents[1] / "frontend" / "dist")

    def validate(self):
        if len(self.token) < 32 or self.token.startswith("replace-"):
            raise ValueError("Set OPSDECK_TOKEN to a random secret of at least 32 characters")
        if self.gitlab_token and not self.gitlab_url.startswith("https://"):
            raise ValueError("GITLAB_URL must use HTTPS when a token is configured")
        if self.host_root and (not Path(self.host_root).is_absolute() or not Path(self.procfs_path, "meminfo").is_file()):
            raise ValueError("Host monitoring requires an absolute host root and a readable host procfs mount")
