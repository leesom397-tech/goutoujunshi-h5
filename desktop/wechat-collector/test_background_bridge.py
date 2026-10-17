"""Synthetic bridge tests: no desktop access, key discovery or user records."""
import time
import unittest
from unittest.mock import patch
from types import SimpleNamespace
from bridge import CollectorState, BridgeError, _capture_process


def fake_background(conn, request):
    conn.send({"type": "partial", "partial": {
        "version": 1, "kind": "chat", "account": "synthetic", "friend": request["friend"],
        "capturedAt": "2026-10-15T00:00:00Z", "records": [], "warnings": []}})
    conn.send({"type": "progress", "progress": 25, "message": "合成后台任务"})
    time.sleep(.5)
    conn.send({"type": "result", "result": {"mode": request["mode"], "includeVoice": request["includeVoice"]}})
    conn.close()


def fake_incompatible_background(conn, request):
    from background_reader import BackgroundCaptureError
    provider = SimpleNamespace(open_authorized_source=lambda: None)
    with patch.object(provider, "open_authorized_source", side_effect=BackgroundCaptureError(
            "DATABASE_KEY_UNAVAILABLE", "合成本地数据库不兼容，未导入。")), \
         patch("background_reader._provider_module", return_value=provider):
        _capture_process(conn, request)


def fake_exits_without_message(conn, request):
    # Simulate a frozen-runtime/provider crash before the child can send an
    # error.  The monitor must surface this immediately instead of waiting for
    # the 20-minute background timeout.
    return


class BackgroundBridgeTest(unittest.TestCase):
    def test_component_health_never_inspects_private_account_or_data(self):
        with patch("compatibility.compatibility_probe", return_value={
                "ready": False, "message": "synthetic UI unavailable", "capabilities": {"chat": False}}), \
             patch("local_database_source.os.name", "nt"), \
             patch("local_database_source.importlib.util.find_spec", return_value=object()), \
             patch("local_database_source._running_processes", side_effect=AssertionError("private process lookup")), \
             patch("local_database_source._primitives", side_effect=AssertionError("private key lookup")), \
             patch("local_voice_transcriber.probe_transcriber", return_value={"dependenciesReady": True, "modelReady": True}), \
             patch("bridge.mp.get_context", side_effect=AssertionError("capture process must not start")):
            state = CollectorState()
            health = state.health()
            self.assertTrue(health["backgroundModelReady"])
            self.assertTrue(health["capabilities"]["backgroundChat"])
            self.assertTrue(health["capabilities"]["backgroundVoice"])
            self.assertEqual(health["backgroundMaxRows"], 1000)
            self.assertEqual(health["backgroundStatus"], "components-ready")
            self.assertIn("导入时", health["message"])
            self.assertIn("核对", health["backgroundMessage"])
            self.assertIsNone(state.active)

    def test_task_rejects_incompatible_source_even_when_components_ready(self):
        state = self.state()
        state.capture_target = fake_incompatible_background
        try:
            job_id = state.start({"kind": "chat", "friend": "合成联系人", "limit": 10,
                                  "mode": "background"})["jobId"]
            job = self.wait(state, job_id, "failed")
            self.assertEqual(job["error"]["code"], "DATABASE_KEY_UNAVAILABLE")
            self.assertEqual(job["partialRevision"], 0)
            self.assertNotIn("result", job)
        finally:
            state.cancel_active()

    def state(self, voice=True):
        return CollectorState(health_provider=lambda: {
            "ready": False, "message": "synthetic UI unavailable",
            "capabilities": {"chat": False, "backgroundChat": True, "backgroundVoice": voice}},
            capture_target=fake_background)

    def wait(self, state, job_id, status):
        limit = time.monotonic() + 8
        while time.monotonic() < limit:
            job = state.get(job_id)
            if job["status"] == status:
                return job
            time.sleep(.02)
        self.fail("synthetic job did not reach " + status)

    def test_background_works_when_ui_unavailable_and_is_explicit(self):
        state = self.state()
        try:
            with self.assertRaises(BridgeError):
                state.start({"kind": "chat", "friend": "合成联系人", "limit": 10})
            start = state.start({"kind": "chat", "friend": "合成联系人", "limit": 10, "mode": "background"})
            job = self.wait(state, start["jobId"], "completed")
            self.assertEqual(job["result"], {"mode": "background", "includeVoice": False})
            self.assertEqual(job["partialRevision"], 1)
        finally:
            state.cancel_active()

    def test_invalid_modes_and_voice_without_capability_reject(self):
        state = self.state(voice=False)
        for extra in [{"mode": "shell"}, {"mode": "background", "kind": "moments"},
                      {"mode": "background", "includeVoice": True}, {"mode": "background", "path": "C:/private"}]:
            with self.assertRaises(BridgeError):
                state.start({"kind": "chat", "friend": "合成联系人", "limit": 10, **extra})
        self.assertIsNone(state.active)

    def test_background_thousand_limit_does_not_expand_ui_or_moments(self):
        state = self.state()
        for extra in ({"mode": "background", "limit": 1001},
                      {"mode": "ui", "limit": 501},
                      {"kind": "moments", "mode": "ui", "limit": 2001}):
            with self.assertRaises(BridgeError) as error:
                state.start({"kind": "chat", "friend": "合成联系人", **extra})
            self.assertEqual(error.exception.code, "INVALID_LIMIT")
        try:
            job_id = state.start({"kind": "chat", "friend": "合成联系人", "limit": 1000,
                                  "mode": "background"})["jobId"]
            self.assertEqual(self.wait(state, job_id, "completed")["status"], "completed")
        finally:
            state.cancel_active()

    def test_cancel_preserves_partial(self):
        state = self.state()
        try:
            job_id = state.start({"kind": "chat", "friend": "合成联系人", "limit": 10, "mode": "background", "includeVoice": True})["jobId"]
            deadline = time.monotonic() + 8
            while time.monotonic() < deadline and not state.get(job_id).get("partial"):
                time.sleep(.02)
            result = state.cancel(job_id)
            self.assertEqual(result["status"], "cancelled")
            self.assertEqual(result["partialRevision"], 1)
            self.assertEqual(result["partial"]["account"], "synthetic")
        finally:
            state.cancel_active()

    def test_dead_background_child_fails_immediately(self):
        state = self.state()
        state.capture_target = fake_exits_without_message
        began = time.monotonic()
        try:
            job_id = state.start({"kind": "chat", "friend": "合成联系人", "limit": 10,
                                  "mode": "background"})["jobId"]
            job = self.wait(state, job_id, "failed")
            self.assertLess(time.monotonic() - began, 3)
            self.assertEqual(job["error"]["code"], "CAPTURE_INTERRUPTED")
            self.assertIn("进程已退出", job["message"])
        finally:
            state.cancel_active()


if __name__ == '__main__':
    unittest.main()
