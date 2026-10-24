"""Text-free, read-only Qt AX experiment for official or private-copy WeChat.

Run only while the separate controlled runtime has the private copy running.
This script never starts/stops apps, changes environment, prompts for access,
sets AX attributes, or invokes actions. It compares bounded-array traversal
with direct AXChildren queries and geometric hit tests. The receipt and exact
process path scope the target; bundle integrity remains the runtime's gate.

Qt 5.15.14 source: src/plugins/platforms/cocoa/qnsview_accessibility.mm
Its accessibilityAttributeValue: calls setActive(true); the Linux accessibility
environment variable is not a macOS activation mechanism.
"""
from __future__ import annotations

import argparse
from collections import Counter
import ctypes as C
import json
import math
import os
from pathlib import Path
import plistlib
import re
import subprocess
import sys
import time

import macos_ax_probe_stdlib as base

MAX_SECONDS = 28.0  # Includes bounded original signature validation.
AX_SECONDS = 6.0
SAMPLE_NODES = 64
OFFICIAL_APP = Path("/Applications/WeChat.app")


class _ProcBSDInfo(C.Structure):
    # Public XNU bsd/sys/proc_info.h; MAXCOMLEN == 16 on macOS.
    _fields_ = [(name, C.c_uint32) for name in
                ("flags", "status", "xstatus", "pid", "ppid", "uid", "gid",
                 "ruid", "rgid", "svuid", "svgid", "reserved")]
    _fields_ += [("comm", C.c_char * 16), ("name", C.c_char * 32)]
    _fields_ += [(name, C.c_uint32) for name in
                ("nfiles", "pgid", "pjobc", "tdev", "tpgid")]
    _fields_ += [("nice", C.c_int32), ("start_sec", C.c_uint64), ("start_usec", C.c_uint64)]


class CandidateAX(base.NativeAX):
    def __init__(self, executable, *, direct=False, identity=None, **kwargs):
        self.executable = os.fsencode(executable)
        self.direct = direct
        self.identity = identity
        super().__init__(**kwargs)
        self._bind(self.proc, "proc_pidinfo",
                   [C.c_int, C.c_int, C.c_uint64, C.c_void_p, C.c_int], C.c_int)
        self._bind(self.ax, "AXUIElementCopyElementAtPosition",
                   [C.c_void_p, C.c_float, C.c_float, C.POINTER(C.c_void_p)], C.c_int)

    def target_pids(self):
        self.check_budget()
        buffer = (C.c_int * base.MAX_PIDS)()
        count = self.proc.proc_listallpids(buffer, C.sizeof(buffer))
        if not 0 < count < base.MAX_PIDS:
            raise base.NativeFailure()
        return sorted({int(pid) for pid in buffer[:count]
                       if pid > 0 and self._path(pid) == self.executable})

    def assert_target(self):
        if (self.pid is None or self._path(self.pid) != self.executable
                or self.identity is None or self._identity(self.pid) != self.identity):
            raise base.TargetChanged()

    def _identity(self, pid):
        self.check_budget()
        info = _ProcBSDInfo()
        if (C.sizeof(info) != 136 or self.proc.proc_pidinfo(pid, 3, 0, C.byref(info), C.sizeof(info)) != C.sizeof(info)
                or info.pid != pid or info.uid != os.getuid() or not info.start_sec
                or info.start_usec >= 1000000):
            raise base.TargetChanged()
        return (pid, info.uid, info.start_sec, info.start_usec)

    def application(self, pid):
        identity = self._identity(pid)
        if self.identity is not None and identity != self.identity:
            raise base.TargetChanged()
        self.identity = identity
        return super().application(pid)

    def elements(self, element, name, limit):
        if not self.direct or name != "AXChildren":
            return super().elements(element, name, limit)
        if type(limit) is not int or not 1 <= limit <= base.MAX_CHILDREN:
            raise ValueError("invalid array bound")
        value = self._copy(self.ax.AXUIElementCopyAttributeValue, element, self._attribute_name(name))
        owned = []
        try:
            if not value or self.cf.CFGetTypeID(value) != self.cf.CFArrayGetTypeID():
                raise base.NativeFailure()
            count = self.cf.CFArrayGetCount(value)
            if count < 0:
                raise base.NativeFailure()
            for index in range(min(count, limit)):
                child = self.cf.CFArrayGetValueAtIndex(value, index)
                if not child or self.cf.CFGetTypeID(child) != self.ax.AXUIElementGetTypeID():
                    raise base.NativeFailure()
                self._prepare(child)  # Reject a foreign PID before retaining.
                retained = self.cf.CFRetain(child)
                if not retained:
                    raise base.NativeFailure()
                owned.append(retained)
            return owned, count
        except BaseException:
            for child in owned:
                self.release(child)
            raise
        finally:
            self.release(value)

    def hit(self, application, x, y):
        if not all(type(value) in (float, int) and math.isfinite(value)
                   and abs(value) <= 100000 for value in (x, y)):
            raise ValueError("invalid point")
        value = self._copy(self.ax.AXUIElementCopyElementAtPosition, application, x, y)
        try:
            if value:
                self._prepare(value)
            return value
        except BaseException:
            self.release(value)
            raise


