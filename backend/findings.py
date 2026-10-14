"""Private, validated survey archives. Reported evidence is never promoted to a live measurement."""
import json
from pathlib import Path
import time
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class Record(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class JobResult(Record):
    name: str = Field(max_length=160)
    status: str = Field(max_length=32)
    duration: float | None = Field(default=None, ge=0)
    queued_duration: float | None = Field(default=None, ge=0)
    stage: str | None = Field(default=None, max_length=80)
    runner: str | None = Field(default=None, max_length=160)
    url: str | None = Field(default=None, max_length=1024)


class Benchmark(Record):
    pipeline_id: int = Field(ge=1)
    label: str = Field(max_length=120)
    status: str = Field(max_length=32)
    ref: str | None = Field(default=None, max_length=160)
    runner_seconds: float | None = Field(default=None, ge=0)
    wall_seconds: float | None = Field(default=None, ge=0)
    queue_seconds: float | None = Field(default=None, ge=0)
    total_jobs: int | None = Field(default=None, ge=0)
    passed_jobs: int | None = Field(default=None, ge=0)
    url: str | None = Field(default=None, max_length=1024)
    evidence: str = Field(default="Imported report", max_length=300)
    verified_at: float | None = None
    jobs: list[JobResult] = Field(default_factory=list, max_length=300)
    note: str = Field(default="", max_length=2000)


class JobComparison(Record):
    name: str = Field(max_length=160)
    seconds: list[float | None] = Field(max_length=30)
    note: str = Field(default="", max_length=1000)


class Optimization(Record):
    key: str = Field(max_length=80)
    title: str = Field(max_length=160)
    scope: Literal["host", "repository", "follow-up"]
    recorded_status: Literal["done", "prepared", "recommended"]
    detail: str = Field(max_length=5000)
    evidence: str = Field(default="", max_length=2000)
    verify: Literal["nvme_docker", "nvme_cache", "toolchains", "cpu_epp", "manual"] = "manual"


class Archive(Record):
    schema_version: Literal[1] = 1
    title: str = Field(max_length=200)
    recorded_on: str = Field(max_length=30)
    imported_at: float = Field(default_factory=time.time)
    source_name: str = Field(max_length=240)
    source_sha256: str | None = Field(default=None, max_length=64)
    source_report: str = Field(default="", max_length=150000)
    context: dict[str, str] = Field(default_factory=dict)
    benchmarks: list[Benchmark] = Field(default_factory=list, max_length=30)
    job_comparisons: list[JobComparison] = Field(default_factory=list, max_length=300)
    optimizations: list[Optimization] = Field(default_factory=list, max_length=80)
    expected_images: list[str] = Field(default_factory=list, max_length=100)
    notes: list[str] = Field(default_factory=list, max_length=80)


def validate_archive(raw):
    if len(raw) > 2 * 1024 * 1024:
        raise ValueError("Survey archive exceeds 2 MiB")
    archive = Archive.model_validate_json(raw)
    for row in archive.job_comparisons:
        if len(row.seconds) != len([b for b in archive.benchmarks if b.runner_seconds is not None]):
            raise ValueError("Job comparison columns must match the measured benchmark pipelines")
    return archive


def load_archive(path):
    with Path(path).open("rb") as file:
        return validate_archive(file.read(2 * 1024 * 1024 + 1))


def collect_findings(settings):
    from backend.collectors import source
    try:
        archive = load_archive(settings.findings_path)
        return source(archive.model_dump(mode="json"))
    except FileNotFoundError:
        return source(status="not_configured", message="Import a private survey archive to retain benchmark outcomes and optimization evidence")
    except (ValueError, OSError):
        return source(status="unavailable", message="Survey archive is invalid or unreadable; check its schema and file permissions")


def observations(data, sources):
    """Attach independently measured present state to immutable recorded statuses."""
    result = json.loads(json.dumps(data))
    host = (sources.get("host") or {}).get("data") or {}
    engine = (sources.get("docker") or {}).get("data") or {}
    tags = {tag for image in engine.get("images", []) for tag in image["tags"]}
    volumes = host.get("volumes", [])
    def backing(path):
        matches = [v for v in volumes if path == v["mount"] or path.startswith(v["mount"].rstrip("/") + "/")]
        return max(matches, key=lambda v: len(v["mount"])) if matches else None
    for item in result["optimizations"]:
        kind = item["verify"]
        status, detail = "not_verified", "Requires repository or administrator verification"
        if kind in ("nvme_docker", "nvme_cache"):
            path = engine.get("root", "/var/lib/docker") if kind == "nvme_docker" else "/cache"
            volume = backing(path)
            if volume:
                status = "verified" if "nvme" in volume["device"] else "not_applied"
                detail = f"{path} is backed by {volume['device']} ({volume['fstype']})"
        elif kind == "toolchains" and sources.get("docker", {}).get("status") == "healthy":
            expected = result["expected_images"]
            present = sum(tag in tags for tag in expected)
            status = "verified" if expected and present == len(expected) else "partial"
            detail = f"{present}/{len(expected)} recorded toolchain tags are currently present"
        elif kind == "cpu_epp" and host.get("cpu", {}).get("epp"):
            status = "verified" if host["cpu"]["epp"] == "performance" else "not_applied"
            detail = "Current energy preference: " + host["cpu"]["epp"]
        item["current_check"] = {"status": status, "detail": detail}
    result["image_checks"] = [{"tag": tag, "present": tag in tags if sources.get("docker", {}).get("status") == "healthy" else None} for tag in result["expected_images"]]
    return result
