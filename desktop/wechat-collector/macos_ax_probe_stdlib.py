"""Standalone, text-free AX diagnostic for system Python 3.9 on macOS.

Run: /usr/bin/python3 macos_ax_probe_stdlib.py
No PyObjC, installs, permission prompts, screenshots, actions or AX writes.
The target's official signature must already have been verified by the caller;
this probe independently requires its exact executable path and a unique PID.

Apple declarations / ownership / per-element timeout:
https://developer.apple.com/documentation/applicationservices/axuielement_h
https://developer.apple.com/documentation/applicationservices/1459345-axuielementsetmessagingtimeout
https://developer.apple.com/documentation/applicationservices/axattributeconstants_h
https://github.com/apple-oss-distributions/xnu/blob/main/libsyscall/wrappers/libproc/libproc.h
"""
from __future__ import annotations

import ctypes as C
import json
import math
import os
import re
import subprocess
import sys
import time
from collections import deque

EXECUTABLE = b"/Applications/WeChat.app/Contents/MacOS/WeChat"
MAX_NODES = 128
MAX_DEPTH = 6
MAX_CHILDREN = 24
MAX_SECONDS = 3.0
API_TIMEOUT = 0.15
MAX_PIDS = 16384
_VALUE_ATTRIBUTES = frozenset(("AXRole", "AXPosition", "AXSize"))
_ARRAY_ATTRIBUTES = frozenset(("AXWindows", "AXChildren"))
_NAME = re.compile(r"AX[A-Za-z0-9]{1,62}\Z")


class BudgetExceeded(Exception):
    pass


class TargetChanged(Exception):
    pass


class NativeFailure(Exception):
    pass


class _Pair(C.Structure):
    _fields_ = [("first", C.c_double), ("second", C.c_double)]


def _name(value):
    return value if isinstance(value, str) and _NAME.fullmatch(value) else ""


def _base(status):
    return {"status": status, "contentIncluded": False, "permissionPrompted": False,
            "target": "official-wechat", "maxNodes": MAX_NODES, "maxDepth": MAX_DEPTH,
            "maxSeconds": MAX_SECONDS, "perApiTimeout": API_TIMEOUT}


