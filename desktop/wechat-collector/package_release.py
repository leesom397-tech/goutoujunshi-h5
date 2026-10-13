"""Produce a tiny bootstrap ZIP and hash-verified static parts, never user data."""
import hashlib
import json
from pathlib import Path
import shutil
import zipfile
from normalize import VERSION

ROOT = Path(__file__).resolve().parent
APP = ROOT / "dist" / "ChengziWeChatCollector"
RELEASE = ROOT / "dist" / "release"


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    executable = APP / "ChengziWeChatCollector.exe"
    if not executable.is_file():
        raise SystemExit("Run PyInstaller first.")
    RELEASE.mkdir(parents=True, exist_ok=True)
    source = APP / "source"
    source.mkdir(exist_ok=True)
    for filename in ("main.py", "bridge.py", "adapter.py", "compatibility.py", "normalize.py", "requirements-lock.txt", "README.md", "LICENSE-pywechat.txt", "test_collector.py", "package_release.py", "install.ps1"):
        shutil.copy2(ROOT / filename, source / filename)
    upstream = ROOT / ".venv" / "Lib" / "site-packages"
    # Complete original Python library sources remain replaceable/rebuildable.
    for module in ("pyweixin", "pywechat"):
        shutil.copytree(upstream / module, source / module, dirs_exist_ok=True, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    licenses = source / "third-party-licenses"
    licenses.mkdir(exist_ok=True)
    for info in upstream.glob("*.dist-info"):
        for path in info.rglob("*"):
            if path.is_file() and ("license" in path.name.lower() or "copying" in path.name.lower() or "notice" in path.name.lower()):
                dest = licenses / info.name / path.relative_to(info)
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(path, dest)
    archive = Path(shutil.make_archive(str(ROOT / "dist" / f"chengzi-wechat-collector-{VERSION}-full"), "zip", APP.parent, APP.name))
    parts = []
    with archive.open("rb") as stream:
        index = 1
        while data := stream.read(12 * 1024 * 1024):
            name = f"chengzi-wechat-collector-{VERSION}.part{index:02}.bin"
            target = RELEASE / name
            target.write_bytes(data)
            parts.append({"name": name, "bytes": len(data), "sha256": sha(target)})
            index += 1
    manifest = {"version": VERSION, "bytes": archive.stat().st_size, "sha256": sha(archive), "exeSha256": sha(executable), "parts": parts}
    (RELEASE / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    shutil.copy2(RELEASE / "manifest.json", RELEASE / f"manifest-{VERSION}.json")
    with zipfile.ZipFile(RELEASE / "chengzi-wechat-collector-windows.zip", "w", zipfile.ZIP_DEFLATED) as installer:
        installer.writestr("启动成子助手.cmd", '@echo off\r\ncd /d "%~dp0"\r\npowershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"\r\nif errorlevel 1 pause\r\n')
        installer.writestr("install.ps1", (ROOT / "install.ps1").read_text(encoding="utf-8").encode("utf-8-sig"))
        installer.write(RELEASE / "manifest.json", "manifest.json")
        installer.write(ROOT / "README.md", "使用说明.md")
    shutil.copy2(RELEASE / "chengzi-wechat-collector-windows.zip", RELEASE / f"chengzi-wechat-collector-windows-{VERSION}.zip")
    print(json.dumps({"release": str(RELEASE), "fullBytes": manifest["bytes"], "partCount": len(parts), "bootstrapBytes": (RELEASE / "chengzi-wechat-collector-windows.zip").stat().st_size}, ensure_ascii=False))


if __name__ == "__main__":
    main()