def _summary(result):
    nodes = result.get("nodes", [])
    return {"status": result.get("status"), "pid": result.get("pid"),
            "windowCount": result.get("windowCount", 0), "nodeCount": len(nodes),
            "roles": dict(sorted(Counter(node["role"] for node in nodes).items())),
            "truncated": result.get("truncated", False)}


def _hit_queries(api):
    """Hit-test inside at most two window frames, without mouse events or focus."""
    app, windows = None, []
    result = {"status": "probe-failed", "pid": None, "queryCount": 0, "roles": {}}
    roles = Counter()
    try:
        if not api.permissions()[0]:
            result["status"] = "accessibility-permission-required"
            return result
        targets = api.target_pids()
        if len(targets) != 1:
            result["status"] = "candidate-not-uniquely-running"
            return result
        result["pid"] = targets[0]
        app = api.application(targets[0])
        windows, _ = api.elements(app, "AXWindows", 2)
        for window in windows:
            frame = api.geometry(window)
            if not frame or frame[2] < 80 or frame[3] < 100:
                continue
            x, y, width, height = frame
            for fx, fy in ((.5, .5), (.3, .65), (.75, .65)):
                element = api.hit(app, x + width * fx, y + height * fy)
                result["queryCount"] += 1
                children = []
                try:
                    if element:
                        roles[api.role(element)] += 1
                        # Invoke the legacy attribute-value entry point as well.
                        try:
                            children, _ = api.elements(element, "AXChildren", 1)
                        except base.NativeFailure:
                            pass
                finally:
                    for child in children:
                        api.release(child)
                    api.release(element)
        api.assert_target()
        result.update(status="ready", roles=dict(sorted(roles.items())))
    except base.BudgetExceeded:
        result["status"] = "budget-exceeded"
    except base.TargetChanged:
        result.update(status="target-changed", roles={})
    except Exception:
        result["status"] = "probe-failed"
    finally:
        for window in windows:
            api.release(window)
        api.release(app)
        api.close()
    return result


def _result(status):
    return {"mode": "macos-qt-ax-read-activation", "status": status,
            "contentIncluded": False, "captureCompatibilityValidated": False,
            "permissionPrompted": False, "axAttributesWritten": False,
            "actionsPerformed": False, "environmentChanged": False,
            "maxSeconds": MAX_SECONDS, "maxAXSeconds": AX_SECONDS}


def _official_executable():
    app = OFFICIAL_APP
    info_path = app / "Contents/Info.plist"
    executable = app / "Contents/MacOS/WeChat"
    if any(path.is_symlink() for path in (app, app / "Contents", info_path, app / "Contents/MacOS", executable)):
        raise ValueError("official-layout-rejected")
    info = plistlib.loads(info_path.read_bytes())
    if (info.get("CFBundleIdentifier") != "com.tencent.xinWeChat"
            or info.get("CFBundleExecutable") != "WeChat"
            or str(info.get("CFBundleVersion")) != "270135"
            or str(info.get("CFBundleShortVersionString")) != "4.1.15"):
        raise ValueError("official-identity-rejected")
    verified = subprocess.run(["/usr/bin/codesign", "--verify", "--deep", "--strict", str(app)],
                              stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                              stderr=subprocess.DEVNULL, timeout=15, check=False)
    detail = subprocess.run(["/usr/bin/codesign", "-d", "--verbose=4", str(app)],
                            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                            stderr=subprocess.PIPE, timeout=5, check=False)
    if (verified.returncode != 0 or detail.returncode != 0 or len(detail.stderr) > 65536
            or not re.search(rb"^TeamIdentifier=5A4RE8SF68\s*$", detail.stderr, re.M)
            or not re.search(rb"^Identifier=com\.tencent\.xinWeChat\s*$", detail.stderr, re.M)):
        raise ValueError("official-signature-rejected")
    return executable


