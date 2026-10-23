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
import json
import os
from pathlib import Path
import platform
import plistlib
import re
import shutil
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
                      providerReady=status.get("ready") is True)
        proof, launched = _launch(app, result["accessibilityGranted"])
        result.update(launched)
        if not known:
            raise SmokeError("official-build-not-in-collector-allowlist")
        if status["status"] != "authorization-required" or result["providerReady"]:
            raise SmokeError("unexpected-clean-profile-provider-state")
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
