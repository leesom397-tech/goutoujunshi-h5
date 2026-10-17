"""Build a one-file, GUI-only Windows launcher after package_release.py.

Usage: .venv/Scripts/python.exe build_launcher.py --manifest dist/1.2.4/release/manifest.json
The manifest is embedded into the EXE; the launcher never fetches a mutable
manifest URL at runtime. This script prepares local files only; it never uploads.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import struct
import subprocess
import sys

from launcher import APP_NAME, EXE_NAME, file_sha256, validate_manifest
from normalize import VERSION
from windows_version_info import write_version_info


ROOT = Path(__file__).resolve().parent


def gui_subsystem(executable: Path) -> bool:
    """PE Optional Header Subsystem 2 means no console window on double-click."""
    with executable.open("rb") as source:
        if source.read(2) != b"MZ":
            return False
        source.seek(0x3C)
        pe_offset = struct.unpack("<I", source.read(4))[0]
        source.seek(pe_offset)
        if source.read(4) != b"PE\x00\x00":
            return False
        source.seek(pe_offset + 4 + 20 + 68)
        return struct.unpack("<H", source.read(2))[0] == 2


def verify_release(manifest_path: Path) -> dict:
    manifest = validate_manifest(json.loads(manifest_path.read_text(encoding="utf-8")))
    if manifest["version"] != VERSION:
        raise SystemExit(f"Manifest version {manifest['version']} differs from source version {VERSION}.")
    release = manifest_path.parent
    archive = release.parent / f"chengzi-wechat-collector-{manifest['version']}-full.zip"
    if not archive.is_file() or archive.stat().st_size != manifest["bytes"] or file_sha256(archive) != manifest["sha256"]:
        raise SystemExit("The full collector archive does not match the release manifest.")
    for part in manifest["parts"]:
        item = release / part["name"]
        if not item.is_file() or item.stat().st_size != part["bytes"] or file_sha256(item) != part["sha256"]:
            raise SystemExit(f"Missing or changed release part: {item}")
    exe = release.parent / APP_NAME / EXE_NAME
    if not exe.is_file() or file_sha256(exe) != manifest["exeSha256"]:
        raise SystemExit("The built collector EXE does not match the release manifest.")
    return manifest


def build(manifest_path: Path, output_dir: Path | None = None, build_dir: Path | None = None) -> Path:
    manifest_path = manifest_path.resolve()
    manifest = verify_release(manifest_path)
    release = manifest_path.parent
    output_dir = (output_dir or release).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    name = f"{APP_NAME}-Setup-{manifest['version']}"
    build_dir = (build_dir or output_dir / ".launcher-build").resolve()
    build_dir.mkdir(parents=True, exist_ok=True)
    version_info_path = write_version_info(
        build_dir / "version-info.txt",
        manifest["version"],
        file_description="成子电脑微信助手安装程序",
        original_filename=f"{name}.exe",
    )
    command = [
        sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean", "--onefile",
        "--windowed", "--noupx", "--log-level", "WARN", "--name", name,
        "--icon", str(ROOT / "launcher.ico"),
        "--version-file", str(version_info_path),
        "--distpath", str(output_dir), "--workpath", str(build_dir / "work"),
        "--specpath", str(build_dir), "--add-data", f"{manifest_path}{';' if sys.platform == 'win32' else ':'}.",
        str(ROOT / "launcher.py"),
    ]
    environment = dict(os.environ)
    environment["TEMP"] = str(build_dir)
    environment["TMP"] = str(build_dir)
    subprocess.run(command, cwd=ROOT, check=True, env=environment)
    executable = output_dir / (name + ".exe")
    if not executable.is_file() or not gui_subsystem(executable):
        raise SystemExit("Launcher was not built as a Windows GUI executable.")
    digest = file_sha256(executable)
    (output_dir / (name + ".sha256.txt")).write_text(f"{digest}  {executable.name}\n", encoding="ascii")
    print(json.dumps({"launcher": str(executable), "bytes": executable.stat().st_size, "sha256": digest}, ensure_ascii=False))
    return executable


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the GUI-only, pinned-manifest launcher EXE.")
    parser.add_argument("--manifest", type=Path, default=ROOT / "dist" / VERSION / "release" / "manifest.json")
    parser.add_argument("--output-dir", type=Path, help="Where to write the finished EXE (use another drive if needed).")
    parser.add_argument("--build-dir", type=Path, help="Where to put temporary PyInstaller build files.")
    args = parser.parse_args()
    if sys.platform != "win32":
        raise SystemExit("Build the Windows launcher on Windows.")
    build(args.manifest, args.output_dir, args.build_dir)


if __name__ == "__main__":
    main()
