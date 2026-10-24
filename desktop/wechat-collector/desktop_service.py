"""Private stdio sidecar for the desktop host; never a browser IPC endpoint.

Only connect creates a short-lived ticket. Startup/status inspect no WeChat
data. The host must not log connect responses or expose this pipe to web pages.
"""
import contextlib
import errno
import json
import os
import re
import socket
import sys
import threading

from bridge import BridgeError, CollectorState, PORT, server_for
from normalize import VERSION

MAX_LINE = 4096
EXPERIMENTAL_SETUP_ENV = "CHENGZI_MAC_EXPERIMENTAL_SETUP"
SETUP_MESSAGES = {
    "idle": "首次使用，请先完成 Mac 本机读取设置。",
    "preparing": "正在核对本机设置组件与微信。",
    "waiting-for-original-exit": "请从微信菜单正常退出；如有未完成事项，请先在微信处理。",
    "waiting-for-app-start": "正在等待微信首次设置窗口启动。",
    "waiting-for-user": "请在微信或系统窗口完成首次设置，再点「继续」。",
    "checking-account": "正在核对微信当前账号。",
    "cleanup": "正在结束本次设置并恢复原微信，请稍候。",
    "waiting-for-original-account": "请在原微信完成登录，正在核对同一账号。",
    "registering": "正在核对本机读取与后台组件。",
    "ready": "本机实验读取已就绪；正式 Mac 采集仍待真机验收。",
    "cancelling": "正在取消并恢复原微信，请稍候。",
    "failed": "本机设置未完成，请检查微信窗口后重试。",
    "cancelled": "本次设置已停止，原微信已恢复后可重新设置。",
    "closed": "本机设置已结束。",
}
SETUP_ERRORS = frozenset(("", "SETUP_PENDING", "SETUP_FAILED", "CLEANUP_INCOMPLETE", "PROCESS_CHANGED",
    "WATCHDOG_EXITED", "OBSERVER_UNAVAILABLE", "AUTHORIZATION_NOT_VERIFIED", "CANCELLED", "ACCOUNT_CHANGED",
    "MAC_WECHAT_MUST_CLOSE", "SOURCE_GRANT_EXPIRED", "HANDOFF_WINDOW_EXPIRED"))


def _public_setup(value):
    """Fixed public schema and phase text; never forward raw controller values."""
    if not isinstance(value, dict):
        raise ValueError("setup-state-invalid")
    phase = value.get("phase", "idle")
    if not isinstance(phase, str) or phase not in SETUP_MESSAGES:
        raise ValueError("setup-state-invalid")
    job = value.get("jobId", "")
    if not isinstance(job, str) or job and re.fullmatch(r"[A-Za-z0-9_-]{1,80}", job) is None:
        raise ValueError("setup-state-invalid")
    for name in ("attempt", "revision"):
        if type(value.get(name, 0)) is not int or not 0 <= value.get(name, 0) <= 1_000_000_000:
            raise ValueError("setup-state-invalid")
    for name in ("active", "can_continue", "cleanupPending", "ready"):
        if type(value.get(name, False)) is not bool:
            raise ValueError("setup-state-invalid")
    active, cleanup = value.get("active", False), value.get("cleanupPending", False)
    can_continue = value.get("can_continue", False) and not cleanup
    ready = value.get("ready", False) and not active and not cleanup and phase == "ready"
    error = value.get("error_code", "")
    error = error if isinstance(error, str) and error in SETUP_ERRORS else "SETUP_FAILED"
    ready = ready and not error
    return {"jobId": job, "attempt": value.get("attempt", 0), "revision": value.get("revision", 0),
        "active": active, "phase": phase, "message": SETUP_MESSAGES[phase], "can_continue": can_continue,
        "continue_action": ("recheck-current-attempt" if active else "start-fresh-attempt") if can_continue else "",
        "error_code": error, "cleanupPending": cleanup, "experimental": True,
        "ready": ready, "realDeviceValidated": False}


def _set_windows_standard_input(fd):
    import ctypes
    import msvcrt
    from ctypes import wintypes
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.SetStdHandle.argtypes = [wintypes.DWORD, wintypes.HANDLE]
    kernel.SetStdHandle.restype = wintypes.BOOL
    if not kernel.SetStdHandle(wintypes.DWORD(-10), msvcrt.get_osfhandle(fd)):
        raise ctypes.WinError(ctypes.get_last_error())


@contextlib.contextmanager
def isolated_control_input(stream):
    """Keep the host pipe private; workers must inherit NUL as standard input.

    On Windows CPython initializes inherited stdin with an OS seek. If our
    service is already waiting in ReadFile on that pipe, the child's startup
    blocks before it can even send the first progress event (CPython #78961).
    Merely replacing sys.stdin does not change the inherited Windows handle.
    """
    if sys.platform != "win32":
        yield stream
        return
    source_fd = stream.fileno()
    private_fd = os.dup(source_fd)
    os.set_inheritable(private_fd, False)
    was_inheritable = os.get_inheritable(source_fd)
    private = null_fd = None
    redirected = False
    try:
        # No input has been read yet, so creating this wrapper cannot contend
        # with a pending read. Both descriptor and OS handle are non-inheritable.
        private = os.fdopen(private_fd, "r", encoding="utf-8", errors="strict")
        null_fd = os.open(os.devnull, os.O_RDONLY)
        os.dup2(null_fd, source_fd, inheritable=False)
        redirected = True
        _set_windows_standard_input(source_fd)
        yield private
    finally:
        try:
            if redirected:
                os.dup2(private_fd, source_fd, inheritable=was_inheritable)
                _set_windows_standard_input(source_fd)
        finally:
            if null_fd is not None:
                os.close(null_fd)
            if private is not None:
                private.close()
            else:
                os.close(private_fd)


