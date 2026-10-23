"""Frozen service worker check. Only in-memory, invented SQLite records are used."""
import contextlib
import os
import sys
import threading
import time


@contextlib.contextmanager
def _pending_host_input():
    """Keep a synthetic control read pending throughout the frozen worker test."""
    if sys.platform != "win32":
        yield {"pendingControlRead": False, "controlPipeIntact": True}
        return
    from desktop_service import isolated_control_input, _set_windows_standard_input
    saved_fd = os.dup(0)
    read_fd, write_fd = os.pipe()
    reader = None
    receipts = []
    state = {"pendingControlRead": False, "controlPipeIntact": False}
    try:
        os.dup2(read_fd, 0)
        _set_windows_standard_input(0)
        os.close(read_fd)
        read_fd = None
        with isolated_control_input(sys.stdin) as control:
            waiting = threading.Event()
            def wait_for_host():
                waiting.set()
                receipts.append(control.readline())
            reader = threading.Thread(target=wait_for_host, name="synthetic-host-control", daemon=True)
            reader.start()
            waiting.wait(2)
            time.sleep(.1)
            state["pendingControlRead"] = reader.is_alive()
            try:
                yield state
            finally:
                os.write(write_fd, b"synthetic-control\n")
                reader.join(3)
                state["controlPipeIntact"] = receipts == ["synthetic-control\n"] and not reader.is_alive()
    finally:
        os.dup2(saved_fd, 0)
        _set_windows_standard_input(0)
        os.close(saved_fd)
        os.close(write_fd)
        if read_fd is not None:
            os.close(read_fd)


def _synthetic_capture(pipe, request):
    """Exercise the real capture entry point while replacing its data provider."""
    import sqlite3
    import platform_runtime
    from bridge import _capture_process

    def capture(_request, progress, on_partial=None):
        with sqlite3.connect(":memory:") as db:
            db.execute("CREATE TABLE synthetic(row_id INTEGER, body TEXT)")
            db.executemany("INSERT INTO synthetic VALUES(?,?)",
                           ((i, "synthetic-message") for i in range(500)))
            progress(3, "synthetic worker is ready")
            count = db.execute("SELECT COUNT(*) FROM synthetic").fetchone()[0]
        return {"synthetic": True, "count": count, "pid": os.getpid()}

    original = platform_runtime.capture_function
    platform_runtime.capture_function = lambda _request: capture
    try:
        _capture_process(pipe, request)
    finally:
        platform_runtime.capture_function = original


def run_worker_self_test():
    """Spawn from a service thread with redirected stdio, as Electron does."""
    from bridge import CollectorState
    started = time.monotonic()
    result = {"mode": "capture-worker-self-test", "ok": False,
              "userDataUsed": False, "networkUsed": False, "jobs": 0}
    state = CollectorState(health_provider=lambda: {"capabilities": {"backgroundChat": True}},
                           capture_target=_synthetic_capture)
    failures = []
    timings = []

    def run():
        try:
            for _ in range(2):
                began = time.monotonic()
                job_id = state.start({"kind": "chat", "friend": "synthetic", "limit": 500,
                                      "mode": "background"})["jobId"]
                while time.monotonic() - began < 15:
                    job = state.get(job_id)
                    if job["status"] != "running" and state.active is None:
                        if (job["status"] != "completed" or job.get("result", {}).get("count") != 500
                                or job["result"]["pid"] == os.getpid()):
                            raise RuntimeError("synthetic-worker-result-invalid")
                        result["jobs"] += 1
                        timings.append(round((time.monotonic() - began) * 1000))
                        break
                    time.sleep(.01)
                else:
                    raise RuntimeError("synthetic-worker-start-or-read-timeout")
        except Exception as error:
            failures.append(type(error).__name__)
        finally:
            state.cancel_active()

    # Reproduce the actual desktop sidecar's stdio environment, without opening
    # its production port or creating a real connection/session.
    with _pending_host_input() as control_state:
        with open(os.devnull, "w", encoding="utf-8") as sink:
            with contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
                thread = threading.Thread(target=run, name="synthetic-desktop-request", daemon=True)
                thread.start()
                thread.join(timeout=35)
    if thread.is_alive():
        state.cancel_active()
        failures.append("ThreadTimeout")
    result.update(ok=result["jobs"] == 2 and not failures and control_state["controlPipeIntact"],
                  **control_state,
                  elapsedMilliseconds=round((time.monotonic() - started) * 1000),
                  jobMilliseconds=timings)
    if failures:
        result["errorType"] = failures[0]
    return result
