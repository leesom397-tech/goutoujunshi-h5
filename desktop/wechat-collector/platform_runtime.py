"""Platform selection and private worker setup; never exposed as an HTTP API."""
from __future__ import annotations

import importlib
import sys


def source_provider():
    return importlib.import_module("macos_database_source" if sys.platform == "darwin" else "local_database_source")


def contact_cache():
    return source_provider().ContactSourceCache()


def default_capabilities():
    if sys.platform == "darwin":
        return {"momentsAllVisible": False, "momentsCached": True,
                "momentsContacts": True, "personBundle": False,
                "uiCapturePreparation": False, "backgroundImagesById": False}
    return {"momentsAllVisible": True, "momentsContacts": True,
            "personBundle": True, "uiCapturePreparation": True}


def compatibility_probe():
    if sys.platform != "darwin":
        from compatibility import compatibility_probe as probe
        return probe()
    state = source_provider().probe_authorized_source()
    ready = state.get("ready") is True
    return {"platform": "darwin", "ready": ready, "uiCode": state.get("status", "MAC_SETUP_REQUIRED"),
            "message": state.get("message", "请先在 Mac 助手中完成本机读取授权。"),
            "capabilities": {"chat": False, "moments": ready, **default_capabilities()}}


def capture_function(request):
    if request.get("mode") == "background":
        from background_reader import capture_background
        return capture_background
    if sys.platform == "darwin":
        if request.get("kind") != "moments":
            from background_reader import BackgroundCaptureError
            raise BackgroundCaptureError("MAC_BACKGROUND_REQUIRED", "Mac 聊天请先授权本机读取，再从联系人列表导入。")
        from macos_moments import capture_moments
        return capture_moments
    from adapter import capture
    return capture


def export_worker_authorization():
    if sys.platform != "darwin":
        return None
    from macos_key_provider import export_worker_authorization as export
    return export()


def import_worker_authorization(payload):
    if sys.platform == "darwin" and payload is not None:
        from macos_key_provider import import_worker_authorization as restore
        restore(payload)


def clear_worker_authorization():
    if sys.platform == "darwin":
        from macos_key_provider import clear_authorization
        clear_authorization()
