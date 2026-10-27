"""One administrator account with hashed passwords and revocable browser sessions."""
import hashlib
import hmac
import json
from pathlib import Path
import secrets
import sqlite3
import time

from fastapi import HTTPException, Request

SESSION_SECONDS = 12 * 3600


def password_hash(password, salt):
    return hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1).hex()


def account_record(username, password):
    if not username.strip() or len(username) > 120 or not 12 <= len(password) <= 1024:
        raise ValueError('Use a username of 1..120 characters and a password of 12..1024 characters')
    salt = secrets.token_hex(16)
    return {'username': username.strip(), 'salt': salt, 'password_hash': password_hash(password, salt)}


class AdminAuth:
    def __init__(self, path, db, operator_token):
        self.account = None
        self.db = db
        self.attempts = {}
        target = Path(path)
        if target.exists():
            try:
                account = json.loads(target.read_text())
                if (not isinstance(account['username'], str) or not account['username']
                        or len(bytes.fromhex(account['salt'])) != 16
                        or len(bytes.fromhex(account['password_hash'])) != 64):
                    raise ValueError()
                self.account = account
            except (OSError, ValueError, KeyError, TypeError):
                raise ValueError('Administrator account file is invalid or unreadable') from None
        self.fingerprint = hashlib.sha256((json.dumps(self.account, sort_keys=True) + operator_token).encode()).hexdigest()
        with self.connect() as connection:
            connection.execute('CREATE TABLE IF NOT EXISTS admin_sessions (hash TEXT PRIMARY KEY, expires REAL NOT NULL, account TEXT NOT NULL)')
            connection.execute('DELETE FROM admin_sessions WHERE expires <= ? OR account != ?', (time.time(), self.fingerprint))

    def connect(self):
        return sqlite3.connect(self.db, timeout=30)

    @staticmethod
    def digest(token):
        return hashlib.sha256(token.encode()).hexdigest()

    def valid(self, token):
        if not self.account or not token:
            return False
        with self.connect() as connection:
            row = connection.execute('SELECT 1 FROM admin_sessions WHERE hash=? AND expires>? AND account=?',
                                     (self.digest(token), time.time(), self.fingerprint)).fetchone()
        return bool(row)

    def login(self, username, password, peer):
        now = time.monotonic()
        recent = [stamp for stamp in self.attempts.get(peer, []) if now - stamp < 60]
        if len(recent) >= 5:
            raise HTTPException(429, 'Too many sign-in attempts; wait one minute')
        if len(self.attempts) > 1024:
            self.attempts.clear()
        self.attempts[peer] = recent + [now]
        if not self.account:
            raise HTTPException(403, 'Administrator password login is not configured')
        # Check the password even for an unknown username.
        valid_password = hmac.compare_digest(password_hash(password, self.account['salt']), self.account['password_hash'])
        if not hmac.compare_digest(username.encode(), self.account['username'].encode()) or not valid_password:
            raise HTTPException(401, 'Username or password was not accepted')
        self.attempts.pop(peer, None)
        token = secrets.token_urlsafe(48)
        expires = time.time() + SESSION_SECONDS
        with self.connect() as connection:
            connection.execute('DELETE FROM admin_sessions WHERE expires <= ?', (time.time(),))
            connection.execute('INSERT INTO admin_sessions VALUES (?,?,?)', (self.digest(token), expires, self.fingerprint))
        return {'token': token, 'expires_at': expires}

    def logout(self, token):
        with self.connect() as connection:
            connection.execute('DELETE FROM admin_sessions WHERE hash=?', (self.digest(token),))

    def routes(self, app):
        @app.get('/api/auth/config')
        def configuration():
            return {'mode': 'password' if self.account else 'token'}

        @app.post('/api/auth/login')
        async def login(request: Request):
            data = bytearray()
            async for chunk in request.stream():
                data.extend(chunk)
                if len(data) > 8192:
                    raise HTTPException(413, 'Sign-in request is too large')
            try:
                values = json.loads(data)
                username, password = values['username'], values['password']
                if not isinstance(username, str) or not isinstance(password, str) or len(username) > 120 or len(password) > 1024:
                    raise ValueError()
            except (ValueError, KeyError, TypeError, RecursionError):
                raise HTTPException(400, 'Enter a username and password') from None
            import asyncio
            return await asyncio.to_thread(self.login, username, password, request.client.host if request.client else 'unknown')

        @app.post('/api/auth/logout')
        def logout(request: Request):
            authorization = request.headers.get('authorization', '')
            self.logout(authorization[7:] if authorization.startswith('Bearer ') else '')
            return {'signed_out': True}
