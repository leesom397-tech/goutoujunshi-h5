"""Mac frozen-runtime gate: synthetic media only; no WeChat, prompts or network."""
from __future__ import annotations

import importlib
import io
import platform
import sys
import time


REQUIRED_MODULES = (
    "apsw", "cryptography.hazmat.bindings._rust", "zstandard", "psutil", "PIL.Image",
    "objc", "Foundation", "AppKit", "ApplicationServices", "Quartz", "CoreText",
    "numpy", "pysilk", "sherpa_onnx", "_cffi_backend", "tkinter",
)


def _check_codec():
    import numpy as np
    import pysilk
    from local_voice_transcriber import _decode_silk

    # A generated tone verifies the native codec without supplying speech or
    # loading/downloading the speech model. Never expose generated PCM in output.
    samples = (np.sin(np.arange(16000) * (2 * np.pi * 440 / 16000)) * 3000).astype("<i2")
    encoded = io.BytesIO()
    pysilk.encode(io.BytesIO(samples.tobytes()), encoded, 16000, 24000)
    decoded = _decode_silk(encoded.getvalue())
    if len(decoded) != 16000:
        raise RuntimeError("synthetic-codec-length-mismatch")


def run_runtime_self_test():
    began = time.monotonic()
    result = {
        "mode": "macos-runtime-self-test", "ok": False,
        "platform": sys.platform, "architecture": platform.machine(),
        "python": platform.python_version(), "macos": platform.mac_ver()[0],
        "frozen": bool(getattr(sys, "frozen", False)),
        "userDataUsed": False, "processMemoryRead": False, "networkUsed": False,
        "permissionPromptsUsed": False, "modelLoaded": False, "codecReady": False,
        "vendorRuntimeReady": False,
    }
    try:
        if sys.platform != "darwin" or platform.machine() != "arm64":
            result["reason"] = "macos-arm64-required"
            return result
        if sys.version_info[:2] != (3, 12):
            result["reason"] = "python-3.12-required"
            return result
        # Import only; don't enumerate accounts, start Tk or call AX/TCC APIs.
        for name in REQUIRED_MODULES:
            importlib.import_module(name)
        result["dependenciesReady"] = True
        # Exercise the same pinned resource loader used by initialization. This
        # only validates and imports shipped code; never invoke key extraction.
        # Frozen apps must pass too, including PyInstaller resource relocation.
        import macos_key_provider as provider
        provider._load_upstream()
        result["vendorRuntimeReady"] = True
        _check_codec()
        result["codecReady"] = True
        from database_runtime_self_test import run_database_self_test
        result["database"] = run_database_self_test()
        if not result["database"].get("ok"):
            result["reason"] = "synthetic-database-check-failed"
            return result
        result["ok"] = True
    except Exception as error:
        result["reason"] = getattr(error, "code", "macos-runtime-load-failed")
        result["errorType"] = type(error).__name__
    finally:
        result["elapsedMilliseconds"] = round((time.monotonic() - began) * 1000)
    return result
