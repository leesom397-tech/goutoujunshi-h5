"""Real Windows spawn + synthetic SQLite/audio only; never opens user WeChat."""
import hashlib
import os
from pathlib import Path
import sys
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from bridge import CollectorState, BridgeError
from pairing import WEB_ORIGIN

_model_loads = 0
_source_opens = 0


def synthetic_voice_capture(conn, request):
    """Use real capture orchestration and model memoization inside the child."""
    global _model_loads, _source_opens
    import local_voice_transcriber as voice
    from background_reader import capture_from_source, BackgroundCaptureError
    from test_background_reader import Source
    from test_local_voice_transcriber import FakeRecognizer, framed_voice
    marker = int(request["voiceIds"][0]["messageId"])
    if marker == 900:
        conn.send({"type": "error", "error": {"code": "SYNTHETIC_FAILURE", "message": "synthetic"}})
        conn.close()
        return
    if marker == 901:
        conn.send({"type": "partial", "partial": {"version": 1, "kind": "chat", "account": "synthetic",
                   "friend": request["friend"], "capturedAt": "2026-10-23T00:00:00Z", "records": [], "warnings": []}})
        conn.send({"type": "progress", "progress": 1, "message": "synthetic cancellation wait"})
        time.sleep(10)
    if marker == 902:
        conn.pipe.send({"type": "result", "workerJobId": "wrong-old-job", "result": {}})
        conn.close()
        return

    def create_model(**kwargs):
        global _model_loads
        _model_loads += 1
        # A controlled initialization cost; not a claimed real ASR duration.
        time.sleep(.2)
        return FakeRecognizer()
    source = Source()
    _source_opens += 1
    shard = source.shard("message_0.db")
    source.add(shard, 1, marker, mtype=34, sender=2)
    source.add_audio(marker, framed_voice())
    seals = []
    original_seal = source.assert_unchanged
    def seal():
        seals.append(True)
        original_seal()
    source.assert_unchanged = seal
    try:
        with patch.dict(sys.modules, {"sherpa_onnx": SimpleNamespace(
                OfflineRecognizer=SimpleNamespace(from_sense_voice=create_model))}), \
             patch.object(voice, "prepare_model", return_value=Path("synthetic-public-model")), \
             patch.object(voice, "_decode_silk", return_value=[1]), \
             patch.object(voice, "_read_cache", return_value=None), \
             patch.object(voice, "_write_cache"):
            result = capture_from_source(request, lambda event: conn.send({"type": "progress", "progress": 25, "message": "synthetic"}),
                lambda batch: conn.send({"type": "partial", "partial": batch}), source)
        result["synthetic"] = {"pid": os.getpid(), "loads": _model_loads, "opens": _source_opens,
                               "closed": source.closed, "seals": len(seals), "marker": marker}
        conn.send({"type": "result", "result": result})
    except BackgroundCaptureError as error:
        conn.send({"type": "error", "error": {"code": error.code, "message": str(error)}})
    finally:
        source.close()
        conn.close()


