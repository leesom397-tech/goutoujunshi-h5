"""Synthetic setup ownership, cancellation and cold-worker readiness contracts."""
from pathlib import Path
import json
import threading
import time
import unittest

from background_reader import BackgroundCaptureError
from macos_candidate_setup_controller import ExperimentalMacSetupController, SetupError


class Resource:
    def __init__(self): self.closed = False
    def close(self): self.closed = True


class Session(Resource):
    def __init__(self, backend, progress, cancelled):
        super().__init__()
        self.backend, self.progress, self.cancelled = backend, progress, cancelled
        self.launched = False
        self.status = {}
    def __enter__(self):
        self.launched = True
        self.backend.session_entered.set()
        self.progress({"phase": "waiting-for-user", "message": "PRIVATE PATH"})
        try:
            while self.backend.wait_auth and not self.cancelled(): time.sleep(.005)
            if self.cancelled(): raise SetupError("CANCELLED")
            return self
        except BaseException:
            self.close()
            raise
    def close(self):
        if self.closed: return
        super().close()
        self.backend.session_close_thread = threading.get_ident()
        self.status.update(runtimeCleanupComplete=not self.backend.cleanup_fails,
                           originalRestored=not self.backend.cleanup_fails)
        if not self.backend.cleanup_fails: self.backend.closed = False
    def __exit__(self, *error): self.close()


class Backend:
    def __init__(self):
        self.calls = []
        self.account, self.salt = Path("synthetic-owner"), b"s"*16
        self.closed = self.registered = self.wait_auth = self.cleanup_fails = False
        self.worker_ok = self.valid = True
        self.account_pending = self.change_account = False
        self.session_entered, self.clear_entered, self.clear_release = threading.Event(), threading.Event(), threading.Event()
        self.block_clear = False
        self.restore_count = self.clear_count = 0
        self.session_close_thread = None
    def preflight(self): self.calls.append("preflight")
    def original_proof(self, **kwargs):
        self.calls.append("proof")
        if self.account_pending and self.session_entered.is_set():
            raise BackgroundCaptureError("WECHAT_NOT_LOGGED_IN", "synthetic")
        return {"account": Path("other-owner") if self.change_account and self.session_entered.is_set() else self.account}
    def contact_salt(self, proof): return self.salt
    def prepare_candidate(self, receipt): self.calls.append("prepare-candidate"); return Path("synthetic-receipt")
    def original_closed(self, proof): return self.closed
    def request_normal_quit(self, proof): self.calls.append("normal-quit"); self.closed = True; return "requested"
    def restore_original(self): self.restore_count += 1; self.closed = False; return True
    def session(self, receipt, progress, cancel):
        self.session_value = Session(self, progress, cancel); return self.session_value
    def capture_grant(self, session):
        grant = Resource(); grant._account, grant._salt = self.account, self.salt
        grant._handoff_expires = time.monotonic()+60
        self.grant = grant
        return grant
    def rebind(self, grant): self.calls.append("rebind"); self.lease = Resource(); return self.lease
    def register(self, lease): self.calls.append("register"); self.registered = True
    def worker_check(self, cancelled): self.calls.append("worker-check"); return self.worker_ok
    def readiness(self): return self.valid and self.registered
    def clear(self):
        self.clear_count += 1
        if self.block_clear and self.registered:
            self.clear_entered.set(); self.clear_release.wait(5)
        self.registered = False