def _error(code, message):
    return {"ok": False, "error": {"code": code, "message": message}}


def _request(line):
    try:
        value = json.loads(line)
    except (ValueError, TypeError):
        return None
    if not isinstance(value, dict) or not {"id", "command"} <= set(value):
        return None
    request_id = value["id"]
    if not ((type(request_id) is int and 0 <= request_id <= 9007199254740991)
            or (isinstance(request_id, str) and 0 < len(request_id) <= 80)):
        return None
    if not isinstance(value["command"], str):
        return None
    extras = {"consent"} if value["command"] in ("setup", "setup-prepare") else {"jobId"} if value["command"] in ("setup-continue", "setup-cancel") else set()
    if set(value) - {"id", "command"} - extras:
        return None
    return value


def _cleanup(state):
    if state is None:
        return
    try:
        with state.lock:
            state.closing = True
            state.cancel_active()
            state.jobs.clear()
            state.token, state.origin = "", ""
            state.revoke_handoff()
            state.code = ""
    finally:
        from platform_runtime import clear_worker_authorization
        clear_worker_authorization()


def run_service(input_stream, output_stream, *, port=PORT, state_factory=CollectorState,
                setup_factory=None, experimental_setup=None):
    """port/state_factory are injection points for synthetic tests, not CLI flags."""
    emit_lock, setup_lock = threading.Lock(), threading.Lock()
    setup = None
    setup_state = None
    ready_emitted = False
    enabled = sys.platform == "darwin" and (os.environ.get(EXPERIMENTAL_SETUP_ENV) == "1"
        if experimental_setup is None else experimental_setup is True)
    def emit(value):
        with emit_lock:
            output_stream.write(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n")
            output_stream.flush()

    def setup_changed(value):
        nonlocal setup_state
        public = _public_setup(value)
        with setup_lock:
            previous = setup_state
            if public == previous:
                return
            if previous and (public["attempt"] < previous["attempt"]
                    or public["attempt"] == previous["attempt"] and public["revision"] < previous["revision"]):
                return
            setup_state = public
        if ready_emitted:
            emit({"event": "setup-progress", "setup": public})

    def setup_snapshot():
        if setup is None:
            return None
        public = _public_setup(setup.snapshot())
        setup_changed(public)
        with setup_lock:
            return dict(setup_state)

    def setup_active():
        with setup_lock:
            return bool(setup_state and (setup_state["active"] or setup_state["cleanupPending"]))

    state = server = server_thread = None
    shutdown_id = None
    exit_code = 0
    try:
        state = state_factory()
        if enabled:
            if setup_factory is None:
                from macos_candidate_setup_controller import create_setup_controller
                setup_factory = create_setup_controller
            setup = setup_factory(enabled=True, on_change=setup_changed)
            setup_changed(setup.snapshot())
            state.setup_in_progress = setup_active
        try:
            server = server_for(state, port=port)
        except OSError as error:
            occupied = error.errno == errno.EADDRINUSE or getattr(error, "winerror", None) == 10048
            if not occupied and getattr(error, "winerror", None) == 10013:
                # Windows reports access denied for some already bound sockets.
                # A TCP-only probe distinguishes a listener from firewall denial.
                try:
                    with socket.create_connection(("127.0.0.1", port), timeout=.2):
                        occupied = True
                except OSError:
                    pass
            emit({"event": "error", **_error(
                "PORT_IN_USE" if occupied else "SERVICE_START_FAILED",
                "本机助手端口已被占用，请先退出已打开的助手。" if occupied else "本机服务启动失败，请重新打开桌面应用。")})
            return 2
        # Join in-flight HTTP handlers before clearing session/worker state.
        server.daemon_threads = False
        server.block_on_close = True
        server_thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": .1},
                                         daemon=True, name="chengzi-desktop-loopback")
        server_thread.start()
        emit({"event": "ready", "port": server.server_port, "protocol": 1,
              "version": VERSION, "platform": sys.platform, "serviceReady": True,
              "sourceReady": False, "setupAvailable": setup is not None})
        ready_emitted = True
        while True:
            line = input_stream.readline(MAX_LINE + 1)
            if not line:
                break
            if len(line) > MAX_LINE:
                emit({"id": None, **_error("INVALID_REQUEST", "桌面指令过长，请更新桌面应用。")})
                exit_code = 2
                break
            request = _request(line)
            if request is None:
                emit({"id": None, **_error("INVALID_REQUEST", "桌面指令格式不正确。")})
                continue
            request_id, command = request["id"], request["command"]
            if command == "shutdown":
                shutdown_id = request_id
                break
            if command == "status":
                snapshot = setup_snapshot()
                with state.lock:
                    result = {"ok": True, "version": VERSION, "protocol": 1,
                              "platform": sys.platform, "port": server.server_port,
                              "connected": bool(state.token), "busy": state.active is not None or setup_active(),
                              "serviceReady": True, "sourceReady": bool(snapshot and snapshot["ready"]),
                              "setupAvailable": setup is not None, "experimental": setup is not None}
                    if snapshot is not None:
                        result["setup"] = snapshot
            elif command == "connect":
                try:
                    result = {"ok": True, "handoffUrl": state.create_handoff()}
                except BridgeError as error:
                    result = (_error("CAPTURE_BUSY", "请先完成或停止本次导入，再重新连接。")
                              if error.code == "CAPTURE_BUSY" else _error("CONNECT_FAILED", "连接未完成，请重试。"))
            elif command in ("setup", "setup-prepare", "setup-status", "setup-continue", "setup-cancel"):
                if setup is None:
                    result = _error("SETUP_UNAVAILABLE", "当前 Mac 本机设置尚未启用。" if sys.platform == "darwin"
                                    else "Windows 无需此项 Mac 首次授权设置。")
                elif command in ("setup", "setup-prepare") and request.get("consent") is not True:
                    result = _error("SETUP_LOCAL_CONSENT_REQUIRED", "请先在本机窗口确认开始设置。")
                else:
                    try:
                        # Controller methods return immediately. Publish their
                        # active fact under the same lock as HTTP capture start,
                        # so neither operation can enter the other's idle gap.
                        with state.lock:
                            if command in ("setup", "setup-prepare", "setup-continue") and state.active is not None:
                                result = _error("CAPTURE_BUSY", "请先完成或停止正在进行的采集。")
                            else:
                                if command == "setup-status":
                                    snapshot = setup_snapshot()
                                elif command in ("setup", "setup-prepare"):
                                    snapshot = (setup.start if command == "setup" else setup.prepare)(consent=True)
                                else:
                                    job = request.get("jobId")
                                    if not isinstance(job, str) or re.fullmatch(r"[A-Za-z0-9_-]{1,80}", job) is None:
                                        raise ValueError("setup-job-invalid")
                                    snapshot = (setup.continue_setup if command == "setup-continue" else setup.cancel)(job)
                                snapshot = _public_setup(snapshot)
                                setup_changed(snapshot)
                                result = {"ok": True, "setup": snapshot, "setupAvailable": True,
                                          "serviceReady": True, "sourceReady": snapshot["ready"], "experimental": True}
                    except Exception:
                        result = _error("SETUP_ACTION_FAILED", "设置操作未完成，请查看本机状态后重试。")
            else:
                result = _error("UNKNOWN_COMMAND", "桌面指令不受支持。")
            emit({"id": request_id, **result})
    except (BrokenPipeError, EOFError):
        exit_code = 0
    except Exception:
        exit_code = 1
        try:
            emit({"event": "error", **_error("SERVICE_FAILED", "本机服务已停止，请重新打开桌面应用。")})
        except (OSError, ValueError):
            pass
    finally:
        # Close the listening socket before revoking state so no new connection
        # can race with teardown. Drain existing HTTP handlers before revocation;
        # their socket reads have the bridge's existing five-second timeout.
        if server is not None:
            if server_thread is not None:
                server.shutdown()
            server.server_close()
        if setup is not None:
            try:
                closed = setup.close()
                final_setup = _public_setup(setup.snapshot())
                if closed is not True or final_setup["active"] or final_setup["cleanupPending"]:
                    exit_code = 1
                    emit({"event": "error", **_error("SETUP_CLEANUP_PENDING", "设置清理或原微信恢复尚未完成，请保留当前窗口并检查微信。")})
            except Exception:
                exit_code = 1
                try:
                    emit({"event": "error", **_error("SETUP_CLEANUP_PENDING", "设置清理或原微信恢复尚未完成，请检查微信。")})
                except (OSError, ValueError):
                    pass
        try:
            _cleanup(state)
        except Exception:
            exit_code = 1
        if server_thread is not None:
            server_thread.join(timeout=2)
    if shutdown_id is not None:
        try:
            emit({"id": shutdown_id, "ok": exit_code == 0})
        except (OSError, ValueError):
            pass
    return exit_code


def main():
    # Windows windowed PyInstaller executables have no stdio. Build the separate
    # console service executable; the Electron parent launches it windowsHide.
    if sys.stdin is None or sys.stdout is None:
        return 2
    incoming, outgoing = sys.stdin, sys.stdout
    for stream in (incoming, outgoing):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="strict")
    # Keep dependency print/warnings away from the JSON protocol and logs.
    with isolated_control_input(incoming) as control_input:
        with open(os.devnull, "w", encoding="utf-8") as sink:
            with contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
                return run_service(control_input, outgoing)


if __name__ == "__main__":
    raise SystemExit(main())
