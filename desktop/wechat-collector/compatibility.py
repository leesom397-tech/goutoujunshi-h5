"""Read-only dependency and window metadata probe; never reads conversation text."""
import importlib.metadata
import sys
import time
from normalize import UPSTREAM_COMMIT


def compatibility_probe():
    result = {"ready": False, "capabilities": {"chat": False, "moments": False}, "platform": sys.platform,
              "upstreamCommit": UPSTREAM_COMMIT, "uiCode": "UNSUPPORTED_PLATFORM", "message": "仅支持Windows微信4.1.6及以上兼容版本。"}
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
            return {**result, "uiCode": "WECHAT_NOT_RUNNING", "message": "请先打开并登录电脑版微信。"}
        windows = []
        def enum(hwnd, _):
            if win32process.GetWindowThreadProcessId(hwnd)[1] in processes and win32gui.IsWindowVisible(hwnd) and "Qt" in win32gui.GetClassName(hwnd):
                windows.append(hwnd)
        win32gui.EnumWindows(enum, None)
        info = win32api.GetFileVersionInfo(next(iter(processes.values())), "\\")
        version = (info["FileVersionMS"] >> 16, info["FileVersionMS"] & 65535, info["FileVersionLS"] >> 16, info["FileVersionLS"] & 65535)
        result.update(wechatVersion=".".join(map(str, version)), adapterVersion=importlib.metadata.version("pywechat127"))
        if version[:3] < (4, 1, 6):
            return {**result, "uiCode": "WECHAT_UNSUPPORTED_VERSION", "message": "当前微信版本暂不兼容。"}
        if not windows:
            return {**result, "uiCode": "WECHAT_WINDOW_HIDDEN", "message": "微信窗口尚未显示，开始采集时将尝试恢复窗口。"}
        import pythoncom
        pythoncom.CoInitialize()
        try:
            from pywinauto import Desktop
            classes = [Desktop(backend="uia").window(handle=hwnd).element_info.class_name for hwnd in windows[:8]]
        finally:
            pythoncom.CoUninitialize()
        available = any(name == "mmui::MainWindow" for name in classes)
        if available:
            message = "已检测到微信主窗口；未读取任何消息。"
            code = "READY"
        elif any(name == "mmui::LoginWindow" for name in classes):
            message = "请在微信登录窗口完成登录。"
            code = "WECHAT_LOGIN_REQUIRED"
        else:
            message = "微信已打开，但当前账号的界面文字暂不可读取。请保持微信窗口可见，或改用网页的窗口采集/录屏导入。"
            code = "WECHAT_UI_UNAVAILABLE"
        return {**result, "ready": available, "capabilities": {"chat": available, "moments": available},
                "uiCode": code, "message": message}
    except Exception:
        return {**result, "uiCode": "WECHAT_PROBE_FAILED", "message": "兼容性未确认，请将微信与助手以相同权限运行。"}


def prepare_capture_ui():
    """Only called by an explicitly requested capture worker, never /health.

    Restore one verified WeChat top-level window before rechecking UIA. Do not
    launch/restart WeChat, click arbitrary content or change accessibility flags.
    A persistent Qt shell is an actual unsupported state, not a successful read.
    """
    before = compatibility_probe()
    if before.get("ready") or before.get("uiCode") in (
            "UNSUPPORTED_PLATFORM", "WECHAT_NOT_RUNNING", "WECHAT_UNSUPPORTED_VERSION", "WECHAT_LOGIN_REQUIRED"):
        return before
    try:
        import psutil
        import win32gui
        import win32process
        pids = {p.pid for p in psutil.process_iter(["name"])
                if (p.info["name"] or "").lower() == "weixin.exe"}
        windows = []
        def enum(hwnd, _):
            if (win32process.GetWindowThreadProcessId(hwnd)[1] in pids
                    and win32gui.GetClassName(hwnd).startswith("Qt")
                    and win32gui.GetWindowText(hwnd) in ("微信", "Weixin", "WeChat")):
                windows.append(hwnd)
        win32gui.EnumWindows(enum, None)
        if len(windows) > 1:
            return {**before, "uiCode": "WECHAT_WINDOW_AMBIGUOUS", "message": "检测到多个微信主窗口，请只保留要采集的账号窗口后重试。"}
        if len(windows) == 1:
            win32gui.ShowWindow(windows[0], 9)  # SW_RESTORE, only after explicit capture.
            try:
                win32gui.SetForegroundWindow(windows[0])
            except Exception:
                pass  # Windows may refuse focus; the subsequent probe decides.
        current = before
        for _ in range(4):
            time.sleep(.35)
            current = compatibility_probe()
            if current.get("ready"):
                return current
        return current
    except Exception:
        return before


if __name__ == "__main__":
    import json
    print(json.dumps(compatibility_probe(), ensure_ascii=False))
