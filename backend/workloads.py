"""Project/image attribution and scoped checkpoints from retained evidence, never inferred outcomes."""
from datetime import datetime
from collections import defaultdict
import json
import math
import secrets
import statistics
import time

from fastapi import HTTPException


def timestamp(value):
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() if value else None
    except (ValueError, AttributeError):
        return None


def number(value):
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0 else None


def scope_values(project="all", pipeline="all", image="all", hours=24):
    return {"project": project or "all", "pipeline": pipeline or "all", "image": image or "all", "hours": hours}


class Workloads:
    def __init__(self, store, sources):
        self.store, self.sources = store, sources

    def model(self):
        engine = (self.sources.get("docker", {}).get("data") or {})
        projects, images, pipelines = {}, {}, {}
        workers = self.store.workers(limit=10000)
        # Include a fresh snapshot even if history persistence is temporarily behind.
        known = {row["id"] for row in workers}
        now = time.time()
        workers.extend({**row, "first_seen": now, "last_seen": now} for row in engine.get("containers", []) if row.get("ci") and row["id"] not in known)
        def project_for(identifier, path=None):
            key = str(identifier or path or "unattributed")
            row = projects.setdefault(key, {"id": key, "name": path or ("Unattributed" if key == "unattributed" else "Project " + key), "containers": 0, "jobs": set(), "pipelines": set(), "images": set(), "running_containers": 0})
            if path:
                row["name"] = path
            return key
        for item in (self.sources.get("gitlab", {}).get("data") or {}).get("projects", []):
            project_for(item["id"], item.get("name"))
        for image in engine.get("images", []):
            images[image["id"]] = {**image, "key": image["id"], "present": True, "projects": set(), "pipelines": set(), "observed_containers": 0}
        for row in self.store.pipeline_records():
            project = project_for(row.get("project_id"), row.get("project"))
            key = project + ":" + str(row["id"])
            pipelines[key] = {**row, "key": key, "project_key": project, "images": set(), "container_ids": set(), "first_seen": timestamp(row.get("created_at")) or row["confirmed_at"], "last_seen": row["confirmed_at"], "outcome_known": True}
        jobs = {(str(row.get("project_id") or row.get("project")), str(row["id"])): row for row in self.store.pipeline_records(jobs=True)}
        metadata = {}
        live_ids = {row["id"] for row in engine.get("containers", []) if row.get("state") == "running"}
        for row in workers:
            ci = dict(row.get("ci_metadata") or {})
            project = project_for(ci.get("project_id"), ci.get("project_path"))
            job = jobs.get((project, str(ci.get("job_id"))))
            if job:
                ci.setdefault("pipeline_id", job.get("pipeline"))
                ci.setdefault("job_name", job.get("name"))
                project_for(project, job.get("project"))
            pipeline_id = ci.get("pipeline_id")
            pipeline_key = project + ":" + str(pipeline_id) if pipeline_id else None
            image_key = row.get("image_id") or (row.get("image") if str(row.get("image", "")).startswith("sha256:") else "ref:" + str(row.get("image", "unknown")))
            image = images.setdefault(image_key, {"id": image_key, "key": image_key, "tags": [row.get("image", "Unknown")], "present": False,
                "size_bytes": None, "projects": set(), "pipelines": set(), "observed_containers": 0})
            image["projects"].add(project)
            image["observed_containers"] += 1
            if pipeline_key:
                image["pipelines"].add(pipeline_key)
                pipeline = pipelines.setdefault(pipeline_key, {"id": str(pipeline_id), "key": pipeline_key, "project_key": project, "project": projects[project]["name"],
                    "source": "runner", "status": "unknown", "outcome_known": False, "duration": None, "queued_duration": None,
                    "first_seen": row["first_seen"], "last_seen": row["last_seen"], "images": set(), "container_ids": set()})
                pipeline["images"].add(image_key)
                pipeline["container_ids"].add(row["id"])
                pipeline["first_seen"] = min(pipeline["first_seen"], row["first_seen"])
                pipeline["last_seen"] = max(pipeline["last_seen"], row["last_seen"])
                if not pipeline["outcome_known"] and row["id"] in live_ids:
                    pipeline["status"] = "observed_running"
            projects[project]["containers"] += 1
            projects[project]["running_containers"] += row["id"] in live_ids
            projects[project]["images"].add(image_key)
            if ci.get("job_id"):
                projects[project]["jobs"].add(str(ci["job_id"]))
            if pipeline_key:
                projects[project]["pipelines"].add(pipeline_key)
            metadata[row["id"]] = {**ci, "project_key": project, "pipeline_key": pipeline_key, "image_key": image_key}
            row["ci_metadata"] = metadata[row["id"]]
        for row in pipelines.values():
            projects[row["project_key"]]["pipelines"].add(row["key"])
        project_rows = [{**row, "jobs": len(row["jobs"]), "pipelines": len(row["pipelines"]), "images": len(row["images"])} for row in projects.values()]
        pipeline_rows = [{**row, "images": sorted(row["images"]), "container_ids": sorted(row["container_ids"]), "project": projects[row["project_key"]]["name"]} for row in pipelines.values()]
        image_rows = [{**row, "projects": sorted(row["projects"]), "pipelines": sorted(row["pipelines"])} for row in images.values()]
        return {"projects": sorted(project_rows, key=lambda p: p["name"].lower()), "pipelines": sorted(pipeline_rows, key=lambda p: p["last_seen"], reverse=True),
            "images": sorted(image_rows, key=lambda p: p.get("created") or 0, reverse=True), "workers": workers, "worker_metadata": metadata,
            "live_ids": live_ids, "truncated": len(workers) >= 10000 or len(pipeline_rows) >= 10000}

    def view(self, scope, kind="pipelines", query="", status="all", page=1, size=20):
        model = self.model()
        cutoff = time.time() - scope["hours"] * 3600 if scope["hours"] else 0
        project, pipeline, image = (scope[k] for k in ("project", "pipeline", "image"))
        def worker_matches(row):
            metadata = row.get("ci_metadata") or {}
            return row["last_seen"] >= cutoff and (project == "all" or metadata.get("project_key") == project) and (pipeline == "all" or metadata.get("pipeline_key") == pipeline) and (image == "all" or metadata.get("image_key") == image)
        workers = [row for row in model["workers"] if worker_matches(row)]
        pipeline_rows = [row for row in model["pipelines"] if row["last_seen"] >= cutoff and (project == "all" or row["project_key"] == project) and (pipeline == "all" or row["key"] == pipeline) and (image == "all" or image in row["images"])]
        workers_by_project, pipelines_by_project, workers_by_image = defaultdict(list), defaultdict(list), defaultdict(list)
        for row in workers:
            workers_by_project[row["ci_metadata"]["project_key"]].append(row)
            workers_by_image[row["ci_metadata"]["image_key"]].append(row)
        for row in pipeline_rows:
            pipelines_by_project[row["project_key"]].append(row)
        worker_projects = {row["ci_metadata"]["project_key"] for row in workers}
        project_keys = worker_projects | {row["project_key"] for row in pipeline_rows}
        scoped_image_keys = {row["ci_metadata"]["image_key"] for row in workers}
        image_rows = [row for row in model["images"] if (project == "all" and pipeline == "all" or row["key"] in scoped_image_keys) and (image == "all" or row["key"] == image)]
        image_rows = [{**row, "global_projects": row["projects"],
            "projects": sorted({worker["ci_metadata"]["project_key"] for worker in workers_by_image[row["key"]]}),
            "observed_containers": len(workers_by_image[row["key"]])} for row in image_rows]
        # Project-specific image attribution is based on retained container evidence.
        project_rows = [row for row in model["projects"] if row["id"] in project_keys and (project == "all" or row["id"] == project)]
        for row in project_rows:
            selected = workers_by_project[row["id"]]
            selected_pipelines = pipelines_by_project[row["id"]]
            row.update(containers=len(selected), running_containers=sum(w["id"] in model["live_ids"] for w in selected),
                jobs=len({w["ci_metadata"].get("job_id") for w in selected if w["ci_metadata"].get("job_id")}), pipelines=len(selected_pipelines), images=len({w["ci_metadata"]["image_key"] for w in selected}))
        known_success = [row for row in pipeline_rows if row["source"] == "gitlab" and row["status"] == "success"]
        durations = [number(row.get("duration")) for row in known_success]
        durations = [value for value in durations if value is not None]
        docker_source = self.sources.get("docker", {})
        docker_fresh = docker_source.get("status") == "healthy" and (not docker_source.get("updated_at") or time.time() - docker_source["updated_at"] <= 45)
        if not docker_fresh:
            for row in project_rows:
                row["running_containers"] = None
        summary = {"projects": len(project_rows), "observed_containers": len(workers), "observed_jobs": len({(row["ci_metadata"]["project_key"], row["ci_metadata"]["job_id"]) for row in workers if row["ci_metadata"].get("job_id")}),
            "running_containers": sum(row["id"] in model["live_ids"] for row in workers) if docker_fresh else None, "pipelines": len(pipeline_rows), "successful_pipelines": len(known_success),
            "failed_pipelines": sum(row["outcome_known"] and row["status"] == "failed" for row in pipeline_rows), "unknown_outcomes": sum(not row["outcome_known"] for row in pipeline_rows),
            "median_success_duration": statistics.median(durations) if durations else None, "timed_successful_pipelines": len(durations), "images": len(image_rows)}
        rows = {"projects": project_rows, "pipelines": pipeline_rows, "images": image_rows, "workers": workers}[kind]
        filtered = [row for row in rows if (status == "all" or row.get("status", row.get("state")) == status) and query.lower() in json.dumps(row, ensure_ascii=False).lower()]
        total = len(filtered)
        pages = max(1, math.ceil(total / size))
        page = min(page, pages)
        # Only current/latest-visible workers need client-side attribution for legacy views.
        visible_ids = {row["id"] for row in (self.sources.get("docker", {}).get("data") or {}).get("containers", [])} | {row["id"] for row in model["workers"][:100]}
        return {"scope": scope, "summary": summary, "rows": filtered[(page-1)*size:page*size], "total": total, "page": page, "size": size,
            "catalog": {"projects": model["projects"], "pipelines": [{k: row[k] for k in ("key", "id", "project_key", "project")} for row in model["pipelines"] if row["last_seen"] >= cutoff and (project == "all" or row["project_key"] == project)][:500],
                "images": [{k: row[k] for k in ("key", "tags", "projects", "pipelines", "present")} for row in model["images"]]},
            "worker_metadata": {key: row for key, row in model["worker_metadata"].items() if key in visible_ids},
            "coverage": {"truncated": model["truncated"], "gitlab_status": self.sources.get("gitlab", {}).get("status", "not_configured"), "worker_limit": 10000, "pipeline_limit": 10000,
                "note": "Runner activity and images are node observations. GitLab outcomes cover configured projects and can include jobs executed on other nodes. Sampling can miss short jobs; missing outcomes remain unknown."}}

    def capture(self, title, notes, scope):
        view = self.view(scope, kind="pipelines", size=100)
        host = (self.sources.get("host", {}).get("data") or {})
        engine = (self.sources.get("docker", {}).get("data") or {})
        identifier, now = secrets.token_hex(16), time.time()
        payload = {"id": identifier, "title": title, "notes": notes, "scope": scope, "created_at": now, "summary": view["summary"],
            "source_health": {key: {"status": value["status"], "updated_at": value.get("updated_at"), "age_seconds": now-value["updated_at"] if value.get("updated_at") else None} for key, value in self.sources.items()},
            "resources": {"cpu_percent": host.get("cpu", {}).get("percent"), "memory_percent": host.get("memory", {}).get("percent"), "memory_available_bytes": host.get("memory", {}).get("available"),
                "build_cache_bytes": (engine.get("storage") or {}).get("build_cache_bytes"), "runner_concurrent": (self.sources.get("runner", {}).get("data") or {}).get("metrics", {}).get("gitlab_runner_concurrent")},
            "pipelines": view["rows"], "pipeline_detail_truncated": view["total"] > len(view["rows"]), "coverage": view["coverage"]}
        self.store.event("action", "info", "Survey checkpoint captured", title)
        self.store.save_checkpoint(identifier, payload)
        return payload

    def compare(self, baseline, result):
        before, after = self.store.checkpoint(baseline), self.store.checkpoint(result)
        if before is None or after is None:
            raise HTTPException(404, "Checkpoint no longer available")
        if before["scope"] != after["scope"]:
            raise HTTPException(409, "Choose checkpoints with the same repository, pipeline, image and observation window")
        return {"before": before, "after": after, "note": "Resource readings describe the node. Pipeline timing medians describe successful pipelines in each window; different workloads do not establish an optimization speedup."}