def worker(receipt_path=None, *, official=False):
    if sys.platform != "darwin":
        return _result("unsupported-platform")
    try:
        if official:
            executable = _official_executable()
        else:
            # Private-mode validation has no side effects; importing modules
            # does not compile helpers or enter the app's data container.
            import macos_candidate_device_runtime as device
            _, shadow, _ = device._load_receipt(receipt_path)
            executable = shadow / "Contents/MacOS/WeChat"
        if executable.is_symlink() or not executable.is_file():
            return _result("candidate-executable-rejected")
        # Bound each phase as well as the parent watchdog. No content attributes
        # are read, including on a candidate which reused an existing login.
        api = CandidateAX(executable, deadline=time.monotonic() + 1.1)
        baseline = _summary(base.collect(api, max_nodes=SAMPLE_NODES))
        identity = api.identity
        if baseline["status"] != "ready":
            return dict(_result("baseline-unavailable"), baseline=baseline)
        direct = _summary(base.collect(CandidateAX(executable, identity=identity, direct=True, deadline=time.monotonic() + 1.3), max_nodes=SAMPLE_NODES))
        hits = _hit_queries(CandidateAX(executable, identity=identity, direct=True, deadline=time.monotonic() + 1.0))
        after = _summary(base.collect(CandidateAX(executable, identity=identity, direct=True, deadline=time.monotonic() + 1.3), max_nodes=SAMPLE_NODES))
        phases = (baseline, direct, hits, after)
        if any(phase.get("pid") != baseline["pid"] or phase["status"] == "target-changed" for phase in phases):
            return _result("target-changed")
        result = _result("complete")
        result.update(target="official-wechat" if official else "private-candidate",
                      officialSignatureVerified=official, processGenerationBound=True)
        result.update(baseline=baseline, directChildren=direct, hitTests=hits, afterHitTests=after,
                      moreNodesObserved=(not baseline["truncated"] and
                                         max(direct["nodeCount"], after["nodeCount"]) > baseline["nodeCount"]))
        return result
    except Exception:
        return _result("candidate-scope-or-native-api-unavailable")


def probe(receipt_path=None, *, official=False, popen=subprocess.Popen, clock=time.monotonic):
    if sys.platform != "darwin":
        return _result("unsupported-platform")
    child = None
    start = clock()
    try:
        scope = ["--official"] if official else ["--receipt", str(receipt_path)]
        child = popen([sys.executable, str(Path(__file__).absolute()), *scope, "--worker"],
                      stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        output, _ = child.communicate(timeout=max(.001, MAX_SECONDS - (clock() - start)))
        if child.returncode != 0 or len(output) > 16384:
            return _result("probe-failed")
        result = json.loads(output)
        if not isinstance(result, dict) or result.get("contentIncluded") is not False:
            return _result("probe-failed")
        result["elapsedMs"] = round((clock() - start) * 1000)
        return result
    except subprocess.TimeoutExpired:
        if child is not None:
            child.kill()  # Only this script's read-only worker, never WeChat.
            child.communicate()
        return _result("watchdog-timeout")
    except Exception:
        if child is not None and child.poll() is None:
            child.kill()
            child.communicate()
        return _result("probe-failed")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    scope = parser.add_mutually_exclusive_group(required=True)
    scope.add_argument("--receipt", type=Path)
    scope.add_argument("--official", action="store_true", help="Verify and read only the running official 270135 app")
    parser.add_argument("--worker", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    print(json.dumps(worker(args.receipt, official=args.official) if args.worker else probe(args.receipt, official=args.official), ensure_ascii=True, separators=(",", ":")))
