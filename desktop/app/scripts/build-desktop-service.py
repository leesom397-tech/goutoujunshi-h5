"""Build the desktop app's entire native sidecar, without publishing artifacts."""
from pathlib import Path
import argparse
import os
import platform
import subprocess
import sys


COLLECTOR = Path(__file__).resolve().parents[2] / "wechat-collector"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=COLLECTOR / "dist" / "desktop-service")
    args = parser.parse_args()
    output = args.output_dir.resolve()
    if sys.version_info[:2] != (3, 12):
        raise SystemExit("Use native Python 3.12 with the collector's pinned dependencies.")
    if sys.platform == "win32" and platform.machine().lower() in ("amd64", "x86_64"):
        spec = "ChengziDesktopService.spec"
        artifact = output / "ChengziDesktopService"
    elif sys.platform == "darwin" and platform.machine() == "arm64":
        spec = "ChengziDesktopService-macos.spec"
        artifact = output / "ChengziDesktopService.app"
    else:
        raise SystemExit("Build natively on Windows x64 or an Apple Silicon Mac.")
    if artifact.exists():
        raise SystemExit("Preserving existing service. Choose a new --output-dir and set CHENGZI_DESKTOP_SERVICE_DIR to its service artifact.")
    output.mkdir(parents=True, exist_ok=True)
    work = output / ".build"
    env = dict(os.environ)
    if sys.platform == "darwin":
        sys.path.insert(0, str(COLLECTOR))
        from build_macos import compile_helpers, export_icon, verify_vendor
        verify_vendor()
        env["CHENGZI_MACOS_NATIVE_DIR"] = str(compile_helpers(work / "native"))
        env["CHENGZI_MACOS_ASSET_DIR"] = str(export_icon(work / "assets").parent)
    subprocess.run([sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean",
                    "--distpath", str(output), "--workpath", str(work / "pyinstaller"),
                    str(COLLECTOR / spec)], cwd=COLLECTOR, env=env, check=True)
    if sys.platform == "darwin":
        from build_macos import verify_packaged_helpers
        verify_packaged_helpers(artifact)
        executable = artifact / "Contents/MacOS/ChengziDesktopService"
        subprocess.run(["codesign", "--verify", "--deep", "--strict", str(artifact)], check=True)
        subprocess.run([str(executable), "--runtime-self-test", "--probe-output", str(output / "runtime-self-test.json")], check=True, timeout=120)
    else:
        executable = artifact / "ChengziDesktopService.exe"
        subprocess.run([str(executable), "--database-self-test", "--probe-output", str(output / "database-self-test.json")], check=True, timeout=120)
    # Startup alone cannot validate a frozen worker launched by the service's
    # background request thread. Exercise that exact path before packaging.
    subprocess.run([str(executable), "--worker-self-test", "--probe-output", str(output / "worker-self-test.json")], check=True, timeout=90)
    print("Built native service:", artifact)


if __name__ == "__main__":
    main()
