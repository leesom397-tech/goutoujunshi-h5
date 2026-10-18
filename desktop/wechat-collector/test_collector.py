"""All communication content below is invented. No real WeChat is opened by tests."""
import http.client
import json
import threading
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch
import re

from bridge import BridgeError, CollectorState, ORIGINS, server_for, _capture_process
from normalize import normalized_capture
from adapter import CaptureError, _account, _chat, _assert_target, _open_target, _moments_window, capture


def fake_capture(conn, request):
    conn.send({"type": "progress", "progress": 40, "message": "mock progress"})
    time.sleep(0.2)
    result = normalized_capture(request["kind"], request["friend"], "fake_account_only", [{"kind": "text", "text": "虚构测试消息", "sender": "测试人", "at": "", "source": {"requestedVoice": request.get("includeVoice")}}])
    conn.send({"type": "result", "result": result})
    conn.close()


def fake_partial_capture(conn, request):
    result = normalized_capture(request["kind"], request["friend"], "fake_account_only", [
        {"kind": "text", "text": "已核对的虚构文字", "sender": "测试人", "at": "",
         "source": {"requestedVoice": request["includeVoice"]}}])
    conn.send({"type": "partial", "partial": result})
    if request["limit"] in (1, 5):
        time.sleep(30)  # cancelled/terminated by the test, never a real UI operation
    elif request["limit"] == 2:
        conn.send({"type": "error", "error": {"code": "SOURCE_CHANGED", "message": "synthetic source changed"}})
    elif request["limit"] == 4:
        conn.close()
        return
    else:
        time.sleep(.15)
        conn.send({"type": "result", "result": result})
    conn.close()


class NormalizationTest(unittest.TestCase):
    def test_repeated_short_messages_survive(self):
        rows = [{"kind": "text", "text": "嗯", "sender": "同一人", "at": ""}] * 3
        batch = normalized_capture("chat", "演示", "fake_account", rows)
        self.assertEqual(len(batch["records"]), 3)
        self.assertTrue(all(r["id"] == "" and r["at"] == "" for r in batch["records"]))
        self.assertEqual([r["source"]["index"] for r in batch["records"]], [0, 1, 2])
        self.assertEqual([r["source"]["uiIndex"] for r in batch["records"]], [2, 1, 0])
        self.assertTrue(all(r["source"]["order"] == "oldest-first" for r in batch["records"]))
        self.assertEqual(len({r["source"]["contentFingerprint"] for r in batch["records"]}), 1)

    def test_sticker_and_original_time_are_preserved(self):
        batch = normalized_capture("chat", "演示", "fake_account", [{"kind": "sticker", "text": "[动画表情]", "at": "昨天 22:10", "senderRole": "unknown"}])
        self.assertEqual(batch["records"][0]["kind"], "sticker")
        self.assertEqual(batch["records"][0]["at"], "昨天 22:10")
        self.assertEqual(batch["records"][0]["senderRole"], "unknown")
        with self.assertRaises(ValueError):
            normalized_capture("chat", "演示", "", [])

    def test_chat_returns_oldest_first_without_sorting_unknown_times(self):
        batch = normalized_capture("chat", "演示", "fake_account", [{"text": "最新一句", "at": "昨天"}, {"text": "更早一句", "at": ""}])
        self.assertEqual([r["text"] for r in batch["records"]], ["更早一句", "最新一句"])
        moments = normalized_capture("moments", "演示", "fake_account", [{"text": "最新动态"}, {"text": "旧动态"}])
        self.assertEqual(moments["records"][0]["text"], "最新动态")
        self.assertEqual(moments["records"][0]["source"]["order"], "newest-first")


