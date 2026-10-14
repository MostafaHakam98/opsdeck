from backend.run import load_environment


def test_environment_loader_accepts_template_spacing_and_preserves_process_values(tmp_path, monkeypatch):
    path = tmp_path / "settings.env"
    path.write_text('OPSDECK_TOKEN = "example-token-value"\nOPSDECK_PORT=9090\n# Comment\n')
    monkeypatch.delenv("OPSDECK_TOKEN", raising=False)
    monkeypatch.setenv("OPSDECK_PORT", "8080")
    load_environment(path)
    import os
    assert os.environ["OPSDECK_TOKEN"] == "example-token-value"
    assert os.environ["OPSDECK_PORT"] == "8080"
    monkeypatch.delenv("OPSDECK_TOKEN")


def test_environment_loader_treats_shell_text_as_data(tmp_path, monkeypatch):
    path = tmp_path / "settings.env"
    value = "$(touch /tmp/opsdeck-env-should-never-execute)"
    path.write_text("OPSDECK_ENV_TEST=" + value + "\n")
    monkeypatch.delenv("OPSDECK_ENV_TEST", raising=False)
    load_environment(path)
    import os
    assert os.environ["OPSDECK_ENV_TEST"] == value
    monkeypatch.delenv("OPSDECK_ENV_TEST")
