"""Build a local Apple Silicon preview .app/ZIP. Never uploads or publishes."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import subprocess
import sys


ROOT = Path(__file__).resolve().parent
BASE_VERSION = "1.2.23"
PREVIEW_VERSION = BASE_VERSION + "-mac-preview.1"
APP_NAME = "ChengziWeChatCollector"
PINNED_KEEPER_COMMIT = "2225294fd0761e10ce15540f21e7dbb2ac304c3c"


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_vendor(root=ROOT):
    root = Path(root)
    vendor = (root / "vendor" / "chatlog_keeper").resolve()
    manifest = json.loads((root / "vendor" / "chatlog-keeper-pin.json").read_text("utf-8"))
    if (manifest.get("repository") != "https://github.com/labazhou2024/chatlog-keeper"
            or manifest.get("commit") != PINNED_KEEPER_COMMIT
            or not isinstance(manifest.get("files"), dict) or not manifest["files"]):
        raise RuntimeError("Unexpected chatlog-keeper source pin.")
    expected = set()
    for name, digest in manifest["files"].items():
        path = (vendor / name).resolve()
        if (not isinstance(name, str) or "\\" in name or not path.is_relative_to(vendor)
                or not isinstance(digest, str) or not re.fullmatch(r"[a-f0-9]{64}", digest)
                or not path.is_file() or sha256(path) != digest):
            raise RuntimeError("Vendored source integrity check failed: " + str(name))
        expected.add(name)
    actual = {path.relative_to(vendor).as_posix() for path in vendor.rglob("*")
              if path.is_file() and path.suffix in (".py", ".c")}
    if actual != expected:
        raise RuntimeError("Vendored executable source set differs from the pinned manifest.")
    return manifest


def export_icon(output_dir, source=None):
    """Mechanical format/size export of the approved homepage artwork."""
    from PIL import Image
    source = source or ROOT.parents[1] / "assets" / "brand" / "chengzi-fluted-chat-source.png"
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    icon = output_dir / "chengzi-fluted-chat-v1.icns"
    with Image.open(source) as image:
        image = image.convert("RGBA")
        if image.width != image.height:
            raise RuntimeError("The approved icon source must be square; no cropping is permitted.")
        image.resize((1024, 1024), Image.Resampling.LANCZOS).save(icon, format="ICNS")
    return icon


def compile_helpers(output_dir):
    sources = ROOT / "vendor" / "chatlog_keeper" / "scripts"
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    common = ["xcrun", "clang", "-arch", "arm64", "-mmacosx-version-min=11.0", "-O2", "-Wall", "-Wextra"]
    commands = [
        common + [str(sources / "macos_memory_scan.c"), "-o", str(output_dir / "macos_memory_scan")],
        common + ["-dynamiclib", "-Wl,-install_name,@rpath/macos_wechat_key_capture.dylib",
                  str(sources / "macos_wechat_key_capture.c"), "-o", str(output_dir / "macos_wechat_key_capture.dylib")],
    ]
    for command in commands:
        subprocess.run(command, check=True, cwd=ROOT)
    for name in ("macos_memory_scan", "macos_wechat_key_capture.dylib"):
        binary = output_dir / name
        subprocess.run(["lipo", str(binary), "-verify_arch", "arm64"], check=True)
    return output_dir


def verify_packaged_helpers(bundle):
    """Fail the build if resource relocation would trigger runtime compilation.

    The fixed upstream prefers an existing prebuilt file regardless of source
    mtime. PyInstaller may link its binary from Resources into Frameworks; check
    the path used by the packaged Python sources, not just the staging folder.
    """
    bundle = Path(bundle).resolve()
    resources = bundle / "Contents" / "Resources"
    verify_vendor(resources)
    scripts = resources / "vendor" / "chatlog_keeper" / "scripts"
    for name in ("macos_memory_scan", "macos_wechat_key_capture.dylib"):
        path = scripts / name
        if not path.is_file() or not path.resolve().is_relative_to(bundle):
            raise RuntimeError("A required bundled native helper is missing or escapes the app: " + name)
        subprocess.run(["lipo", str(path), "-verify_arch", "arm64"], check=True)


def build(output_dir):
    if sys.platform != "darwin" or platform.machine() != "arm64" or sys.version_info[:2] != (3, 12):
        raise SystemExit("Build this preview on an Apple Silicon Mac with native CPython 3.12.")
    output_dir = Path(output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    bundle = output_dir / (APP_NAME + ".app")
    archive = output_dir / (APP_NAME + "-" + PREVIEW_VERSION + "-arm64.zip")
    if bundle.exists() or archive.exists():
        raise SystemExit("An app or ZIP already exists here. Choose a new --output-dir to preserve it.")
    vendor = verify_vendor()
    work_dir = output_dir / ".build"
    native_dir = compile_helpers(work_dir / "native")
    icon = export_icon(work_dir / "assets")
    environment = dict(os.environ)
    environment["CHENGZI_MACOS_NATIVE_DIR"] = str(native_dir)
    environment["CHENGZI_MACOS_ASSET_DIR"] = str(icon.parent)
    subprocess.run([sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean",
                    "--distpath", str(output_dir), "--workpath", str(work_dir / "pyinstaller"),
                    str(ROOT / "ChengziWeChatCollector-macos.spec")],
                   cwd=ROOT, env=environment, check=True)
    executable = bundle / "Contents" / "MacOS" / APP_NAME
    if not executable.is_file():
        raise RuntimeError("The build did not produce the expected app executable.")
    verify_packaged_helpers(bundle)
    subprocess.run(["lipo", str(executable), "-verify_arch", "arm64"], check=True)
    # Ad-hoc integrity verification is not Developer ID signing/notarization.
    subprocess.run(["codesign", "--verify", "--deep", "--strict", str(bundle)], check=True)
    receipt = output_dir / "runtime-self-test.json"
    subprocess.run([str(executable), "--runtime-self-test", "--probe-output", str(receipt)],
                   check=True, timeout=120)
    runtime = json.loads(receipt.read_text("utf-8"))
    if (runtime.get("ok") is not True or runtime.get("architecture") != "arm64"
            or runtime.get("frozen") is not True or runtime.get("userDataUsed") is not False):
        raise RuntimeError("The frozen runtime self-test receipt did not pass.")
    subprocess.run(["ditto", "-c", "-k", "--sequesterRsrc", "--keepParent", str(bundle), str(archive)], check=True)
    manifest = {
        "version": PREVIEW_VERSION, "platform": "macos", "architecture": "arm64", "channel": "preview",
        "macosBuildHost": platform.mac_ver()[0], "python": platform.python_version(),
        "file": archive.name, "bytes": archive.stat().st_size, "sha256": sha256(archive),
        "codeSigning": "ad-hoc", "developerIdSigned": False, "notarized": False,
        "vendorCommit": vendor["commit"], "nativeRuntimeSelfTest": runtime,
        "liveWechatVerified": False, "publicRelease": False,
    }
    (output_dir / "manifest-macos-preview.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", "utf-8")
    (output_dir / (archive.name + ".sha256.txt")).write_text(manifest["sha256"] + "  " + archive.name + "\n", "ascii")
    print(json.dumps(manifest, ensure_ascii=False, indent=2))
    return archive


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=ROOT / "dist" / PREVIEW_VERSION)
    parser.add_argument("--check-sources", action="store_true", help="Verify the pinned public source files without building or running helpers.")
    args = parser.parse_args()
    if args.check_sources:
        manifest = verify_vendor()
        print(json.dumps({"ok": True, "vendorCommit": manifest["commit"], "files": len(manifest["files"])}))
        return
    build(args.output_dir)


if __name__ == "__main__":
    main()
