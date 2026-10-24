"""Real local stdio/HTTP transport with synthetic async setup facts only."""
import json
import socket
import threading
import unittest
from unittest.mock import Mock, patch

import desktop_service as service
from bridge import CollectorState, BridgeError
from test_desktop_service import InputPipe, OutputPipe


class SetupController:
    def __init__(self, *, enabled, on_change):
        assert enabled is True
        self.changed = on_change
        self.value = {"jobId": "", "attempt": 0, "revision": 0, "phase": "idle", "active": False,
            "message": "PRIVATE controller text", "can_continue": False, "error_code": "", "cleanupPending": False,
            "ready": False, "experimental": True, "realDeviceValidated": False}
        self.starts = self.continues = self.cancels = self.closes = 0
        self.close_ok = True

    def snapshot(self):
        return dict(self.value)

    def publish(self, **fields):
        self.value.update(fields)
        self.value["revision"] += 1
        self.changed(self.snapshot())
        return self.snapshot()

    def start(self, *, consent):
        assert consent is True
        self.starts += 1
        return self.publish(jobId="synthetic-setup-job", attempt=self.value["attempt"] + 1,
            phase="waiting-for-user", active=True, can_continue=True)

    prepare = start

    def continue_setup(self, job):
        if job != self.value["jobId"]:
            raise ValueError("PRIVATE stale job")
        self.continues += 1
        return self.publish(phase="checking-account", can_continue=False)

    def cancel(self, job):
        if job != self.value["jobId"]:
            raise ValueError("PRIVATE stale job")
        self.cancels += 1
        return self.publish(phase="cancelling", cleanupPending=True, active=True, can_continue=False)

    def close(self):
        self.closes += 1
        if self.close_ok:
            self.publish(phase="closed", active=False, cleanupPending=False, can_continue=False, ready=False)
        return self.close_ok


