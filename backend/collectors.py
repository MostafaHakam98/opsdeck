"""Read-only collectors. Missing integrations report unavailable, never fabricated values."""
import concurrent.futures
import csv
import io
import json
import os
from pathlib import Path
import platform
import re
import socket
import subprocess
import time
from urllib.parse import quote

import docker
import httpx
import psutil


def command(args: list[str], timeout=5):
    return subprocess.run(args, capture_output=True, text=True, timeout=timeout, check=True).stdout


def source(data=None, status="healthy", message=None):
    return {"status": status, "message": message, "updated_at": time.time(), "data": data}


def failure(exc, hint):
    # Exception strings may contain access tokens or URLs; return a controlled message.
    return source(status="unavailable", message=f"{hint} ({type(exc).__name__})")


def pressure():
    result = {}
    for name in ("cpu", "io", "memory"):
        try:
            result[name] = {}
            for line in Path(f"/proc/pressure/{name}").read_text().splitlines():
                kind, *fields = line.split()
                result[name][kind] = {k: float(v) for k, v in (f.split("=") for f in fields)}
        except (OSError, ValueError):
            result[name] = None
    return result


class HostCollector:
    def __init__(self):
        self.previous = None
        self.inventory = None
        self.inventory_at = 0

    def collect(self):
        now = time.monotonic()
        vm, swap = psutil.virtual_memory(), psutil.swap_memory()
        net = psutil.net_io_counters(pernic=True)
        disks = psutil.disk_io_counters(perdisk=True) or {}
        old_ts, old_net, old_disks = self.previous or (now, {}, {})
        elapsed = max(now - old_ts, .001)
        self.previous = (now, net, disks)
        networks = []
        stats = psutil.net_if_stats()
        for name, counters in net.items():
            if name == "lo":
                continue
            prev = old_net.get(name)
            state = stats.get(name)
            networks.append({"name": name, "up": state.isup if state else False, "speed_mbps": state.speed if state else None,
                "rx_bytes_s": max(0, counters.bytes_recv - prev.bytes_recv) / elapsed if prev else None,
                "tx_bytes_s": max(0, counters.bytes_sent - prev.bytes_sent) / elapsed if prev else None,
                "errors": counters.errin + counters.errout, "drops": counters.dropin + counters.dropout})
        volumes = []
        for part in psutil.disk_partitions():
            if part.device.startswith("/dev/loop") or part.fstype in ("squashfs", "overlay", "tmpfs"):
                continue
            try:
                usage = psutil.disk_usage(part.mountpoint)
                vfs = os.statvfs(part.mountpoint)
                volumes.append({"device": part.device, "mount": part.mountpoint, "fstype": part.fstype, "total": usage.total,
                    "used": usage.used, "free": usage.free, "percent": usage.percent,
                    "inode_percent": 100 * (vfs.f_files - vfs.f_ffree) / vfs.f_files if vfs.f_files else None})
            except OSError:
                continue
        disk_rates = []
        for name, counters in disks.items():
            if name.startswith(("loop", "ram")):
                continue
            prev = old_disks.get(name)
            operations = (counters.read_count + counters.write_count - prev.read_count - prev.write_count) if prev else 0
            times = counters.read_time + counters.write_time - prev.read_time - prev.write_time if prev else 0
            disk_rates.append({"name": name, "read_bytes_s": max(0, counters.read_bytes - prev.read_bytes) / elapsed if prev else None,
                "write_bytes_s": max(0, counters.write_bytes - prev.write_bytes) / elapsed if prev else None,
                "iops": max(0, operations) / elapsed if prev else None,
                "await_ms": max(0, times) / operations if operations > 0 else None,
                "busy_percent": min(100, max(0, getattr(counters, "busy_time", 0) - getattr(prev, "busy_time", 0)) / elapsed / 10) if prev else None})
        if now - self.inventory_at > 300 or self.inventory is None:
            try:
                self.inventory = json.loads(command(["lsblk", "--json", "--bytes", "-o", "NAME,SIZE,ROTA,FSTYPE,MOUNTPOINTS,TYPE"]))["blockdevices"]
                self.inventory = [d for d in self.inventory if d.get("type") == "disk"]
            except (OSError, ValueError, subprocess.SubprocessError):
                self.inventory = []
            self.inventory_at = now
        temperatures = []
        try:
            for sensor, readings in psutil.sensors_temperatures().items():
                temperatures.extend({"sensor": sensor, "label": r.label, "current": r.current, "high": r.high} for r in readings)
        except (AttributeError, OSError):
            pass
        freq = psutil.cpu_freq()
        processes = []
        for proc in psutil.process_iter(["pid", "name", "memory_info", "cpu_percent"]):
            try:
                p = proc.info
                processes.append({"pid": p["pid"], "name": p["name"], "memory_bytes": p["memory_info"].rss if p["memory_info"] else 0, "cpu_percent": p["cpu_percent"]})
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue
        return source({"hostname": socket.gethostname(), "os": platform.platform(), "boot_time": psutil.boot_time(),
            "cpu": {"percent": psutil.cpu_percent(interval=.1), "cores": psutil.cpu_count(logical=False), "threads": psutil.cpu_count(),
                "load": list(os.getloadavg()), "mhz": freq.current if freq else None},
            "memory": {"total": vm.total, "available": vm.available, "used": vm.total - vm.available, "percent": vm.percent,
                "cached": getattr(vm, "cached", None), "swap_total": swap.total, "swap_used": swap.used},
            "volumes": volumes, "disks": disk_rates, "inventory": self.inventory, "network": networks,
            "pressure": pressure(), "temperatures": temperatures,
            "processes": len(psutil.pids()), "top_processes": sorted(processes, key=lambda p: p["memory_bytes"], reverse=True)[:15]})