class AdapterTest(unittest.TestCase):
    def test_voice_transcript_keeps_provenance_and_excludes_duration_from_body(self):
        class Item:
            def __init__(self, index, label, ui_class="mmui::ChatVoiceItemView"):
                self.element_info = SimpleNamespace(runtime_id=[index])
                self.label, self.ui_class = label, ui_class
            def has_keyboard_focus(self): return True
            def class_name(self): return self.ui_class
            def window_text(self): return self.label
        class Listing:
            index = 0
            items = [Item(1, '好友 2026-10-13 10:03 语音12"秒周六下午可以。'),
                     Item(2, '我 2026-10-13 10:02 语音3"秒'),
                     Item(3, '好友 2026-10-13 10:01 语音8"秒转换失败'),
                     Item(4, '好友 2026-10-13 10:00 语音12"秒这是输入的字', "mmui::ChatTextItemView")]
            def exists(self, **kwargs): return True
            def children(self): return [self.items[self.index]]
            def type_keys(self, *args, **kwargs): self.index = min(self.index + 1, len(self.items)-1)
        listing = Listing()
        history = SimpleNamespace(child_window=lambda **kwargs: listing, type_keys=lambda *args: None, close=lambda: None)
        navigator = SimpleNamespace(open_chat_history=lambda **kwargs: history)
        tools = SimpleNamespace(select_chatHistoryList=lambda window: object())
        ui = SimpleNamespace(Lists=SimpleNamespace(ChatHistoryList={}), Regex_Patterns=SimpleNamespace(
            Chathistory_Timestamp_pattern=re.compile(r"2026-10-13 \d{2}:\d{2}"), Audio_pattern=re.compile(r'(?<=语音)\d+"秒(.*)$')))
        with patch("adapter._open_target", return_value=object()), patch("adapter._image") as screenshot, \
             patch("adapter._native_voice", side_effect=[(None, "not-voice"), RuntimeError("source gone")]):
            rows, warnings = _chat("好友", 4, "我", lambda *args: None, (navigator, tools, ui), convert_voices=True)
        screenshot.assert_not_called()
        self.assertEqual([row["kind"] for row in rows], ["text", "other", "other", "text"])
        self.assertEqual(rows[0]["text"], "周六下午可以。")
        self.assertEqual(rows[0]["senderRole"], "other")
        self.assertEqual(rows[0]["at"], "2026-10-13 10:03")
        self.assertEqual(rows[0]["source"]["mediaKind"], "voice")
        self.assertEqual(rows[0]["source"]["transcriptionStatus"], "visible-text")
        self.assertEqual(rows[1]["source"]["transcriptionStatus"], "not-visible")
        self.assertEqual(rows[2]["source"]["transcriptionStatus"], "failed")
        self.assertEqual(rows[1]["source"]["nativeConversionOutcome"], "source-or-window-changed")
        self.assertEqual(rows[2]["source"]["nativeConversionOutcome"], "source-or-window-changed")
        self.assertNotIn("mediaKind", rows[3]["source"])
        self.assertEqual(rows[3]["text"], '语音12"秒这是输入的字')
        normalized = normalized_capture("chat", "好友", "synthetic_account", rows, warnings)
        self.assertEqual(normalized["records"][-1]["source"]["mediaKind"], "voice")
        self.assertEqual(normalized["records"][-1]["text"], "周六下午可以。")
        self.assertTrue(any("3 条语音" in warning and "1 条" in warning and "2 条未取得转写" in warning for warning in warnings))
        listing.index = 0
        with patch("adapter._open_target", return_value=object()), patch("adapter._native_voice") as native:
            quick, _ = _chat("好友", 4, "我", lambda *args: None, (navigator, tools, ui))
        native.assert_not_called()
        self.assertEqual(quick[0]["text"], "周六下午可以。")
        self.assertEqual([row["kind"] for row in quick], ["text", "other", "other", "text"])
        self.assertNotIn("nativeConversionOutcome", quick[1]["source"])

    def test_moments_new_embedded_ui_requires_unique_visible_album(self):
        old = SimpleNamespace(exists=lambda **kwargs: True)
        missing = SimpleNamespace(exists=lambda **kwargs: False)
        album = SimpleNamespace(element_info=SimpleNamespace(automation_id="sns_list"), is_visible=lambda: True)
        other = SimpleNamespace(element_info=SimpleNamespace(automation_id="session_list"), is_visible=lambda: True)
        controls = [other, album]
        main = SimpleNamespace(descendants=lambda **kwargs: controls)
        self.assertIs(_moments_window(main, old), old)
        self.assertIs(_moments_window(main, missing), main)
        controls.append(album)
        with self.assertRaises(CaptureError):
            _moments_window(main, missing)
        controls[:] = [other]
        with self.assertRaises(CaptureError):
            _moments_window(main, missing)

    def test_target_selection_requires_one_exact_local_match(self):
        clicks = []
        def item(name):
            return SimpleNamespace(class_name=lambda: "mmui::SearchContentCellView", window_text=lambda: name,
                                   click_input=lambda: clicks.append(name))
        candidates = [item("虚构测试人")]
        listing = SimpleNamespace(wait=lambda *args, **kwargs: listing, children=lambda **kwargs: candidates)
        search = SimpleNamespace(click_input=lambda: None, set_text=lambda value: None)
        main = SimpleNamespace(descendants=lambda **kwargs: [search], child_window=lambda **kwargs:
                               listing if kwargs.get("auto_id") == "search_list" else SimpleNamespace(click_input=lambda: None))
        navigator = SimpleNamespace(open_weixin=lambda **kwargs: main)
        ui = SimpleNamespace(SideBar=SimpleNamespace(Weixin={}), Main_window=SimpleNamespace(Search={}),
                             Lists=SimpleNamespace(SearchResult={"auto_id": "search_list"}), Texts={})
        with patch("adapter._assert_target") as asserted:
            self.assertIs(_open_target("虚构测试人", (navigator, None, ui)), main)
            asserted.assert_called_once()
        self.assertEqual(clicks, ["虚构测试人"])
        candidates.append(item("虚构测试人"))
        with self.assertRaises(CaptureError) as error:
            _open_target("虚构测试人", (navigator, None, ui))
        self.assertEqual(error.exception.code, "FRIEND_AMBIGUOUS")
        self.assertEqual(len(clicks), 1)
        candidates[:] = [item("虚构测试人 同名后缀")]
        with self.assertRaises(CaptureError) as error:
            _open_target("虚构测试人", (navigator, None, ui))
        self.assertEqual(error.exception.code, "FRIEND_NOT_FOUND")
        self.assertEqual(len(clicks), 1)

    def test_chat_order_speakers_and_duplicate_text_without_real_wechat(self):
        class Item:
            def __init__(self, index, text):
                self.element_info = SimpleNamespace(runtime_id=[index])
                self.text = text
            def has_keyboard_focus(self): return True
            def class_name(self): return "mmui::ChatTextItemView"
            def window_text(self): return self.text
        class Listing:
            index = 0
            items = [Item(1, "好友 2026-10-13 10:03 嗯"), Item(2, "我 2026-10-13 10:02 嗯"), Item(3, "好友 2026-10-13 10:01 嗯"), Item(4, "未确认来源 " + "较长原文" * 600)]
            def exists(self, **kwargs): return True
            def children(self): return [self.items[self.index]]
            def type_keys(self, *args, **kwargs): self.index = min(self.index + 1, len(self.items) - 1)
        listing = Listing()
        history = SimpleNamespace(child_window=lambda **kwargs: listing, type_keys=lambda *args: None, close=lambda: None)
        main = SimpleNamespace(child_window=lambda **kwargs: SimpleNamespace(exists=lambda **kw: True))
        navigator = SimpleNamespace(open_dialog_window=lambda **kwargs: main, open_chat_history=lambda **kwargs: history)
        tools = SimpleNamespace(is_group_chat=lambda window: False, select_chatHistoryList=lambda window: object())
        ui = SimpleNamespace(Texts=SimpleNamespace(CurrentChatNameText={}), Lists=SimpleNamespace(ChatHistoryList={}), Regex_Patterns=SimpleNamespace(Chathistory_Timestamp_pattern=re.compile(r"2026-10-13 \d{2}:\d{2}")))
        with patch("adapter._open_target", return_value=main):
            rows, warnings = _chat("好友", 4, "我", lambda *args: None, (navigator, tools, ui))
        self.assertEqual([r["text"] for r in rows[:3]], ["嗯", "嗯", "嗯"])
        self.assertEqual([r["senderRole"] for r in rows], ["other", "self", "other", "unknown"])
        self.assertEqual(rows[-1]["at"], "")
        self.assertEqual(rows[0]["at"], "2026-10-13 10:03")
        self.assertTrue(any("未知" in warning for warning in warnings))
        self.assertNotIn("rawText", rows[0]["source"])
        self.assertEqual(rows[-1]["text"], "未确认来源 " + "较长原文" * 600)
        self.assertTrue(all(not isinstance(value, str) or len(value) <= 2000 for row in rows for value in row["source"].values()))

    def test_account_identity_must_be_visible_and_group_is_refused(self):
        def account_pane(values):
            text_nodes = [SimpleNamespace(window_text=lambda value=value: value) for value in values]
            group = SimpleNamespace(descendants=lambda **kwargs: text_nodes)
            pane = SimpleNamespace(child_window=lambda **kwargs: SimpleNamespace(children=lambda: [None, group]), close=lambda: None)
            return SimpleNamespace(open_my_profile=lambda **kwargs: (pane, None))
        self.assertEqual(_account(account_pane(["昵称", "微信号", "wxid_fake_only"])), ("wxid_fake_only", "昵称"))
        with self.assertRaises(CaptureError) as error:
            _account(account_pane(["昵称", "微信号", ""]))
        self.assertEqual(error.exception.code, "ACCOUNT_UNREADABLE")
        main = SimpleNamespace(child_window=lambda **kwargs: SimpleNamespace(exists=lambda **kw: True))
        with self.assertRaises(CaptureError) as error:
            _assert_target(main, "群聊", SimpleNamespace(CurrentChatNameText={}), SimpleNamespace(is_group_chat=lambda window: True))
        self.assertEqual(error.exception.code, "GROUP_NOT_SUPPORTED")


