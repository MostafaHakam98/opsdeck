#!/usr/bin/env bash
# Install the prebuilt application as a native Linux user service.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)
[[ "$ROOT" != *' '* ]] || { echo 'Install into a path without spaces' >&2; exit 1; }
[[ -d frontend/dist ]] || { echo 'Build the frontend before installing' >&2; exit 1; }
umask 077
mkdir -p data
if [[ ! -x .venv/bin/python ]]; then
  python3 -m venv --without-pip .venv
fi
if [[ -d wheels ]]; then
  PIP_WHEEL=$(find wheels -maxdepth 1 -name 'pip-*.whl' -print -quit)
  [[ -n "$PIP_WHEEL" ]] || { echo 'Offline bundle is missing its pip bootstrap wheel' >&2; exit 1; }
  PYTHONPATH="$ROOT/$PIP_WHEEL" .venv/bin/python -m pip --isolated install --no-index --find-links wheels pip
  .venv/bin/python -m pip --isolated install --no-index --find-links wheels -r backend/requirements.lock
else
  .venv/bin/python -m ensurepip
  .venv/bin/python -m pip install -r backend/requirements.lock
fi
if [[ ! -f .env ]]; then
  .venv/bin/python - <<'PY'
from pathlib import Path
import secrets
values = {'OPSDECK_TOKEN': secrets.token_urlsafe(48), 'OPSDECK_BIND': '127.0.0.1', 'OPSDECK_PORT': '8080', 'OPSDECK_DB': './data/opsdeck.sqlite', 'OPSDECK_ACTIONS': 'false'}
Path('.env').write_text(''.join(f'{key}={value}\n' for key, value in values.items()))
PY
fi
chmod 600 .env
mkdir -p "$HOME/.config/systemd/user"
cat > "$HOME/.config/systemd/user/opsdeck.service" <<EOF
[Unit]
Description=OpsDeck infrastructure workspace
After=network.target
[Service]
WorkingDirectory=$ROOT
ExecStart=$ROOT/.venv/bin/python -m backend.run
Restart=on-failure
RestartSec=5
UMask=0077
NoNewPrivileges=true
MemoryMax=1G
CPUQuota=100%
TasksMax=128
[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
systemctl --user enable --now opsdeck.service
echo "Installed OpsDeck. Access token: $ROOT/.env (mode 600; not printed)."
echo "For boot persistence, an administrator must run: loginctl enable-linger $(id -un)"
