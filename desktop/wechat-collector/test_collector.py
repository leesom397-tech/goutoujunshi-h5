"""All communication content below is invented. No real WeChat is opened by tests."""
import http.client
import json
import threading
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch
import re

from bridge import BridgeError, CollectorState, ORIGINS, server_for
from normalize import normalized_capture
from adapter import CaptureError, _account, _chat, _assert_target, _open_target, _moments_window


def fake_capture(conn, request):
    conn.send({"type": "progress", "progress": 40, "message": "mock progress"})
    time.sleep(0.2)
    result = normalized_capture(request["kind"], request["friend"], "fake_account_only", [{"kind": "text", "text": "虚构测试消息", "sender": "测试人", "at": ""}])
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
        self.assertEqual(self.request("GET", "/health")[0], 200)
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

    def test_preflight_and_body_limit(self):
        status, _, headers = self.request("OPTIONS", "/capture", headers={"Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization, content-type", "Access-Control-Request-Private-Network": "true"})
        self.assertEqual(status, 200)
        self.assertEqual(headers.get("Access-Control-Allow-Origin"), self.origin)
        self.assertEqual(headers.get("Access-Control-Allow-Private-Network"), "true")
        self.assertEqual(self.request("POST", "/pair", {"code": "a" * 5000})[0], 413)
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


if __name__ == "__main__":
    unittest.main()
