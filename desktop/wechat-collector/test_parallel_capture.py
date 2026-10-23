"""Real subprocess lanes with invented records, no WeChat or network access."""
import hashlib
import multiprocessing as mp
import os
import sys
import threading
import time
import unittest
from unittest.mock import patch
from functools import partial
from bridge import CollectorState, BridgeError
from pairing import WEB_ORIGIN


def synthetic_parallel_capture(conn, request):
    conn.send({"type": "progress", "progress": 20, "message": "synthetic lane started"})
    # Both lanes remain live so tests can inspect/cancel them independently.
    for _ in range(25):
        time.sleep(.04)
        conn.send({"type": "progress", "progress": 40, "message": "synthetic lane working"})
    conn.send({"type": "result", "result": {"kind": request["kind"],
               "records": [{"text": "synthetic"}], "pid": os.getpid()}})
    conn.close()


def synthetic_guarded_capture(conn, request, *, entered, release, gate, verify_ok=False,
                              crash=False, recovery_guard=None):
    if request.get("mode") == "background":
        return synthetic_parallel_capture(conn, request)
    from types import SimpleNamespace
    from qt_accessibility_recovery import bind_transaction_guard, _recover
    class Memory:
        def validate(self, plan): pass
        def same_window(self): return True
        def read(self, rva, count): return bytes([gate.value])
        def write(self, rva, value): gate.value = value[0]
    def verify():
        entered.set()
        if crash:
            os._exit(0)  # Synthetic abandoned-lock regression; no real memory.
        release.wait(8)
        return verify_ok
    bind_transaction_guard(recovery_guard)
    conn.send({"type": "progress", "progress": 1, "message": "synthetic guarded verification"})
    _recover(Memory(), SimpleNamespace(gate_rva=0), verify)
    time.sleep(8)  # Parent cancellation/timeout must end this synthetic worker.


