"""Explicit local experimental setup, asynchronous and absent from default routing."""
from __future__ import annotations

import contextlib
import multiprocessing as mp
import os
from pathlib import Path
import secrets
import subprocess
import threading
import time

import macos_key_provider as provider
from background_reader import BackgroundCaptureError


class SetupError(RuntimeError):
    pass


def _check_cancel(cancel):
    if cancel():
        raise SetupError("CANCELLED")


def _authorization_worker(connection, payload):
    """Cold/spawn contract check; only self identity/HMAC, never chat rows."""
    with open(os.devnull, "w") as sink, contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
        source = None
        try:
            provider.import_worker_authorization(payload)
            import macos_database_source
            source = macos_database_source.open_authorized_source(contacts_only=True)
            source.assert_unchanged()
            source.close(); source = None
            connection.send({"ready": True, "experimental": True, "workerAuthorizationVersion": 2})
        except Exception:
            connection.send({"ready": False, "experimental": True})
        finally:
            try:
                if source is not None: source.close()
            finally:
                payload.close()
                provider.clear_experimental_authorization()
                connection.close()


class _Backend:
    def preflight(self):
        from macos_candidate_source_preflight import check_dependencies
        if check_dependencies(profile="desktop").get("ok") is not True:
            raise SetupError("MAC_COMPONENTS_MISSING")

    def original_proof(self, *, verify_signature=False):
        return provider.experimental_original_proof(consent=True, verify_signature=verify_signature)

    def contact_salt(self, proof):
        return provider._read_contact_header(proof["account"])[1][:16]

    def prepare_candidate(self, receipt):
        import macos_candidate_prepare as prepare
        import macos_candidate_device_runtime as device
        if receipt is None:
            result = prepare.prepare()
            if result.get("ok") is not True: raise SetupError("MAC_CANDIDATE_PREPARATION_FAILED")
            receipt = Path(result["workDirectory"]) / "prepare-receipt.json"
        work, shadow, digest = device._load_receipt(receipt)
        debug, _, _ = device._load_modules(work)
        device._verify(work, shadow, digest, debug)
        return receipt

    def original_closed(self, proof):
        processes = provider._processes()
        if not processes: return True
        if (len(processes) != 1 or processes[0][0] != proof["pid"]
                or provider._native_generation(proof["pid"]) != (proof["uid"], proof["startSeconds"], proof["startMicroseconds"])):
            raise SetupError("ACCOUNT_CHANGED")
        return False

    def request_normal_quit(self, proof):
        if self.original_closed(proof): return "closed"
        # No shell, force quit, System Events/AX click, or permission change.
        # A user cancellation (-128) is respected rather than retried.
        script = 'with timeout of 10 seconds\nif application "/Applications/WeChat.app" is running then\ntell application "/Applications/WeChat.app" to quit\nend if\nend timeout'
        try:
            result = subprocess.run(["/usr/bin/osascript", "-e", script], capture_output=True, timeout=12, check=False)
        except (OSError, subprocess.SubprocessError): return "manual"
        if result.returncode == 0: return "requested"
        if b"-128" in result.stderr: raise SetupError("CANCELLED")
        return "manual"

    def restore_original(self):
        provider._verify_official_bundle()
        if provider.bundle_metadata() != provider.EXPERIMENTAL_BUILD: return False
        if not provider._processes():
            result = subprocess.run(["/usr/bin/open", str(provider.WECHAT_APP)], capture_output=True, timeout=15, check=False)
            if result.returncode != 0: return False
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            pids = provider._processes()
            if len(pids) == 1:
                provider._native_generation(pids[0][0])
                return True
            time.sleep(.2)
        return False

    def session(self, receipt, progress, cancel):
        from macos_candidate_source import CandidateSession
        return CandidateSession(receipt, seconds=600, authentication_seconds=600, human_setup=True,
                                progress=progress, cancel=cancel)

    def capture_grant(self, session):
        from macos_candidate_handoff import capture_handoff_grant
        return capture_handoff_grant(session)

    def rebind(self, grant):
        from macos_candidate_handoff import rebind_after_restore
        return rebind_after_restore(grant)

    def register(self, lease):
        return lease.register_experimental_with_provider(consent=True)

    def readiness(self):
        return provider.experimental_status(validate=True)["ready"]

    def clear(self):
        provider.clear_experimental_authorization()

    def worker_check(self, cancelled):
        payload = provider.export_worker_authorization()
        if type(payload) is not provider.ExperimentalWorkerAuthorization:
            payload.close(); return False
        context = mp.get_context("spawn")
        receive, send = context.Pipe(duplex=False)
        process = context.Process(target=_authorization_worker, args=(send, payload), daemon=True)
        try:
            process.start(); send.close(); payload.close()
            deadline = time.monotonic() + 30
            value = None
            while time.monotonic() < deadline:
                _check_cancel(cancelled)
                if receive.poll(.1): value = receive.recv(); break
                if not process.is_alive(): break
            process.join(timeout=2)
            return value == {"ready": True, "experimental": True, "workerAuthorizationVersion": 2} and process.exitcode == 0
        finally:
            payload.close(); receive.close(); send.close()
            if process.pid is not None and process.is_alive():
                process.terminate(); process.join(timeout=3)
                if process.is_alive(): process.kill(); process.join(timeout=3)


