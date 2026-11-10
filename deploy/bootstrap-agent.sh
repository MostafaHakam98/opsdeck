#!/usr/bin/env bash
# Install the OpsDeck outbound agent on this machine from the public repository.
#
# The dashboard's Enroll host walkthrough shows the exact command, pinned to the
# commit the server runs:
#   curl -fsSL https://raw.githubusercontent.com/MostafaHakam98/opsdeck/<commit>/deploy/bootstrap-agent.sh \
#     | bash -s -- --server https://opsdeck.example.com --method docker --ref <commit>
#
# The agent credential is read from the terminal without echo, or from the
# OPSDECK_AGENT_CREDENTIAL environment variable for unattended installs. It is
# never a command argument, never printed, and only stored in .env.agent (mode 600).
set -euo pipefail

fail() {
  echo "opsdeck: $*" >&2
  exit 1
}

main() {
  local repository=https://github.com/MostafaHakam98/opsdeck.git
  local server="" method=docker ref=origin/devel directory="$HOME/opsdeck-agent"
  while [ $# -gt 0 ]; do
    case "$1" in
      --server | --method | --ref | --dir | --repository)
        [ $# -ge 2 ] || fail "$1 needs a value"
        case "$1" in
          --server) server=$2 ;;
          --method) method=$2 ;;
          --ref) ref=$2 ;;
          --dir) directory=$2 ;;
          --repository) repository=$2 ;;
        esac
        shift 2
        ;;
      *) fail "unknown option $1 (use --server, --method docker|native, --ref, --dir)" ;;
    esac
  done

  [[ $server =~ ^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?$ || $server =~ ^http://(127\.0\.0\.1|localhost|\[::1\])(:[0-9]{1,5})?$ ]] \
    || fail "--server must be the OpsDeck HTTPS origin, for example https://opsdeck.example.com"
  [[ $method == docker || $method == native ]] || fail "--method must be docker or native"
  [[ $ref =~ ^[0-9a-f]{7,40}$ || $ref =~ ^origin/[A-Za-z0-9._/-]+$ ]] || fail "--ref must be a commit or origin/<branch>"
  [[ $directory != *' '* ]] || fail "--dir must not contain spaces"

  for tool in git make python3; do
    command -v "$tool" >/dev/null || fail "$tool is required"
  done
  if [ "$method" = docker ]; then
    docker info >/dev/null 2>&1 < /dev/null \
      || fail "cannot reach Docker as $(id -un); add this account to the docker group, or use --method native"
    docker compose version >/dev/null 2>&1 < /dev/null || fail "Docker Compose v2 is required"
  else
    python3 -c 'import sys; sys.exit(sys.version_info < (3, 12))' || fail "Python 3.12+ is required; use --method docker"
    command -v systemctl >/dev/null || fail "a systemd user session is required; use --method docker"
  fi

  local credential=${OPSDECK_AGENT_CREDENTIAL:-}
  unset OPSDECK_AGENT_CREDENTIAL
  if [ -z "$credential" ]; then
    { : < /dev/tty; } 2>/dev/null || fail "no terminal to ask for the credential; set OPSDECK_AGENT_CREDENTIAL"
    printf 'Paste the agent credential from OpsDeck (input is hidden): ' > /dev/tty
    IFS= read -rs credential < /dev/tty
    printf '\n' > /dev/tty
  fi
  [[ $credential =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[A-Za-z0-9_-]{20,}$ ]] \
    || fail "that is not an OpsDeck agent credential; copy it again from the walkthrough"

  echo "opsdeck: fetching $repository at $ref into $directory"
  if [ -d "$directory/.git" ]; then
    git -C "$directory" fetch --quiet origin < /dev/null
  else
    git clone --quiet "$repository" "$directory" < /dev/null
  fi
  cd "$directory"
  git -c advice.detachedHead=false checkout --quiet "$ref" < /dev/null

  umask 077
  mkdir -p data
  printf '%s\n' "$credential" | python3 -m deploy.configure --agent --server "$server"
  credential=""

  if [ "$method" = docker ]; then
    echo "opsdeck: building and starting the agent container (project opsdeck-agent)"
    COMPOSE_PROJECT_NAME=opsdeck-agent make docker-agent-up < /dev/null
  else
    echo "opsdeck: installing backend dependencies and the opsdeck-agent user service"
    [ -x .venv/bin/python ] || python3 -m venv .venv < /dev/null
    .venv/bin/python -m pip install --quiet -r backend/requirements.lock < /dev/null
    make agent-install < /dev/null
  fi
  echo "opsdeck: agent started. Return to the OpsDeck walkthrough; this host turns Online after its first sample."
}

main "$@"
