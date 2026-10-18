"""Bounded Windows accessibility metadata requests; no conversation reads."""
import threading

UIA_REQUEST_SECONDS = 2.0
_uia_lock = threading.Lock()
_uia_request = None


def restore_window(hwnd):
    """Nonblocking restore; pywin32 does not expose ShowWindowAsync."""
    import ctypes
    from ctypes import wintypes
    restore = ctypes.WinDLL("user32", use_last_error=True).ShowWindowAsync
    restore.argtypes = [wintypes.HWND, ctypes.c_int]
    restore.restype = wintypes.BOOL
    if not restore(hwnd, 9):  # SW_RESTORE
        raise OSError("window restore was not queued")


def wechat_windows(processes):
    """Exclude tray hosts and shadows which can share the main window's title."""
    import win32gui
    import win32process
    windows = []
    def enum(hwnd, _):
        try:
            pid = win32process.GetWindowThreadProcessId(hwnd)[1]
            if pid not in processes or not win32gui.GetClassName(hwnd).startswith("Qt"):
                return
            if win32gui.GetWindow(hwnd, 4):  # GW_OWNER: owned popups are not the app.
                return
            style, extended = win32gui.GetWindowLong(hwnd, -16), win32gui.GetWindowLong(hwnd, -20)
            if style & 0x40000000 or extended & 0x80:  # WS_CHILD / WS_EX_TOOLWINDOW
                return
            left, top, right, bottom = win32gui.GetClientRect(hwnd)
            if win32gui.IsIconic(hwnd):
                left, top, right, bottom = win32gui.GetWindowPlacement(hwnd)[4]
            if right - left < 200 or bottom - top < 160:
                return
            visible = bool(win32gui.IsWindowVisible(hwnd))
            standard_title = win32gui.GetWindowText(hwnd) in ("微信", "Weixin", "WeChat")
            if not standard_title and (not visible or not (style & 0x00C40000)):
                return
            windows.append((hwnd, pid, visible))
        except Exception:
            return  # A window can disappear during enumeration.
    win32gui.EnumWindows(enum, None)
    return windows


def _activate_accessibility(hwnd):
    """Use the supported MSAA OBJID_CLIENT request, not a raw WM_GETOBJECT.

    Qt activates accessibility when Windows requests its provider. Do not read
    names, values or descendants from the returned accessible object.
    """
    import ctypes
    from ctypes import wintypes
    from comtypes import GUID, IUnknown
    request = ctypes.OleDLL("oleacc").AccessibleObjectFromWindow
    request.argtypes = [wintypes.HWND, wintypes.DWORD, ctypes.POINTER(GUID),
                        ctypes.POINTER(ctypes.POINTER(IUnknown))]
    request.restype = ctypes.HRESULT
    pointer = ctypes.POINTER(IUnknown)()
    interface = GUID("{618736E0-3C3D-11CF-810C-00AA00389B71}")  # IID_IAccessible
    request(hwnd, 0xFFFFFFFC, ctypes.byref(interface), ctypes.byref(pointer))
    del pointer


def _read_ui_metadata(windows, activate=False):
    """Fresh COM objects in an MTA; return class/PID, never UI text."""
    import comtypes
    import comtypes.client
    comtypes.CoInitializeEx(0)  # COINIT_MULTITHREADED; this thread owns no window.
    automation = element = None
    try:
        module = comtypes.client.GetModule("UIAutomationCore.dll")
        automation = comtypes.client.CreateObject(module.CUIAutomation8, interface=module.IUIAutomation2)
        automation.ConnectionTimeout = 350
        automation.TransactionTimeout = 350
        automation.AutoSetFocus = False
        result = []
        for hwnd, pid, _ in windows:
            if activate:
                try:
                    _activate_accessibility(hwnd)
                except Exception:
                    pass  # MSAA failures cannot establish UIA readiness.
            try:
                element = automation.ElementFromHandle(hwnd)
                if element.CurrentProcessId == pid:
                    result.append((hwnd, element.CurrentClassName))
            except Exception:
                pass
            finally:
                element = None
        return result
    finally:
        element = automation = None
        comtypes.CoUninitialize()


def ui_metadata(windows, activate=False):
    """Bound even a hung provider, with at most one outstanding COM request.

    Results are never cached. A late result cannot mark a later request ready.
    """
    global _uia_request
    # First import initializes the importing thread: do it before starting the
    # MTA worker so comtypes' implicit STA setup cannot conflict in that worker.
    import comtypes.client
    outcome = []
    def run():
        try:
            outcome.append(_read_ui_metadata(windows, activate))
        except Exception:
            outcome.append(None)
    with _uia_lock:
        if _uia_request is not None and _uia_request.is_alive():
            return None
        _uia_request = threading.Thread(target=run, name="wechat-ui-metadata", daemon=True)
        worker = _uia_request
        worker.start()
    worker.join(UIA_REQUEST_SECONDS)
    return outcome[0] if not worker.is_alive() and outcome else None
