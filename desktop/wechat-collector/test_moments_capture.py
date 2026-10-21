"""Synthetic UI controls and in-memory contacts. Never opens real WeChat."""
import hashlib
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch, Mock
import re

from adapter import (_moments, _resolve_moments_contact, _open_moments_source,
                     _visible_moment_cells, _viewport_has_trailing_space, _cell_scan_key,
                     _prepare_capture_ui, _advance_moments_list, capture, CaptureError)
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
        self.detail_open = False
        self.element_info = SimpleNamespace(runtime_id=[1234])
    def process_id(self): return 123
    def wrapper_object(self): return self
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
                has_keyboard_focus=lambda: True,
                click_input=lambda: setattr(self, "detail_open", True))]


class MomentsCaptureTests(unittest.TestCase):
    def test_recycled_rows_outside_viewport_are_not_clicked_and_geometry_proves_end(self):
        def rect(top, bottom):
            return SimpleNamespace(left=0, right=100, top=top, bottom=bottom)
        def cell(top, bottom):
            return SimpleNamespace(class_name=lambda: "mmui::AlbumContentCell",
                                   rectangle=lambda: rect(top, bottom), is_visible=lambda: True)
        rows = [cell(0, 60), cell(101, 131)]
        listing = SimpleNamespace(rectangle=lambda: rect(0, 100), children=lambda **kwargs: rows)
        self.assertEqual(_visible_moment_cells(listing), [])
        self.assertFalse(_viewport_has_trailing_space(listing))
        rows[:] = [cell(0, 100)]
        self.assertEqual(_visible_moment_cells(listing), rows)
        rows[:] = [cell(30, 75)]
        self.assertTrue(_viewport_has_trailing_space(listing))
        first = SimpleNamespace(class_name=lambda: "mmui::AlbumContentCell", window_text=lambda: "同一条动态",
                                rectangle=lambda: rect(10, 40))
        moved = SimpleNamespace(class_name=lambda: "mmui::AlbumContentCell", window_text=lambda: "同一条动态",
                                rectangle=lambda: rect(50, 80))
        self.assertEqual(_cell_scan_key(first), _cell_scan_key(moved))

    def test_pinned_album_returns_to_ordinary_feed_without_marking_feed_as_pinned(self):
        class TwoLists:
            def __init__(self):
                self.mode, self.index, self.detail_open = "normal", -1, False
                self.element_info = SimpleNamespace(runtime_id=[42])
            def exists(self, **kwargs): return True
            def is_visible(self): return True
            def wait(self, *_args, **_kwargs): return self
            def type_keys(self, *_args, **_kwargs):
                count = 2 if self.mode == "pinned" else 3
                self.index = min(count - 1, self.index + 1)
            @property
            def iface_scroll(self):
                count = 2 if self.mode == "pinned" else 3
                return SimpleNamespace(CurrentVerticalScrollPercent=100 if self.index >= count - 1 else 0)
            def children(self, **kwargs):
                def open_pinned(): self.mode, self.index = "pinned", 0
                top = SimpleNamespace(class_name=lambda: "mmui::AlbumTopCell",
                    window_text=lambda: "置顶", click_input=open_pinned)
                label = f"{self.mode} {max(self.index, 0)}"
                post = SimpleNamespace(class_name=lambda: "mmui::AlbumContentCell",
                    window_text=lambda: label, click_input=lambda: setattr(self, "detail_open", True))
                return ([top] if self.mode == "normal" else []) + [post]
            def back(self):
                if self.detail_open: self.detail_open = False
                else: self.mode, self.index = "normal", 0
        listing = TwoLists()
        detail = SimpleNamespace(exists=lambda **kwargs: listing.detail_open,
            is_visible=lambda: listing.detail_open,
            children=lambda **kwargs: [SimpleNamespace(window_text=lambda:
                f"好友 {listing.mode} {listing.index} 2026年10月18日")])
        back = SimpleNamespace(click_input=listing.back)
        window = SimpleNamespace(child_window=lambda **kwargs:
            {"album": listing, "detail": detail, "back": back}[kwargs["auto_id"]])
        ui = SimpleNamespace(Lists=SimpleNamespace(MomentsList={"auto_id":"album"},
            SnsDetailList={"auto_id":"detail"}), Buttons=SimpleNamespace(BackButton={"auto_id":"back"}),
            Regex_Patterns=SimpleNamespace(Snsdetail_Timestamp_pattern=re.compile(r"2026年10月18日")))
        main = SimpleNamespace(handle=1, process_id=lambda: 123)
        with patch("adapter._open_target", return_value=main), patch("adapter._open_moments_from_chat", return_value=window), \
             patch("adapter._ensure_foreground"), patch("adapter._image", return_value={"data":"a", "mime":"image/jpeg"}), patch("adapter.time.sleep"):
            rows, _, coverage = _moments("好友", 10, lambda *_args, **_kwargs: None,
                (None, SimpleNamespace(activate_momentsList=lambda *_args: None), ui), all_visible=True)
        posts = [row for row in rows if row.get("kind") == "post"]
        self.assertEqual(len(posts), 5)
        self.assertEqual(sum(row["source"]["pinned"] for row in posts), 2)
        self.assertEqual(coverage["pinnedCount"], 2)
        self.assertTrue(coverage["complete"])

    def test_scroll_advances_with_mouse_when_keyboard_path_is_stuck(self):
        import sys
        class WheelAlbum:
            def __init__(self):
                self.index = 0
                self.element_info = SimpleNamespace(runtime_id=[99])
            def children(self, **kwargs):
                return [SimpleNamespace(
                    element_info=SimpleNamespace(runtime_id=[self.index]),
                    class_name=lambda: "mmui::AlbumCell",
                    window_text=lambda: f"动态 {self.index}",
                    is_visible=lambda: True)]
            def descendants(self, **kwargs): return []
            def rectangle(self): return SimpleNamespace(left=0, top=0, width=lambda: 100, height=lambda: 100)
            def click_input(self): return None
            def type_keys(self, *_args, **_kwargs): return None
            @property
            def iface_scroll(self):
                return SimpleNamespace(CurrentVerticalScrollPercent=self.index * 10)
        album = WheelAlbum()
        fake_mouse = SimpleNamespace(scroll=lambda **kwargs: setattr(album, "index", album.index + 1))
        fake_pywinauto = SimpleNamespace(mouse=fake_mouse)
        with patch.dict(sys.modules, {"pywinauto": fake_pywinauto}):
            self.assertTrue(_advance_moments_list(album))
        self.assertEqual(album.index, 1)

    def test_profile_popup_waits_in_same_process_without_premature_child_fallback(self):
        import sys
        from adapter import _open_moments_from_chat
        click, wrong_click = Mock(), Mock()
        wrong = SimpleNamespace(is_visible=lambda: True, is_enabled=lambda: True,
                                class_name=lambda: "mmui::OtherButton", click_input=wrong_click)
        button = SimpleNamespace(is_visible=lambda: True, is_enabled=lambda: True,
                                 class_name=lambda: "mmui::ProfileDetailValueSnsView", click_input=click)
        container = SimpleNamespace(descendants=lambda **kw: [wrong, button])
        link = SimpleNamespace(exists=lambda **kw: True, is_visible=lambda: True,
                               parent=lambda: SimpleNamespace(parent=lambda: container))
        profile = SimpleNamespace(wait=Mock(), descendants=lambda **kw: [SimpleNamespace(window_text=lambda: "好友 微信号 W-test")], child_window=lambda **kw:
            SimpleNamespace(exists=lambda **kw: True) if "auto_id" in kw else link)
        pane = SimpleNamespace(exists=lambda **kw: True, is_visible=lambda: True,
            child_window=lambda **kw: SimpleNamespace(wait=lambda *a, **kw:
                SimpleNamespace(click_input=Mock(), children=lambda **kw: [SimpleNamespace(click_input=Mock())])))
        main = SimpleNamespace(process_id=lambda: 123, child_window=lambda **kw: pane)
        desktop = SimpleNamespace(window=Mock(return_value=profile))
        ui = SimpleNamespace(Windows=SimpleNamespace(MomentsWindow={"title":"album"}),
                             Texts=SimpleNamespace(MomentsText={"title":"朋友圈"}),
                             Lists=SimpleNamespace(MomentsList={"title":"sns"}))
        with patch.dict(sys.modules,{"pywinauto":SimpleNamespace(Desktop=lambda **kw:desktop)}), patch("adapter._moments_window",return_value=main), patch("adapter._ensure_foreground"):
            self.assertIs(_open_moments_from_chat(main,"好友",(None,None,ui),expected_identifier="W-test"),main)
        self.assertEqual(desktop.window.call_args_list[0].kwargs,
                         {"class_name":"mmui::ProfileUniquePop","process":123,"visible_only":True})
        click.assert_called_once()
        wrong_click.assert_not_called()
        with patch.dict(sys.modules,{"pywinauto":SimpleNamespace(Desktop=lambda **kw:desktop)}), patch("adapter._ensure_foreground"):
            with self.assertRaises(CaptureError) as mismatch:
                _open_moments_from_chat(main,"好友",(None,None,ui),expected_identifier="W-another")
        self.assertEqual(mismatch.exception.code, "MOMENTS_OWNER_UNVERIFIED")

    def test_bundle_uses_database_account_identity_and_retains_selected_label(self):
        import sys
        modules = {"pythoncom": SimpleNamespace(CoInitialize=lambda: None, CoUninitialize=lambda: None),
                   "pyweixin": SimpleNamespace(Navigator=None, Tools=None, Uielements=None, GlobalConfig=SimpleNamespace())}
        rows = [{"kind": "post", "sender": "好友", "senderRole": "other", "text": "合成动态"}]
        coverage = {"complete": True, "stopReason": "visible-end"}
        partials = []
        source = SimpleNamespace(close=Mock(), assert_unchanged=Mock())
        def moments(*args, **kwargs):
            kwargs["on_rows"](rows, [], coverage)
            return rows, [], coverage
        with patch.dict(sys.modules, modules), patch("adapter._prepare_capture_ui"), patch("adapter._account", return_value=("visible_wechat_alias", "本人")) as account_read, \
             patch("adapter._open_moments_source", return_value=source), \
             patch("adapter._resolve_moments_contact", return_value=("好友", "selected-id", "wxid_canonical")) as resolve_contact, \
             patch("adapter._moments", side_effect=moments):
            batch = capture({"kind": "moments", "friend": "所选唯一标签", "contactId": "selected-id", "accountKey": "a" * 64, "limit": 2000, "allVisible": True}, lambda *args: None, partials.append)
        self.assertEqual(batch["account"], "wxid_canonical")
        self.assertEqual(partials[0]["account"], "wxid_canonical")
        self.assertEqual(batch["friend"], "所选唯一标签")
        self.assertEqual(account_read.call_count, 1, "in-progress and final checks must not close the album through open_my_profile")
        source.close.assert_called_once()
        source.assert_unchanged.assert_called_once()
        self.assertEqual(resolve_contact.call_count, 2, "full contact checks at entry and finish; progress verifies the same login without rescanning names")
        self.assertTrue(CollectorState(health_provider=lambda: {}).health()["capabilities"]["personBundle"])

    def run_album(self, count, limit=10, all_visible=True, no_focus=False, stuck_at=None, scroll_proof=True, through_capture=False, changed_at=None):
        album = Album(count, no_focus, stuck_at, scroll_proof)
        detail = SimpleNamespace(exists=lambda **kwargs: album.detail_open,
            is_visible=lambda: album.detail_open,
            children=lambda **kwargs: [SimpleNamespace(window_text=lambda: f"好友 动态 {album.index} 2026年10月18日")])
        back = SimpleNamespace(click_input=lambda: setattr(album, "detail_open", False))
        window = SimpleNamespace(child_window=lambda **kwargs: {"album": album, "detail": detail, "back": back}[kwargs["auto_id"]])
        ui = SimpleNamespace(Lists=SimpleNamespace(MomentsList={"auto_id": "album"}, SnsDetailList={"auto_id": "detail"}),
             Buttons=SimpleNamespace(BackButton={"auto_id": "back"}),
             Regex_Patterns=SimpleNamespace(Snsdetail_Timestamp_pattern=re.compile(r"2026年10月18日")))
        tools = SimpleNamespace(activate_momentsList=lambda listing: None)
        ui.Texts = None
        main = SimpleNamespace(handle=321, process_id=lambda: 123,
                               descendants=Mock(side_effect=AssertionError("unnecessary full-window traversal")))
        partials, progress = [], []
        with patch("adapter._open_target", return_value=main), patch("adapter._assert_target"), patch("adapter._ensure_foreground"), patch("adapter._open_moments_from_chat", return_value=window), \
             patch("adapter._image", return_value={"data": "test", "mime": "image/jpeg"}), patch("adapter.time.sleep"):
            if through_capture:
                import sys
                source = Source()
                source.contact.execute("UPDATE contact SET remark='好友'")
                opened = False
                def open_album(*args, **kwargs):
                    nonlocal opened
                    opened = True
                    return window
                def profile(*args):
                    if opened:
                        raise AssertionError("upstream open_my_profile closes the current embedded album")
                    return source.account_id, "本人"
                def partial(batch):
                    partials.append((len(batch["records"]), batch["coverage"]))
                    if changed_at == "partial":
                        source.changed = True
                    elif changed_at == "view":
                        main.handle = 1234567
                    elif changed_at == "provider":
                        album.element_info.runtime_id = [5678]
                def status(*event):
                    progress.append(event)
                    if changed_at == "final" and event[0] == 95:
                        source.changed = True
                modules = {"pythoncom": SimpleNamespace(CoInitialize=lambda: None, CoUninitialize=lambda: None),
                           "pyweixin": SimpleNamespace(Navigator=None, Tools=tools, Uielements=ui, GlobalConfig=SimpleNamespace())}
                # Advance the synthetic clock so both first-row and periodic
                # publications exercise the same real capture callback.
                clock = iter(range(0, 100000, 6))
                with patch.dict(sys.modules, modules), patch("adapter._prepare_capture_ui"), \
                     patch("adapter._account", side_effect=profile) as account_read, \
                     patch("adapter._open_moments_from_chat", side_effect=open_album), \
                     patch("background_reader._provider_module", return_value=SimpleNamespace(open_authorized_source=lambda **kwargs: source)), \
                     patch("adapter.time.monotonic", side_effect=lambda: next(clock)):
                    try:
                        batch = capture({"kind": "moments", "friend": "好友", "contactId": "target-user",
                                         "accountKey": hashlib.sha256(source.account_id.encode()).hexdigest(),
                                         "limit": limit, "allVisible": all_visible}, status, partial)
                        result = batch["records"], batch["warnings"], batch["coverage"]
                    finally:
                        self.assertTrue(source.closed, "the retained account source closes on success and failure")
                        self.assertEqual(account_read.call_count, 1, "no mid-capture or final UI navigation")
                        self.assertTrue(opened, "the selected album remains open")
            else:
                result = _moments("好友", limit, lambda *event: progress.append(event), (None, tools, ui),
                                  all_visible=all_visible, on_rows=lambda rows, warnings, coverage: partials.append((len(rows), coverage)))
        main.descendants.assert_not_called()
        return result, partials, progress

    def test_actual_capture_continues_past_first_and_periodic_partial_without_closing_album(self):
        (rows, _, coverage), partials, _ = self.run_album(12, through_capture=True)
        self.assertEqual(len(rows), 12)
        self.assertEqual([count for count, _ in partials], list(range(1, 13)))
        self.assertTrue(coverage["complete"])
        self.assertEqual(coverage["stopReason"], "visible-end")

    def test_non_ui_account_guard_stops_changes_before_later_partial_and_final(self):
        for changed_at in ("partial", "final"):
            with self.subTest(changed_at=changed_at), self.assertRaises(BackgroundCaptureError) as error:
                self.run_album(12, through_capture=True, changed_at=changed_at)
            self.assertEqual(error.exception.code, "SOURCE_CHANGED")

    def test_switching_album_container_stops_before_reading_other_friend(self):
        with self.assertRaises(CaptureError) as error:
            self.run_album(12, through_capture=True, changed_at="view")
        self.assertEqual(error.exception.code, "MOMENTS_VIEW_CHANGED")

    def test_album_provider_rebuild_does_not_mean_different_person(self):
        (rows, _, coverage), _, _ = self.run_album(12, through_capture=True, changed_at="provider")
        self.assertEqual(len(rows), 12)
        self.assertTrue(coverage['complete'])

    def test_legacy_account_mismatch_is_rejected_without_navigation_and_source_is_closed(self):
        source = Source()
        with patch("background_reader._provider_module", return_value=SimpleNamespace(open_authorized_source=lambda **kwargs: source)):
            with self.assertRaises(CaptureError) as error:
                _open_moments_source({"friend": "唯一备注"}, "different-visible-account")
        self.assertEqual(error.exception.code, "ACCOUNT_CHANGED")
        self.assertTrue(source.closed)

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
        self.assertEqual(coverage["stopReason"], "navigation-stalled")
        self.assertTrue(any("没有继续向下" in warning for warning in warnings))

    def test_selected_moments_account_is_checked_and_source_closed(self):
        source = Source()
        key = hashlib.sha256(source.account_id.encode()).hexdigest()
        provider = SimpleNamespace(open_authorized_source=Mock(return_value=source))
        with patch("background_reader._provider_module", return_value=provider):
            self.assertEqual(_resolve_moments_contact({"friend": "唯一备注", "contactId": "target-user", "accountKey": key}), ("唯一备注", "唯一备注", source.account_id))
        self.assertTrue(source.closed)
        provider.open_authorized_source.assert_called_once_with(contacts_only=True)
        source = Source()
        with patch("background_reader._provider_module", return_value=SimpleNamespace(open_authorized_source=lambda **kwargs: source)):
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
                GetWindow=lambda *args: 0, GetWindowLong=lambda hwnd,index: 0x00C40000 if index==-16 else 0,
                GetClientRect=lambda hwnd: (0,0,1000,700), IsWindowVisible=lambda hwnd: True,
                IsIconic=lambda hwnd:False,
                ShowWindowAsync=lambda *args: calls.append(("restore",args)), SetForegroundWindow=lambda *args: calls.append(("foreground",args))),
        }

    def test_explicit_capture_restores_hidden_window_then_rechecks_before_account_reads(self):
        calls, modules = self.modules()
        before = {"ready":False,"uiCode":"WECHAT_WINDOW_HIDDEN","message":"隐藏窗口"}
        with patch.dict("sys.modules", modules), patch("compatibility.time.sleep"), \
             patch("compatibility.restore_window",side_effect=lambda hwnd:calls.append(("restore",(hwnd,9)))), \
             patch("compatibility.compatibility_probe", side_effect=[before,{"ready":True}]) as probe:
            self.assertTrue(prepare_capture_ui()["ready"])
        self.assertEqual(probe.call_count,2)
        self.assertEqual(calls,[('restore',(1,9)),('foreground',(1,))])

    def test_persistent_qt_shell_remains_an_actionable_failure(self):
        calls, modules = self.modules()
        status={"ready":False,"uiCode":"WECHAT_UI_UNAVAILABLE","message":"微信界面文字暂不可读取"}
        with patch.dict("sys.modules", modules), patch("compatibility.time.sleep"), patch("compatibility.restore_window"), patch("compatibility.ui_metadata", return_value=[]), patch("compatibility.compatibility_probe", return_value=status) as probe:
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
