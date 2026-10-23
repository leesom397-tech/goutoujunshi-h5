"""GitHub-hosted Mac compatibility smoke using an unmodified official client.

No account login, screenshot, QR inspection, chat read, key extraction, signing
change, permission change or memory helper is performed. Receipts contain only
public version/signature information and anonymous window counts. The default
mode removes its temporary client; --install-for-ci keeps a newly installed,
verified official client running for the following GUI integration step.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib
import json
import os
from pathlib import Path
import platform
import plistlib
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request


SOURCE_PAGE = "https://mac.weixin.qq.com/"
OFFICIAL_DMG = "https://dldir1v6.qq.com/weixin/Universal/Mac/WeChatMac_4.1.15.dmg"
OFFICIAL_TEAM = "5A4RE8SF68"
BUNDLE_ID = "com.tencent.xinWeChat"
INSTALL_PATH = Path("/Applications/WeChat.app")
MAX_DOWNLOAD = 1024 * 1024 * 1024


class SmokeError(Exception):
    pass


def _official_url(url):
    parsed = urllib.parse.urlsplit(url)
    if (parsed.scheme != "https" or parsed.hostname not in {"dldir1v6.qq.com", "dldir1.qq.com"}
            or parsed.username or parsed.password or parsed.port not in (None, 443)
            or parsed.query or parsed.fragment
            or not re.fullmatch(r"/weixin/Universal/Mac/WeChatMac_\d+(?:\.\d+){1,4}\.dmg", parsed.path)):
        raise SmokeError("non-official-download-rejected")
    return url


class _OfficialRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, newurl):
        _official_url(newurl)
        return super().redirect_request(request, fp, code, message, headers, newurl)


def _ci_root():
    if (sys.platform != "darwin" or platform.machine() != "arm64"
            or os.environ.get("GITHUB_ACTIONS") != "true"
            or os.environ.get("RUNNER_ENVIRONMENT") != "github-hosted"
            or os.environ.get("RUNNER_OS") != "macOS"):
        raise SmokeError("fresh-github-hosted-macos-arm64-required")
    raw = os.environ.get("RUNNER_TEMP", "")
    root = Path(raw)
    if not raw or not root.is_absolute() or not root.is_dir():
        raise SmokeError("runner-temporary-directory-unavailable")
    return root.resolve()


def _ensure_clean_profile(home=None):
    home = Path.home() if home is None else Path(home)
    containers = (home / "Library/Containers/com.tencent.xinWeChat",
                  home / "Library/Group Containers/5A4RE8SF68.com.tencent.xinWeChat")
    if any(path.exists() or path.is_symlink() for path in containers):
        raise SmokeError("existing-wechat-profile-rejected")
    from AppKit import NSRunningApplication
    if list(NSRunningApplication.runningApplicationsWithBundleIdentifier_(BUNDLE_ID)):
        raise SmokeError("existing-wechat-process-rejected")


def _run(arguments, timeout=60):
    result = subprocess.run(arguments, stdin=subprocess.DEVNULL, capture_output=True,
                            check=False, timeout=timeout)
    if result.returncode != 0:
        raise SmokeError("official-client-command-failed")
    return result.stdout, result.stderr


def _download(url, destination):
    opener = urllib.request.build_opener(_OfficialRedirects())
    digest, size, deadline = hashlib.sha256(), 0, time.monotonic() + 180
    with opener.open(_official_url(url), timeout=30) as response:
        _official_url(response.url)
        expected = response.headers.get("Content-Length")
        expected = int(expected) if expected and expected.isdigit() else None
        if expected is not None and not 0 < expected <= MAX_DOWNLOAD:
            raise SmokeError("official-download-size-rejected")
        with destination.open("xb") as output:
            while True:
                if time.monotonic() >= deadline:
                    raise SmokeError("official-download-timeout")
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > MAX_DOWNLOAD:
                    raise SmokeError("official-download-size-rejected")
                output.write(chunk)
                digest.update(chunk)
    if size == 0 or (expected is not None and size != expected):
        raise SmokeError("official-download-incomplete")
    return {"downloadedBytes": size, "downloadSha256": digest.hexdigest()}


def _verified_bundle(app):
    if app.is_symlink() or not app.is_dir():
        raise SmokeError("official-bundle-layout-invalid")
    info = plistlib.loads((app / "Contents/Info.plist").read_bytes())
    if info.get("CFBundleIdentifier") != BUNDLE_ID or info.get("CFBundleExecutable") != "WeChat":
        raise SmokeError("official-bundle-identity-invalid")
    _run(["/usr/bin/codesign", "--verify", "--deep", "--strict", str(app)], timeout=90)
    _, detail = _run(["/usr/bin/codesign", "-d", "--verbose=4", str(app)], timeout=15)
    detail = detail.decode("utf-8", errors="replace")
    if not re.search(r"^TeamIdentifier=" + OFFICIAL_TEAM + r"\s*$", detail, re.M):
        raise SmokeError("official-signing-team-invalid")
    if not re.search(r"^Identifier=" + re.escape(BUNDLE_ID) + r"\s*$", detail, re.M):
        raise SmokeError("official-signing-identifier-invalid")
    version, build = str(info.get("CFBundleShortVersionString", "")), str(info.get("CFBundleVersion", ""))
    if not re.fullmatch(r"\d+(?:\.\d+){1,4}", version) or not re.fullmatch(r"\d{1,12}", build):
        raise SmokeError("official-bundle-version-invalid")
    return {"wechatVersion": version, "wechatBuild": build,
            "signatureVerified": True, "teamIdentifier": OFFICIAL_TEAM}


def _install_new_client(source, destination):
    # Atomic ownership claim: no existing app, symlink or concurrent install can
    # be overwritten by ditto. This helper is only reached after _ci_root().
    try:
        destination.mkdir(mode=0o755)
    except FileExistsError:
        raise SmokeError("existing-official-installation-rejected") from None
    claimed = destination.stat()
    try:
        _run(["/usr/bin/ditto", str(source), str(destination)], timeout=90)
        _verified_bundle(destination)
    except BaseException:
        now = destination.lstat()
        if not destination.is_symlink() and (now.st_dev, now.st_ino) == (claimed.st_dev, claimed.st_ino):
            shutil.rmtree(destination)
        raise
    return destination


def _permission_metadata():
    result = {"sip": "unknown", "accessibilityGranted": False, "screenRecordingGranted": False}
    try:
        output, _ = _run(["/usr/bin/csrutil", "status"], timeout=10)
        match = re.search(r"status:\s*(enabled|disabled)\b", output.decode("ascii", errors="ignore"), re.I)
        if match:
            result["sip"] = match.group(1).lower()
    except (SmokeError, OSError, subprocess.SubprocessError):
        pass
    import ApplicationServices as AX
    import Quartz
    result["accessibilityGranted"] = bool(AX.AXIsProcessTrusted())
    preflight = getattr(Quartz, "CGPreflightScreenCaptureAccess", None)
    result["screenRecordingGranted"] = bool(preflight()) if preflight else False
    return result


def _arm64_text_digest(binary):
    """Read-only __text fingerprint; comparison evidence, never authenticity.

    Hash the actual arm64 instruction section without rewriting a signature or
    normalizing load commands. A match alone does not establish compatibility.
    """
    with binary.open("rb") as handle:
        total = binary.stat().st_size
        header = handle.read(8)
        base, length = 0, total
        fat = {b"\xca\xfe\xba\xbe": (">", False), b"\xbe\xba\xfe\xca": ("<", False),
               b"\xca\xfe\xba\xbf": (">", True), b"\xbf\xba\xfe\xca": ("<", True)}.get(header[:4])
        if fat:
            endian, wide = fat
            count = struct.unpack(endian + "I", header[4:8])[0]
            if not 0 < count <= 16:
                return None
            size, candidates = (32 if wide else 20), []
            for _ in range(count):
                record = handle.read(size)
                if len(record) != size:
                    return None
                values = struct.unpack(endian + ("IIQQII" if wide else "IIIII"), record)
                if values[0] == 0x0100000C and (values[1] & 0xFFFFFF) == 0:
                    candidates.append((values[2], values[3]))
            if len(candidates) != 1:
                return None
            base, length = candidates[0]
        if length < 32 or base < 0 or base + length > total:
            return None
        handle.seek(base)
        header = handle.read(32)
        if len(header) != 32 or header[:4] != b"\xcf\xfa\xed\xfe":
            return None
        _, cpu, _, _, count, command_bytes, _, _ = struct.unpack("<8I", header)
        if cpu != 0x0100000C or count > 4096 or command_bytes > min(length - 32, 4 * 1024 * 1024):
            return None
        commands, cursor = handle.read(command_bytes), 0
        sections = []
        for _ in range(count):
            if cursor + 8 > len(commands):
                return None
            kind, size = struct.unpack_from("<II", commands, cursor)
            if size < 8 or cursor + size > len(commands):
                return None
            if kind == 0x19:
                if size < 72:
                    return None
                section_count = struct.unpack_from("<I", commands, cursor + 64)[0]
                if 72 + section_count * 80 > size:
                    return None
                for index in range(section_count):
                    section = cursor + 72 + index * 80
                    name, segment = commands[section:section+16].rstrip(b"\0"), commands[section+16:section+32].rstrip(b"\0")
                    if name == b"__text" and segment == b"__TEXT":
                        section_size, offset = struct.unpack_from("<QI", commands, section + 40)
                        if not section_size or offset < 32 or offset + section_size > length:
                            return None
                        sections.append((offset, section_size))
            cursor += size
        if len(sections) != 1:
            return None
        offset, remaining = sections[0]
        handle.seek(base + offset)
        digest = hashlib.sha256()
        while remaining:
            chunk = handle.read(min(1024 * 1024, remaining))
            if not chunk:
                return None
            digest.update(chunk)
            remaining -= len(chunk)
        return digest.hexdigest()


def _static_compatibility(app):
    """Inspect signed public code only; never initialize the capture provider."""
    result = {"captureInitialized": False, "allowlistChanged": False,
              "baselineBuild": "4.1.15/270102", "baselineEntitlementPolicyMatches": False,
              "kdfImportObserved": False, "binaryScanComplete": False, "xplayerCodeFingerprints": []}
    stdout, stderr = _run(["/usr/bin/codesign", "-d", "--entitlements", ":-", str(app)], timeout=20)
    entitlements = None
    for stream in (stdout, stderr):
        start, end = stream.find(b"<?xml"), stream.find(b"</plist>")
        if start >= 0 and end >= start:
            entitlements = plistlib.loads(stream[start:end + len(b"</plist>")])
            break
    if not isinstance(entitlements, dict):
        raise SmokeError("official-entitlements-unavailable")
    result["entitlementKeys"] = sorted(entitlements)
    result["entitlementsSha256"] = hashlib.sha256(plistlib.dumps(entitlements, sort_keys=True)).hexdigest()
    import macos_key_provider as provider
    provider._load_upstream()  # Verifies exact bundled-source hashes; no native helper call.
    policies = importlib.import_module("chatlog_keeper.macos_debug_app")
    result["baselineEntitlementPolicyMatches"] = policies._debug_copy_entitlements(
        "wechat", entitlements, client_version=("4.1.15", "270102")) is not None
    architectures, _ = _run(["/usr/bin/lipo", "-archs", str(app / "Contents/MacOS/WeChat")], timeout=10)
    result["architectures"] = sorted(set(architectures.decode("ascii", errors="ignore").split()) & {"arm64", "arm64e", "x86_64"})
    binaries = []
    for parent, directories, files in os.walk(app / "Contents", followlinks=False):
        directories[:] = [name for name in directories if not (Path(parent) / name).is_symlink()]
        for name in files:
            path = Path(parent) / name
            if path.is_symlink():
                continue
            with path.open("rb") as handle:
                magic = handle.read(4)
            if magic in {b"\xcf\xfa\xed\xfe", b"\xca\xfe\xba\xbe", b"\xbe\xba\xfe\xca", b"\xca\xfe\xba\xbf", b"\xbf\xba\xfe\xca"}:
                binaries.append(path)
    binaries.sort(key=lambda path: ("wechat" not in path.name.lower(), "xplayer" not in path.name.lower(), str(path)))
    result["nativeBinaryCount"] = len(binaries)
    scanned, kdf_imports, deadline = 0, [], time.monotonic() + 45
    for binary in binaries[:64]:
        if time.monotonic() >= deadline:
            break
        if "xplayer" in binary.name.lower():
            digest = _arm64_text_digest(binary)
            if digest:
                result["xplayerCodeFingerprints"].append({"binary": binary.name, "arm64TextSha256": digest})
        try:
            symbols, _ = _run(["/usr/bin/nm", "-arch", "arm64", "-u", "-j", str(binary)], timeout=5)
            if re.search(rb"(?m)^_?CCKeyDerivationPBKDF\s*$", symbols):
                kdf_imports.append(binary.relative_to(app).as_posix())
        except (SmokeError, subprocess.TimeoutExpired):
            # Some signed embedded executables have no arm64 slice/symbols.
            pass
        scanned += 1
    result.update(kdfImportObserved=bool(kdf_imports), kdfImportBinaries=kdf_imports,
                  binariesScanned=scanned, binaryScanComplete=scanned == len(binaries),
                  staticEvidenceOnly=True, loginTimeKdfShapeValidated=False,
                  xplayerBaselineComparisonAvailable=False)
    return result


def _window_metadata(pid, trusted):
    # Do not access kCGWindowName, AXTitle, AXValue, AXDescription or pixels.
    import Quartz
    windows = Quartz.CGWindowListCopyWindowInfo(Quartz.kCGWindowListOptionOnScreenOnly,
                                               Quartz.kCGNullWindowID) or []
    count = sum(1 for window in windows
                if window.get(Quartz.kCGWindowOwnerPID) == pid and window.get(Quartz.kCGWindowLayer) == 0)
    result = {"visibleWindowCount": count, "windowRoles": [], "contentIncluded": False}
    if trusted:
        import ApplicationServices as AX
        root = AX.AXUIElementCreateApplication(pid)
        AX.AXUIElementSetMessagingTimeout(root, 0.2)
        error, values = AX.AXUIElementCopyAttributeValue(root, "AXWindows", None)
        if error == 0:
            for window in list(values or [])[:8]:
                error, role = AX.AXUIElementCopyAttributeValue(window, "AXRole", None)
                if error == 0 and str(role) in {"AXWindow", "AXDialog", "AXSheet"}:
                    result["windowRoles"].append(str(role))
    return result


def _launch(app, trusted):
    import psutil
    from AppKit import NSRunningApplication
    executable = app / "Contents/MacOS/WeChat"
    process = subprocess.Popen([str(executable)], cwd=str(app.parent), stdin=subprocess.DEVNULL,
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    proof = None
    try:
        deadline = time.monotonic() + 35
        while time.monotonic() < deadline:
            for native in NSRunningApplication.runningApplicationsWithBundleIdentifier_(BUNDLE_ID):
                if Path(str(native.bundleURL().path())).resolve() != app.resolve():
                    continue
                child = psutil.Process(int(native.processIdentifier()))
                if Path(child.exe()).resolve() != executable.resolve() or child.uids().real != os.getuid():
                    raise SmokeError("launched-process-identity-invalid")
                proof = (child.pid, child.create_time(), str(executable.resolve()))
                metadata = _window_metadata(child.pid, trusted)
                if metadata["visibleWindowCount"] or metadata["windowRoles"]:
                    return proof, {"launchObserved": True, **metadata}
            if process.poll() is not None and process.returncode != 0:
                raise SmokeError("official-client-launch-failed")
            time.sleep(0.5)
        raise SmokeError("official-client-window-not-observed")
    except BaseException:
        try:
            if proof:
                _stop_launched(proof)
            elif process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
        except Exception:
            raise SmokeError("official-client-launch-cleanup-incomplete") from None
        raise


def _stop_launched(proof):
    import psutil
    pid, started, executable = proof
    try:
        process = psutil.Process(pid)
        if (process.create_time() != started or process.uids().real != os.getuid()
                or str(Path(process.exe()).resolve()) != executable):
            raise SmokeError("launched-process-cleanup-identity-mismatch")
        process.terminate()
        try:
            process.wait(timeout=10)
        except psutil.TimeoutExpired:
            if process.create_time() != started or str(Path(process.exe()).resolve()) != executable:
                raise SmokeError("launched-process-cleanup-identity-mismatch")
            process.kill()
            process.wait(timeout=5)
    except psutil.NoSuchProcess:
        pass


def run_smoke(*, install_for_ci=False, download_url=OFFICIAL_DMG):
    began = time.monotonic()
    result = {"mode": "official-macos-wechat-smoke", "ok": False,
              "platform": sys.platform, "architecture": platform.machine(), "macos": platform.mac_ver()[0],
              "sourcePage": SOURCE_PAGE, "signatureVerified": False, "launchObserved": False,
              "loginAttempted": False, "accountDataRead": False, "processMemoryRead": False,
              "screenshotsTaken": False, "qrRead": False, "permissionsChanged": False,
              "officialSignatureChanged": False, "installForCi": bool(install_for_ci)}
    work, mount, mounted, proof = None, None, False, None
    try:
        root = _ci_root()
        _ensure_clean_profile()
        if INSTALL_PATH.exists() or INSTALL_PATH.is_symlink():
            raise SmokeError("existing-official-installation-rejected")
        _official_url(download_url)
        work = Path(tempfile.mkdtemp(prefix="chengzi-official-smoke-", dir=root)).resolve()
        work.chmod(0o700)
        dmg, mount = work / "official.dmg", work / "mount"
        result.update(_download(download_url, dmg))
        mount.mkdir()
        # An attach can mount successfully before a later command failure.
        # Always attempt detach after it has been started; never traverse a
        # potentially still-mounted image during directory cleanup.
        mounted = True
        _run(["/usr/bin/hdiutil", "attach", "-readonly", "-nobrowse", "-noautoopen",
              "-mountpoint", str(mount), "-plist", str(dmg)], timeout=90)
        source = mount / "WeChat.app"
        if source.is_symlink() or not source.is_dir():
            raise SmokeError("official-dmg-layout-invalid")
        app = work / "WeChat.app"
        _run(["/usr/bin/ditto", str(source), str(app)], timeout=90)
        result.update(_verified_bundle(app))
        _run(["/usr/bin/hdiutil", "detach", str(mount)], timeout=20)
        mounted = False
        if install_for_ci:
            app = _install_new_client(app, INSTALL_PATH)
            result["installedNewOfficialClient"] = True
        result.update(_permission_metadata())
        result["sipEnabledEnvironment"] = result["sip"] == "enabled"
        result["sipOnCaptureValidated"] = False
        result["sipAcceptance"] = ("sip-enabled-no-live-capture-test" if result["sip"] == "enabled"
                                   else "runner-sip-not-enabled-cannot-validate-sip-on-capture")
        result["staticCompatibility"] = _static_compatibility(app)
        import macos_key_provider as provider
        # probe_setup reads only bundle metadata and dependency/auth presence.
        original = provider.WECHAT_APP
        try:
            provider.WECHAT_APP = app
            status = provider.probe_setup()
        finally:
            provider.WECHAT_APP = original
        known = (result["wechatVersion"], result["wechatBuild"]) in provider.SUPPORTED_BUILDS
        result.update(collectorBuildSupported=known, providerStatus=status["status"],
                      providerReady=status.get("ready") is True, captureValidated=False,
                      captureCompatible=None if known else False,
                      captureCompatibilityStatus="policy-listed-live-capture-unverified" if known else "blocked-unsupported-build")
        proof, launched = _launch(app, result["accessibilityGranted"])
        result.update(launched)
        expected = "authorization-required" if known else "MAC_WECHAT_VERSION_UNSUPPORTED"
        if status["status"] != expected or result["providerReady"]:
            raise SmokeError("unexpected-clean-profile-provider-state")
        # This smoke passes when the actual build is correctly accepted for
        # authorization or explicitly refused. It never proves live capture.
        result["compatibilityProbeHandled"] = True
        result["ok"] = True
    except Exception as error:
        result["reason"] = str(error) if type(error) is SmokeError else "official-client-smoke-failed"
        result["errorType"] = type(error).__name__
    finally:
        cleanup_ok = result.get("reason") != "official-client-launch-cleanup-incomplete"
        if proof and not install_for_ci:
            try:
                _stop_launched(proof)
            except Exception:
                cleanup_ok = False
        if mounted:
            try:
                _run(["/usr/bin/hdiutil", "detach", str(mount)], timeout=20)
                mounted = False
            except Exception:
                cleanup_ok = False
        if work and cleanup_ok and not mounted:
            try:
                shutil.rmtree(work)
            except OSError:
                cleanup_ok = False
        result["temporaryCleanupComplete"] = cleanup_ok
        result["officialClientLeftRunning"] = bool(proof and install_for_ci)
        if not cleanup_ok:
            result.update(ok=False, reason="official-client-cleanup-incomplete")
        result["elapsedSeconds"] = round(time.monotonic() - began, 2)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--install-for-ci", action="store_true")
    parser.add_argument("--download-url", default=OFFICIAL_DMG)
    args = parser.parse_args()
    result = run_smoke(install_for_ci=args.install_for_ci, download_url=args.download_url)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False))
    raise SystemExit(0 if result["ok"] else 1)


if __name__ == "__main__":
    main()
