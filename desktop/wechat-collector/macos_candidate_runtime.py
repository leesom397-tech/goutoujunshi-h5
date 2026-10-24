"""Isolated 270135 startup experiment, never a production capture permit.

Only a fresh GitHub-hosted Apple Silicon runner is allowed. Download the exact
official build, compare its unmodified logged-out launch with a private copy,
and observe the pinned startup helper and XPlayer rendezvous service. No login,
screenshots, QR inspection, database access or system-permission changes occur.
The original signature and production build policies are kept unchanged.
"""
from __future__ import annotations

import argparse
import ctypes
import hashlib
import importlib
import json
import os
from pathlib import Path
import platform
import plistlib
import shutil
import sys
import tempfile
import time
import urllib.request

import macos_candidate_probe as probe
import macos_official_client_smoke as smoke


URL = "https://dldir1.qq.com/weixin/Universal/Mac/xWeChatMac_universal_4.1.15.55_270135.dmg"
SERVICE_PREFIX = "5A4RE8SF68.com.tencent.xinWeChat.XPlayerMachPortRendezvousServer."
SAMPLE_SECONDS = 25


class DiagnosticError(Exception):
    """Fixed diagnostic codes only; no native output or private paths."""


def _official_url(url):
    if url != URL:
        raise DiagnosticError("candidate-download-location-rejected")
    return url


class _Redirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, newurl):
        _official_url(newurl)
        return super().redirect_request(request, fp, code, message, headers, newurl)


def _download(destination):
    digest, size, deadline = hashlib.sha256(), 0, time.monotonic() + 180
    opener = urllib.request.build_opener(_Redirects())
    with opener.open(URL, timeout=30) as response, destination.open("xb") as output:
        _official_url(response.url)
        while True:
            if time.monotonic() >= deadline:
                raise DiagnosticError("candidate-download-timeout")
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if size > smoke.MAX_DOWNLOAD:
                raise DiagnosticError("candidate-download-too-large")
            output.write(chunk)
            digest.update(chunk)
    if digest.hexdigest() != probe.CANDIDATE_DMG_SHA256:
        raise DiagnosticError("candidate-download-digest-mismatch")
    return {"dmgSha256": digest.hexdigest(), "downloadBytes": size}


def _pinned_modules(support):
    import macos_key_provider as provider
    provider._load_upstream()  # Verifies every bundled Python/C source hash.
    modules = tuple(importlib.import_module("chatlog_keeper." + name)
                    for name in ("macos_debug_app", "macos_wechat_capture", "macos_key"))
    support.mkdir(mode=0o700)
    # Isolated process only: helper build caches stay inside this CI task.
    for module in modules:
        module.data_dir = lambda: support
    return (provider, *modules)


def _candidate_entitlements(debug, original, static):
    if not static.get("matchesInspectedCandidate"):
        raise DiagnosticError("candidate-public-binaries-not-matched")
    # Explicit experiment with the unchanged baseline policy, not a declaration
    # that 270135 is supported. Never modify the production policy dictionary.
    expected = debug._debug_copy_entitlements("wechat", original, client_version=probe.BASELINE)
    if (not expected or expected.get("com.apple.security.app-sandbox") is not True
            or expected.get("com.apple.security.temporary-exception.mach-register.global-name") != [
                "5A4RE8SF68.com.tencent.xinWeChat.MachPortRendezvousServer.*",
                "5A4RE8SF68.com.tencent.xinWeChat.MMMojo.MachPortRendezvousServer.*",
                SERVICE_PREFIX + "*"]):
        raise DiagnosticError("candidate-baseline-entitlement-policy-rejected")
    return expected


def _prepare_shadow(original, work, debug, expected):
    digest = debug._bundle_source_digest(original)
    if not digest:
        raise DiagnosticError("original-bundle-digest-unavailable")
    target = work / "Candidate.app"
    smoke._run(["/usr/bin/ditto", str(original), str(target)], timeout=120)
    marker = target / "Contents/Resources" / debug._DEBUG_COPY_MARKER
    marker.write_text(digest.hex(), encoding="ascii")
    entitlements = work / "candidate-entitlements.plist"
    entitlements.write_bytes(plistlib.dumps(expected))
    # Re-sign only this new copy's root. Nested Tencent code remains identical.
    smoke._run(["/usr/bin/codesign", "--force", "--sign", "-", "--entitlements",
                str(entitlements), str(target)], timeout=90)
    if (not debug._verified_debug_copy(target, marker, digest.hex(), expected, hardened_runtime=False)
            or debug._bundle_source_digest(target) != digest
            or debug._bundle_source_digest(original) != digest):
        raise DiagnosticError("candidate-copy-integrity-rejected")
    target.chmod(0o700)
    return target, digest


