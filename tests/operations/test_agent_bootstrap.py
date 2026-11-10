import os
from pathlib import Path
import subprocess
import sys

import pytest

from backend.run import load_environment
from deploy.configure import agent_environment

ROOT = Path(__file__).resolve().parents[2]
TEMPLATE = ROOT / ".env.agent.example"
SCRIPT = ROOT / "deploy" / "bootstrap-agent.sh"
CREDENTIAL = "0b6c1f3e-1111-4222-8333-444455556666." + "a" * 43
SERVER = "https://opsdeck.example.com"


def test_agent_environment_fills_the_template_privately_and_replaces_on_rotation(tmp_path, monkeypatch):
    target = tmp_path / ".env.agent"
    agent_environment(target, TEMPLATE, SERVER, CREDENTIAL)
    assert target.stat().st_mode & 0o777 == 0o600
    lines = target.read_text().splitlines()
    # Every template line survives in order; only the two enrollment values change.
    assert len(lines) == len(TEMPLATE.read_text().splitlines())
    assert "replace-with" not in target.read_text() and "opsdeck.example.com" in target.read_text()
    for key in ("OPSDECK_SERVER_URL", "OPSDECK_AGENT_TOKEN", "RUNNER_METRICS_URL", "OPSDECK_SAMPLE_SECONDS"):
        monkeypatch.delenv(key, raising=False)
    load_environment(target)
    assert (os.environ["OPSDECK_SERVER_URL"], os.environ["OPSDECK_AGENT_TOKEN"]) == (SERVER, CREDENTIAL)
    assert os.environ["OPSDECK_SAMPLE_SECONDS"] == "10"
    rotated = CREDENTIAL[:-1] + "b"
    agent_environment(target, TEMPLATE, SERVER, rotated)
    assert rotated in target.read_text() and CREDENTIAL not in target.read_text()
    assert [p.name for p in tmp_path.iterdir()] == [".env.agent"]


@pytest.mark.parametrize("server,credential", [
    ("http://opsdeck.example.com", CREDENTIAL), ("https://opsdeck.example.com/path", CREDENTIAL),
    ("https://x.example.com\nOPSDECK_ACTIONS=true", CREDENTIAL), (SERVER, ""), (SERVER, "not-a-credential"),
    (SERVER, CREDENTIAL + "\nOPSDECK_ACTIONS=true"),
])
def test_agent_environment_rejects_bad_values_without_writing(tmp_path, server, credential):
    with pytest.raises(ValueError):
        agent_environment(tmp_path / ".env.agent", TEMPLATE, server, credential)
    assert not any(tmp_path.iterdir())


def test_agent_cli_reads_the_credential_from_stdin_and_never_prints_it(tmp_path):
    result = subprocess.run([sys.executable, "-m", "deploy.configure", "--agent", "--server", SERVER,
                             "--output", str(tmp_path / ".env.agent"), "--template", str(TEMPLATE)],
                            input=CREDENTIAL + "\n", capture_output=True, text=True, cwd=ROOT)
    assert result.returncode == 0, result.stderr
    assert CREDENTIAL not in result.stdout + result.stderr
    assert CREDENTIAL in (tmp_path / ".env.agent").read_text()
    bad = subprocess.run([sys.executable, "-m", "deploy.configure", "--agent", "--server", SERVER,
                          "--output", str(tmp_path / "bad"), "--template", str(TEMPLATE)],
                         input="oops\n", capture_output=True, text=True, cwd=ROOT)
    assert bad.returncode != 0 and "not an OpsDeck agent credential" in bad.stderr and not (tmp_path / "bad").exists()


def stub(directory, name, body):
    path = directory / name
    path.write_text("#!/bin/bash\n" + body)
    path.chmod(0o755)


@pytest.fixture
def sandbox(tmp_path):
    """A HOME and PATH where git clones this checkout's deploy tooling and make/docker only record calls."""
    bin_dir, home = tmp_path / "bin", tmp_path / "home"
    bin_dir.mkdir()
    home.mkdir()
    log = tmp_path / "calls.log"
    stub(bin_dir, "git", f'''echo "git $*" >> "{log}"
if [ "$1" = clone ]; then mkdir -p "${{@: -1}}/.git"; cp -r "{ROOT}/deploy" "{TEMPLATE}" "${{@: -1}}/"; fi
''')
    # Draining stdin proves a piped `curl | bash` script cannot be swallowed by a child command.
    stub(bin_dir, "make", f'cat > /dev/null; echo "make $* project=$COMPOSE_PROJECT_NAME" >> "{log}"\n')
    stub(bin_dir, "docker", f'cat > /dev/null; echo "docker $*" >> "{log}"\n')
    env = {"HOME": str(home), "PATH": f"{bin_dir}:/usr/bin:/bin", "LANG": "C"}
    return home, log, env


def bootstrap(env, *args, credential=CREDENTIAL):
    environment = dict(env, **({"OPSDECK_AGENT_CREDENTIAL": credential} if credential is not None else {}))
    # Exactly how the walkthrough runs it: the script arrives on stdin, as from curl.
    return subprocess.run(["bash", "-s", "--", *args], input=SCRIPT.read_text(), capture_output=True, text=True,
                          env=environment, start_new_session=True, timeout=60)


def test_bootstrap_installs_the_docker_agent_from_a_pinned_checkout(sandbox):
    home, log, env = sandbox
    result = bootstrap(env, "--server", SERVER, "--method", "docker", "--ref", "af9fb56")
    assert result.returncode == 0, result.stderr
    assert "agent started" in result.stdout
    assert CREDENTIAL not in result.stdout + result.stderr
    calls = log.read_text().splitlines()
    assert calls[:2] == ["docker info", "docker compose version"]
    assert calls[2].startswith("git clone --quiet https://github.com/MostafaHakam98/opsdeck.git ")
    assert calls[3:] == ["git -c advice.detachedHead=false checkout --quiet af9fb56",
                         "make docker-agent-up project=opsdeck-agent"]
    written = home / "opsdeck-agent" / ".env.agent"
    assert written.stat().st_mode & 0o777 == 0o600
    assert f"OPSDECK_SERVER_URL={SERVER}" in written.read_text().splitlines()
    assert CREDENTIAL in written.read_text()
    # A rerun (for example after rotation) fetches instead of cloning and rewrites the credential.
    rotated = CREDENTIAL[:-1] + "z"
    assert bootstrap(env, "--server", SERVER, "--ref", "af9fb56", credential=rotated).returncode == 0
    assert "git -C " in log.read_text() and rotated in written.read_text()


@pytest.mark.parametrize("args,credential,message", [
    (["--method", "docker"], CREDENTIAL, "--server must be"),
    (["--server", "http://opsdeck.example.com"], CREDENTIAL, "--server must be"),
    (["--server", SERVER, "--method", "podman"], CREDENTIAL, "--method must be"),
    (["--server", SERVER, "--ref", "main; rm -rf ~"], CREDENTIAL, "--ref must be"),
    (["--server", SERVER, "--token", "x"], CREDENTIAL, "unknown option --token"),
    (["--server"], CREDENTIAL, "--server needs a value"),
    (["--server", SERVER], "pasted-the-wrong-thing", "not an OpsDeck agent credential"),
    (["--server", SERVER], None, "no terminal to ask for the credential"),
])
def test_bootstrap_stops_before_changing_anything_on_bad_input(sandbox, args, credential, message):
    home, log, env = sandbox
    result = bootstrap(env, *args, credential=credential)
    assert result.returncode != 0 and message in result.stderr
    assert not (home / "opsdeck-agent").exists()
    assert "git" not in (log.read_text() if log.exists() else "")