class NativeAX:
    """CF Copy/Create references are owned; array members are borrowed until retained."""
    def __init__(self, *, clock=time.monotonic, deadline=None, libraries=None):
        self.clock = clock
        self.deadline = deadline if deadline is not None else clock() + 2.7
        self.pid = None
        self._names = {}
        if libraries is None:
            libraries = (
                C.CDLL("/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices"),
                C.CDLL("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation"),
                C.CDLL("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics"),
                C.CDLL("/usr/lib/libproc.dylib"),
            )
        self.ax, self.cf, self.cg, self.proc = libraries
        p, out, index = C.c_void_p, C.POINTER(C.c_void_p), C.c_long
        self._bind(self.proc, "proc_listallpids", [p, C.c_int], C.c_int)
        self._bind(self.proc, "proc_pidpath", [C.c_int, p, C.c_uint32], C.c_int)
        self._bind(self.ax, "AXIsProcessTrusted", [], C.c_bool)
        self._bind(self.cg, "CGPreflightScreenCaptureAccess", [], C.c_bool)
        self._bind(self.ax, "AXUIElementCreateApplication", [C.c_int], p)
        self._bind(self.ax, "AXUIElementGetTypeID", [], C.c_ulong)
        self._bind(self.ax, "AXUIElementGetPid", [p, C.POINTER(C.c_int)], C.c_int)
        self._bind(self.ax, "AXUIElementSetMessagingTimeout", [p, C.c_float], C.c_int)
        self._bind(self.ax, "AXUIElementCopyAttributeValue", [p, p, out], C.c_int)
        self._bind(self.ax, "AXUIElementCopyAttributeNames", [p, out], C.c_int)
        self._bind(self.ax, "AXUIElementCopyActionNames", [p, out], C.c_int)
        self._bind(self.ax, "AXUIElementGetAttributeValueCount", [p, p, C.POINTER(index)], C.c_int)
        self._bind(self.ax, "AXUIElementCopyAttributeValues", [p, p, index, index, out], C.c_int)
        self._bind(self.ax, "AXValueGetTypeID", [], C.c_ulong)
        self._bind(self.ax, "AXValueGetType", [p], C.c_int)
        self._bind(self.ax, "AXValueGetValue", [p, C.c_int, p], C.c_bool)
        self._bind(self.cf, "CFGetTypeID", [p], C.c_ulong)
        self._bind(self.cf, "CFRetain", [p], p)
        self._bind(self.cf, "CFRelease", [p], None)
        self._bind(self.cf, "CFArrayGetTypeID", [], C.c_ulong)
        self._bind(self.cf, "CFArrayGetCount", [p], index)
        self._bind(self.cf, "CFArrayGetValueAtIndex", [p, index], p)
        self._bind(self.cf, "CFStringGetTypeID", [], C.c_ulong)
        self._bind(self.cf, "CFStringCreateWithCString", [p, C.c_char_p, C.c_uint32], p)
        self._bind(self.cf, "CFStringGetLength", [p], index)
        self._bind(self.cf, "CFStringGetCString", [p, p, index, C.c_uint32], C.c_bool)

    @staticmethod
    def _bind(library, name, args, result):
        fn = getattr(library, name)
        fn.argtypes, fn.restype = args, result

    def check_budget(self):
        remaining = self.deadline - self.clock()
        if remaining <= 0:
            raise BudgetExceeded()
        return remaining

    def release(self, value):
        if value:
            self.cf.CFRelease(value)

    def close(self):
        for name in self._names.values():
            self.release(name)
        self._names.clear()

    def permissions(self):
        self.check_budget()
        # AXIsProcessTrusted has NO arguments and never asks for permission.
        ax = bool(self.ax.AXIsProcessTrusted())
        self.check_budget()
        screen = bool(self.cg.CGPreflightScreenCaptureAccess())
        return ax, screen

    def _path(self, pid):
        self.check_budget()
        buffer = C.create_string_buffer(4096)
        count = self.proc.proc_pidpath(pid, buffer, len(buffer))
        return buffer.value if 0 < count < len(buffer) else b""

    def target_pids(self):
        self.check_budget()
        buffer = (C.c_int * MAX_PIDS)()
        # This API returns a PID COUNT, unlike proc_listpids' byte count.
        count = self.proc.proc_listallpids(buffer, C.sizeof(buffer))
        if count <= 0 or count >= MAX_PIDS:
            raise NativeFailure()
        return sorted({int(pid) for pid in buffer[:count] if pid > 0 and self._path(pid) == EXECUTABLE})

    def assert_target(self):
        if self.pid is None or self._path(self.pid) != EXECUTABLE:
            raise TargetChanged()

    def application(self, pid):
        self.pid = pid
        self.assert_target()
        value = self.ax.AXUIElementCreateApplication(pid)
        if not value:
            raise NativeFailure()
        return value

    def _timeout(self, element):
        remaining = self.check_budget()
        # Apple states timeout settings do not propagate to child elements.
        if self.ax.AXUIElementSetMessagingTimeout(element, min(API_TIMEOUT, remaining)) != 0:
            raise NativeFailure()

    def _prepare(self, element):
        self.assert_target()
        if not element or self.cf.CFGetTypeID(element) != self.ax.AXUIElementGetTypeID():
            raise NativeFailure()
        self._timeout(element)
        actual = C.c_int()
        if self.ax.AXUIElementGetPid(element, C.byref(actual)) != 0 or actual.value != self.pid:
            raise TargetChanged()
        self._timeout(element)

    def _attribute_name(self, name):
        if name not in _VALUE_ATTRIBUTES | _ARRAY_ATTRIBUTES:
            raise ValueError("attribute is outside diagnostic allowlist")
        if name not in self._names:
            value = self.cf.CFStringCreateWithCString(None, name.encode("ascii"), 0x08000100)
            if not value:
                raise NativeFailure()
            self._names[name] = value
        return self._names[name]

    def _copy(self, function, element, *args):
        self._prepare(element)
        value = C.c_void_p()
        try:
            error = function(element, *args, C.byref(value))
            if error != 0:
                self.release(value.value)
                return None
            return value.value
        except BaseException:
            self.release(value.value)
            raise

    def _value(self, element, name):
        if name not in _VALUE_ATTRIBUTES:
            raise ValueError("attribute is outside diagnostic allowlist")
        return self._copy(self.ax.AXUIElementCopyAttributeValue, element, self._attribute_name(name))

    def _string(self, value):
        if not value or self.cf.CFGetTypeID(value) != self.cf.CFStringGetTypeID():
            return ""
        if not 1 <= self.cf.CFStringGetLength(value) <= 64:
            return ""
        buffer = C.create_string_buffer(257)
        if not self.cf.CFStringGetCString(value, buffer, len(buffer), 0x08000100):
            return ""
        return _name(buffer.value.decode("ascii", "ignore"))

    def role(self, element):
        value = self._value(element, "AXRole")
        try:
            return self._string(value) or "AXUnknown"
        finally:
            self.release(value)

    def names(self, element, *, actions=False):
        value = self._copy(self.ax.AXUIElementCopyActionNames if actions else self.ax.AXUIElementCopyAttributeNames, element)
        try:
            if not value or self.cf.CFGetTypeID(value) != self.cf.CFArrayGetTypeID():
                return []
            count = self.cf.CFArrayGetCount(value)
            return sorted({self._string(self.cf.CFArrayGetValueAtIndex(value, i)) for i in range(min(max(0, count), 16 if actions else 64))} - {""})
        finally:
            self.release(value)

    def geometry(self, element):
        result = []
        for name, kind in (("AXPosition", 1), ("AXSize", 2)):
            value = self._value(element, name)
            try:
                if not value or self.cf.CFGetTypeID(value) != self.ax.AXValueGetTypeID() or self.ax.AXValueGetType(value) != kind:
                    return None
                pair = _Pair()
                if not self.ax.AXValueGetValue(value, kind, C.byref(pair)):
                    return None
                result.extend((pair.first, pair.second))
            finally:
                self.release(value)
        if all(math.isfinite(v) and -100000 <= v <= 100000 for v in result) and result[2] >= 0 and result[3] >= 0:
            return [round(v, 1) for v in result]
        return None

    def elements(self, element, name, limit):
        if name not in _ARRAY_ATTRIBUTES or type(limit) is not int or not 1 <= limit <= MAX_CHILDREN:
            raise ValueError("invalid array read")
        attribute = self._attribute_name(name)
        self._prepare(element)
        count = C.c_long()
        error = self.ax.AXUIElementGetAttributeValueCount(element, attribute, C.byref(count))
        if error != 0:
            raise NativeFailure()
        if count.value < 0:
            raise NativeFailure()
        if count.value == 0:
            return [], 0
        value = self._copy(self.ax.AXUIElementCopyAttributeValues, element, attribute, 0, min(limit, count.value))
        owned = []
        try:
            if not value or self.cf.CFGetTypeID(value) != self.cf.CFArrayGetTypeID():
                raise NativeFailure()
            actual = self.cf.CFArrayGetCount(value)
            if actual < 0 or actual > limit:
                raise NativeFailure()
            for i in range(actual):
                child = self.cf.CFArrayGetValueAtIndex(value, i)
                if not child or self.cf.CFGetTypeID(child) != self.ax.AXUIElementGetTypeID():
                    raise NativeFailure()
                # Own before releasing the array; pending queue owns each retain.
                retained = self.cf.CFRetain(child)
                if not retained:
                    raise NativeFailure()
                owned.append(retained)
            return owned, count.value
        except BaseException:
            for child in owned:
                self.release(child)
            raise
        finally:
            self.release(value)