class TwoPhaseCaptureTest(unittest.TestCase):
    def setUp(self):
        self.events = []
        self.modules = {
            "pythoncom": SimpleNamespace(CoInitialize=lambda: None, CoUninitialize=lambda: None),
            "pyweixin": SimpleNamespace(Navigator=object(), Tools=object(), GlobalConfig=SimpleNamespace(), Uielements=object()),
        }
        self.voice = {"kind": "other", "sender": "本人", "senderRole": "self", "at": "原时间", "text": '语音6"秒',
                      "source": {"uiClass": "mmui::ChatVoiceItemView", "mediaKind": "voice", "rawMediaLabel": '语音6"秒', "transcriptionStatus": "not-visible"}}
        self.line = {"kind": "text", "sender": "好友", "senderRole": "other", "at": "原时间", "text": "合成测试的文字原文", "source": {"uiClass": "mmui::ChatTextItemView"}}
        self.converted = {**self.voice, "kind": "text", "text": "合成原生语音正文", "source": {**self.voice["source"], "transcriptionStatus": "visible-text"}}

    def run_capture(self, *, include_voice=None, callback=True, accounts=None, second=None, no_voice=False):
        def read(*args, convert_voices=False):
            self.events.append("convert" if convert_voices else "quick")
            if convert_voices:
                return second if second is not None else ([self.converted, self.line], [])
            return ([self.line] if no_voice else [self.voice, self.line], [])
        def partial(batch):
            self.events.append(("partial", batch))
        request = {"kind": "chat", "friend": "好友", "limit": 2}
        if include_voice is not None:
            request["includeVoice"] = include_voice
        with patch.dict("sys.modules", self.modules), patch("adapter.sys.platform", "win32"), patch("adapter._prepare_capture_ui"), \
             patch("adapter._account", side_effect=accounts or [("synthetic_account", "本人")] * 3), \
             patch("adapter._chat", side_effect=read):
            return capture(request, lambda *args: None, on_partial=partial if callback else None)

    def test_default_and_explicit_false_end_after_fast_capture(self):
        for flag in (None, False):
            self.events.clear()
            result = self.run_capture(include_voice=flag)
            self.assertEqual(self.events, ["quick"])
            self.assertEqual(result["records"][0]["text"], self.line["text"])
            self.assertEqual(result["records"][1]["kind"], "other")

    def test_explicit_voice_first_publishes_account_checked_text_then_converts(self):
        result = self.run_capture(include_voice=True)
        self.assertEqual([event[0] if isinstance(event, tuple) else event for event in self.events], ["quick", "partial", "convert"])
        partial = self.events[1][1]
        self.assertEqual(partial["account"], "synthetic_account")
        self.assertEqual(partial["records"][1]["kind"], "other")
        self.assertEqual(result["records"][1]["text"], self.converted["text"])
        self.assertEqual(partial["records"][1]["kind"], "other", "final result cannot mutate already published partial")

    def test_no_callback_or_no_missing_voice_does_not_start_second_pass(self):
        for kwargs in ({"callback": False}, {"no_voice": True}):
            self.events.clear()
            self.run_capture(include_voice=True, **kwargs)
            self.assertEqual(self.events, ["quick"])

    def test_account_change_before_partial_publishes_nothing(self):
        with self.assertRaises(CaptureError) as result:
            self.run_capture(include_voice=True, accounts=[("original", "本人"), ("foreign", "本人")])
        self.assertEqual(result.exception.code, "ACCOUNT_CHANGED")
        self.assertEqual(self.events, ["quick"])

    def test_account_or_nickname_change_after_partial_preserves_only_first_batch(self):
        for changed in (("foreign", "本人"), ("synthetic_account", "另一人")):
            self.events.clear()
            with self.assertRaises(CaptureError) as result:
                self.run_capture(include_voice=True, accounts=[("synthetic_account", "本人")] * 2 + [changed])
            self.assertEqual(result.exception.code, "ACCOUNT_CHANGED")
            self.assertEqual(len([event for event in self.events if isinstance(event, tuple)]), 1)
            self.assertEqual(self.events[1][1]["records"][1]["kind"], "other")

    def test_changed_second_pass_speaker_or_range_is_not_published(self):
        for rows in ([{**self.converted, "senderRole": "other"}, self.line], [self.converted]):
            self.events.clear()
            with self.assertRaises(CaptureError) as result:
                self.run_capture(include_voice=True, second=(rows, []))
            self.assertEqual(result.exception.code, "SOURCE_CHANGED")
            self.assertEqual(len([event for event in self.events if isinstance(event, tuple)]), 1)

    def test_worker_relays_partial_before_final(self):
        events = []
        partial = {"version": 1, "records": [{"text": "合成原文"}]}
        final = {"version": 1, "records": [{"text": "合成原文与语音"}]}
        def run(request, progress, on_partial=None):
            on_partial(partial)
            progress(60, "文字已导入，正在补全语音…")
            return final
        conn = SimpleNamespace(send=events.append, close=lambda: None)
        with patch("adapter.capture", side_effect=run):
            _capture_process(conn, {"includeVoice": True})
        self.assertEqual([event["type"] for event in events], ["partial", "progress", "result"])
        self.assertEqual(events[0]["partial"], partial)
        self.assertEqual(events[-1]["result"], final)


