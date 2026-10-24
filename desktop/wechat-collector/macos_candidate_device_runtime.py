"""Explicit, bounded runtime diagnostic for an already verified private copy.

--prepare-runtime builds fixed helpers and checks a temporary FIFO, without
starting or stopping WeChat. --start requires the original to be normally quit
first. Only process/window/service metadata and fixed status counts are kept.
Candidate frames are wiped and discarded; databases and chat content are never
opened. Production support is unchanged and original signing stays intact.
"""
from __future__ import annotations

import argparse
import ctypes
import importlib
import json
import os
from pathlib import Path
import platform
import re
import stat
import struct
import sys
import time

import macos_candidate_prepare as prepare
import macos_candidate_probe as probe
import macos_candidate_runtime as runtime
import macos_official_client_smoke as smoke


EXTRA_SOURCES = {
    "core/_macos.py": "832a880958380e6cb4bc7b84f55d2543246ead1d80e554c6480e2fbf1ffeea6a",
    "macos_key.py": "ef1526e311dd47aa680bb46c495f0f65b4a04b2fd73529c34fc5f046eaa05b7a",
    "macos_wechat_capture.py": "ed4e4e5bb6bc7344564062c36bfb958311df128928931b0fe24a0b68f0b0928b",
    "scripts/macos_memory_scan.c": "3f61b27159d3d1194feb1d393736107e12e617ec0da441d4142413d3faba0315",
    "scripts/macos_wechat_key_capture.c": "e361c4afe885f46c39f162009d0a1603bf26ee7509171cd0854945cdb20321a3",
}
EVENTS = {1: "constructor", 2: "load", 3: "resolve_attempt", 4: "resolve_ok",
          5: "resolve_failed", 6: "call", 7: "match", 8: "write_ok", 9: "write_failed"}


class StatusOnlyReader:
    """Streaming status parser that never returns or serializes candidate data."""
    def __init__(self):
        self.buffer = bytearray()
        self.counts = {}
        self.details = {}
        self.discarded = 0

    def feed(self, data):
        self.buffer.extend(data)
        if len(self.buffer) > 65536:
            self.clear()
            raise runtime.DiagnosticError("device-status-buffer-limit")
        while len(self.buffer) >= 4:
            candidate = self.buffer[:4] == b"WXK1"
            if candidate:
                size = 36
            elif self.buffer[:4] == b"WXS1":
                size = 16
            else:
                self.clear()
                raise runtime.DiagnosticError("device-status-invalid-frame")
            if len(self.buffer) < size:
                break
            if candidate:
                self.discarded += 1
            else:
                code = self.buffer[4]
                if code not in EVENTS or any(self.buffer[9:16]):
                    self.clear()
                    raise runtime.DiagnosticError("device-status-invalid-event")
                name = EVENTS[code]
                self.counts[name] = self.counts.get(name, 0) + 1
                self.details[name] = struct.unpack_from("<I", self.buffer, 5)[0]
            self.buffer[:size] = b"\0" * size
            del self.buffer[:size]

    def drain(self, fd):
        for _ in range(64):
            try:
                chunk = bytearray(os.read(fd, 4096))
            except BlockingIOError:
                break
            if not chunk:
                break
            try:
                self.feed(chunk)
            finally:
                chunk[:] = b"\0" * len(chunk)
        return self.snapshot()

    def snapshot(self):
        return {"counts": dict(self.counts), "details": dict(self.details),
                "candidateFramesDiscarded": self.discarded, "candidateBytesRetained": False}

    def clear(self):
        self.buffer[:] = b"\0" * len(self.buffer)
        self.buffer.clear()