class SetupServiceTests(unittest.TestCase):
    def start(self, *, platform="darwin", enabled=True):
        self.incoming, self.outgoing = InputPipe(), OutputPipe()
        self.capture = Mock(side_effect=AssertionError("must not capture"))
        self.health = Mock(side_effect=AssertionError("must not probe"))
        self.state = CollectorState(health_provider=self.health, capture_target=self.capture)
        self.controller = None
        def factory(**kwargs):
            self.controller = SetupController(**kwargs)
            return self.controller
        self.factory = Mock(side_effect=factory)
        self.result = []
        self.platform = patch.object(service.sys, "platform", platform)
        self.platform.start()
        self.addCleanup(self.platform.stop)
        self.cleanup = patch("platform_runtime.clear_worker_authorization")
        self.cleanup.start()
        self.addCleanup(self.cleanup.stop)
        self.thread = threading.Thread(target=lambda: self.result.append(service.run_service(self.incoming, self.outgoing,
            port=0, state_factory=lambda: self.state, setup_factory=self.factory, experimental_setup=enabled)), daemon=True)
        self.thread.start()
        self.addCleanup(self.finish)
        self.ready = self.outgoing.receive()
        self.assertEqual(self.ready["event"], "ready")

    def finish(self):
        self.incoming.lines.put("")
        self.thread.join(timeout=4)
        self.assertFalse(self.thread.is_alive())

    def send(self, command, *, consent=None, job=None, request_id="reply"):
        request = {"id": request_id, "command": command}
        if consent is not None: request["consent"] = consent
        if job is not None: request["jobId"] = job
        self.incoming.lines.put(json.dumps(request) + "\n")
        while True:
            value = self.outgoing.receive()
            if value.get("id") == request_id:
                return value

    def test_default_off_and_windows_ignore_even_requested_experimental_factory(self):
        self.start(platform="win32", enabled=True)
        self.assertFalse(self.ready["setupAvailable"])
        self.assertFalse(self.send("status")["sourceReady"])
        self.assertEqual(self.send("setup", consent=True)["error"]["code"], "SETUP_UNAVAILABLE")
        self.factory.assert_not_called()

    def test_mac_without_explicit_enable_never_constructs_controller(self):
        self.start(enabled=False)
        self.factory.assert_not_called()
        self.assertEqual(self.send("setup", consent=True)["error"]["code"], "SETUP_UNAVAILABLE")
        self.health.assert_not_called()

    def test_enabled_start_immediately_returns_real_stage_with_local_consent_only(self):
        self.start()
        self.assertTrue(self.ready["serviceReady"])
        self.assertFalse(self.ready["sourceReady"])
        self.assertEqual(self.send("setup")["error"]["code"], "SETUP_LOCAL_CONSENT_REQUIRED")
        self.assertEqual(self.controller.starts, 0)
        response = self.send("setup", consent=True)
        self.assertTrue(response["ok"])
        self.assertEqual(response["setup"]["phase"], "waiting-for-user")
        self.assertTrue(response["setup"]["can_continue"])
        self.assertFalse(response["sourceReady"] or response["setup"]["realDeviceValidated"])
        self.assertNotIn("PRIVATE", json.dumps(response))
        self.capture.assert_not_called()
        self.health.assert_not_called()

    def test_status_continue_cancel_and_cleanup_have_distinct_immediate_contracts(self):
        self.start()
        response = self.send("setup", consent=True)
        job = response["setup"]["jobId"]
        status = self.send("status")
        self.assertTrue(status["busy"])
        self.assertFalse(status["sourceReady"])
        continued = self.send("setup-continue", job=job)
        self.assertEqual(continued["setup"]["phase"], "checking-account")
        cancelled = self.send("setup-cancel", job=job)
        self.assertEqual(cancelled["setup"]["phase"], "cancelling")
        self.assertTrue(cancelled["setup"]["cleanupPending"])
        self.assertFalse(cancelled["setup"]["ready"])
        self.assertEqual(self.send("setup-continue", job="old-job")["error"]["code"], "SETUP_ACTION_FAILED")
        self.incoming.send("shutdown", "stop")
        while self.outgoing.receive().get("id") != "stop":
            pass
        self.thread.join(timeout=3)
        self.assertEqual(self.result, [0])
        self.assertEqual(self.controller.closes, 1)

    def test_controller_close_failure_never_reports_clean_shutdown(self):
        self.start()
        self.send("setup", consent=True)
        self.controller.close_ok = False
        self.incoming.send("shutdown", "stop")
        failure = final = None
        while final is None:
            value = self.outgoing.receive()
            if value.get("event") == "error": failure = value
            if value.get("id") == "stop": final = value
        self.assertEqual(failure["error"]["code"], "SETUP_CLEANUP_PENDING")
        self.assertFalse(final["ok"])
        self.thread.join(timeout=3)
        self.assertEqual(self.result, [1])

    def test_http_listener_is_closed_before_waiting_for_controller_cleanup(self):
        self.start()
        closing, release = threading.Event(), threading.Event()
        close = self.controller.close
        def blocked_close():
            closing.set()
            release.wait(3)
            return close()
        self.controller.close = blocked_close
        self.incoming.lines.put("")
        try:
            self.assertTrue(closing.wait(2))
            with self.assertRaises(OSError):
                socket.create_connection(("127.0.0.1", self.ready["port"]), timeout=.2)
        finally:
            release.set()
        self.thread.join(timeout=3)
        self.assertEqual(self.result, [0])

    def test_cached_setup_blocks_http_capture_and_search_without_source_queries(self):
        self.start()
        self.send("setup", consent=True)
        with self.assertRaises(BridgeError) as caught:
            self.state.search_contacts("synthetic")
        self.assertEqual(caught.exception.code, "SETUP_IN_PROGRESS")
        with self.assertRaises(BridgeError) as caught:
            self.state.start({"kind": "chat", "friend": "synthetic", "limit": 1})
        self.assertEqual(caught.exception.code, "SETUP_IN_PROGRESS")
        self.capture.assert_not_called()
        self.health.assert_not_called()

    def test_stage_filter_rejects_private_fields_and_stale_progress(self):
        self.start()
        self.send("setup", consent=True)
        self.controller.publish(message="PRIVATE /account/key", account="PRIVATE", phase="waiting-for-original-account")
        response = self.send("setup-status")
        self.assertEqual(response["setup"]["message"], service.SETUP_MESSAGES["waiting-for-original-account"])
        self.assertNotIn("PRIVATE", json.dumps(response))
        self.controller.changed({**self.controller.snapshot(), "attempt": 0, "revision": 0, "phase": "ready", "ready": True})
        self.assertFalse(self.send("status")["sourceReady"])

    def test_snapshot_new_attempt_beats_previous_higher_revision_without_callback(self):
        self.start()
        self.controller.publish(attempt=1, revision=30, phase="ready", ready=True)
        self.assertTrue(self.send("status")["sourceReady"])
        self.controller.value.update(attempt=2, revision=1, phase="waiting-for-user", active=True, ready=False)
        status = self.send("status")
        self.assertEqual(status["setup"]["attempt"], 2)
        self.assertFalse(status["sourceReady"])
        self.assertTrue(status["busy"])

    def test_setup_start_and_continue_hold_capture_lock_through_active_publication(self):
        self.start()
        original = self.controller.start
        observations = []
        def start(**kwargs):
            observations.append(self.state.lock._is_owned())
            result = original(**kwargs)
            observations.append(self.state.setup_in_progress())
            return result
        self.controller.start = start
        job = self.send("setup", consent=True)["setup"]["jobId"]
        original_continue = self.controller.continue_setup
        def continuation(job):
            observations.append(self.state.lock._is_owned())
            return original_continue(job)
        self.controller.continue_setup = continuation
        self.send("setup-continue", job=job)
        self.assertEqual(observations, [True, True, True])
        with self.state.lock:
            self.state.active = "synthetic-capture"
        self.assertEqual(self.send("setup", consent=True)["error"]["code"], "CAPTURE_BUSY")
        self.assertEqual(self.controller.starts, 1)
        with self.state.lock:
            self.state.active = None

    def test_source_ready_requires_completed_non_cleanup_controller_proof(self):
        self.start()
        self.send("setup", consent=True)
        self.controller.publish(phase="ready", ready=True, active=True, cleanupPending=False)
        self.assertFalse(self.send("status")["sourceReady"])
        self.controller.publish(phase="ready", ready=True, active=False, cleanupPending=False)
        result = self.send("status")
        self.assertTrue(result["sourceReady"])
        self.assertTrue(result["experimental"])
        self.assertFalse(result["setup"]["realDeviceValidated"])


if __name__ == "__main__":
    unittest.main()