def collect(api, *, max_nodes=MAX_NODES, max_depth=MAX_DEPTH):
    """Injectable bounded walker. All acquired refs are released on every exit."""
    if type(max_nodes) is not int or not 1 <= max_nodes <= MAX_NODES or type(max_depth) is not int or not 0 <= max_depth <= MAX_DEPTH:
        raise ValueError("invalid tree bounds")
    result = _base("probe-failed")
    result.update(maxNodes=max_nodes, maxDepth=max_depth)
    app, pending = None, deque()
    try:
        ax, screen = api.permissions()
        result.update(accessibilityGranted=ax, screenRecordingGranted=screen)
        targets = api.target_pids()
        if len(targets) != 1:
            result["status"] = "wechat-not-running" if not targets else "multiple-official-wechat-processes"
            return result
        result["pid"] = targets[0]
        if not ax:
            result["status"] = "accessibility-permission-required"
            return result
        app = api.application(targets[0])
        windows, count = api.elements(app, "AXWindows", min(MAX_CHILDREN, max_nodes))
        result.update(windowCount=count, nodes=[], truncated=count > len(windows))
        pending.extend((window, None, 0) for window in windows)
        while pending and len(result["nodes"]) < max_nodes:
            api.check_budget()
            element, parent, depth = pending.popleft()
            index = len(result["nodes"])
            try:
                node = {"id": index, "parent": parent, "depth": depth, "role": _name(api.role(element)) or "AXUnknown",
                        "attributes": api.names(element), "actions": api.names(element, actions=True)}
                frame = api.geometry(element)
                if frame is not None:
                    node["frame"] = frame
                result["nodes"].append(node)
                room = max_nodes - len(result["nodes"]) - len(pending)
                if depth < max_depth and room > 0:
                    children, total = api.elements(element, "AXChildren", min(MAX_CHILDREN, room))
                    pending.extend((child, index, depth + 1) for child in children)
                    result["truncated"] |= total > len(children)
                else:
                    result["truncated"] = True
            except NativeFailure:
                if len(result["nodes"]) == index:
                    result["nodes"].append({"id": index, "parent": parent, "depth": depth, "role": "AXUnavailable"})
                result["truncated"] = True
            finally:
                api.release(element)
        api.assert_target()
        result["truncated"] |= bool(pending)
        result["status"] = "ready" if result["nodes"] else "no-ax-windows"
    except BudgetExceeded:
        result.update(status="budget-exceeded", truncated=True)
    except TargetChanged:
        # Do not return a tree if identity changed during collection.
        result.pop("nodes", None)
        result.update(status="target-changed", truncated=True)
    except Exception:
        # Native error text may contain private values; it is never serialized.
        result.update(status="probe-failed", truncated=True)
    finally:
        for element, _, _ in pending:
            api.release(element)
        api.release(app)
        api.close()
    return result