def services_collect(settings):
    names = [s for s in settings.services if re.fullmatch(r"[A-Za-z0-9_.@-]+\.service", s)]
    if not names:
        return source([], "not_configured", "Set OPSDECK_SERVICES to the service units to monitor")
    try:
        output = command(["systemctl", "show", "--property=Id,LoadState,ActiveState,SubState,ExecMainStatus,MemoryCurrent,CPUUsageNSec", "--", *names])
        rows = []
        for block in output.strip().split("\n\n"):
            values = dict(line.split("=", 1) for line in block.splitlines() if "=" in line)
            def numeric(key):
                val = values.get(key, "")
                return int(val) if val.isdigit() and int(val) < 2**63 else None
            if values.get("Id"):
                rows.append({"name": values["Id"], "load": values.get("LoadState"), "state": values.get("ActiveState"),
                    "substate": values.get("SubState"), "exit_code": numeric("ExecMainStatus"),
                    "memory_bytes": numeric("MemoryCurrent"), "cpu_seconds": numeric("CPUUsageNSec") / 1e9 if numeric("CPUUsageNSec") is not None else None})
        return source(rows)
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        return failure(exc, "Systemd service status unavailable on this host")


def gpu_collect():
    try:
        output = command(["nvidia-smi", "--query-gpu=index,name,memory.total,memory.used,utilization.gpu,temperature.gpu,power.draw,power.limit,driver_version", "--format=csv,noheader,nounits"])
        gpus = []
        for row in csv.reader(io.StringIO(output)):
            index, name, total, used, util, temp, watts, limit, driver = [v.strip() for v in row]
            def number(value):
                try:
                    return float(value)
                except ValueError:
                    return None
            gpus.append({"index": index, "name": name, "memory_total_mib": number(total), "memory_used_mib": number(used),
                "utilization": number(util), "temperature": number(temp), "power_w": number(watts), "power_limit_w": number(limit), "driver": driver})
        return source(gpus)
    except FileNotFoundError:
        return source(status="not_configured", message="NVIDIA tools are not installed on this host")
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        return failure(exc, "GPU driver or NVIDIA device is unavailable")


