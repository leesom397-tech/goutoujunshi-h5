"""Private stdio sidecar for the desktop host; never a browser IPC endpoint.

Only connect creates a short-lived ticket. Startup/status inspect no WeChat
data. The host must not log connect responses or expose this pipe to web pages.
"""
import contextlib
import errno
import json
import os
import socket
import sys
import threading

from bridge import BridgeError, CollectorState, PORT, server_for
from normalize import VERSION

MAX_LINE = 4096


def _error(code, message):
    return {"ok": False, "error": {"code": code, "message": message}}


def _request(line):
    try:
        value = json.loads(line)
    except (ValueError, TypeError):
        return None
    if not isinstance(value, dict) or set(value) != {"id", "command"}:
        return None
    request_id = value["id"]
    if not ((type(request_id) is int and 0 <= request_id <= 9007199254740991)
            or (isinstance(request_id, str) and 0 < len(request_id) <= 80)):
        return None
    if not isinstance(value["command"], str):
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


def run_service(input_stream, output_stream, *, port=PORT, state_factory=CollectorState):
    """port/state_factory are injection points for synthetic tests, not CLI flags."""
    def emit(value):
        output_stream.write(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n")
        output_stream.flush()

    state = server = server_thread = None
    shutdown_id = None
    exit_code = 0
    try:
        state = state_factory()
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
              "version": VERSION, "platform": sys.platform})
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
                with state.lock:
                    result = {"ok": True, "version": VERSION, "protocol": 1,
                              "platform": sys.platform, "port": server.server_port,
                              "connected": bool(state.token), "busy": state.active is not None,
                              "setupAvailable": False}
            elif command == "connect":
                try:
                    result = {"ok": True, "handoffUrl": state.create_handoff()}
                except BridgeError as error:
                    result = (_error("CAPTURE_BUSY", "请先完成或停止本次导入，再重新连接。")
                              if error.code == "CAPTURE_BUSY" else _error("CONNECT_FAILED", "连接未完成，请重试。"))
            elif command == "setup":
                result = _error("SETUP_UNAVAILABLE", "此桌面预览版尚未集成 Mac 首次授权设置。" if sys.platform == "darwin"
                                else "Windows 无需此项 Mac 首次授权设置。")
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
    with open(os.devnull, "w", encoding="utf-8") as sink:
        with contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
            return run_service(incoming, outgoing)


if __name__ == "__main__":
    raise SystemExit(main())
