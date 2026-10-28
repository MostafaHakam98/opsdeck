#!/usr/bin/env bash
# Tune a Linux GitLab runner host. Run as root, one phase at a time:
#
#   sudo bash scripts/runner/tune-runner-host.sh status
#   sudo bash scripts/runner/tune-runner-host.sh concurrency [N]
#   sudo bash scripts/runner/tune-runner-host.sh metrics
#   sudo bash scripts/runner/tune-runner-host.sh nvme-preflight
#   sudo bash scripts/runner/tune-runner-host.sh nvme --confirm-unused-devices
#   sudo bash scripts/runner/tune-runner-host.sh nvme-rollback --confirm-original-snapshot
#
# Why: 48 threads and 503 GB RAM run 4 jobs at once, and every job's I/O
# (Docker layers, /builds, the runner cache) lands on sda, a 7200 rpm HDD,
# while two 1 TB NVMe drives sit unpartitioned.
#
# Never prints config.toml; only the three keys it changes.

set -euo pipefail

CONFIG=/etc/gitlab-runner/config.toml
NVME_DOCKER=/dev/nvme0n1
NVME_CACHE=/dev/nvme1n1
STAMP=$(date +%Y%m%d-%H%M%S)
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)

[[ $EUID -eq 0 ]] || { echo "run with sudo" >&2; exit 1; }
exec 9>/run/opsdeck-tune.lock
flock -n 9 || { echo "another tuning operation is running" >&2; exit 1; }

show_keys() {
  grep -nE '^\s*(concurrent|limit|request_concurrency)\s*=' "$CONFIG" || true
}

# admin.py needs tomllib (Python 3.11+). Hosts with an older python3 run it in
# a throwaway Python 3.12 container that sees only the checkout and runner config.
run_admin() {
  local py root config_dir image=${OPSDECK_ADMIN_IMAGE:-python:3.12-slim-bookworm}
  for py in python3 python3.13 python3.12 python3.11; do
    if command -v "$py" >/dev/null && "$py" -c 'import tomllib' 2>/dev/null; then
      "$py" "$SCRIPT_DIR/admin.py" "$@"
      return
    fi
  done
  root=$(cd -- "$SCRIPT_DIR/../.." && pwd)
  config_dir=$(dirname -- "$CONFIG")
  echo "Host python3 lacks tomllib; running admin.py in $image." >&2
  docker run --rm --network none \
    -v "$root:$root" -v "$config_dir:$config_dir" -w "$root" \
    "$image" python "$SCRIPT_DIR/admin.py" "$@"
}

phase_status() {
  echo "== runner keys"; show_keys
  echo "== disks"; lsblk -o NAME,SIZE,ROTA,FSTYPE,LABEL,MOUNTPOINTS "$NVME_DOCKER" "$NVME_CACHE"
  echo "== mounts"
  for d in /var/lib/docker /cache; do
    printf '  %s on %s\n' "$d" "$(findmnt -no SOURCE --target "$d")"
  done
  echo "== jobs running"; docker ps --filter name=runner- --format '{{.Names}}' | wc -l
}

phase_concurrency() {
  local n="${1:-8}"
  [[ "$n" =~ ^[0-9]+$ && "$n" -ge 1 && "$n" -le 32 ]] || { echo "N must be 1..32" >&2; exit 2; }
  # Refuses ambiguous multiple registrations. Explicit per-runner limits are
  # preserved; use admin.py --runner NAME --limit N after reviewing them.
  run_admin --config "$CONFIG" --concurrent "$n" --apply
  show_keys
  # gitlab-runner reloads config.toml on change; no restart, running jobs untouched.
  sleep 5
  journalctl -u gitlab-runner --since "-1min" --no-pager | grep -iE 'configuration loaded|error' | tail -3 || true
  echo "Restore the backup printed above if validation fails."
}

metrics_ready() {
  python3 - <<'PY'
import urllib.request
import sys
try:
    with urllib.request.urlopen('http://127.0.0.1:9252/metrics', timeout=2) as response:
        body = response.read(2 * 1024 * 1024).decode()
    sys.exit(0 if any(line.startswith('gitlab_runner_') for line in body.splitlines()) else 1)
except (OSError, UnicodeError):
    sys.exit(1)
PY
}

