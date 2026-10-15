import argparse
import tomllib
from scripts.runner.admin import metrics_config, safe_facts, tune

CONFIG = '''concurrent = 4
[[runners]]
name = "heavy"
token = "keep-this-secret"
limit = 2
request_concurrency = 1
[runners.docker]
image = "ubuntu:24.04"
volumes = ["/cache"]
[[runners]]
name = "light"
token = "another-secret"
[runners.docker]
image = "alpine"
'''


def test_targeted_runner_edit_preserves_other_registration_and_tokens():
    args = argparse.Namespace(runner="heavy", concurrent=8, requests=4, limit=None, cpus=6, memory="32g", metrics=True)
    result = tomllib.loads(tune(CONFIG, args))
    assert result["concurrent"] == 8
    assert result["listen_address"] == "127.0.0.1:9252"
    assert result["runners"][0]["limit"] == 2
    assert result["runners"][0]["request_concurrency"] == 4
    assert result["runners"][0]["docker"]["cpus"] == "6"
    assert result["runners"][0]["token"] == "keep-this-secret"
    assert result["runners"][1] == tomllib.loads(CONFIG)["runners"][1]
    assert "secret" not in str(safe_facts(result))


def test_ambiguous_registration_is_refused():
    import pytest
    args = argparse.Namespace(runner=None, concurrent=8, requests=4, limit=None, cpus=None, memory=None, metrics=False)
    with pytest.raises(ValueError, match="Select exactly one"):
        tune(CONFIG, args)


def test_metrics_only_preserves_all_limits_registrations_and_secrets():
    before = tomllib.loads(CONFIG)
    candidate = metrics_config(CONFIG)
    after = tomllib.loads(candidate)
    assert after.pop("listen_address") == "127.0.0.1:9252"
    assert after == before
    assert metrics_config(candidate) == candidate


def test_metrics_only_updates_empty_global_address_and_preserves_session_address():
    config = 'listen_address = ""\n' + CONFIG + '\n[session_server]\nlisten_address = "127.0.0.1:8093"\n'
    result = tomllib.loads(metrics_config(config))
    assert result["listen_address"] == "127.0.0.1:9252"
    assert result["session_server"]["listen_address"] == "127.0.0.1:8093"
    import pytest
    with pytest.raises(ValueError, match="custom metrics address"):
        metrics_config('listen_address = "localhost:9400"\n' + CONFIG)


def test_metrics_cli_applies_once_with_private_backup_and_sanitized_export(tmp_path, monkeypatch, capsys):
    import sys
    from scripts.runner.admin import main
    path = tmp_path / "config.toml"
    path.write_text(CONFIG)
    path.chmod(0o600)
    facts = tmp_path / "runner-facts.json"
    monkeypatch.setattr(sys, "argv", ["admin.py", "--config", str(path), "--metrics-only", "--apply", "--facts", str(facts)])
    main()
    backups = list(tmp_path.glob("config.toml.bak-*"))
    assert len(backups) == 1
    assert backups[0].read_text() == CONFIG
    assert backups[0].stat().st_mode & 0o777 == 0o600
    assert path.stat().st_mode & 0o777 == 0o600
    assert "secret" not in facts.read_text()
    assert "secret" not in capsys.readouterr().out
    main()
    assert len(list(tmp_path.glob("config.toml.bak-*"))) == 1
