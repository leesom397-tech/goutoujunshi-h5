"""Return UI capture to its original branded browser window, without new tabs."""
import os


def window_api():
    import ctypes
    from ctypes import wintypes
    api = ctypes.windll.user32
    api.GetForegroundWindow.restype = wintypes.HWND
    for name in ("GetWindowTextW", "GetClassNameW"):
        getattr(api, name).argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    api.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    api.IsWindow.argtypes = [wintypes.HWND]
    api.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
    api.SetForegroundWindow.argtypes = [wintypes.HWND]
    return api


def capture_browser_window():
    if os.name != "nt":
        return None
    import ctypes
    from ctypes import wintypes
    api = window_api()
    handle = api.GetForegroundWindow()
    title, kind = ctypes.create_unicode_buffer(512), ctypes.create_unicode_buffer(128)
    api.GetWindowTextW(handle, title, 512)
    api.GetClassNameW(handle, kind, 128)
    if "成子" not in title.value or kind.value not in ("Chrome_WidgetWin_1", "MozillaWindowClass"):
        return None
    pid = wintypes.DWORD()
    api.GetWindowThreadProcessId(handle, ctypes.byref(pid))
    return handle, pid.value


def return_to_browser(target):
    if os.name != "nt" or not target:
        return False
    import ctypes
    from ctypes import wintypes
    api = window_api()
    handle, expected_pid = target
    pid = wintypes.DWORD()
    api.GetWindowThreadProcessId(handle, ctypes.byref(pid))
    if not api.IsWindow(handle) or pid.value != expected_pid:
        return False
    foreground = api.GetForegroundWindow()
    kind = ctypes.create_unicode_buffer(128)
    api.GetClassNameW(foreground, kind, 128)
    # Don't interrupt another app the user deliberately switched to.
    if foreground != handle and not any(part in kind.value.lower() for part in ("wechat", "weixin", "mmui")):
        # WeChat 4's native HWND is Qt; mmui is only its UIA class.
        if not kind.value.startswith("Qt") or not is_wechat_process(api, foreground):
            return False
    api.ShowWindow(handle, 9)
    return bool(api.SetForegroundWindow(handle))


def is_wechat_process(api, handle):
    import ctypes
    from ctypes import wintypes
    import psutil
    pid = wintypes.DWORD()
    api.GetWindowThreadProcessId(handle, ctypes.byref(pid))
    try:
        return psutil.Process(pid.value).name().lower() in ("weixin.exe", "wechat.exe")
    except psutil.Error:
        return False