@unittest.skipUnless(sys.platform == "win32", "Windows foreground/background overlap")
class ParallelCaptureTests(unittest.TestCase):
    def setUp(self):
        # Synthetic lane tests must never inspect or focus the user's windows.
        self.browser = patch("browser_return.capture_browser_window", return_value=None)
        self.browser.start()
        self.addCleanup(self.browser.stop)
        self.state = CollectorState(health_provider=lambda: {"capabilities": {
            "backgroundChat": True, "backgroundVoice": True}}, capture_target=synthetic_parallel_capture)
        self.state.pair(WEB_ORIGIN, self.state.code)
        self.base = {"friend": "Synthetic", "contactId": "synthetic-contact",
                     "accountKey": hashlib.sha256(b"synthetic-account").hexdigest(), "limit": 20}

    def tearDown(self):
        self.state.cancel_active()

    def voice(self, **changes):
        return self.state.start({**self.base, "kind": "chat", "mode": "background",
                                "includeVoice": True, "voiceOnly": True,
                                "voiceIds": [{"messageShard": "message_0.db", "messageId": "1"}],
                                **changes})["jobId"]

    def moments(self, **changes):
        return self.state.start({**self.base, "kind": "moments", "allVisible": True, **changes})["jobId"]

    def wait(self, job_id):
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline:
            job = self.state.get(job_id)
            if job["status"] != "running":
                return job
            time.sleep(.02)
        self.fail("synthetic lane did not finish")

    def test_same_contact_voice_and_moments_run_together_and_keep_worker(self):
        voice = self.voice()
        self.assertIn("可以继续使用电脑", self.state.local_message)
        worker = self.state._voice_worker
        moments = self.moments()
        self.assertIn("暂时不要操作微信", self.state.local_message)
        self.assertIs(self.state._voice_worker, worker)
        self.assertEqual(self.state.get(voice)["status"], "running")
        self.assertEqual(self.state.get(moments)["status"], "running")
        self.assertNotEqual(self.state.jobs[voice]["process"].pid, self.state.jobs[moments]["process"].pid)
        for job_id in (voice, moments):
            self.assertEqual(self.wait(job_id)["status"], "completed")
            self.assertNotIn("_identity", self.state.get(job_id))
        self.assertTrue(self.state.health()["capabilities"]["parallelMediaMoments"])

    def test_cancel_moments_does_not_stop_voice_or_clear_busy(self):
        voice, moments = self.voice(), self.moments()
        self.state.cancel(moments)
        self.assertEqual(self.state.active, voice)
        self.assertIn("可以继续使用电脑", self.state.local_message)
        self.assertEqual(self.wait(voice)["status"], "completed")

    def test_cancel_voice_does_not_stop_moments(self):
        moments, voice = self.moments(), self.voice()
        self.assertIn("暂时不要操作微信", self.state.local_message)
        self.state.cancel(voice)
        self.assertEqual(self.state.active, moments)
        self.assertIn("暂时不要操作微信", self.state.local_message)
        self.assertEqual(self.wait(moments)["status"], "completed")

    def test_different_contact_or_duplicate_lane_is_rejected(self):
        self.voice()
        for start in (lambda: self.voice(), lambda: self.moments(contactId="other"),
                      lambda: self.moments(accountKey=hashlib.sha256(b"other").hexdigest())):
            with self.assertRaises(BridgeError) as error:
                start()
            self.assertEqual(error.exception.code, "CAPTURE_BUSY")

    def test_rotating_session_cancels_both_lanes(self):
        voice, moments = self.voice(), self.moments()
        processes = [self.state.jobs[key]["process"] for key in (voice, moments)]
        self.state.rotate()
        self.assertFalse(any(process.is_alive() for process in processes))
        self.assertIsNone(self.state.active)
        self.assertEqual(self.state.jobs, {})

    def test_voice_result_waits_for_cleanup_before_next_batch_can_reuse_worker(self):
        entered, release = threading.Event(), threading.Event()
        finish = self.state._finish_job
        def blocked_finish(job_id, pipe):
            entered.set()
            release.wait(5)
            return finish(job_id, pipe)
        self.state._finish_job = blocked_finish
        try:
            first = self.voice()
            self.assertTrue(entered.wait(5), "synthetic result never reached cleanup")
            self.assertEqual(self.state.jobs[first]["status"], "completed")
            public = self.state.get(first)
            self.assertEqual(public["status"], "running")
            self.assertNotIn("result", public)
            self.assertNotIn("_settled", public)
            self.assertEqual(self.state.active, first)
            with self.assertRaises(BridgeError) as error:
                self.voice()
            self.assertEqual(error.exception.code, "CAPTURE_BUSY")
            # Even a delayed cleanup may not lose the process reference to TTL.
            self.state.jobs[first]["updated"] -= 3600
            self.state._prune()
            self.assertIn(first, self.state.jobs)
        finally:
            release.set()
        # Refresh the synthetic timestamp before public polling prunes a result.
        self.state.jobs[first]["updated"] = time.monotonic()
        a = self.wait(first)
        b = self.wait(self.voice())
        self.assertEqual(a["status"], "completed")
        self.assertEqual(b["status"], "completed")
        self.assertEqual(a["result"]["pid"], b["result"]["pid"])

    def test_moments_terminal_state_waits_until_browser_return_finishes(self):
        entered, release = threading.Event(), threading.Event()
        def blocked_return(target):
            self.assertEqual(target, (123, 456))
            entered.set()
            release.wait(5)
            return True
        with patch("browser_return.capture_browser_window", return_value=(123, 456)), \
             patch("browser_return.return_to_browser", side_effect=blocked_return):
            try:
                moments = self.moments()
                self.assertTrue(entered.wait(5))
                self.assertEqual(self.state.get(moments)["status"], "running")
                self.assertEqual(self.state.active, moments)
                self.assertIn("暂时不要操作微信", self.state.local_message)
                with self.assertRaises(BridgeError) as error:
                    self.moments()
                self.assertEqual(error.exception.code, "CAPTURE_BUSY")
                voice = self.voice()  # Independent background lane remains usable.
                self.assertIn("暂时不要操作微信", self.state.local_message)
            finally:
                release.set()
            self.assertEqual(self.wait(moments)["status"], "completed")
            self.assertEqual(self.wait(voice)["status"], "completed")

    def test_rotating_during_voice_cleanup_cancels_the_unsettled_process(self):
        entered, release, finished = threading.Event(), threading.Event(), threading.Event()
        finish = self.state._finish_job
        def blocked_finish(job_id, pipe):
            entered.set()
            release.wait(5)
            try:
                return finish(job_id, pipe)
            finally:
                finished.set()
        self.state._finish_job = blocked_finish
        try:
            voice = self.voice()
            process = self.state.jobs[voice]["process"]
            self.assertTrue(entered.wait(5))
            self.assertTrue(process.is_alive())
            self.state.rotate()
            self.assertFalse(process.is_alive())
            self.assertIsNone(self.state.active)
            self.assertEqual(self.state.jobs, {})
        finally:
            release.set()
        self.assertTrue(finished.wait(5))

    def test_finished_moments_keeps_warning_until_settled_then_background_hint(self):
        # Isolate the finishing-state transition independently of OS scheduling.
        moments = {"status": "completed", "mode": "ui", "_settled": False}
        voice = {"status": "running", "mode": "background", "_settled": False}
        self.state.jobs = {"moments": moments, "voice": voice}
        try:
            self.state._refresh_active()
            self.assertIn("暂时不要操作微信", self.state.local_message)
            moments["_settled"] = True
            self.state._refresh_active()
            self.assertEqual(self.state.active, "voice")
            self.assertIn("可以继续使用电脑", self.state.local_message)
        finally:
            self.state.jobs.clear()  # These are state fixtures, not subprocesses.
            self.state._refresh_active()

    def guarded_fixture(self, **options):
        ctx = mp.get_context("spawn")
        entered, release, gate = ctx.Event(), ctx.Event(), ctx.Value("B", 0)
        self.state.capture_target = partial(synthetic_guarded_capture, entered=entered,
                                            release=release, gate=gate, **options)
        # Exercise the exact default-Moments wrapper with a synthetic target.
        self.state._default_capture_target = True
        self.addCleanup(release.set)
        return entered, release, gate

    def test_queued_cancel_waits_for_rollback_without_blocking_voice_lane(self):
        entered, release, gate = self.guarded_fixture()
        moments = self.moments()
        self.assertTrue(entered.wait(5))
        self.assertEqual(gate.value, 1)
        voice = self.voice()
        began = time.monotonic()
        cancelled = self.state.cancel(moments)
        self.assertLess(time.monotonic() - began, .3)
        self.assertEqual(cancelled["status"], "running")
        self.assertTrue(cancelled["cancelRequested"])
        self.assertTrue(self.state.jobs[moments]["process"].is_alive())
        self.assertEqual(self.wait(voice)["status"], "completed")
        self.assertEqual(gate.value, 1, "verification remains held while voice finishes")
        release.set()
        self.assertEqual(self.wait(moments)["status"], "cancelled")
        self.assertEqual(gate.value, 0, "rollback must precede termination")
        self.assertIsNone(self.state.active)

    def test_queued_cancel_after_verified_commit_needs_no_second_request(self):
        entered, release, gate = self.guarded_fixture(verify_ok=True)
        moments = self.moments()
        self.assertTrue(entered.wait(5))
        self.assertTrue(self.state.cancel(moments)["cancelRequested"])
        release.set()
        self.assertEqual(self.wait(moments)["status"], "cancelled")
        self.assertEqual(gate.value, 1, "successful activation is committed before stopping")

    def test_timeout_cleanup_defers_termination_until_guard_releases(self):
        entered, release, gate = self.guarded_fixture()
        with patch("bridge.MOMENTS_IDLE_TIMEOUT", .25):
            moments = self.moments()
            self.assertTrue(entered.wait(5))
            deadline = time.monotonic() + 3
            while self.state.jobs[moments]["status"] == "running" and time.monotonic() < deadline:
                time.sleep(.02)
            self.assertEqual(self.state.jobs[moments]["status"], "failed")
            self.assertFalse(self.state.jobs[moments]["_settled"])
            self.assertEqual(self.state.get(moments)["status"], "running")
            self.assertTrue(self.state.jobs[moments]["process"].is_alive())
            release.set()
            self.assertEqual(self.wait(moments)["status"], "failed")
            self.assertEqual(gate.value, 0)

    def test_exited_child_with_abandoned_guard_can_be_cleaned_up(self):
        entered, release, gate = self.guarded_fixture(crash=True)
        moments = self.moments()
        self.assertTrue(entered.wait(5))
        self.assertEqual(self.wait(moments)["status"], "failed")
        self.assertIsNone(self.state.active)
        self.assertFalse(self.state.jobs[moments]["process"].is_alive())


if __name__ == "__main__":
    unittest.main()