class CompatibilityTest(unittest.TestCase):
    def test_qt_shell_is_not_misreported_as_a_login_request(self):
        import compatibility
        state = {"class": "Qt51514QWindowIcon"}
        modules = {
            "psutil": SimpleNamespace(process_iter=lambda fields: [SimpleNamespace(pid=123, info={"name": "Weixin.exe", "exe": "synthetic.exe"})]),
            "win32api": SimpleNamespace(GetFileVersionInfo=lambda *args: {"FileVersionMS": (4 << 16) | 1, "FileVersionLS": (15 << 16) | 13}),
            "win32gui": SimpleNamespace(EnumWindows=lambda callback, arg: callback(1, arg), IsWindowVisible=lambda hwnd: True, GetClassName=lambda hwnd: "Qt51514QWindowIcon"),
            "win32process": SimpleNamespace(GetWindowThreadProcessId=lambda hwnd: (1, 123)),
            "pythoncom": SimpleNamespace(CoInitialize=lambda: None, CoUninitialize=lambda: None),
            "pywinauto": SimpleNamespace(Desktop=lambda **kwargs: SimpleNamespace(window=lambda **kwargs: SimpleNamespace(element_info=SimpleNamespace(class_name=state["class"])))),
        }
        with patch.dict("sys.modules", modules), patch.object(compatibility.sys, "platform", "win32"), patch.object(compatibility.importlib.metadata, "version", return_value="synthetic"):
            shell = compatibility.compatibility_probe()
            self.assertFalse(shell["ready"])
            self.assertIn("微信已打开", shell["message"])
            self.assertIn("界面文字暂不可读取", shell["message"])
            self.assertNotIn("登录", shell["message"])
            state["class"] = "mmui::LoginWindow"
            self.assertIn("完成登录", compatibility.compatibility_probe()["message"])
            state["class"] = "mmui::MainWindow"
            self.assertTrue(compatibility.compatibility_probe()["ready"])


