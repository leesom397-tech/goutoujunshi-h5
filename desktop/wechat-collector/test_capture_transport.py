"""Only invented snapshots; no WeChat, login or network activity."""
import json
import copy
import time
import unittest

from bridge import BridgeError, CollectorState
from capture_transport import expand_partial, partial_message


def snapshot(count):
    return {"version": 1, "kind": "moments", "account": "synthetic-account",
            "friend": "synthetic-friend", "records": [
                {"text": f"动态 {index}（含作者自己的评论）", "source": {"pinned": index < 2},
                 "images": [{"mime": "image/jpeg", "data": "A" * 80_000}]}
                for index in range(count)], "coverage": {"recordCount": count, "complete": False}}


class CaptureTransportTest(unittest.TestCase):
    def test_voice_updates_keep_images_without_retransmitting_them(self):
        batch = {"version": 1, "kind": "chat", "account": "synthetic-account", "friend": "synthetic-friend",
                 "records": [{"id": f"voice-{index}", "text": "[语音]", "kind": "other",
                              "source": {"accountId": "synthetic-account", "sessionId": "synthetic-friend",
                                         "messageId": str(index), "transcriptionStatus": "not-transcribed"}}
                             for index in range(100)] +
                            [{"id": "image", "text": "[图片]", "source": {},
                              "images": [{"mime": "image/jpeg", "data": "A" * 800_000}]}]}
        previous = expand_partial(None, partial_message(None, batch))
        old = copy.deepcopy(previous)
        cumulative_bytes = transmitted_bytes = 0
        for index in range(100):
            current = copy.deepcopy(previous)
            current["records"][index].update(text=f"合成语音 {index}", kind="voice-transcript")
            current["records"][index]["source"]["transcriptionStatus"] = "visible-text"
            packet = partial_message(previous, current)
            self.assertEqual(packet["type"], "partial-patch")
            self.assertEqual(len(packet["updates"]), 1)
            transmitted_bytes += len(json.dumps(packet))
            cumulative_bytes += len(json.dumps(current))
            previous = expand_partial(previous, packet)
            self.assertEqual(previous, current)
        self.assertEqual(batch, old, "updating the next revision cannot mutate a previously published revision")
        self.assertLess(transmitted_bytes, cumulative_bytes / 100)
        print(f"100 synthetic voice updates IPC: {cumulative_bytes} -> {transmitted_bytes} bytes")

    def test_chat_patch_rejects_identity_count_and_index_changes(self):
        before = {"version": 1, "kind": "chat", "account": "a", "friend": "b",
                  "records": [{"id": "one", "text": "[语音]", "source": {"sessionId": "b"}}]}
        after = copy.deepcopy(before)
        after["records"][0]["text"] = "合成语音"
        packet = partial_message(before, after)
        for mutation in ("friend", "count", "duplicate-index", "index", "id", "sessionId"):
            changed = copy.deepcopy(packet)
            if mutation == "friend": changed["partial"]["friend"] = "other"
            elif mutation == "count": changed["count"] = 2
            elif mutation == "duplicate-index": changed["updates"] *= 2
            elif mutation == "index": changed["updates"][0]["index"] = True
            elif mutation == "id": changed["updates"][0]["record"]["id"] = "other"
            else: changed["updates"][0]["record"]["source"]["sessionId"] = "other"
            with self.subTest(mutation=mutation), self.assertRaisesRegex(ValueError, "PARTIAL_SOURCE_CHANGED"):
                expand_partial(before, changed)
        after["records"][0]["source"]["sessionId"] = "other"
        self.assertEqual(partial_message(before, after)["type"], "partial")

    def test_127_posts_keep_every_image_comment_and_pin_with_linear_pipe_bytes(self):
        previous = None
        cumulative_bytes = transmitted_bytes = 0
        for count in range(1, 128):
            value = snapshot(count)
            packet = partial_message(previous, value)
            cumulative_bytes += len(json.dumps(value))
            transmitted_bytes += len(json.dumps(packet))
            expanded = expand_partial(previous, packet)
            self.assertEqual(expanded, value)
            previous = expanded
        self.assertEqual(len(previous["records"]), 127)
        self.assertLess(transmitted_bytes, cumulative_bytes / 50)
        print(f"127 synthetic posts IPC: {cumulative_bytes} -> {transmitted_bytes} bytes")

    def test_changed_prefix_or_contact_falls_back_to_a_complete_verified_snapshot(self):
        before = snapshot(3)
        changed = snapshot(4)
        changed["records"][0]["text"] = "更正原文"
        self.assertEqual(partial_message(before, changed)["type"], "partial")
        changed = {**snapshot(4), "friend": "someone-else"}
        self.assertEqual(partial_message(before, changed)["type"], "partial")
        with self.assertRaisesRegex(ValueError, "PARTIAL_SOURCE_CHANGED"):
            expand_partial(before, {"type": "partial-delta", "offset": 2, "partial": snapshot(4)})

    def test_progress_revision_does_not_resend_images_and_old_clients_still_receive_them(self):
        state = CollectorState(health_provider=lambda: {})
        job_id = "a" * 24
        partial = snapshot(127)
        state.jobs[job_id] = {"jobId": job_id, "status": "running", "partialRevision": 5,
                              "partial": partial, "updated": time.monotonic()}
        original = state.get(job_id)
        current = state.get(job_id, 5)
        self.assertIn("partial", original)
        self.assertNotIn("partial", current)
        self.assertLess(len(json.dumps(current)), len(json.dumps(original)) / 1000)
        self.assertEqual(state.get(job_id, 0)["partial"], partial, "reload must retrieve saved partial")
        self.assertEqual(state.get(job_id, 99)["partial"], partial, "invalid future ACK cannot hide a snapshot")
        state.jobs[job_id].update(status="completed", result=partial)
        final = state.get(job_id, 0)
        self.assertNotIn("partial", final)
        self.assertEqual(final["result"], partial)
        self.assertEqual(state.get(job_id)["partial"], partial, "legacy compatibility")
        with self.assertRaises(BridgeError):
            state.get(job_id, -1)


if __name__ == "__main__":
    unittest.main()
