"""Read-only dependency and window metadata probe; never reads conversation text."""
import importlib.metadata
import sys
import time
from normalize import UPSTREAM_COMMIT
from compatibility_ui import wechat_windows, ui_metadata, restore_window


def compatibility_probe():
    result = {"ready": False, "capabilities": {"chat": False, "moments": False}, "platform": sys.platform,
              "upstreamCommit": UPSTREAM_COMMIT, "uiCode": "UNSUPPORTED_PLATFORM", "message": "仅支持Windows微信4.1.6及以上兼容版本。"}
    if sys.platform != "win32":
        return result
    try:
        import psutil
        import win32api
        processes = {p.pid: p.info["exe"] for p in psutil.process_iter(["pid", "name", "exe"])
                     if (p.info["name"] or "").lower() == "weixin.exe"}
        if not processes:
            return {**result, "uiCode": "WECHAT_NOT_RUNNING", "message": "请先打开并登录电脑版微信。"}
        windows = wechat_windows(processes)
        info = win32api.GetFileVersionInfo(next(iter(processes.values())), "\\")
        version = (info["FileVersionMS"] >> 16, info["FileVersionMS"] & 65535, info["FileVersionLS"] >> 16, info["FileVersionLS"] & 65535)
        result.update(wechatVersion=".".join(map(str, version)), adapterVersion=importlib.metadata.version("pywechat127"))
        if version[:3] < (4, 1, 6):
            return {**result, "uiCode": "WECHAT_UNSUPPORTED_VERSION", "message": "当前微信版本暂不兼容。"}
        visible = [window for window in windows if window[2]]
        if not visible:
            return {**result, "uiCode": "WECHAT_WINDOW_HIDDEN", "message": "微信窗口尚未显示，开始采集时将尝试恢复窗口。"}
        if len(visible) > 4:
            return {**result, "uiCode": "WECHAT_WINDOW_AMBIGUOUS", "message": "微信窗口较多，暂时无法唯一确认主窗口；请关闭额外弹窗后重试。"}
        metadata = ui_metadata(visible[:4])
        if metadata is None:
            return {**result, "uiCode": "WECHAT_PROBE_TIMEOUT", "message": "微信界面暂未响应，点击导入会重新连接界面。"}
        classes = [name for _, name in metadata]
        if classes.count("mmui::MainWindow") > 1:
            return {**result, "uiCode": "WECHAT_WINDOW_AMBIGUOUS", "message": "检测到多个微信主窗口，请只保留要采集的账号窗口后重试。"}
        available = classes.count("mmui::MainWindow") == 1
        if available:
            message = "已检测到微信主窗口；未读取任何消息。"
            code = "READY"
        elif any(name == "mmui::LoginWindow" for name in classes):
            message = "请在微信登录窗口完成登录。"
            code = "WECHAT_LOGIN_REQUIRED"
        else:
            message = "微信已打开，界面文字暂不可读取。点击导入会尝试恢复界面连接；请保持微信窗口可见。"
            code = "WECHAT_UI_UNAVAILABLE"
        return {**result, "ready": available, "capabilities": {"chat": available, "moments": available},
                "uiCode": code, "message": message}
    except Exception:
        return {**result, "uiCode": "WECHAT_PROBE_FAILED", "message": "兼容性未确认，请将微信与助手以相同权限运行。"}


def prepare_capture_ui():
    """Only called by an explicitly requested capture worker, never /health.

    Restore one verified WeChat top-level window before rechecking UIA. Do not
    launch/restart WeChat, click arbitrary content or change accessibility flags.
    Readiness requires a real main-window provider after activation. A Qt shell
    alone does not prove account restrictions or a successful recovery.
    """
    before = compatibility_probe()
    if before.get("ready") or before.get("uiCode") in (
            "UNSUPPORTED_PLATFORM", "WECHAT_NOT_RUNNING", "WECHAT_UNSUPPORTED_VERSION", "WECHAT_LOGIN_REQUIRED"):
        return before
    try:
        import psutil
        import win32gui
        pids = {p.pid for p in psutil.process_iter(["name"])
                if (p.info["name"] or "").lower() == "weixin.exe"}
        windows = wechat_windows(pids)
        if len(windows) > 1:
            return {**before, "uiCode": "WECHAT_WINDOW_AMBIGUOUS", "message": "检测到多个微信主窗口，请只保留要采集的账号窗口后重试。"}
        if len(windows) == 1:
            hwnd = windows[0][0]
            restore_window(hwnd)  # SW_RESTORE without blocking on the UI thread.
            try:
                win32gui.SetForegroundWindow(hwnd)
            except Exception:
                pass  # Windows may refuse focus; the subsequent probe decides.
        current = before
        for attempt in range(4):
            if attempt == 1 and len(windows) == 1:
                # Use standard accessibility-client activation, then independently
                # verify the actual provider with a fresh UIA request.
                ui_metadata(windows, activate=True)
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
