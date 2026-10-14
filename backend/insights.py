"""Explain measured conditions without claiming that unmeasured tuning is complete."""
def insights(snapshot):
    host = (snapshot.get("host") or {}).get("data") or {}
    engine = (snapshot.get("docker") or {}).get("data") or {}
    gitlab = (snapshot.get("gitlab") or {}).get("data") or {}
    alerts = []
    recommendations = []
    def alert(key, title, detail, severity="warning"):
        alerts.append({"key": key, "title": title, "detail": detail, "severity": severity})
    for volume in host.get("volumes", []):
        if volume["percent"] >= 85:
            alert("disk:" + volume["mount"], "Filesystem is filling up", f"{volume['mount']}: {volume['percent']:.0f}% used", "critical" if volume["percent"] >= 95 else "warning")
        if (volume.get("inode_percent") or 0) >= 85:
            alert("inode:" + volume["mount"], "Filesystem inode pressure", f"{volume['mount']}: {volume['inode_percent']:.0f}% of inodes used")
    memory = host.get("memory", {})
    if memory.get("percent", 0) >= 90:
        alert("memory", "Low available memory", "Available RAM is below 10%; inspect active workloads", "critical")
    io = (host.get("pressure", {}).get("io") or {}).get("some", {}).get("avg60", 0)
    if io > 10:
        alert("io", "Workloads are waiting on storage", f"I/O pressure over the last minute: {io:.1f}%")
    for container in engine.get("containers", []):
        if "unhealthy" in container["status"].lower():
            alert("container:" + container["id"], "Container health check failed", container["name"], "critical")
    for gpu in (snapshot.get("gpu") or {}).get("data") or []:
        if (gpu.get("temperature") or 0) > 85:
            alert("gpu:" + gpu["index"], "GPU temperature is high", f"{gpu['name']}: {gpu['temperature']:.0f} °C")
    for name, item in snapshot.items():
        if item.get("status") == "unavailable":
            alert("source:" + name, f"{name.title()} telemetry is unavailable", item.get("message") or "Check collector access and connectivity")
    for service in (snapshot.get("services") or {}).get("data") or []:
        if service["load"] == "loaded" and service["state"] in ("failed", "inactive"):
            alert("service:" + service["name"], "Monitored service is not running", service["name"] + ": " + service["state"], "critical" if service["state"] == "failed" else "warning")
    unused_nvme = [d for d in host.get("inventory", []) if d["name"].startswith("nvme") and not d.get("fstype") and not d.get("children")]
    recommendations.append({"key": "nvme", "title": "Put busy storage on NVMe", "category": "Storage", "status": "opportunity" if unused_nvme else "verify",
        "evidence": f"{len(unused_nvme)} NVMe device(s) have no filesystem or partitions reported." if unused_nvme else "Verify Docker, workspaces, and cache are on fast storage.",
        "next": "Use the administrator migration preflight. Device inventory alone does not prove a drive is safe to format."})
    recommendations.append({"key": "budgets", "title": "Budget jobs by workload", "category": "Scheduling", "status": "verify",
        "evidence": f"{host.get('cpu', {}).get('cores', '?')} physical cores; {host.get('cpu', {}).get('threads', '?')} hardware threads.",
        "next": "Cap compiler/test workers, then benchmark 8, 12, and 16 slots with mixed projects. Separate heavy, light, and GPU lanes."})
    recommendations.append({"key": "scratch", "title": "Trial bounded RAM scratch", "category": "Memory", "status": "opportunity" if memory.get("available", 0) > 64 * 1024**3 else "verify",
        "evidence": f"{memory.get('available', 0) / 1024**3:.1f} GiB available in the latest sample.",
        "next": "Start with 8–16 GiB per selected job; retain persistent caches on disk and measure with normal fsync."})
    recommendations.append({"key": "cache", "title": "Reuse compiler and image layers", "category": "Caching", "status": "verify",
        "evidence": f"Docker storage driver: {engine.get('storage_driver', 'unavailable')}. Cache hit rates need project instrumentation.",
        "next": "Use project-scoped persistent ccache and BuildKit caches. Keep trusted and untrusted cache writers separate."})
    jobs = gitlab.get("jobs", [])
    queued = [j for j in jobs if j["status"] == "pending"]
    if queued:
        alert("queue", "CI jobs are waiting", f"{len(queued)} pending job(s) in the configured project sample")
    recommendations.append({"key": "gpu", "title": "Use the GPU deliberately", "category": "Compute", "status": "opportunity" if (snapshot.get("gpu") or {}).get("data") else "verify",
        "evidence": f"{len((snapshot.get('gpu') or {}).get('data') or [])} NVIDIA device(s) detected.",
        "next": "Add a serialized CUDA test lane or an internal inference service; coordinate exclusive GPU ownership."})
    return alerts, recommendations