class DockerCollector:
    def __init__(self):
        self.previous = {}
        self.storage = None
        self.storage_at = 0

    def collect(self):
        try:
            client = docker.from_env(timeout=4)
            try:
                info = client.info()
                containers = client.api.containers(all=True)
                running = [c for c in containers if c["State"] == "running"][:64]
                current_stats = {}
                def stats(container):
                    try:
                        return container["Id"], client.api.stats(container["Id"], stream=False, one_shot=True)
                    except docker.errors.DockerException:
                        return container["Id"], None
                with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
                    current_stats.update(pool.map(stats, running))
                rows = []
                for c in containers[:200]:
                    s = current_stats.get(c["Id"])
                    cpu = None
                    memory = None
                    limit = None
                    if s:
                        current = s.get("cpu_stats", {})
                        previous = self.previous.get(c["Id"], {})
                        cpu_delta = current.get("cpu_usage", {}).get("total_usage", 0) - previous.get("cpu_usage", {}).get("total_usage", 0)
                        system_delta = current.get("system_cpu_usage", 0) - previous.get("system_cpu_usage", 0)
                        if previous and system_delta > 0 and cpu_delta >= 0:
                            cpu = cpu_delta / system_delta * current.get("online_cpus", 1) * 100
                        self.previous[c["Id"]] = current
                        m = s.get("memory_stats", {})
                        memory = max(0, m.get("usage", 0) - m.get("stats", {}).get("inactive_file", 0))
                        limit = m.get("limit")
                    labels = c.get("Labels") or {}
                    rows.append({"id": c["Id"], "name": (c.get("Names") or [c["Id"][:12]])[0].lstrip("/"), "image": c["Image"],
                        "state": c["State"], "status": c["Status"], "created": c["Created"], "cpu_percent": cpu,
                        "memory_bytes": memory, "memory_limit": limit, "managed": labels.get("opsdeck.managed") == "true",
                        "ci": any(k.startswith("com.gitlab.gitlab-runner") for k in labels) or any(n.lstrip("/").startswith("runner-") for n in c.get("Names", [])),
                        "ports": [{"private": p.get("PrivatePort"), "public": p.get("PublicPort"), "type": p.get("Type")} for p in c.get("Ports", [])]})
                self.previous = {k: v for k, v in self.previous.items() if k in current_stats}
                storage_error = None
                if time.monotonic() - self.storage_at > 300 or self.storage is None:
                    try:
                        usage = client.df()
                        images = usage.get("Images") or []
                        volumes = usage.get("Volumes") or []
                        build = usage.get("BuildCache") or []
                        self.storage = {"layers_bytes": usage.get("LayersSize"), "images_count": len(images), "volumes_count": len(volumes),
                            "build_cache_bytes": sum(x.get("Size", 0) for x in build),
                            "build_cache_reclaimable_bytes": sum(x.get("Size", 0) for x in build if not x.get("InUse")),
                            "updated_at": time.time()}
                        self.storage_at = time.monotonic()
                    except docker.errors.DockerException:
                        storage_error = "Docker disk-usage query unavailable"
                return source({"version": info.get("ServerVersion"), "storage_driver": info.get("Driver"), "root": info.get("DockerRootDir"),
                    "containers": rows, "total_containers": len(containers), "stats_limit": 64, "truncated": len(containers) > 200,
                    "storage": self.storage, "storage_error": storage_error})
            finally:
                client.close()
        except (docker.errors.DockerException, OSError) as exc:
            return failure(exc, "Docker daemon unavailable; check the service and socket permissions")


