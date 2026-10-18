"""Synthetic UI controls and in-memory contacts. Never opens real WeChat."""
import hashlib
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch
import re

from adapter import _moments, _resolve_moments_contact, _prepare_capture_ui, capture, CaptureError
from compatibility import prepare_capture_ui
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


def fake_empty_moments_capture(conn, request):
    conn.send({"type": "result", "result": {"kind": "moments", "records": [],
               "coverage": {"complete": True, "stopReason": "visible-end"}}})
    conn.close()


class Album:
    def __init__(self, count, no_focus=False, stuck_at=None, scroll_proof=True):
        self.index = -1
        self.count = count
        self.no_focus = no_focus
        self.stuck_at = stuck_at
        self.scroll_proof = scroll_proof
    def exists(self, **kwargs): return True
    def wait(self, *args, **kwargs): return self
    def type_keys(self, *args, **kwargs): self.index = min(self.count - 1, self.index + 1, self.stuck_at if self.stuck_at is not None else self.count)
    @property
    def iface_scroll(self):
        if not self.scroll_proof: raise RuntimeError("synthetic unsupported ScrollPattern")
        return SimpleNamespace(CurrentVerticallyScrollable=self.count > 1,
                               CurrentVerticalScrollPercent=100 if self.index==self.count-1 else 50)
    def children(self, **kwargs):
        if self.no_focus and self.index > 2: return []
        # Recycle every runtime ID, like virtualized WeChat albums.
        return [SimpleNamespace(element_info=SimpleNamespace(runtime_id=[1]),
                window_text=lambda: f"动态 {self.index}", class_name=lambda: "mmui::AlbumCell",
                has_keyboard_focus=lambda: True, click_input=lambda: None)]


class MomentsCaptureTests(unittest.TestCase):
    def test_bundle_uses_database_account_identity_and_retains_selected_label(self):
        import sys
        modules = {"pythoncom": SimpleNamespace(CoInitialize=lambda: None, CoUninitialize=lambda: None),
                   "pyweixin": SimpleNamespace(Navigator=None, Tools=None, Uielements=None, GlobalConfig=SimpleNamespace())}
        rows = [{"kind": "post", "sender": "好友", "senderRole": "other", "text": "合成动态"}]
        coverage = {"complete": True, "stopReason": "visible-end"}
        partials = []
        def moments(*args, **kwargs):
            kwargs["on_rows"](rows, [], coverage)
            return rows, [], coverage
        with patch.dict(sys.modules, modules), patch("adapter._prepare_capture_ui"), patch("adapter._account", return_value=("visible_wechat_alias", "本人")), \
             patch("adapter._resolve_moments_contact", return_value=("好友", "selected-id", "wxid_canonical")), \
             patch("adapter._moments", side_effect=moments):
            batch = capture({"kind": "moments", "friend": "所选唯一标签", "contactId": "selected-id", "accountKey": "a" * 64, "limit": 2000, "allVisible": True}, lambda *args: None, partials.append)
        self.assertEqual(batch["account"], "wxid_canonical")
        self.assertEqual(partials[0]["account"], "wxid_canonical")
        self.assertEqual(batch["friend"], "所选唯一标签")
        self.assertTrue(CollectorState(health_provider=lambda: {}).health()["capabilities"]["personBundle"])

    def run_album(self, count, limit=10, all_visible=True, no_focus=False, stuck_at=None, scroll_proof=True):
        album = Album(count, no_focus, stuck_at, scroll_proof)
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

    def test_stuck_keyboard_is_not_complete_even_when_the_same_row_repeats(self):
        (rows, warnings, coverage), _, _ = self.run_album(30, stuck_at=2)
        self.assertEqual(len(rows), 3)
        self.assertFalse(coverage["complete"])
        self.assertEqual(coverage["stopReason"], "navigation-stalled")
        self.assertTrue(any("未确认" in warning for warning in warnings))

    def test_unavailable_scroll_proof_does_not_claim_the_visible_end(self):
        (rows, _, coverage), _, _ = self.run_album(3, scroll_proof=False)
        self.assertEqual(len(rows), 3)
        self.assertFalse(coverage["complete"])
        self.assertEqual(coverage["stopReason"], "navigation-stalled")

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
            self.assertEqual(_resolve_moments_contact({"friend": "唯一备注", "contactId": "target-user", "accountKey": key}), ("唯一备注", "唯一备注", source.account_id))
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

    def test_empty_success_from_child_is_failed_not_a_completed_import(self):
        state = CollectorState(health_provider=lambda: {"ready": True}, capture_target=fake_empty_moments_capture)
        job_id = state.start({"kind": "moments", "friend": "合成对象", "limit": 5, "allVisible": True})["jobId"]
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            job = state.get(job_id)
            if job["status"] != "running": break
            time.sleep(.03)
        self.assertEqual(job["status"], "failed")
        self.assertEqual(job["error"]["code"], "NO_VISIBLE_MOMENTS")
        self.assertNotIn("result", job)


