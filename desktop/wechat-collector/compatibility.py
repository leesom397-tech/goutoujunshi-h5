"""Read-only dependency and window metadata probe; never reads conversation text."""
import importlib.metadata
import sys
from normalize import UPSTREAM_COMMIT


def compatibility_probe():
    result = {"ready": False, "capabilities": {"chat": False, "moments": False}, "platform": sys.platform,
              "upstreamCommit": UPSTREAM_COMMIT, "message": "仅支持Windows微信4.1.6及以上兼容版本。"}
    if sys.platform != "win32":
        return result
    try:
        import psutil
        import win32api
        import win32gui
        import win32process
        processes = {p.pid: p.info["exe"] for p in psutil.process_iter(["pid", "name", "exe"])
                     if (p.info["name"] or "").lower() == "weixin.exe"}
        if not processes:
            return {**result, "message": "请先打开并登录电脑版微信。"}
        windows = []
        def enum(hwnd, _):
            if win32process.GetWindowThreadProcessId(hwnd)[1] in processes and win32gui.IsWindowVisible(hwnd) and "Qt" in win32gui.GetClassName(hwnd):
                windows.append(hwnd)
        win32gui.EnumWindows(enum, None)
        info = win32api.GetFileVersionInfo(next(iter(processes.values())), "\\")
        version = (info["FileVersionMS"] >> 16, info["FileVersionMS"] & 65535, info["FileVersionLS"] >> 16, info["FileVersionLS"] & 65535)
        result.update(wechatVersion=".".join(map(str, version)), adapterVersion=importlib.metadata.version("pywechat127"))
        if version[:3] < (4, 1, 6):
            return {**result, "message": "当前微信版本暂不兼容。"}
        if not windows:
            return {**result, "message": "请显示微信窗口并完成登录。"}
        import pythoncom
        pythoncom.CoInitialize()
        try:
            from pywinauto import Desktop
            classes = [Desktop(backend="uia").window(handle=hwnd).element_info.class_name for hwnd in windows[:8]]
        finally:
            pythoncom.CoUninitialize()
        available = any(name == "mmui::MainWindow" for name in classes)
        return {**result, "ready": available, "capabilities": {"chat": available, "moments": available},
                "message": "已检测到微信主窗口；未读取任何消息。" if available else "尚未检测到可访问的微信主窗口。"}
    except Exception:
        return {**result, "message": "兼容性未确认，请将微信与助手以相同权限运行。"}


if __name__ == "__main__":
    import json
    print(json.dumps(compatibility_probe(), ensure_ascii=False))