def _new_channel(capture, library, container):
    # The official empty-profile launch must create its own sandbox first. No
    # fictitious account/database is created to satisfy create_capture_channel.
    data = container / "Data"
    if container.is_symlink() or data.is_symlink() or not data.is_dir():
        raise DiagnosticError("fresh-official-container-unavailable")
    directory = data / "tmp"
    directory.mkdir(mode=0o700, exist_ok=True)
    if directory.is_symlink() or not directory.resolve().is_relative_to(data.resolve()):
        raise DiagnosticError("candidate-channel-directory-rejected")
    # The pinned staging validator requires this prefix for both FIFO/dylib.
    path = directory / (".chatlog-key-chengzi-candidate-" + os.urandom(12).hex() + ".fifo")
    os.mkfifo(path, 0o600)
    path.chmod(0o600)
    fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW | os.O_CLOEXEC)
    identity = os.fstat(fd)
    channel = capture.CaptureChannel(path, fd, identity.st_dev, identity.st_ino)
    if not capture.stage_capture_library(channel, library):
        channel.close()
        raise DiagnosticError("candidate-observer-stage-failed")
    return channel


def _drain_status(channel):
    # This fresh-profile run never logs in. Any candidate frame invalidates the
    # experiment immediately. Never serialize, persist or format its bytes.
    candidates = channel.read_candidates()
    unexpected = bool(candidates)
    candidates.clear()
    if unexpected:
        raise DiagnosticError("unexpected-candidate-frame-empty-profile")
    if channel.invalid:
        raise DiagnosticError("candidate-observer-channel-invalid")
    return channel.diagnostic_snapshot()


def _find_process(app):
    import psutil
    from AppKit import NSRunningApplication
    matches = []
    executable = (app / "Contents/MacOS/WeChat").resolve()
    for native in NSRunningApplication.runningApplicationsWithBundleIdentifier_(smoke.BUNDLE_ID):
        if Path(str(native.bundleURL().path())).resolve() != app.resolve():
            continue
        process = psutil.Process(int(native.processIdentifier()))
        if process.uids().real != os.getuid() or Path(process.exe()).resolve() != executable:
            raise DiagnosticError("candidate-process-identity-mismatch")
        matches.append((process.pid, process.create_time(), str(executable)))
    if len(matches) > 1:
        raise DiagnosticError("candidate-process-not-unique")
    return matches[0] if matches else None


def _xplayer_service(pid):
    """Lookup only this owned process's public rendezvous name; send no IPC."""
    system = ctypes.CDLL("/usr/lib/libSystem.B.dylib")
    bootstrap = ctypes.c_uint32.in_dll(system, "bootstrap_port").value
    task = ctypes.c_uint32.in_dll(system, "mach_task_self_").value
    system.bootstrap_look_up.argtypes = [ctypes.c_uint32, ctypes.c_char_p, ctypes.POINTER(ctypes.c_uint32)]
    system.bootstrap_look_up.restype = ctypes.c_int
    system.mach_port_deallocate.argtypes = [ctypes.c_uint32, ctypes.c_uint32]
    system.mach_port_deallocate.restype = ctypes.c_int
    port = ctypes.c_uint32()
    code = system.bootstrap_look_up(bootstrap, (SERVICE_PREFIX + str(pid)).encode("ascii"), ctypes.byref(port))
    if code == 0 and port.value:
        system.mach_port_deallocate(task, port.value)
        return True, 0
    return False, int(code)


def _observe(app, trusted, *, channel=None, watchdog=None, seconds=SAMPLE_SECONDS, output=None):
    result = {} if output is None else output
    result.update({"stableWindowObserved": False, "visibleWindowCount": 0, "windowRoles": [],
              "xplayerRegistrationObserved": False, "xplayerLookupCodes": [],
              "contentInspected": False, "loginWindowContentVerified": False})
    deadline, stable_start, proof, last = time.monotonic() + 45, None, None, None
    while time.monotonic() < deadline:
        if watchdog is not None and watchdog.poll() is not None:
            raise DiagnosticError("candidate-watchdog-exited")
        if channel is not None:
            result["observer"] = _drain_status(channel)
        current = _find_process(app)
        if proof is not None and current != proof:
            raise DiagnosticError("candidate-process-exited-or-restarted")
        if current is not None:
            proof = current
            visible = smoke._window_metadata(proof[0], trusted)
            result.update(visibleWindowCount=visible["visibleWindowCount"], windowRoles=visible["windowRoles"])
            now = time.monotonic()
            if visible["visibleWindowCount"] or visible["windowRoles"]:
                stable_start = now if stable_start is None else stable_start
            else:
                stable_start = None
            if last is None or now - last >= 1:
                found, code = _xplayer_service(proof[0])
                result["xplayerRegistrationObserved"] |= found
                result["xplayerLookupCodes"] = sorted(set(result["xplayerLookupCodes"] + [code]))[:8]
                last = now
            if stable_start is not None and now - stable_start >= seconds:
                result.update(stableWindowObserved=True, stableWindowSeconds=seconds)
                return result
        time.sleep(0.25)
    raise DiagnosticError("candidate-stable-window-not-observed")