class VoiceWorkerTests(unittest.TestCase):
    def setUp(self):
        self.state = CollectorState(health_provider=lambda: {"capabilities": {
            "backgroundChat": True, "backgroundVoice": True}}, capture_target=synthetic_voice_capture)
        self.state.pair(WEB_ORIGIN, self.state.code)

    def tearDown(self):
        self.state.cancel_active()

    def request(self, marker=101, **changes):
        return {"kind": "chat", "friend": "唯一备注", "limit": 500, "mode": "background",
                "includeVoice": True, "voiceOnly": True, "contactId": "target-user",
                "accountKey": hashlib.sha256(b"test-account").hexdigest(),
                "voiceIds": [{"messageShard": "message_0.db", "messageId": str(marker)}], **changes}

    def wait(self, job_id, status="completed"):
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            job = self.state.get(job_id)
            if job["status"] == status and self.state.active is None:
                return job
            if job["status"] == "failed" and status != "failed":
                self.fail(str(job.get("error")))
            time.sleep(.01)
        self.fail("synthetic job did not finish: " + str(self.state.get(job_id)))

    def run_job(self, marker=101, **changes):
        return self.wait(self.state.start(self.request(marker, **changes))["jobId"])

    def test_two_spawn_jobs_keep_one_model_but_new_source_and_results(self):
        first = self.run_job(101)
        second = self.run_job(102)
        a, b = first["result"]["synthetic"], second["result"]["synthetic"]
        self.assertEqual(a["pid"], b["pid"])
        self.assertNotEqual(a["pid"], os.getpid(), "must be a genuine spawned child")
        self.assertEqual((a["loads"], b["loads"]), (1, 1))
        self.assertEqual((a["opens"], b["opens"]), (1, 2))
        self.assertTrue(a["closed"] and b["closed"])
        self.assertGreaterEqual(min(a["seals"], b["seals"]), 4)
        self.assertNotEqual(first["result"]["records"][0]["id"], second["result"]["records"][0]["id"])
        self.assertEqual((a["marker"], b["marker"]), (101, 102))
        self.assertEqual(first["partialRevision"], second["partialRevision"])
        self.assertNotIn("_voiceWorker", second)

    def test_failure_then_next_job_has_fresh_process_and_model(self):
        first = self.run_job()
        self.wait(self.state.start(self.request(900))["jobId"], "failed")
        self.assertIsNone(self.state._voice_worker)
        fresh = self.run_job(103)["result"]["synthetic"]
        self.assertNotEqual(first["result"]["synthetic"]["pid"], fresh["pid"])
        self.assertEqual((fresh["loads"], fresh["opens"]), (1, 1))

    def test_cancel_then_next_job_has_fresh_process(self):
        first = self.run_job()["result"]["synthetic"]
        job = self.state.start(self.request(901))["jobId"]
        deadline = time.monotonic() + 5
        while not self.state.get(job).get("partial") and time.monotonic() < deadline:
            time.sleep(.01)
        cancelled = self.state.cancel(job)
        self.assertEqual(cancelled["partialRevision"], 1)
        self.assertEqual(cancelled["partial"]["account"], "synthetic")
        self.assertIsNone(self.state._voice_worker)
        fresh = self.run_job(104)["result"]["synthetic"]
        self.assertNotEqual(first["pid"], fresh["pid"])
        self.assertEqual(fresh["opens"], 1)

    def test_idle_expiry_destroys_worker(self):
        with patch("bridge.VOICE_WORKER_IDLE_TIMEOUT", .2):
            self.run_job()
            worker = self.state._voice_worker
            deadline = time.monotonic() + 3
            while self.state._voice_worker is not None and time.monotonic() < deadline:
                time.sleep(.02)
        self.assertIsNone(self.state._voice_worker)
        with self.state.lock:  # Wait for the expiry callback's terminate/join.
            self.assertFalse(worker["process"].is_alive())

    def test_pair_rotation_destroys_idle_worker(self):
        first = self.run_job()["result"]["synthetic"]
        self.state.rotate()
        self.assertIsNone(self.state._voice_worker)
        self.state.pair(WEB_ORIGIN, self.state.code)
        self.assertNotEqual(first["pid"], self.run_job(105)["result"]["synthetic"]["pid"])

    def test_near_idle_deadline_uses_fresh_worker_even_if_still_alive(self):
        first = self.run_job()["result"]["synthetic"]
        old_worker = self.state._voice_worker
        self.assertTrue(old_worker["process"].is_alive())
        old_worker["idleDeadline"] = time.monotonic() + .5
        second = self.run_job(109)["result"]["synthetic"]
        self.assertNotEqual(first["pid"], second["pid"])
        self.assertFalse(old_worker["process"].is_alive())
        self.assertEqual(second["opens"], 1)

    def test_changed_contact_is_not_allowed_to_reuse_worker(self):
        self.run_job()
        worker = self.state._voice_worker
        job = self.state.start(self.request(106, contactId="different-user"))["jobId"]
        self.wait(job, "failed")
        self.assertFalse(worker["process"].is_alive())
        self.assertIsNone(self.state._voice_worker)

    def test_wrong_account_still_fails_live_source_validation(self):
        self.run_job()
        job = self.state.start(self.request(107, accountKey=hashlib.sha256(b"other-account").hexdigest()))["jobId"]
        failed = self.wait(job, "failed")
        self.assertNotIn("result", failed)
        self.assertIsNone(self.state._voice_worker)

    def test_timeout_discards_warm_worker(self):
        self.run_job()
        with patch("bridge.BACKGROUND_JOB_TIMEOUT", .1):
            failed = self.wait(self.state.start(self.request(901))["jobId"], "failed")
        self.assertEqual(failed["error"]["code"], "CAPTURE_TIMEOUT")
        self.assertIsNone(self.state._voice_worker)

    def test_mismatched_job_event_is_rejected_without_returning_result(self):
        self.run_job()
        failed = self.wait(self.state.start(self.request(902))["jobId"], "failed")
        self.assertEqual(failed["error"]["code"], "WORKER_JOB_MISMATCH")
        self.assertNotIn("result", failed)
        self.assertIsNone(self.state._voice_worker)

    def test_expired_session_destroys_idle_worker(self):
        from pairing import SESSION_TTL
        self.run_job()
        worker = self.state._voice_worker
        self.state.token_created -= SESSION_TTL + 1
        with self.assertRaises(BridgeError):
            self.state.authorize(WEB_ORIGIN, "Bearer " + self.state.token)
        self.assertIsNone(self.state._voice_worker)
        self.assertFalse(worker["process"].is_alive())

    def test_unpaired_requests_never_keep_worker(self):
        self.state.rotate()
        first = self.run_job()["result"]["synthetic"]
        self.assertIsNone(self.state._voice_worker)
        second = self.run_job(108)["result"]["synthetic"]
        self.assertNotEqual(first["pid"], second["pid"])
        self.assertEqual((first["loads"], second["loads"]), (1, 1))


if __name__ == "__main__":
    unittest.main()
