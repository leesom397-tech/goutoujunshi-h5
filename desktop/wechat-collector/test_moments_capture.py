"""Synthetic UI controls and in-memory contacts. Never opens real WeChat."""
import hashlib
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch
import re

from adapter import _moments, _resolve_moments_contact
from background_reader import BackgroundCaptureError
from bridge import CollectorState, BridgeError
from test_background_reader import Source


def fake_moments_capture(conn, request):
    batch = {"kind": "moments", "records": [{"text": "合成动态"}],
             "coverage": {"complete": False, "stopReason": "scanning"},
             "selection": [request.get("contactId"), request.get("accountKey")],
             "allVisible": request.get("allVisible")}
    conn.send({"type": "partial", "partial": batch})
    for _ in range(6):
        time.sleep(.1)
        conn.send({"type": "progress", "progress": 50, "message": "合成进度"})
    batch["coverage"] = {"complete": True, "stopReason": "visible-end"}
    conn.send({"type": "result", "result": batch})
    conn.close()


class Album:
    def __init__(self, count, no_focus=False):
        self.index = -1
        self.count = count
        self.no_focus = no_focus
    def exists(self, **kwargs): return True
    def wait(self, *args, **kwargs): return self
    def type_keys(self, *args, **kwargs): self.index = min(self.count - 1, self.index + 1)
    def children(self, **kwargs):
        if self.no_focus and self.index > 2: return []
        # Recycle every runtime ID, like virtualized WeChat albums.
        return [SimpleNamespace(element_info=SimpleNamespace(runtime_id=[1]),
                window_text=lambda: f"动态 {self.index}", class_name=lambda: "mmui::AlbumCell",
                has_keyboard_focus=lambda: True, click_input=lambda: None)]


class MomentsCaptureTests(unittest.TestCase):
    def run_album(self, count, limit=10, all_visible=True, no_focus=False):
        album = Album(count, no_focus)
        detail = SimpleNamespace(exists=lambda **kwargs: True,
            children=lambda **kwargs: [SimpleNamespace(window_text=lambda: f"好友 动态 {album.index} 2026年10月18日")])
        back = SimpleNamespace(click_input=lambda: None)
        window = SimpleNamespace(child_window=lambda **kwargs: {"album": album, "detail": detail, "back": back}[kwargs["auto_id"]])
        ui = SimpleNamespace(Lists=SimpleNamespace(MomentsList={"auto_id": "album"}, SnsDetailList={"auto_id": "detail"}),
             Buttons=SimpleNamespace(BackButton={"auto_id": "back"}),
             Regex_Patterns=SimpleNamespace(Snsdetail_Timestamp_pattern=re.compile(r"2026年10月18日")))
        tools = SimpleNamespace(activate_momentsList=lambda listing: None)
        partials, progress = [], []
        with patch("adapter._open_target", return_value=object()), patch("adapter._open_moments_from_chat", return_value=window), \
             patch("adapter._image", return_value={"data": "test", "mime": "image/jpeg"}), patch("adapter.time.sleep"):
            result = _moments("好友", limit, lambda *event: progress.append(event), (None, tools, ui),
                              all_visible=all_visible, on_rows=lambda rows, warnings, coverage: partials.append((len(rows), coverage)))
        return result, partials, progress

    def test_all_visible_exceeds_old_2000_cap_and_recycled_runtime_ids(self):
        (rows, warnings, coverage), partials, progress = self.run_album(2003)
        self.assertEqual(len(rows), 2003)
        self.assertEqual(rows[0]["text"], "动态 0")
        self.assertEqual(rows[-1]["text"], "动态 2002")
        self.assertTrue(coverage["complete"])
        self.assertEqual(coverage["stopReason"], "visible-end")
        self.assertEqual(partials[0][0], 1)
        self.assertTrue(all(value < 100 for value, _ in progress))

    def test_requested_count_is_never_labeled_all_visible(self):
        (rows, _, coverage), _, _ = self.run_album(30, limit=5, all_visible=False)
        self.assertEqual(len(rows), 5)
        self.assertFalse(coverage["complete"])
        self.assertEqual(coverage["stopReason"], "requested-count")

    def test_focus_loss_keeps_rows_without_claiming_completion(self):
        (rows, warnings, coverage), _, _ = self.run_album(50, no_focus=True)
        self.assertEqual(len(rows), 3)
        self.assertFalse(coverage["complete"])
        self.assertEqual(coverage["stopReason"], "focus-unavailable")
        self.assertTrue(any("焦点丢失" in warning for warning in warnings))

    def test_selected_moments_account_is_checked_and_source_closed(self):
        source = Source()
        key = hashlib.sha256(source.account_id.encode()).hexdigest()
        provider = SimpleNamespace(open_authorized_source=lambda: source)
        with patch("background_reader._provider_module", return_value=provider):
            self.assertEqual(_resolve_moments_contact({"friend": "唯一备注", "contactId": "target-user", "accountKey": key}), ("唯一备注", "唯一备注"))
        self.assertTrue(source.closed)
        source = Source()
        with patch("background_reader._provider_module", return_value=SimpleNamespace(open_authorized_source=lambda: source)):
            with self.assertRaises(BackgroundCaptureError) as error:
                _resolve_moments_contact({"friend": "唯一备注", "contactId": "target-user", "accountKey": "0" * 64})
        self.assertEqual(error.exception.code, "ACCOUNT_CHANGED")
        self.assertTrue(source.closed)

    def test_bridge_preserves_moments_selection_and_uses_activity_timeout(self):
        state = CollectorState(health_provider=lambda: {"ready": True, "capabilities": {"moments": True}}, capture_target=fake_moments_capture)
        self.assertTrue(state.health()["capabilities"]["momentsAllVisible"])
        with patch("bridge.JOB_TIMEOUT", .01), patch("bridge.MOMENTS_IDLE_TIMEOUT", 5):
            job_id = state.start({"kind": "moments", "friend": "唯一备注", "limit": 2000,
                                  "contactId": "target-user", "accountKey": "a" * 64, "allVisible": True})["jobId"]
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline:
                job = state.get(job_id)
                if job["status"] != "running": break
                time.sleep(.03)
        self.assertEqual(job["status"], "completed")
        self.assertEqual(job["result"]["selection"], ["target-user", "a" * 64])
        self.assertTrue(job["result"]["allVisible"])
        self.assertGreater(job["partialRevision"], 0)

    def test_bridge_rejects_invalid_full_scan_and_contact_tokens(self):
        state = CollectorState(health_provider=lambda: {"ready": True})
        for changes in ({"allVisible": "yes"}, {"contactId": "target-user", "accountKey": "bad"}, {"kind": "chat"}):
            with self.assertRaises(BridgeError):
                state.start({"kind": "moments", "friend": "测试", "limit": 50, "allVisible": True, **changes})


if __name__ == "__main__":
    unittest.main()