class CapturePreparationTests(unittest.TestCase):
    def modules(self, windows=(1,)):
        calls = []
        return calls, {
            "psutil": SimpleNamespace(process_iter=lambda fields: [SimpleNamespace(pid=123, info={"name":"Weixin.exe"})]),
            "win32process": SimpleNamespace(GetWindowThreadProcessId=lambda hwnd: (1,123)),
            "win32gui": SimpleNamespace(EnumWindows=lambda visit,arg: [visit(hwnd,arg) for hwnd in windows],
                GetClassName=lambda hwnd: "Qt51514QWindowIcon", GetWindowText=lambda hwnd: "微信",
                ShowWindow=lambda *args: calls.append(("restore",args)), SetForegroundWindow=lambda *args: calls.append(("foreground",args))),
        }

    def test_explicit_capture_restores_hidden_window_then_rechecks_before_account_reads(self):
        calls, modules = self.modules()
        before = {"ready":False,"uiCode":"WECHAT_WINDOW_HIDDEN","message":"隐藏窗口"}
        with patch.dict("sys.modules", modules), patch("compatibility.time.sleep"), \
             patch("compatibility.compatibility_probe", side_effect=[before,{"ready":True}]) as probe:
            self.assertTrue(prepare_capture_ui()["ready"])
        self.assertEqual(probe.call_count,2)
        self.assertEqual(calls,[('restore',(1,9)),('foreground',(1,))])

    def test_persistent_qt_shell_remains_an_actionable_failure(self):
        calls, modules = self.modules()
        status={"ready":False,"uiCode":"WECHAT_UI_UNAVAILABLE","message":"微信界面文字暂不可读取"}
        with patch.dict("sys.modules", modules), patch("compatibility.time.sleep"), patch("compatibility.compatibility_probe", return_value=status) as probe:
            result=prepare_capture_ui()
        self.assertFalse(result["ready"])
        self.assertEqual(probe.call_count,5)
        with patch("compatibility.prepare_capture_ui", return_value=result):
            with self.assertRaises(CaptureError) as failed: _prepare_capture_ui()
        self.assertEqual(failed.exception.code,"WECHAT_UI_UNAVAILABLE")
        self.assertEqual(failed.exception.message,status["message"])

    def test_ambiguous_windows_are_not_restored_or_guessed(self):
        calls, modules = self.modules((1,2))
        with patch.dict("sys.modules", modules), patch("compatibility.compatibility_probe", return_value={"ready":False,"uiCode":"WECHAT_WINDOW_HIDDEN"}):
            result=prepare_capture_ui()
        self.assertEqual(result["uiCode"],"WECHAT_WINDOW_AMBIGUOUS")
        self.assertEqual(calls,[])

    def test_failed_preparation_never_reads_account_or_contact(self):
        modules={"pythoncom":SimpleNamespace(CoInitialize=lambda:None,CoUninitialize=lambda:None),
                 "pyweixin":SimpleNamespace(Navigator=None,Tools=None,Uielements=None,GlobalConfig=SimpleNamespace())}
        with patch.dict("sys.modules",modules), patch("adapter.sys.platform","win32"), \
             patch("adapter._prepare_capture_ui",side_effect=CaptureError("WECHAT_UI_UNAVAILABLE","合成不可读状态")), \
             patch("adapter._account",side_effect=AssertionError("account must not be read")), \
             patch("adapter._resolve_moments_contact",side_effect=AssertionError("contact must not be read")):
            with self.assertRaises(CaptureError):capture({"kind":"moments","friend":"合成对象","limit":5},lambda *args:None)


if __name__ == "__main__":
    unittest.main()
