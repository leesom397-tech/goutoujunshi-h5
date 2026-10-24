"""Resolve the fixed candidate components in source and frozen desktop builds.

Preparing and starting share one service process. Reuse only modules from the
same verified vendor directory; never clear an unrelated import or compile a
replacement for a missing bundled helper.
"""
from __future__ import annotations

import hashlib
import importlib
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import sys

import macos_candidate_runtime as runtime


def _need(condition, reason):
    if not condition:
        raise runtime.DiagnosticError(reason)


def verified_package(expected_sources):
    # The provider resolver checks the fixed .app executable and Info.plist.
    # It handles PyInstaller's Frameworks/Resources split without trusting an
    # environment variable or searching neighbouring folders.
    from macos_key_provider import _upstream_vendor_root, _regular_component_path, UPSTREAM_COMMIT
    try:
        vendor = _upstream_vendor_root()
        package = _regular_component_path(vendor, "chatlog_keeper", directory=True)
        pin_path = _regular_component_path(vendor, "chatlog-keeper-pin.json")
        _need(pin_path.stat().st_size <= 131072, "candidate-component-pin-rejected")
        pin = json.loads(pin_path.read_text("utf-8-sig"))
        files = pin.get("files")
        _need(pin.get("commit") == UPSTREAM_COMMIT and isinstance(files, dict) and bool(files),
              "candidate-component-pin-rejected")
        for relative, digest in files.items():
            _need(isinstance(relative, str) and "\\" not in relative
                  and isinstance(digest, str) and re.fullmatch(r"[a-f0-9]{64}", digest),
                  "candidate-component-pin-rejected")
            path = _regular_component_path(package, relative)
            _need(hashlib.sha256(path.read_bytes()).hexdigest() == digest,
                  "candidate-pinned-source-mismatch")
        _need(all(files.get(relative) == digest for relative, digest in expected_sources.items()),
              "candidate-pinned-source-mismatch")
        return package, files
    except runtime.DiagnosticError:
        raise
    except (OSError, ValueError, TypeError, KeyError):
        raise runtime.DiagnosticError("candidate-components-unavailable") from None


def _module_paths(package, files):
    result = {}
    for relative in files:
        if not relative.endswith(".py"):
            continue
        parts = list(Path(relative).with_suffix("").parts)
        if parts[-1] == "__init__":
            parts.pop()
        result[".".join(("chatlog_keeper", *parts))] = package / relative
    return result


def _verify_existing_modules(package, files):
    allowed = _module_paths(package, files)
    for name, module in tuple(sys.modules.items()):
        if name != "chatlog_keeper" and not name.startswith("chatlog_keeper."):
            continue
        expected = allowed.get(name)
        actual = getattr(module, "__file__", None)
        origin = getattr(getattr(module, "__spec__", None), "origin", None)
        _need(expected is not None and isinstance(actual, str) and isinstance(origin, str)
              and Path(actual) == expected and Path(origin) == expected,
              "candidate-existing-vendor-module-rejected")
        if expected.name == "__init__.py":
            _need(list(getattr(module, "__path__", ())) == [str(expected.parent)],
                  "candidate-existing-vendor-module-rejected")


def load_debug_module(expected_sources):
    package, files = verified_package(expected_sources)
    _verify_existing_modules(package, files)
    if "chatlog_keeper" not in sys.modules:
        spec = importlib.util.spec_from_file_location("chatlog_keeper", package / "__init__.py",
                                                      submodule_search_locations=[str(package)])
        _need(spec is not None and spec.loader is not None, "candidate-component-loader-unavailable")
        module = importlib.util.module_from_spec(spec)
        sys.modules["chatlog_keeper"] = module
        try:
            spec.loader.exec_module(module)
        except BaseException:
            if sys.modules.get("chatlog_keeper") is module:
                del sys.modules["chatlog_keeper"]
            raise
    result = importlib.import_module("chatlog_keeper.macos_debug_app")
    _verify_existing_modules(package, files)
    return result


def verify_runtime_helpers(package):
    names = ("macos_memory_scan", "macos_wechat_key_capture.dylib")
    if not getattr(sys, "frozen", False):
        _need(not any((package / "scripts" / name).exists() or (package / "scripts" / name).is_symlink()
                      for name in names), "device-unpinned-prebuilt-rejected")
        return
    from macos_key_provider import _verify_frozen_native_inputs, _upstream_vendor_root
    try:
        vendor = _upstream_vendor_root()
        _need(package == vendor / "chatlog_keeper", "candidate-native-location-rejected")
        _verify_frozen_native_inputs(vendor)
        bundle = vendor.parents[2]
        verified = subprocess.run(["/usr/bin/codesign", "--verify", "--deep", "--strict", str(bundle)],
                                  capture_output=True, timeout=60, check=False)
        _need(verified.returncode == 0, "candidate-native-bundle-invalid")
    except runtime.DiagnosticError:
        raise
    except (OSError, ValueError, subprocess.SubprocessError):
        raise runtime.DiagnosticError("candidate-native-bundle-invalid") from None