def _private_entry(path, *, directory=False):
    info = path.lstat()
    expected = stat.S_ISDIR if directory else stat.S_ISREG
    if path.is_symlink() or not expected(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o022:
        raise runtime.DiagnosticError("device-private-entry-rejected")
    return info


def _load_receipt(path):
    path = Path(path).absolute()
    root = Path.home() / "Library/Caches/ChengziCandidateDiagnostics"
    if (path.name != "prepare-receipt.json" or path.parent.parent != root
            or not re.fullmatch(r"prepare-270135-[A-Za-z0-9_-]+", path.parent.name)):
        raise runtime.DiagnosticError("device-receipt-location-rejected")
    _private_entry(root, directory=True)
    _private_entry(path.parent, directory=True)
    info = _private_entry(path)
    if info.st_size > 65536:
        raise runtime.DiagnosticError("device-receipt-too-large")
    receipt = json.loads(path.read_text(encoding="utf-8"))
    shadow = path.parent / "Candidate.app"
    if (receipt.get("mode") != "macos-270135-prepare-only" or receipt.get("ok") is not True
            or receipt.get("copyIntegrityVerified") is not True
            or receipt.get("originalUnchangedVerified") is not True
            or receipt.get("productionPolicyUnchangedVerified") is not True
            or receipt.get("candidatePath") != str(shadow)
            or receipt.get("workDirectory") != str(path.parent)
            or not re.fullmatch(r"[a-f0-9]{64}", str(receipt.get("sourceBundleDigest", "")))):
        raise runtime.DiagnosticError("device-receipt-invalid")
    _private_entry(shadow, directory=True)
    if stat.S_IMODE(shadow.stat().st_mode) != 0o700:
        raise runtime.DiagnosticError("device-candidate-mode-rejected")
    return path.parent, shadow, bytes.fromhex(receipt["sourceBundleDigest"])


def _load_modules(work):
    from macos_candidate_components import verified_package, verify_runtime_helpers
    package, _ = verified_package(EXTRA_SOURCES)
    verify_runtime_helpers(package)
    debug = prepare._debug_module()
    capture = importlib.import_module("chatlog_keeper.macos_wechat_capture")
    key = importlib.import_module("chatlog_keeper.macos_key")
    support = work / "runtime-support"
    support.mkdir(mode=0o700, exist_ok=True)
    _private_entry(support, directory=True)
    if stat.S_IMODE(support.stat().st_mode) != 0o700:
        raise runtime.DiagnosticError("device-support-mode-rejected")
    for module in (debug, capture, key):
        module.data_dir = lambda: support
    return debug, capture, key


def _verify(work, shadow, digest, debug):
    app = Path("/Applications/WeChat.app")
    signature = smoke._verified_bundle(app)
    static = probe.probe_candidate(app)
    expected = runtime._candidate_entitlements(debug, debug._entitlements(app), static)
    marker = shadow / "Contents/Resources" / debug._DEBUG_COPY_MARKER
    if (probe.CANDIDATE in debug._WECHAT_AD_HOC_POLICIES
            or not debug._verified_debug_copy(shadow, marker, digest.hex(), expected, hardened_runtime=False)
            or debug._bundle_source_digest(app) != digest
            or debug._bundle_source_digest(shadow) != digest):
        raise runtime.DiagnosticError("device-original-or-candidate-integrity-rejected")
    return {"officialSignatureVerified": signature["signatureVerified"], "copyIntegrityVerified": True,
            "productionPolicyUnchangedVerified": True, "originalUnchangedVerified": True}


def _sip_state():
    data, _ = smoke._run(["/usr/bin/csrutil", "status"], timeout=10)
    found = re.search(rb"status:\s*(enabled|disabled)\b", data, re.I)
    return found.group(1).decode("ascii").lower() if found else "unknown"


def _window_count(pid):
    """CoreGraphics public metadata only; no screen recording or AX dependency."""
    cf = ctypes.CDLL("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation")
    cg = ctypes.CDLL("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics")
    cg.CGWindowListCopyWindowInfo.argtypes = [ctypes.c_uint32, ctypes.c_uint32]
    cg.CGWindowListCopyWindowInfo.restype = ctypes.c_void_p
    cf.CFArrayGetCount.argtypes, cf.CFArrayGetCount.restype = [ctypes.c_void_p], ctypes.c_long
    cf.CFArrayGetValueAtIndex.argtypes = [ctypes.c_void_p, ctypes.c_long]
    cf.CFArrayGetValueAtIndex.restype = ctypes.c_void_p
    cf.CFDictionaryGetValue.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
    cf.CFDictionaryGetValue.restype = ctypes.c_void_p
    cf.CFNumberGetValue.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p]
    cf.CFNumberGetValue.restype = ctypes.c_bool
    cf.CFRelease.argtypes = [ctypes.c_void_p]
    owner_key = ctypes.c_void_p.in_dll(cg, "kCGWindowOwnerPID").value
    layer_key = ctypes.c_void_p.in_dll(cg, "kCGWindowLayer").value
    windows = cg.CGWindowListCopyWindowInfo(1, 0)  # OnScreenOnly; no image API.
    if not windows:
        return None
    count = 0
    try:
        for index in range(min(4096, cf.CFArrayGetCount(windows))):
            item = cf.CFArrayGetValueAtIndex(windows, index)
            owner, layer = ctypes.c_int64(), ctypes.c_int64()
            owner_value, layer_value = cf.CFDictionaryGetValue(item, owner_key), cf.CFDictionaryGetValue(item, layer_key)
            if (owner_value and layer_value
                    and cf.CFNumberGetValue(owner_value, 4, ctypes.byref(owner))
                    and cf.CFNumberGetValue(layer_value, 4, ctypes.byref(layer))
                    and owner.value == pid and layer.value == 0):
                count += 1
    finally:
        cf.CFRelease(windows)
    return count


