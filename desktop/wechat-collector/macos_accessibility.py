"""Opt-in, bounded, text-free macOS Accessibility compatibility diagnostics.

Uses Apple's public AX APIs. No screenshots, typing, clicks, focus changes,
window titles, AXValue, AXDescription, AXIdentifier or chat text are collected.
Permissions are queried, never modified. An explicit prompt=True may ask macOS
to show its standard Accessibility permission dialog; it does not grant access.

https://developer.apple.com/documentation/applicationservices/axuielement_h
"""
from __future__ import annotations

import platform
import re
import sys
import time

WECHAT_BUNDLE = "com.tencent.xinWeChat"
MAX_NODES = 128
MAX_DEPTH = 6
MAX_CHILDREN = 24
MAX_SECONDS = 3.0


def _ax_name(value):
    text = str(value or "")
    return text if re.fullmatch(r"AX[A-Za-z0-9]{1,62}", text) else ""


def anonymous_tree(root, backend, *, max_nodes=MAX_NODES, max_depth=MAX_DEPTH,
                   budget_seconds=MAX_SECONDS, clock=time.monotonic):
    """Pure bounded tree traversal; backend never reads semantic text values.

    Test fixtures use synthetic AX roles, not real customer data. IDs are local
    ordinal numbers with no native handles or process addresses attached.
    """
    if (type(max_nodes) is not int or not 1 <= max_nodes <= MAX_NODES
            or type(max_depth) is not int or not 0 <= max_depth <= MAX_DEPTH
            or not isinstance(budget_seconds, (int, float)) or not 0 < budget_seconds <= MAX_SECONDS):
        raise ValueError("invalid diagnostic bounds")
    deadline = clock() + budget_seconds
    pending, nodes, truncated = [(root, None, 0)], [], False
    while pending and len(nodes) < max_nodes and clock() < deadline:
        element, parent, depth = pending.pop()
        index = len(nodes)
        try:
            role = _ax_name(backend.role(element)) or "AXUnknown"
            attributes = sorted({_ax_name(x) for x in backend.attribute_names(element)} - {""})[:64]
            actions = sorted({_ax_name(x) for x in backend.action_names(element)} - {""})[:16]
            node = {"id": index, "parent": parent, "depth": depth, "role": role,
                    "attributes": attributes, "actions": actions}
            geometry = backend.geometry(element)
            if geometry and len(geometry) == 4:
                values = [float(v) for v in geometry]
                if all(-100_000 <= v <= 100_000 for v in values) and values[2] >= 0 and values[3] >= 0:
                    node["frame"] = [round(v, 1) for v in values]
            nodes.append(node)
            if clock() >= deadline:
                truncated = True
                break
            remaining = max_nodes - len(nodes) - len(pending)
            if depth < max_depth and remaining > 0:
                children, more = backend.children(element, min(MAX_CHILDREN, remaining))
                children = list(children)[:min(MAX_CHILDREN, remaining)]
                truncated = truncated or more
                pending.extend((child, index, depth + 1) for child in reversed(children))
            else:
                # No tree expansion at the limit. Conservatively report that
                # this is a sample, not proof there are no other controls.
                truncated = True
        except Exception:
            if len(nodes) == index:
                nodes.append({"id": index, "parent": parent, "depth": depth, "role": "AXUnavailable"})
            truncated = True
    return {"nodes": nodes, "truncated": bool(truncated or pending),
            "contentIncluded": False, "maxNodes": max_nodes, "maxDepth": max_depth}


class _AppleAX:
    def __init__(self, api):
        self.api = api

    def _attribute(self, element, name):
        error, value = self.api.AXUIElementCopyAttributeValue(element, name, None)
        return value if error == 0 else None

    def role(self, element):
        return self._attribute(element, "AXRole")

    def attribute_names(self, element):
        error, values = self.api.AXUIElementCopyAttributeNames(element, None)
        return list(values or []) if error == 0 else []

    def action_names(self, element):
        error, values = self.api.AXUIElementCopyActionNames(element, None)
        return list(values or []) if error == 0 else []

    def geometry(self, element):
        point = self._attribute(element, "AXPosition")
        size = self._attribute(element, "AXSize")
        if point is None or size is None:
            return None
        ok_point, point_value = self.api.AXValueGetValue(point, self.api.kAXValueCGPointType, None)
        ok_size, size_value = self.api.AXValueGetValue(size, self.api.kAXValueCGSizeType, None)
        if not ok_point or not ok_size:
            return None
        return (point_value.x, point_value.y, size_value.width, size_value.height)

    def children(self, element, limit):
        error, count = self.api.AXUIElementGetAttributeValueCount(element, "AXChildren", None)
        if error != 0 or not count:
            return [], False
        error, children = self.api.AXUIElementCopyAttributeValues(element, "AXChildren", 0, min(int(count), limit), None)
        return (list(children or []), count > limit) if error == 0 else ([], True)


def probe_accessibility(*, prompt=False, include_tree=False):
    """Only read metadata from the verified WeChat bundle's running process."""
    if type(prompt) is not bool or type(include_tree) is not bool:
        raise ValueError("diagnostic options must be boolean")
    result = {"platform": sys.platform, "architecture": platform.machine(),
              "accessibilityGranted": False, "screenRecordingGranted": False,
              "contentIncluded": False, "status": "unsupported-platform"}
    if sys.platform != "darwin":
        return result
    try:
        import ApplicationServices as AX
        import Quartz
        from AppKit import NSRunningApplication
        from Foundation import NSBundle
    except ImportError:
        result["status"] = "missing-pyobjc"
        return result
    try:
        result["accessibilityGranted"] = bool(AX.AXIsProcessTrustedWithOptions({AX.kAXTrustedCheckOptionPrompt: prompt}))
        screen_probe = getattr(Quartz, "CGPreflightScreenCaptureAccess", None)
        result["screenRecordingGranted"] = bool(screen_probe()) if screen_probe else False
        apps = list(NSRunningApplication.runningApplicationsWithBundleIdentifier_(WECHAT_BUNDLE))
        if len(apps) != 1:
            result["status"] = "wechat-not-running" if not apps else "multiple-wechat-processes"
            return result
        app = apps[0]
        bundle = NSBundle.bundleWithURL_(app.bundleURL())
        info = bundle.infoDictionary() or {}
        result["wechatVersion"] = str(info.get("CFBundleShortVersionString") or "")[:40]
        result["wechatBuild"] = str(info.get("CFBundleVersion") or "")[:40]
        if not result["accessibilityGranted"]:
            result["status"] = "accessibility-permission-required"
            return result
        result["status"] = "ready"
        if include_tree:
            root = AX.AXUIElementCreateApplication(int(app.processIdentifier()))
            # AX calls to a hung app must not block diagnostic collection.
            AX.AXUIElementSetMessagingTimeout(root, 0.15)
            result["tree"] = anonymous_tree(root, _AppleAX(AX))
        return result
    except Exception:
        # Native exception text can contain titles or paths. Keep it local.
        result["status"] = "accessibility-probe-failed"
        return result