class BridgeTest(unittest.TestCase):
    def setUp(self):
        self.state = CollectorState(health_provider=lambda: {"ready": True, "capabilities": {"chat": True, "moments": True}, "message": "mock only"}, capture_target=fake_capture)
        self.server = server_for(self.state, 0)
        self.port = self.server.server_port
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.origin = "https://coach.lovetalk.love"

    def tearDown(self):
        with self.state.lock:
            self.state.cancel_active()
        self.server.shutdown()
        self.server.server_close()

    def request(self, method, path, body=None, headers=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        complete = {"Origin": self.origin}
        if body is not None:
            body = json.dumps(body)
            complete["Content-Type"] = "application/json"
        complete.update(headers or {})
        conn.request(method, path, body, complete)
        response = conn.getresponse()
        raw = response.read()
        out = response.status, json.loads(raw), dict(response.getheaders())
        conn.close()
        return out

    def pair(self):
        status, payload, _ = self.request("POST", "/pair", {"code": self.state.code})
        self.assertEqual(status, 200)
        return {"Authorization": "Bearer " + payload["token"]}

    def test_origin_host_token_and_paths(self):
        status, health, _ = self.request("GET", "/health")
        self.assertEqual(status, 200)
        self.assertTrue(health["capabilities"]["deferredVoice"])
        self.assertEqual(self.request("GET", "/health", headers={"Origin": "https://evil.example"})[0], 403)
        self.assertEqual(self.request("GET", "/health", headers={"Origin": "null"})[0], 403)
        self.assertEqual(self.request("GET", "/health", headers={"Host": "evil.example"})[0], 403)
        self.assertEqual(self.request("POST", "/capture", {"kind": "chat", "friend": "虚构", "limit": 5})[0], 401)
        token = self.pair()
        self.assertEqual(self.request("GET", "/health?file=C:/secret", headers=token)[0], 400)
        self.assertEqual(self.request("GET", "/files/private", headers=token)[0], 404)
        self.assertEqual(self.request("POST", "/capture", {"kind": "chat", "friend": "虚构", "limit": True}, token)[0], 400)
        self.assertEqual(self.request("POST", "/capture", {"kind": "chat", "friend": "虚构", "limit": 501}, token)[0], 400)
        self.assertEqual(self.request("POST", "/capture", {"kind": "chat", "friend": "虚构", "limit": 5, "path": "C:/secret"}, token)[0], 400)
        for flag in (1, 0, "true", None, []):
            self.assertEqual(self.request("POST", "/capture", {"kind": "chat", "friend": "虚构", "limit": 5, "includeVoice": flag}, token)[0], 400)
        self.assertEqual(self.request("GET", "/jobs/" + "a" * 24, headers={**token, "Origin": "http://localhost:3000"})[0], 401)
        self.state.rotate()
        self.assertEqual(self.request("GET", "/jobs/" + "a" * 24, headers=token)[0], 401)

    def test_pair_rate_limit_expiry_and_replay(self):
        old_code = self.state.code
        self.pair()
        self.assertEqual(self.request("POST", "/pair", {"code": old_code})[0], 401)
        for _ in range(4):
            self.assertEqual(self.request("POST", "/pair", {"code": "WRONG"})[0], 401)
        self.assertEqual(self.request("POST", "/pair", {"code": self.state.code})[0], 429)
        self.state.pair_failures.clear()
        self.state.code_created -= 601
        self.assertEqual(self.request("POST", "/pair", {"code": self.state.code})[0], 410)

    def test_ui_not_ready_still_allows_explicit_worker_preparation(self):
        token = self.pair()
        message = "微信已打开，但当前账号的界面文字暂不可读取。"
        self.state.health_provider = lambda: {"ready": False, "message": message}
        status, payload, _ = self.request("POST", "/capture", {"kind": "chat", "friend": "虚构", "limit": 5}, token)
        self.assertEqual(status, 202)
        self.assertIn("jobId", payload)
        self.state.cancel_active()
        for invalid in (None, {}, "   ", "长" * 1000):
            self.state.health_provider = lambda value=invalid: {"ready": False, "message": value}
            health = self.state.health()
            self.assertTrue(0 < len(health["uiMessage"]) <= 500)
            self.assertEqual(health["message"], health["uiMessage"])

    def test_preflight_and_body_limit(self):
        status, _, headers = self.request("OPTIONS", "/capture", headers={"Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization, content-type", "Access-Control-Request-Private-Network": "true"})
        self.assertEqual(status, 200)
        self.assertEqual(headers.get("Access-Control-Allow-Origin"), self.origin)
        self.assertEqual(headers.get("Access-Control-Allow-Private-Network"), "true")
        self.assertEqual(self.request("POST", "/pair", {"code": "a" * (64 * 1024)})[0], 413)
        self.assertEqual(self.request("OPTIONS", "/capture", headers={"Access-Control-Request-Method": "DELETE"})[0], 403)

    def test_mock_job_scope_and_result(self):
        token = self.pair()
        status, started, _ = self.request("POST", "/capture", {"kind": "chat", "friend": "虚构", "limit": 5}, token)
        self.assertEqual(status, 202)
        self.assertEqual(self.request("POST", "/capture", {"kind": "chat", "friend": "虚构", "limit": 5}, token)[0], 409)
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            status, job, _ = self.request("GET", "/jobs/" + started["jobId"], headers=token)
            if job["status"] != "running":
                break
            time.sleep(0.05)
        self.assertEqual(job["status"], "completed", job)
        self.assertEqual(job["result"]["account"], "fake_account_only")
        self.assertIs(job["result"]["records"][0]["source"]["requestedVoice"], False)
        self.assertNotIn("process", job)
        self.state.jobs[started["jobId"]]["updated"] -= 901
        self.assertEqual(self.request("GET", "/jobs/" + started["jobId"], headers=token)[0], 404)

    def test_cancel_discards_results_and_releases_capture(self):
        token = self.pair()
        _, started, _ = self.request("POST", "/capture", {"kind": "chat", "friend": "虚构", "limit": 1}, token)
        status, stopped, _ = self.request("POST", "/jobs/" + started["jobId"] + "/cancel", {}, token)
        self.assertEqual(status, 200)
        self.assertEqual(stopped["status"], "cancelled")
        self.assertIsNone(self.state.active)
        self.assertNotIn("result", self.state.get(started["jobId"]))

    def wait_job(self, job_id, token, predicate):
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline:
            status, job, _ = self.request("GET", "/jobs/" + job_id, headers=token)
            self.assertEqual(status, 200)
            if predicate(job):
                return job
            time.sleep(.03)
        self.fail("synthetic capture did not reach expected state")

    def start_partial(self, limit=3):
        self.state.capture_target = fake_partial_capture
        token = self.pair()
        status, started, _ = self.request("POST", "/capture", {"kind": "chat", "friend": "虚构", "limit": limit, "includeVoice": True}, token)
        self.assertEqual(status, 202)
        return started["jobId"], token

    def test_partial_is_available_before_final_and_stays_scoped(self):
        job_id, token = self.start_partial()
        interim = self.wait_job(job_id, token, lambda job: job["partialRevision"] == 1)
        self.assertEqual(interim["partial"]["account"], "fake_account_only")
        self.assertTrue(interim["partial"]["records"][0]["source"]["requestedVoice"])
        final = self.wait_job(job_id, token, lambda job: job["status"] == "completed")
        self.assertEqual(final["partialRevision"], 1)
        self.assertEqual(final["partial"], final["result"])
        self.assertEqual(self.request("GET", "/jobs/" + job_id, headers={**token, "Origin": "http://localhost:3000"})[0], 401)
        self.state.rotate()
        self.assertEqual(self.request("GET", "/jobs/" + job_id, headers=token)[0], 401)

    def test_cancel_returns_and_preserves_completed_partial(self):
        job_id, token = self.start_partial(1)
        interim = self.wait_job(job_id, token, lambda job: job["partialRevision"] == 1)
        status, cancelled, _ = self.request("POST", "/jobs/" + job_id + "/cancel", {}, token)
        self.assertEqual(status, 200)
        self.assertEqual(cancelled["status"], "cancelled")
        self.assertEqual(cancelled["partialRevision"], 1)
        self.assertEqual(cancelled["partial"], interim["partial"])
        self.assertEqual(self.state.get(job_id)["partial"], interim["partial"])
        self.assertIsNone(self.state.active)

    def test_error_or_interruption_preserves_completed_partial(self):
        for limit, code in ((2, "SOURCE_CHANGED"), (4, "CAPTURE_INTERRUPTED")):
            job_id, token = self.start_partial(limit)
            failed = self.wait_job(job_id, token, lambda job: job["status"] == "failed")
            self.assertEqual(failed["error"]["code"], code)
            self.assertEqual(failed["partialRevision"], 1)
            self.assertEqual(failed["partial"]["account"], "fake_account_only")
            self.assertNotIn("result", failed)

    def test_timeout_preserves_completed_partial(self):
        with patch("bridge.JOB_TIMEOUT", 2):
            job_id, token = self.start_partial(5)
            failed = self.wait_job(job_id, token, lambda job: job["status"] == "failed")
        self.assertEqual(failed["error"]["code"], "CAPTURE_TIMEOUT")
        self.assertEqual(failed["partialRevision"], 1)
        self.assertIn("partial", failed)


if __name__ == "__main__":
    unittest.main()