def _original_is_closed(debug):
    for relative in ("Contents/MacOS/WeChat", "Contents/MacOS/XPlayer.app/Contents/MacOS/XPlayer"):
        pids = debug._exact_process_pids(Path("/Applications/WeChat.app") / relative)
        if pids is None:
            raise runtime.DiagnosticError("device-original-process-state-unavailable")
        if pids:
            raise runtime.DiagnosticError("device-original-still-running-quit-normally-first")


def _restore_original(debug, key):
    app = Path("/Applications/WeChat.app")
    smoke._verified_bundle(app)
    smoke._run(["/usr/bin/open", str(app)], timeout=15)
    executable, deadline = app / "Contents/MacOS/WeChat", time.monotonic() + 15
    while time.monotonic() < deadline:
        pids = debug._exact_process_pids(executable)
        if pids and len(pids) == 1:
            identity = key.process_identity(pids[0], timeout=5)
            if identity is not None and identity[0] == os.fsencode(executable.resolve()) and _window_count(pids[0]):
                return True
        time.sleep(0.5)
    return False


def _observe(shadow, debug, key, watcher, channel, reader, output, seconds):
    executable = shadow / "Contents/MacOS/WeChat"
    deadline, appeared, stable_since, proof, last_service = time.monotonic() + seconds, False, None, None, 0
    output.update(stableWindowObserved=False, xplayerRegistrationObserved=False, visibleWindowCount=0,
                  windowContentRead=False, loginRequired="operator-observation-needed")
    while time.monotonic() < deadline:
        output["observer"] = reader.drain(channel.read_fd)
        if watcher.poll() is not None:
            raise runtime.DiagnosticError("device-watchdog-exited")
        pids = debug._exact_process_pids(executable)
        if pids is None or len(pids) > 1:
            raise runtime.DiagnosticError("device-candidate-process-state-invalid")
        if not pids:
            if appeared:
                raise runtime.DiagnosticError("device-candidate-exited")
            time.sleep(0.5)
            continue
        identity = key.process_identity(pids[0], timeout=5)
        current = (pids[0], identity)
        if identity is None or identity[0] != os.fsencode(executable.resolve()):
            raise runtime.DiagnosticError("device-candidate-identity-invalid")
        if proof is not None and current != proof:
            raise runtime.DiagnosticError("device-candidate-generation-changed")
        proof, appeared = current, True
        count = _window_count(pids[0])
        output["visibleWindowCount"] = count
        now = time.monotonic()
        if count:
            stable_since = now if stable_since is None else stable_since
        else:
            stable_since = None
        output["stableWindowSeconds"] = round(now - stable_since, 1) if stable_since is not None else 0
        output["stableWindowObserved"] = output["stableWindowSeconds"] >= 25
        if now - last_service >= 1:
            found, status = runtime._xplayer_service(pids[0])
            output["xplayerRegistrationObserved"] |= found
            output["xplayerLookupCode"] = status
            last_service = now
        time.sleep(0.5)
    if not output["stableWindowObserved"]:
        raise runtime.DiagnosticError("device-window-stability-not-confirmed")
    status = reader.snapshot()
    if (not status["counts"].get("constructor") or status["details"].get("load") != 1
            or status["counts"].get("resolve_failed") or status["counts"].get("write_failed")):
        raise runtime.DiagnosticError("device-observer-load-or-forwarding-failed")


