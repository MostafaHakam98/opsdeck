"""Create/reset the central administrator account without storing a plaintext password."""
import argparse
import getpass
import json
import os
from pathlib import Path
import sys
import tempfile

from backend.auth import account_record


def write_account(path, username, password):
    record = account_record(username, password)
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(dir=path.parent, prefix='.admin-')
    try:
        with os.fdopen(descriptor, 'w') as stream:
            json.dump(record, stream)
            stream.write('\n')
        os.replace(temporary, path)
    finally:
        if Path(temporary).exists():
            Path(temporary).unlink()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--username', default='admin')
    parser.add_argument('--file', default=os.getenv('OPSDECK_ADMIN_FILE', './data/admin.json'))
    args = parser.parse_args()
    password = getpass.getpass('New administrator password (at least 12 characters): ')
    if password != getpass.getpass('Confirm password: '):
        raise SystemExit('Passwords do not match')
    write_account(args.file, args.username, password)
    sys.stdout.write('Administrator account saved. Restart the central service to apply it and invalidate existing sessions.\n')