phase_metrics() {
  run_admin --config "$CONFIG" --metrics-only --apply \
    --facts "$SCRIPT_DIR/../../data/runner-facts.json"
  if metrics_ready; then
    echo 'Runner metrics are already available; refreshed sanitized configuration facts.'
    return
  fi
  if ! systemctl is-active --quiet gitlab-runner; then
    echo 'Metrics configured. Runner is not active; start it when its maintenance is complete.'
    return
  fi
  local original_pid current_pid deadline
  original_pid=$(systemctl show gitlab-runner --property=MainPID --value)
  [[ "$original_pid" =~ ^[1-9][0-9]*$ ]] || { echo 'Runner main PID unavailable; no signal sent.' >&2; return 1; }
  echo 'Draining the runner gracefully: no new work; current jobs can finish.'
  systemctl kill --kill-whom=main --signal=SIGQUIT gitlab-runner
  deadline=$((SECONDS + 3600))
  while true; do
    current_pid=$(systemctl show gitlab-runner --property=MainPID --value)
    [[ "$current_pid" == "$original_pid" ]] || break
    [[ $SECONDS -lt $deadline ]] || { echo 'Still draining after one hour. No forced stop was issued; let jobs finish, then start the service if needed.' >&2; return 1; }
    sleep 2
  done
  # Start is idempotent if the service restart policy has already launched it.
  # Do not restart a new process: it may already have accepted another job.
  systemctl start gitlab-runner
  deadline=$((SECONDS + 60))
  until metrics_ready; do
    [[ $SECONDS -lt $deadline ]] || { echo 'Runner metrics did not become ready; inspect the service locally.' >&2; return 1; }
    sleep 2
  done
  echo 'Runner metrics ready on loopback port 9252. Concurrency and job limits were preserved.'
}

assert_blank() {
  local dev="$1"
  if [[ -n "$(lsblk -nro FSTYPE,PTTYPE "$dev" | tr -d ' \n')" ]] || [[ "$(lsblk -nr "$dev" | wc -l)" -ne 1 ]] \
     || [[ -n "$(wipefs -n "$dev")" ]] || [[ -n "$(lsblk -nro MOUNTPOINTS "$dev" | tr -d ' \n')" ]] \
     || [[ -n "$(ls -A "/sys/class/block/$(basename "$dev")/holders")" ]]; then
    echo "$dev is not blank (partitions or signatures found). Refusing to format it." >&2
    exit 1
  fi
}

# Wait for running jobs to finish without accepting new ones, then hold the
# runner stopped. SIGQUIT is gitlab-runner's graceful stop; plain `systemctl
# stop` sends SIGTERM, which aborts running jobs. Restart=always with
# RestartSec=120 gives a window to issue the real stop before it comes back.
drain_runner() {
  echo "Draining: no new jobs; waiting for running ones to finish..."
  if ! systemctl is-active --quiet gitlab-runner; then
    return
  fi
  mkdir -p /run/systemd/system/gitlab-runner.service.d
  printf '[Service]\nRestart=no\n' > /run/systemd/system/gitlab-runner.service.d/90-opsdeck-drain.conf
  systemctl daemon-reload
  systemctl kill --kill-whom=main --signal=SIGQUIT gitlab-runner
  local deadline=$((SECONDS + 3600))
  while systemctl is-active --quiet gitlab-runner; do
    [[ $SECONDS -lt $deadline ]] || { echo "Drain timed out; services left unchanged for inspection" >&2; return 1; }
    printf '  %s jobs still running\n' "$(docker ps -q --filter name=runner- | wc -l)"
    sleep 20
  done
  systemctl stop gitlab-runner
  rm /run/systemd/system/gitlab-runner.service.d/90-opsdeck-drain.conf
  systemctl daemon-reload
}

move_onto() {
  local dev="$1" label="$2" dir="$3"
  mkfs.ext4 -q -L "$label" -E lazy_itable_init=0,lazy_journal_init=0 "$dev"
  local mnt="/mnt/$label"
  mkdir -p "$mnt"
  mount -o noatime "$dev" "$mnt"
  echo "copying $dir -> $label ($(du -sh "$dir" 2>/dev/null | cut -f1))"
  rsync -aHAX --numeric-ids --info=progress2 "$dir"/ "$mnt"/
  umount "$mnt"
  rmdir "$mnt"
  # Mounted over the original directory: the HDD copy stays underneath,
  # untouched, which is what makes nvme-rollback a plain unmount.
  local uuid
  uuid=$(blkid -s UUID -o value "$dev")
  echo "UUID=$uuid $dir ext4 defaults,noatime 0 2 # opsdeck-$label" >> /etc/fstab
  mount "$dir"
  mountpoint -q "$dir"
}

