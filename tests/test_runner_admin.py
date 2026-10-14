import argparse
import tomllib
from deploy.runner_admin import safe_facts, tune

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
