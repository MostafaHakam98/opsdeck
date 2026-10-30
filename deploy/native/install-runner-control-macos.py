"""Install the runner image/capacity helper as the current macOS runner owner."""
import os
from pathlib import Path
import plistlib
import subprocess
import sys


def main():
    if sys.platform != "darwin" or os.getuid() == 0:
        raise SystemExit("Run with the OpsDeck virtualenv Python as the macOS runner owner")
    root = Path(__file__).resolve().parents[2]
    config = Path.home()/".gitlab-runner/config.toml"
    if config.is_symlink() or not config.is_file() or config.stat().st_uid != os.getuid():
        raise SystemExit("Expected your own regular ~/.gitlab-runner/config.toml")
    os.umask(0o077)
    for name in ("data", "logs"):
        (root/name).mkdir(mode=0o700, exist_ok=True)
    label = "io.opsdeck.runner-control"
    launch = Path.home()/"Library/LaunchAgents"/(label+".plist")
    launch.parent.mkdir(parents=True, exist_ok=True)
    domain = "gui/" + str(os.getuid())
    existing = subprocess.run(["launchctl", "print", domain+"/"+label], capture_output=True).returncode == 0
    if existing:
        subprocess.run(["launchctl", "bootout", domain+"/"+label], check=True)
    launch.write_bytes(plistlib.dumps({"Label":label,"ProgramArguments":[sys.executable,"-m","scripts.runner.control",
        "--config",str(config),"--facts",str(root/"data/runner-facts.json"),"--socket",str(root/"data/runner-control.sock"),"--lock",str(root/"data/runner-control.lock")],
        "WorkingDirectory":str(root),"RunAtLoad":True,"KeepAlive":True,
        "StandardOutPath":str(root/"logs/runner-control.out.log"),"StandardErrorPath":str(root/"logs/runner-control.err.log")}))
    subprocess.run(["launchctl","bootstrap",domain,str(launch)],check=True)
    sys.stdout.write("Helper installed; GitLab Runner was not restarted.\n")
    sys.stdout.write("Set OPSDECK_RUNNER_CONTROL_SOCKET="+str(root/"data/runner-control.sock")+" in the workspace environment and restart only OpsDeck.\n")


if __name__ == "__main__":
    main()