phase_nvme_preflight() {
  phase_status
  assert_blank "$NVME_DOCKER"
  assert_blank "$NVME_CACHE"
  du -sh /var/lib/docker /cache
  docker info --format 'storage={{.Driver}} root={{.DockerRootDir}}'
  echo "Verify ownership of both devices and actual build workspace/cache mounts before proceeding."
}

phase_nvme() {
  [[ "${1:-}" == "--confirm-unused-devices" ]] || { echo "Run nvme-preflight, then pass --confirm-unused-devices after reviewing ownership and downtime" >&2; exit 2; }
  assert_blank "$NVME_DOCKER"
  assert_blank "$NVME_CACHE"
  findmnt -n /var/lib/docker >/dev/null && { echo "/var/lib/docker is already a mount" >&2; exit 1; }
  findmnt -n /cache >/dev/null && { echo "/cache is already a mount" >&2; exit 1; }
  command -v rsync >/dev/null || { echo "Install rsync before starting maintenance" >&2; exit 1; }
  [[ "$(docker info --format '{{.Driver}}')" == "overlay2" ]] || { echo "Unsupported Docker storage driver; inspect containerd and data paths before migration" >&2; exit 1; }
  [[ "$(docker info --format '{{.DockerRootDir}}')" == "/var/lib/docker" ]] || { echo "Docker data root differs; adapt the migration first" >&2; exit 1; }
  [[ "$(docker ps -q --filter name=runner- | wc -l)" == "$(docker ps -q | wc -l)" ]] || { echo "Non-runner containers are active; account for their downtime before migrating" >&2; exit 1; }
  for pair in "$NVME_DOCKER:/var/lib/docker" "$NVME_CACHE:/cache"; do
    dev=${pair%%:*}; directory=${pair#*:}
    [[ -d "$directory" ]] || { echo "$directory missing" >&2; exit 1; }
    used=$(du -sx --block-size=1 "$directory" | cut -f1)
    capacity=$(blockdev --getsize64 "$dev")
    [[ $used -lt $((capacity * 8 / 10)) ]] || { echo "$directory exceeds 80% of target device capacity" >&2; exit 1; }
  done
  cp -a /etc/fstab "/etc/fstab.bak-$STAMP"
  trap 'echo "Migration stopped. Inspect mounts and fstab; services are not automatically restarted on failure." >&2' ERR

  drain_runner
  systemctl stop docker.socket docker
  move_onto "$NVME_DOCKER" ci-docker /var/lib/docker
  move_onto "$NVME_CACHE" ci-cache /cache
  for unit in docker gitlab-runner; do
    mkdir -p "/etc/systemd/system/$unit.service.d"
    printf '[Unit]\nRequiresMountsFor=/var/lib/docker /cache\n[Service]\nExecStartPre=/usr/bin/mountpoint -q /var/lib/docker\nExecStartPre=/usr/bin/mountpoint -q /cache\n' > "/etc/systemd/system/$unit.service.d/80-opsdeck-storage.conf"
  done
  systemctl daemon-reload
  systemctl start docker
  docker image ls --format '{{.Repository}}:{{.Tag}}' | grep -c . | xargs echo "images visible:"
  systemctl start gitlab-runner
  systemctl enable --now fstrim.timer
  trap - ERR
  phase_status
  echo "Done. The HDD copies remain under the mounts; free them only after a week of green pipelines."
}

phase_nvme_rollback() {
  [[ "${1:-}" == "--confirm-original-snapshot" ]] || { echo "The HDD copy is the pre-migration snapshot. Reverse-sync current data first, or pass --confirm-original-snapshot to explicitly return to that older state." >&2; exit 2; }
  drain_runner
  systemctl stop docker.socket docker
  umount /var/lib/docker /cache
  cp -a /etc/fstab "/etc/fstab.bak-$STAMP"
  sed -i -E '/# opsdeck-ci-(docker|cache)$/d' /etc/fstab
  for unit in docker gitlab-runner; do
    rm -f "/etc/systemd/system/$unit.service.d/80-opsdeck-storage.conf"
  done
  systemctl daemon-reload
  systemctl start docker gitlab-runner
  phase_status
}

case "${1:-status}" in
  status) phase_status ;;
  concurrency) phase_concurrency "${2:-16}" ;;
  metrics) phase_metrics ;;
  nvme-preflight) phase_nvme_preflight ;;
  nvme) phase_nvme "${2:-}" ;;
  nvme-rollback) phase_nvme_rollback "${2:-}" ;;
  *) echo "unknown phase: $1" >&2; exit 2 ;;
esac
