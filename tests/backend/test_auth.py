import json
import sqlite3
import time

from fastapi.testclient import TestClient
import pytest

from backend.config import Settings
from backend.main import create_app
from deploy.admin import write_account

TOKEN = 'operator-secret-for-tests-over-32-characters'
PASSWORD = 'a-long-administrator-test-password'


def configured(tmp_path):
    account = tmp_path / 'admin.json'
    write_account(account, 'admin', PASSWORD)
    settings = Settings(mode='central', token=TOKEN, db=str(tmp_path / 'fleet.sqlite'), admin_file=str(account))
    return settings, TestClient(create_app(settings))


def login(client, password=PASSWORD, username='admin'):
    return client.post('/api/auth/login', json={'username': username, 'password': password})


def test_password_login_private_config_session_reuse_and_logout(tmp_path):
    settings, client = configured(tmp_path)
    account = tmp_path / 'admin.json'
    assert account.stat().st_mode & 0o777 == 0o600
    assert PASSWORD not in account.read_text()
    response = client.get('/api/auth/config')
    assert response.json() == {'mode': 'password'}
    assert response.headers['cache-control'] == 'no-store'
    assert client.get('/api/fleet').status_code == 401
    session = login(client).json()
    assert TOKEN not in json.dumps(session) and PASSWORD not in json.dumps(session)
    headers = {'Authorization': 'Bearer ' + session['token']}
    assert client.get('/api/fleet', headers=headers).status_code == 200
    # Browser sessions do not expire when the central process restarts.
    restarted = TestClient(create_app(settings))
    assert restarted.get('/api/fleet', headers=headers).status_code == 200
    with sqlite3.connect(settings.db) as db:
        assert session['token'] not in repr(db.execute('SELECT * FROM admin_sessions').fetchall())
    assert client.post('/api/auth/logout', headers=headers).status_code == 200
    assert restarted.get('/api/fleet', headers=headers).status_code == 401
    # The internal operator token stays usable, but sessions cannot ingest as agents.
    assert client.get('/api/fleet', headers={'Authorization': 'Bearer ' + TOKEN}).status_code == 200
    assert client.post('/api/agent/telemetry', headers=headers, json={}).status_code == 401


def test_failed_login_is_generic_throttled_and_never_echoes_input(tmp_path):
    _, client = configured(tmp_path)
    for i in range(5):
        response = login(client, 'secret-wrong-password', 'unknown' if i % 2 else 'admin')
        assert response.status_code == 401
        assert response.json() == {'detail': 'Username or password was not accepted'}
    assert login(client).status_code == 429
    invalid = client.post('/api/auth/login', json={'username': 'admin', 'password': 'sensitive' * 200})
    assert invalid.status_code == 400 and 'sensitive' not in invalid.text
    assert client.post('/api/auth/login', content='x' * 8193).status_code == 413


def test_sessions_expire_and_password_reset_invalidates_sessions(tmp_path):
    settings, client = configured(tmp_path)
    token = login(client).json()['token']
    headers = {'Authorization': 'Bearer ' + token}
    with sqlite3.connect(settings.db) as db:
        db.execute('UPDATE admin_sessions SET expires=?', (time.time() - 1,))
    assert client.get('/api/fleet', headers=headers).status_code == 401
    headers = {'Authorization': 'Bearer ' + login(client).json()['token']}
    write_account(settings.admin_file, 'admin', 'a-different-long-password')
    restarted = TestClient(create_app(settings))
    assert restarted.get('/api/fleet', headers=headers).status_code == 401
    assert login(restarted, 'a-different-long-password').status_code == 200


def test_without_account_legacy_token_login_is_available(tmp_path):
    settings = Settings(mode='central', token=TOKEN, db=str(tmp_path / 'fleet.sqlite'), admin_file=str(tmp_path / 'absent.json'))
    client = TestClient(create_app(settings))
    assert client.get('/api/auth/config').json() == {'mode': 'token'}
    assert login(client).status_code == 403


def test_malformed_account_fails_closed(tmp_path):
    settings, _ = configured(tmp_path)
    (tmp_path / 'admin.json').write_text('{"username":"admin"}')
    with pytest.raises(ValueError, match='invalid or unreadable'):
        create_app(settings)