class SetupControllerTests(unittest.TestCase):
    def controller(self, backend=None, **kwargs):
        backend = backend or Backend()
        controller = ExperimentalMacSetupController(enabled=True, _backend=backend, **kwargs)
        self.addCleanup(backend.clear_release.set)
        self.addCleanup(controller.close)
        return controller, backend
    def wait(self, controller, predicate, timeout=5):
        deadline = time.monotonic()+timeout
        while time.monotonic()<deadline:
            value = controller.snapshot()
            if predicate(value): return value
            time.sleep(.005)
        self.fail("setup did not reach expected public state: "+repr(controller.snapshot()))
    def settled(self, controller):
        self.wait(controller, lambda view: not view["active"])
        controller._thread.join(2)
        self.assertFalse(controller._thread.is_alive())
        return controller.snapshot()

    def test_default_disabled_and_consent_do_not_probe_or_prepare(self):
        backend = Backend(); controller = ExperimentalMacSetupController(_backend=backend)
        self.assertEqual(controller.snapshot()["jobId"], "")
        with self.assertRaisesRegex(SetupError, "SETUP_UNAVAILABLE"): controller.start(consent=True)
        controller.enabled = True
        with self.assertRaisesRegex(SetupError, "MAC_LOCAL_CONSENT_REQUIRED"): controller.start(consent=1)
        self.assertEqual(backend.calls, [])
        self.assertTrue(controller.close())

    def test_prepare_is_readonly_and_continuation_requires_new_attempt(self):
        controller, backend = self.controller()
        first = controller.prepare(consent=True); state = self.settled(controller)
        self.assertEqual(backend.calls, ["preflight", "proof"])
        self.assertTrue(state["can_continue"])
        controller.continue_setup(first["jobId"])
        ready = self.wait(controller, lambda view: view["ready"])
        self.assertEqual(ready["attempt"], 2)
        self.assertIn("normal-quit", backend.calls)
        self.assertFalse(ready["realDeviceValidated"])

    def test_ready_requires_original_rebind_and_worker_proof(self):
        controller, backend = self.controller()
        controller.start(consent=True)
        ready = self.wait(controller, lambda view: view["ready"])
        self.assertTrue(ready["workerReady"] and ready["originalRestored"])
        self.assertEqual(backend.calls[-3:], ["rebind", "register", "worker-check"])
        self.assertTrue(backend.grant.closed is False)  # Owned until final cleanup.
        self.assertNotIn("PRIVATE PATH", json.dumps(ready))

    def test_cancel_waiting_auth_is_owned_by_worker_and_restores_once(self):
        controller, backend = self.controller(); backend.wait_auth = True
        job = controller.start(consent=True)
        self.assertTrue(backend.session_entered.wait(2))
        self.wait(controller, lambda view: view["phase"]=="waiting-for-user")
        caller = threading.get_ident(); controller.cancel(job["jobId"])
        state = self.settled(controller)
        self.assertEqual(state["phase"], "cancelled")
        self.assertNotEqual(backend.session_close_thread, caller)
        self.assertTrue(state["originalRestored"])
        self.assertEqual(backend.restore_count, 0)
        self.assertFalse(backend.registered or state["ready"])

    def test_continue_during_auth_does_not_create_attempt_or_renew_deadline(self):
        controller, backend = self.controller(); backend.wait_auth = True
        job = controller.start(consent=True)
        self.wait(controller, lambda view: view["phase"]=="waiting-for-user")
        value = controller.continue_setup(job["jobId"])
        self.assertEqual(value["attempt"], 1)
        self.assertEqual(backend.calls.count("prepare-candidate"), 1)
        controller.cancel(job["jobId"]); self.settled(controller)

    def test_original_account_pending_is_not_ready_and_cancellable(self):
        controller, backend = self.controller(); backend.account_pending = True
        job = controller.start(consent=True)
        self.wait(controller, lambda view: view["phase"]=="waiting-for-original-account")
        self.assertNotIn("register", backend.calls)
        controller.cancel(job["jobId"]); self.settled(controller)
        self.assertEqual(backend.restore_count, 0)

    def test_account_change_and_worker_failure_never_report_ready(self):
        for account_changed in (False, True):
            with self.subTest(account_changed=account_changed):
                backend = Backend(); backend.change_account = account_changed; backend.worker_ok = False
                controller, _ = self.controller(backend)
                controller.start(consent=True); state = self.settled(controller)
                self.assertFalse(state["ready"] or backend.registered)
                self.assertEqual(state["error_code"], "ACCOUNT_CHANGED" if account_changed else "MAC_EXPERIMENTAL_WORKER_UNAVAILABLE")
                controller.close()

    def test_failed_candidate_cleanup_does_not_launch_original_concurrently(self):
        controller, backend = self.controller(); backend.wait_auth = True; backend.cleanup_fails = True
        job = controller.start(consent=True); self.assertTrue(backend.session_entered.wait(2))
        controller.cancel(job["jobId"]); state = self.settled(controller)
        self.assertTrue(state["cleanupPending"])
        self.assertEqual(state["error_code"], "SETUP_CLEANUP_PENDING")
        self.assertEqual(backend.restore_count, 0)
        self.assertFalse(controller.close())

    def test_ready_cancel_blocks_retry_until_previous_monitor_settled(self):
        controller, backend = self.controller(); backend.block_clear = True
        job = controller.start(consent=True); self.wait(controller, lambda view: view["ready"])
        controller.cancel(job["jobId"])
        self.assertTrue(backend.clear_entered.wait(2))
        state = controller.start(consent=True)
        self.assertEqual(state["attempt"], 1)
        self.assertTrue(state["cleanupPending"] and state["active"])
        with self.assertRaisesRegex(SetupError, "SETUP_CONTINUATION_UNAVAILABLE"): controller.continue_setup(job["jobId"])
        backend.clear_release.set(); self.settled(controller)
        backend.block_clear = False
        controller.continue_setup(job["jobId"])
        value = self.wait(controller, lambda view: view["ready"])
        self.assertEqual(value["attempt"], 2)
        self.assertTrue(backend.registered)

    def test_user_quits_original_after_ready_revokes_without_reopening(self):
        controller, backend = self.controller()
        controller.start(consent=True); self.wait(controller, lambda view: view["ready"])
        backend.closed = True; backend.valid = False
        state = self.settled(controller)
        self.assertEqual(state["error_code"], "ACCOUNT_CHANGED")
        self.assertFalse(state["ready"] or backend.registered)
        self.assertEqual(backend.restore_count, 0)
        self.assertTrue(backend.closed)

    def test_stale_jobs_and_private_errors_are_rejected_without_leak(self):
        events = []; controller, backend = self.controller(on_change=events.append)
        backend.preflight = lambda: (_ for _ in ()).throw(RuntimeError("PRIVATE PATH"))
        controller.start(consent=True); state = self.settled(controller)
        self.assertEqual(state["error_code"], "SETUP_FAILED")
        self.assertNotIn("PRIVATE PATH", json.dumps(events))
        with self.assertRaisesRegex(SetupError, "SETUP_JOB_STALE"): controller.cancel("unrelated")


if __name__ == "__main__": unittest.main()