class ExperimentalMacSetupController:
    def __init__(self, *, enabled=False, on_change=None, _backend=None, _clock=time.monotonic):
        self.enabled = enabled is True
        self._backend, self._clock = _backend or _Backend(), _clock
        self._on_change, self._lock = on_change, threading.RLock()
        self._stop, self._wake = threading.Event(), threading.Event()
        self._thread = None
        self._receipt = self._prepared = None
        self._closed = False
        self._state = {"jobId": "", "attempt": 0, "revision": 0, "active": False, "phase": "idle",
            "message": "请在本机开始实验设置。", "can_continue": False, "continue_action": "", "error_code": "",
            "cleanupPending": False, "originalRestored": False, "ready": False, "experimental": self.enabled,
            "realDeviceValidated": False, "workerReady": False}

    def _publish(self, **changes):
        with self._lock:
            self._state.update(changes); self._state["revision"] += 1
            snapshot = dict(self._state)
        if self._on_change is not None:
            try: self._on_change(dict(snapshot))
            except Exception: pass
        return snapshot

    def capabilities(self):
        return {"experimental": self.enabled, "setupAvailable": self.enabled and not self._closed, "realDeviceValidated": False}

    def snapshot(self):
        with self._lock: return dict(self._state)

    status = snapshot

    def _start(self, consent, prepare_only):
        with self._lock:
            if not self.enabled or self._closed: raise SetupError("SETUP_UNAVAILABLE")
            if consent is not True: raise SetupError("MAC_LOCAL_CONSENT_REQUIRED")
            if self._state["active"]: return dict(self._state)
            if self._state["cleanupPending"]: raise SetupError("SETUP_CLEANUP_PENDING")
            if self._state["ready"]: return dict(self._state)
            if self._thread is not None and self._thread.is_alive(): raise SetupError("SETUP_CLEANUP_PENDING")
            self._stop, self._wake = threading.Event(), threading.Event()
            self._state.update(jobId=secrets.token_urlsafe(18), attempt=self._state["attempt"] + 1,
                               active=True, ready=False, workerReady=False)
            self._thread = threading.Thread(target=self._run, args=(prepare_only,), daemon=True, name="chengzi-experimental-mac-setup")
            result = self._publish(phase="preparing", message="正在核对本机组件和原微信账号…", error_code="", can_continue=False)
            self._thread.start()
            return result

    def prepare(self, *, consent=False): return self._start(consent, True)
    def start(self, *, consent=False): return self._start(consent, False)

    def continue_setup(self, job_id):
        with self._lock:
            if job_id != self._state["jobId"]: raise SetupError("SETUP_JOB_STALE")
            if not self._state["can_continue"]: raise SetupError("SETUP_CONTINUATION_UNAVAILABLE")
            if self._state["active"]:
                self._wake.set()
                return dict(self._state)
        return self.start(consent=True)

    def cancel(self, job_id):
        with self._lock:
            if job_id != self._state["jobId"]: raise SetupError("SETUP_JOB_STALE")
            self._stop.set(); self._wake.set()
            if not self._state["active"]:
                if not self._state["ready"]: return dict(self._state)
                return self._publish(active=True, phase="cancelling", ready=False, workerReady=False,
                                     cleanupPending=True, can_continue=False, message="正在停止实验读取…")
        return self._publish(phase="cancelling", message="正在停止设置并恢复微信…", can_continue=False)

    def _wait(self):
        self._wake.wait(.25); self._wake.clear(); _check_cancel(self._stop.is_set)

    def _candidate_progress(self, view):
        phase = view.get("phase")
        if phase not in {"waiting-for-app-start", "waiting-for-user", "checking-account", "cleanup"}: return
        changes = {"phase": phase, "can_continue": phase == "waiting-for-user", "continue_action": "recheck-current-attempt" if phase == "waiting-for-user" else ""}
        changes["message"] = {"waiting-for-app-start": "正在启动临时微信窗口…", "waiting-for-user": "请在微信或系统窗口完成首次设置，然后继续。",
                              "checking-account": "正在核对临时微信的当前账号…", "cleanup": "正在清理临时窗口并恢复原微信…"}[phase]
        if phase == "cleanup": changes["cleanupPending"] = True
        self._publish(**changes)

    def _run(self, prepare_only):
        session = grant = lease = None
        original_closed = quit_requested = False
        restore_owned = False
        registered = False
        failure = None
        prepared_only_done = False
        try:
            self._backend.preflight(); _check_cancel(self._stop.is_set)
            proof = self._backend.original_proof(verify_signature=True)
            salt = self._backend.contact_salt(proof)
            self._prepared = (proof, salt)
            if prepare_only:
                prepared_only_done = True
                return
            self._receipt = self._backend.prepare_candidate(self._receipt)
            _check_cancel(self._stop.is_set)
            self._publish(phase="waiting-for-original-exit", message="正在请求微信正常退出；请先处理微信中的未完成事项。", can_continue=True)
            quit_requested = True
            restore_owned = True
            outcome = self._backend.request_normal_quit(proof)
            if outcome == "manual": self._publish(message="请从微信菜单正常退出后继续。")
            deadline = self._clock() + 300
            while not self._backend.original_closed(proof):
                if self._clock() >= deadline: raise SetupError("MAC_WECHAT_MUST_CLOSE")
                self._wait()
            original_closed = True
            _check_cancel(self._stop.is_set)
            session = self._backend.session(self._receipt, self._candidate_progress, self._stop.is_set)
            with session:
                _check_cancel(self._stop.is_set)
                grant = self._backend.capture_grant(session)
                if grant._account != proof["account"] or grant._salt != salt: raise SetupError("ACCOUNT_CHANGED")
            restore_owned = False
            original_closed = False
            self._publish(cleanupPending=False, originalRestored=True, phase="waiting-for-original-account",
                          message="请在原微信完成登录，正在核对同一账号。", can_continue=True)
            while self._clock() < grant._handoff_expires:
                _check_cancel(self._stop.is_set)
                try:
                    original = self._backend.original_proof()
                    if original["account"] != proof["account"] or self._backend.contact_salt(original) != salt:
                        raise SetupError("ACCOUNT_CHANGED")
                    break
                except BackgroundCaptureError as error:
                    if error.code not in {"WECHAT_NOT_LOGGED_IN", "MAC_ACCOUNT_UNVERIFIED", "MAC_DATABASE_UNAVAILABLE"}: raise
                self._wait()
            else: raise SetupError("MAC_ORIGINAL_ACCOUNT_NOT_READY")
            lease = self._backend.rebind(grant)
            _check_cancel(self._stop.is_set)
            self._publish(phase="registering", message="正在核对后台读取授权…", can_continue=False)
            self._backend.register(lease); registered = True
            _check_cancel(self._stop.is_set)
            if not self._backend.worker_check(self._stop.is_set) or not self._backend.readiness():
                raise SetupError("MAC_EXPERIMENTAL_WORKER_UNAVAILABLE")
            _check_cancel(self._stop.is_set)
            self._publish(active=False, phase="ready", message="本机实验读取已就绪。", ready=True, workerReady=True,
                          cleanupPending=False, originalRestored=True, can_continue=False, error_code="")
            while not self._stop.wait(.5):
                if not self._backend.readiness():
                    self._backend.clear()
                    self._publish(active=True, phase="cleanup", ready=False, workerReady=False,
                                  cleanupPending=True, can_continue=False, message="正在结束已失效的实验读取…")
                    raise SetupError("ACCOUNT_CHANGED")
        except BaseException as error:
            failure = "CANCELLED" if self._stop.is_set() else getattr(error, "code", str(error) if isinstance(error, SetupError) else "SETUP_FAILED")
            if failure not in {"CANCELLED", "ACCOUNT_CHANGED", "MAC_COMPONENTS_MISSING", "MAC_WECHAT_MUST_CLOSE", "MAC_ORIGINAL_ACCOUNT_NOT_READY",
                               "MAC_EXPERIMENTAL_WORKER_UNAVAILABLE", "MAC_CANDIDATE_PREPARATION_FAILED", "WECHAT_NOT_LOGGED_IN", "MAC_ACCOUNT_UNVERIFIED"}:
                failure = "SETUP_FAILED"
        finally:
            if failure is None and self._stop.is_set(): failure = "CANCELLED"
            cleanup = True
            for resource in (lease, grant):
                if resource is not None:
                    try: resource.close()
                    except Exception: cleanup = False
            if session is not None:
                try: session.close()
                except Exception: cleanup = False
                if session.launched:
                    cleanup = cleanup and session.status.get("runtimeCleanupComplete") is True
                    original_closed = not session.status.get("originalRestored", False)
            if not registered or failure is not None or self._stop.is_set(): self._backend.clear()
            if restore_owned and quit_requested and not original_closed:
                try: original_closed = self._backend.original_closed(proof)
                except Exception: pass
            safe_to_restore = session is None or not session.launched or session.status.get("runtimeCleanupComplete") is True
            if restore_owned and original_closed and safe_to_restore:
                self._publish(phase="cleanup", cleanupPending=True, message="正在恢复原微信…", can_continue=False)
                try: restored = self._backend.restore_original()
                except Exception: restored = False
                cleanup = cleanup and restored
            else: restored = not (restore_owned and original_closed)
            if failure is not None or not cleanup:
                self._publish(active=False, phase="cancelled" if failure == "CANCELLED" and cleanup else "failed",
                    ready=False, workerReady=False, cleanupPending=not cleanup, originalRestored=restored,
                    can_continue=cleanup and failure in {"CANCELLED", "MAC_ORIGINAL_ACCOUNT_NOT_READY", "MAC_WECHAT_MUST_CLOSE"},
                    continue_action="start-fresh-attempt" if cleanup else "", error_code=failure if cleanup else "SETUP_CLEANUP_PENDING",
                    message="设置已停止，可以稍后继续。" if failure == "CANCELLED" and cleanup else "本机实验设置未完成，请核对微信窗口后重试。")
            elif prepared_only_done:
                self._publish(active=False, phase="idle", message="检查完成，继续后开始本机设置。", can_continue=True,
                              continue_action="start-fresh-attempt", cleanupPending=False)

    def close(self):
        self._closed = True; self._stop.set(); self._wake.set()
        thread = self._thread
        if thread is not None and thread is not threading.current_thread(): thread.join(timeout=60)
        self._backend.clear()
        if thread is not None and thread.is_alive():
            self._publish(phase="cleanup", cleanupPending=True, ready=False, workerReady=False)
            return False
        self._publish(active=False, phase="closed", ready=False, workerReady=False, can_continue=False)
        return not self.snapshot()["cleanupPending"]


def create_setup_controller(*, enabled=False, on_change=None):
    return ExperimentalMacSetupController(enabled=enabled, on_change=on_change)