def worker():
    if sys.platform != "darwin":
        return _base("unsupported-platform")
    try:
        return collect(NativeAX())
    except Exception:
        return _base("native-api-unavailable")


def probe(*, popen=subprocess.Popen, clock=time.monotonic):
    """A read-only child enforces a hard 3 s ceiling even if native code stalls."""
    if sys.platform != "darwin":
        return _base("unsupported-platform")
    start = clock()
    child = None
    try:
        child = popen([sys.executable, os.path.abspath(__file__), "--worker"], stdin=subprocess.DEVNULL,
                      stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        output, _ = child.communicate(timeout=max(0.001, MAX_SECONDS - (clock() - start)))
        if child.returncode != 0 or len(output) > 131072:
            return _base("probe-failed")
        result = json.loads(output)
        if not isinstance(result, dict) or result.get("contentIncluded") is not False:
            return _base("probe-failed")
        result["elapsedMs"] = round((clock() - start) * 1000)
        return result
    except subprocess.TimeoutExpired:
        if child is not None:
            child.kill()
            child.communicate()
        return _base("watchdog-timeout")
    except Exception:
        if child is not None and child.poll() is None:
            child.kill()
            child.communicate()
        return _base("probe-failed")


if __name__ == "__main__":
    if sys.argv[1:] not in ([], ["--worker"]):
        raise SystemExit("usage: python3 macos_ax_probe_stdlib.py")
    print(json.dumps(worker() if sys.argv[1:] else probe(), ensure_ascii=True, separators=(",", ":")))
