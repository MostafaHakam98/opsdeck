#!/usr/bin/env bash
# Install an outbound telemetry agent as a Linux user service.
set -euo pipefail
cd "$(dirname "$0")/../.."
AGENT_ROOT=$(pwd)
[[ "$AGENT_ROOT" != *' '* ]] || { echo 'Install into a path without spaces' >&2; exit 1; }
[[ -x .venv/bin/python && -f .env.agent ]] || { echo 'Install backend dependencies and create .env.agent first' >&2; exit 1; }
umask 077
chmod 600 .env.agent
.venv/bin/python - <<'PY'
from pathlib import Path
from backend.agent import AgentSettings
from backend.run import load_environment
load_environment(Path('.env.agent'))
AgentSettings().validate()
PY
mkdir -p data "$HOME/.config/systemd/user"
cat > "$HOME/.config/systemd/user/opsdeck-agent.service" <<EOF
[Unit]
Description=OpsDeck outbound runner telemetry agent
After=network-online.target
[Service]
WorkingDirectory=$AGENT_ROOT
ExecStart=$AGENT_ROOT/.venv/bin/python -m backend.agent --env-file $AGENT_ROOT/.env.agent
Restart=on-failure
RestartSec=5
UMask=0077
NoNewPrivileges=true
MemoryMax=512M
CPUQuota=100%
TasksMax=128
[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
systemctl --user enable --now opsdeck-agent.service
echo 'Installed opsdeck-agent.service. Credentials are stored in .env.agent and are not printed.'
echo "For boot persistence, an administrator can run: loginctl enable-linger $(id -un)"