def _assessment(result):
    candidate = result.get("candidate", {})
    counts = candidate.get("observer", {}).get("counts", {})
    startup = bool(result.get("official", {}).get("stableWindowObserved")
                   and result.get("copyIntegrityVerified") and candidate.get("stableWindowObserved")
                   and counts.get("constructor") and counts.get("load")
                   and not counts.get("resolve_failed") and not counts.get("write_failed")
                   and not candidate.get("observer", {}).get("invalid") and not result.get("reason"))
    return {"startupChecksPassed": startup,
            "xplayerRegistrationValidated": bool(startup and candidate.get("xplayerRegistrationObserved")),
            "ordinaryMacAcceptance": False, "captureCompatible": False, "captureValidated": False,
            "loginTimeKdfShapeValidated": False,
            "decision": ("startup-observed-xplayer-service-observed-runtime-login-still-unverified"
                         if startup and candidate.get("xplayerRegistrationObserved") else
                         "startup-observed-xplayer-not-triggered-or-not-visible" if startup else
                         "candidate-startup-check-incomplete")}


def run_diagnostic():
    started = time.monotonic()
    result = {"mode": "macos-270135-empty-profile-candidate", "ok": False,
              "platform": sys.platform, "architecture": platform.machine(), "macos": platform.mac_ver()[0],
              "productionAllowlistChanged": False, "originalSignatureChanged": False,
              "loginAttempted": False, "accountDataRead": False, "qrRead": False,
              "screenshotsTaken": False, "permissionsChanged": False, "databaseOpened": False,
              "observerMode": "pinned-startup-interpose-empty-profile-only", "candidateBytesRetained": False}
    work = mount = original = shadow = channel = watcher = baseline_proof = key = debug = None
    mounted, cleanup, original_digest, production_state = False, True, None, None
    try:
        root = smoke._ci_root()
        smoke._ensure_clean_profile()
        if any(name.startswith("DYLD_") or name == "CHATLOG_KEEPER_WECHAT_KEY_FIFO" for name in os.environ):
            raise DiagnosticError("inherited-injection-environment-rejected")
        if smoke.INSTALL_PATH.exists() or smoke.INSTALL_PATH.is_symlink():
            raise DiagnosticError("existing-official-installation-rejected")
        work = Path(tempfile.mkdtemp(prefix="chengzi-candidate-270135-", dir=root)).resolve()
        work.chmod(0o700)
        result.update(smoke._permission_metadata())
        result["sipAcceptance"] = ("sip-enabled-startup-only" if result["sip"] == "enabled"
                                   else "runner-sip-not-enabled-cannot-validate-ordinary-mac")
        provider, debug, capture, key = _pinned_modules(work / "support")
        production_state = (provider.SUPPORTED_BUILDS, dict(debug._WECHAT_AD_HOC_POLICIES))
        if probe.CANDIDATE in production_state[0] or probe.CANDIDATE in production_state[1]:
            raise DiagnosticError("candidate-already-in-production-policy-review-required")
        result.update(_download(work / "official.dmg"))
        mount = work / "mount"
        mount.mkdir()
        mounted = True
        smoke._run(["/usr/bin/hdiutil", "attach", "-readonly", "-nobrowse", "-noautoopen",
                    "-mountpoint", str(mount), "-plist", str(work / "official.dmg")], timeout=90)
        original = work / "WeChat.app"
        smoke._run(["/usr/bin/ditto", str(mount / "WeChat.app"), str(original)], timeout=120)
        # Private directory permission is needed for the pinned generation-bound
        # process cleanup. No executable, entitlement or original seal changes.
        original.chmod(0o700)
        result["originalSignature"] = smoke._verified_bundle(original)
        result["staticCandidate"] = probe.probe_candidate(original)
        expected = _candidate_entitlements(debug, debug._entitlements(original), result["staticCandidate"])
        smoke._run(["/usr/bin/hdiutil", "detach", str(mount)], timeout=20)
        mounted = False
        shadow, original_digest = _prepare_shadow(original, work, debug, expected)
        result["copyIntegrityVerified"] = True
        result["nestedOfficialCodePreserved"] = True
        baseline_proof, _ = smoke._launch(original, result["accessibilityGranted"])
        result["official"] = {}
        _observe(original, result["accessibilityGranted"], seconds=5, output=result["official"])
        smoke._stop_launched(baseline_proof)
        baseline_proof = None
        if not key.cleanup_debug_copy_bundle(original):
            raise DiagnosticError("official-baseline-child-cleanup-incomplete")
        # The verified original's first launch creates only a fresh sandbox.
        library = capture.ensure_capture_library()
        if library is None:
            raise DiagnosticError("candidate-pinned-observer-build-failed")
        container = Path.home() / "Library/Containers/com.tencent.xinWeChat"
        channel = _new_channel(capture, library, container)
        watcher = key.launch_debug_copy_watchdog("wechat", shadow / "Contents/MacOS/WeChat", shadow,
                    capture_library=channel.library_path, capture_fifo=channel.path)
        if watcher is None:
            result["observer"] = _drain_status(channel)
            known_failures = {"helper_compile_failed", "helper_codesign_failed", "helper_signature_validation_failed",
                              "helper_validation_failed", "helper_unavailable", "watchdog_arm_failed",
                              "watchdog_launch_failed", "watchdog_durable_record_failed", "watchdog_launch_invalid"}
            result["watchdogFailure"] = key._LAST_ERROR if key._LAST_ERROR in known_failures else "unspecified"
            raise DiagnosticError("candidate-launchservices-watchdog-failed")
        result["candidate"] = {}
        _observe(shadow, result["accessibilityGranted"], channel=channel, watchdog=watcher,
                 output=result["candidate"])
        result.update(_assessment(result))
        result["ok"] = result["startupChecksPassed"]
    except Exception as error:
        result["reason"] = (str(error) if type(error) in (DiagnosticError, smoke.SmokeError)
                            else "candidate-diagnostic-failed")
        result["errorType"] = type(error).__name__
    finally:
        if watcher is not None:
            try:
                cleanup = key.request_debug_copy_watchdog_cleanup(watcher) and cleanup
            except Exception:
                cleanup = False
        if baseline_proof is not None:
            try:
                smoke._stop_launched(baseline_proof)
            except Exception:
                cleanup = False
        if key is not None:
            for app in (shadow, original):
                if app is not None and app.is_dir():
                    try:
                        cleanup = key.cleanup_debug_copy_bundle(app) and cleanup
                    except Exception:
                        cleanup = False
        if channel is not None:
            # Stop every owned process before removing its FIFO/dylib.
            try:
                result["finalObserverStatus"] = _drain_status(channel)
                if "candidate" in result:
                    result["candidate"]["observer"] = result["finalObserverStatus"]
            except Exception as error:
                result["reason"] = str(error) if type(error) is DiagnosticError else "candidate-final-status-invalid"
                result["ok"] = False
            try:
                cleanup = channel.close() and cleanup
            except Exception:
                cleanup = False
        if original_digest is not None and original is not None:
            try:
                result["originalUnchangedVerified"] = debug._bundle_source_digest(original) == original_digest
                smoke._verified_bundle(original)
                cleanup = result["originalUnchangedVerified"] and cleanup
            except Exception:
                cleanup = False
        if production_state is not None:
            unchanged = (provider.SUPPORTED_BUILDS, debug._WECHAT_AD_HOC_POLICIES) == production_state
            result["productionPoliciesUnchangedVerified"] = unchanged
            cleanup = unchanged and cleanup
        if mounted:
            try:
                smoke._run(["/usr/bin/hdiutil", "detach", str(mount)], timeout=20)
                mounted = False
            except Exception:
                cleanup = False
        # Only this mkdtemp generation can be removed. Never remove account
        # containers; the disposable runner discards its fresh profile itself.
        if work is not None and cleanup and not mounted:
            try:
                if work.is_symlink() or work.parent != root or not work.name.startswith("chengzi-candidate-270135-"):
                    raise DiagnosticError("candidate-cleanup-path-rejected")
                shutil.rmtree(work)
            except Exception:
                cleanup = False
        result.update(_assessment(result))
        result["temporaryCleanupComplete"] = cleanup
        result["ok"] = bool(result["ok"] and cleanup and not result.get("reason"))
        result["elapsedSeconds"] = round(time.monotonic() - started, 2)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    result = run_diagnostic()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("x", encoding="utf-8") as output:
        json.dump(result, output, ensure_ascii=False, indent=2)
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
