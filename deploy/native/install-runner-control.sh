#!/usr/bin/env bash
# Install the narrow runner-capacity helper. Does not restart GitLab Runner.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Run this installer with sudo.' >&2; exit 1; }
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
python3 -c 'import tomllib'
[[ -f /etc/gitlab-runner/config.toml && ! -L /etc/gitlab-runner/config.toml ]] || { echo 'Expected a regular /etc/gitlab-runner/config.toml; review a custom installation manually.' >&2; exit 1; }
getent group opsdeck-control >/dev/null || groupadd --system opsdeck-control
install -d -o root -g root -m 0755 /opt/opsdeck-runner-control /var/lib/opsdeck-control
install -o root -g root -m 0644 "$root/scripts/runner/admin.py" /opt/opsdeck-runner-control/admin.py
install -o root -g root -m 0644 "$root/scripts/runner/control.py" /opt/opsdeck-runner-control/control.py
touch /run/opsdeck-tune.lock
printf 'f /run/opsdeck-tune.lock 0600 root root -\n' > /etc/tmpfiles.d/opsdeck-control.conf
cat > /etc/systemd/system/opsdeck-runner-control.service <<'UNIT'
[Unit]
Description=OpsDeck local runner capacity control
After=gitlab-runner.service systemd-tmpfiles-setup.service

[Service]
Type=simple
User=root
Group=opsdeck-control
ExecStart=/usr/bin/python3 -B /opt/opsdeck-runner-control/control.py --facts /var/lib/opsdeck-control/runner-facts.json
Restart=on-failure
RestartSec=3
RuntimeDirectory=opsdeck-control
RuntimeDirectoryMode=0750
UMask=0027
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
PrivateDevices=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictAddressFamilies=AF_UNIX
ReadWritePaths=/etc/gitlab-runner /var/lib/opsdeck-control /run/opsdeck-tune.lock

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable opsdeck-runner-control.service
systemctl restart opsdeck-runner-control.service
printf 'Runner capacity helper ready. Socket group ID: %s\n' "$(getent group opsdeck-control | cut -d: -f3)"
echo 'GitLab Runner was not restarted. Follow docs/operations/operator-actions.md to connect OpsDeck.'