def run(receipt_path, *, start=False, restore_original=False, seconds=60):
    result = {"mode": "macos-270135-device-runtime" if start else "macos-270135-device-runtime-prepare",
              "ok": False, "startRequested": start, "originalStoppedByDiagnostic": False,
              "accountDataRead": False, "databaseOpened": False, "candidateBytesRetained": False,
              "captureCompatible": False, "captureValidated": False, "allowlistChanged": False,
              "qrRead": False, "permissionsChanged": False, "screenshotsTaken": False,
              "originalRestoreRequested": restore_original, "originalRestored": False}
    work = shadow = debug = capture = key = channel = watcher = lock = None
    reader, cleanup, launched = StatusOnlyReader(), True, False
    began = time.monotonic()
    try:
        if sys.platform != "darwin" or platform.machine() != "arm64":
            raise runtime.DiagnosticError("apple-silicon-mac-required")
        if not 30 <= seconds <= 180 or restore_original and not start:
            raise runtime.DiagnosticError("device-runtime-options-invalid")
        if any(name.startswith("DYLD_") or name == "CHATLOG_KEEPER_WECHAT_KEY_FIFO" for name in os.environ):
            raise runtime.DiagnosticError("inherited-injection-environment-rejected")
        result["sip"] = _sip_state()
        if result["sip"] != "enabled":
            raise runtime.DiagnosticError("device-normal-sip-required")
        work, shadow, digest = _load_receipt(receipt_path)
        debug, capture, key = _load_modules(work)
        lock = debug._acquire_launch_lock(work, "candidate-device")
        if lock is None:
            raise runtime.DiagnosticError("device-diagnostic-already-running")
        result.update(_verify(work, shadow, digest, debug))
        library, helper = capture.ensure_capture_library(), key.ensure_helper()
        if library is None or helper is None:
            for name, module in (("observer", capture), ("watchdog", key)):
                code = module.last_error()
                if re.fullmatch(r"(?:helper|capture|watchdog)_[a-z_]{1,80}", code):
                    result[name + "FailureCode"] = code
            raise runtime.DiagnosticError("device-pinned-component-build-failed")
        result["pinnedComponentsVerified"] = True
        if key.debug_copy_bundle_is_running(shadow) is not False:
            raise runtime.DiagnosticError("device-existing-candidate-process-rejected")
        if start:
            _original_is_closed(debug)
        channel = runtime._new_channel(capture, library, Path.home() / "Library/Containers/com.tencent.xinWeChat")
        result["fifoPreparedAndVerified"] = capture.validate_capture_fifo(channel.path, expected_identity=channel.identity)
        if not result["fifoPreparedAndVerified"]:
            raise runtime.DiagnosticError("device-fifo-identity-invalid")
        if not start:
            result.update(ok=True, nextStep="normally-quit-original-then-explicit-start")
        else:
            # Recheck just before handing the copy to LaunchServices. Never quit
            # the original here: the operator has verified its current UI state.
            _original_is_closed(debug)
            launched = True  # Even interruption during launch may leave a late child.
            watcher = key.launch_debug_copy_watchdog("wechat", shadow / "Contents/MacOS/WeChat", shadow,
                        capture_library=channel.library_path, capture_fifo=channel.path)
            if watcher is None:
                raise runtime.DiagnosticError("device-launchservices-failed")
            result["candidate"] = {}
            _observe(shadow, debug, key, watcher, channel, reader, result["candidate"], seconds)
            result.update(ok=True, nextStep="startup-verified-database-and-capture-still-unvalidated")
    except (Exception, KeyboardInterrupt) as error:
        result["reason"] = (str(error) if type(error) in (runtime.DiagnosticError, smoke.SmokeError)
                            else "device-runtime-interrupted" if isinstance(error, KeyboardInterrupt)
                            else "device-runtime-diagnostic-failed")
        result["errorType"] = type(error).__name__
    finally:
        if watcher is not None:
            try:
                cleanup = key.request_debug_copy_watchdog_cleanup(watcher) and cleanup
            except Exception:
                cleanup = False
        if launched and key is not None and shadow is not None:
            try:
                cleanup = key.cleanup_debug_copy_bundle(shadow) and cleanup
                cleanup = key.debug_copy_bundle_is_running(shadow) is False and cleanup
            except Exception:
                cleanup = False
        if channel is not None:
            try:
                result["observerStatus"] = reader.drain(channel.read_fd)
            except Exception:
                result["reason"] = "device-final-status-invalid"
                result["ok"] = False
            try:
                cleanup = channel.close() and cleanup
            except Exception:
                cleanup = False
        reader.clear()
        if debug is not None:
            try:
                debug._release_launch_lock(lock)
            except Exception:
                cleanup = False
        if launched and restore_original and cleanup:
            try:
                result["originalRestoreRequested"] = True
                result["originalRestored"] = _restore_original(debug, key)
                if not result["originalRestored"]:
                    result["ok"] = False
            except Exception:
                result["originalRestoreFailed"] = True
                result["ok"] = False
        result["runtimeCleanupComplete"] = cleanup
        result["ok"] = bool(result["ok"] and cleanup and not result.get("reason"))
        result["elapsedSeconds"] = round(time.monotonic() - began, 2)
        if work is not None:
            try:
                stamp = str(time.time_ns())
                filename = work / (("runtime-" if start else "runtime-prepare-") + stamp + ".json")
                descriptor = os.open(filename, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
                with os.fdopen(descriptor, "w", encoding="utf-8") as output:
                    json.dump(result, output, ensure_ascii=False, indent=2)
            except Exception:
                result.update(ok=False, receiptWriteFailed=True)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--receipt", required=True)
    phases = parser.add_mutually_exclusive_group(required=True)
    phases.add_argument("--prepare-runtime", action="store_true")
    phases.add_argument("--start", action="store_true")
    parser.add_argument("--restore-original", action="store_true")
    parser.add_argument("--seconds", type=int, default=60)
    args = parser.parse_args()
    result = run(args.receipt, start=args.start, restore_original=args.restore_original, seconds=args.seconds)
    print(json.dumps(result, ensure_ascii=False, indent=2), flush=True)
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