def runner_collect(settings):
    metrics = {}
    facts = {}
    try:
        loaded = json.loads(Path(settings.runner_facts).read_text())
        facts = {k: loaded[k] for k in ("concurrent", "updated_at") if k in loaded}
        fields = ("name", "executor", "limit", "request_concurrency", "cpus", "memory")
        facts["runners"] = [{k: row[k] for k in fields if k in row} for row in loaded.get("runners", []) if isinstance(row, dict)]
    except (OSError, ValueError, TypeError, AttributeError):
        pass
    if not settings.runner_url:
        return source({"facts": facts}, "not_configured", "Configure RUNNER_METRICS_URL for runner telemetry")
    try:
        response = httpx.get(settings.runner_url, timeout=4, follow_redirects=False)
        response.raise_for_status()
        for line in response.text.splitlines():
            if line.startswith("gitlab_runner_"):
                try:
                    full_name, value, *_ = line.split()
                    name = full_name.split("{")[0]
                    numeric = float(value)
                    if numeric == numeric and abs(numeric) != float("inf"):
                        metrics[name] = metrics.get(name, 0) + numeric
                except ValueError:
                    continue
        return source({"metrics": metrics, "facts": facts})
    except (httpx.HTTPError, ValueError) as exc:
        return source({"metrics": {}, "facts": facts}, "unavailable", f"Runner metrics endpoint unavailable ({type(exc).__name__}); enable its local metrics listener")


def gitlab_collect(settings):
    if not settings.gitlab_url or not settings.gitlab_token or not settings.projects:
        return source({"projects": [], "pipelines": [], "jobs": []}, "not_configured", "Set GITLAB_URL, GITLAB_TOKEN (read_api), and GITLAB_PROJECT_IDS on the server")
    projects, pipelines, jobs, errors = [], [], [], []
    with httpx.Client(base_url=settings.gitlab_url + "/api/v4/", headers={"PRIVATE-TOKEN": settings.gitlab_token}, timeout=8, follow_redirects=False) as client:
        def get(path, params=None):
            response = client.get(path, params=params)
            response.raise_for_status()
            return response.json()
        for project in settings.projects:
            try:
                prefix = "projects/" + quote(project, safe="")
                meta = get(prefix)
                name = meta["path_with_namespace"]
                projects.append({"id": meta["id"], "name": name, "url": meta.get("web_url")})
                recent = get(prefix + "/pipelines", {"per_page": 10})
                active = get(prefix + "/pipelines", {"per_page": 20, "status": "running"}) + get(prefix + "/pipelines", {"per_page": 20, "status": "pending"})
                candidates = {p["id"]: p for p in recent + active}
                for p in candidates.values():
                    detailed = p
                    if p["status"] in ("running", "pending") or p["id"] in [r["id"] for r in recent[:3]]:
                        detailed = get(prefix + f"/pipelines/{p['id']}")
                    pipelines.append({"id": p["id"], "project": name, "status": p["status"], "ref": p["ref"], "url": p.get("web_url"),
                        "created_at": p.get("created_at"), "duration": detailed.get("duration"), "queued_duration": detailed.get("queued_duration")})
                    if p["status"] in ("running", "pending") or (recent and p["id"] == recent[0]["id"]):
                        for page in range(1, 4):
                            batch = get(prefix + f"/pipelines/{p['id']}/jobs", {"per_page": 100, "page": page})
                            for j in batch:
                                jobs.append({"id": j["id"], "pipeline": p["id"], "project": name, "name": j["name"], "status": j["status"],
                                    "duration": j.get("duration"), "queued_duration": j.get("queued_duration"), "url": j.get("web_url"),
                                    "runner": (j.get("runner") or {}).get("description"), "created_at": j.get("created_at")})
                            if len(batch) < 100:
                                break
            except (httpx.HTTPError, KeyError, ValueError) as exc:
                errors.append(f"Project {project}: read failed ({type(exc).__name__}); check access and connectivity")
    return source({"projects": projects, "pipelines": pipelines, "jobs": jobs,
        "errors": errors, "scope": "Latest 10 pipelines plus up to 20 running and 20 pending per project; up to 300 jobs per selected pipeline"},
        "degraded" if errors else "healthy", "; ".join(errors) or None)
