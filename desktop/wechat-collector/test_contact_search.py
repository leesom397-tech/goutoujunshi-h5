"""Synthetic contact rows only; no real WeChat files or message content."""
import hashlib
import http.client
import json
import threading
import time
import unittest
from unittest.mock import Mock, patch

from background_reader import BackgroundCaptureError, capture_from_source, search_contacts_from_source
from bridge import BridgeError, CollectorState, server_for
from pairing import WEB_ORIGIN
from test_background_reader import Source, REQUEST


def fake_selected_capture(conn, request):
    conn.send({"type": "result", "result": {
        "friend": request["friend"], "contactId": request.get("contactId"),
        "accountKey": request.get("accountKey"), "pageSize": request.get("pageSize")}})
    conn.close()


class ContactSearchTests(unittest.TestCase):
    def test_public_wechat_id_and_safe_avatar_are_metadata_only(self):
        source = Source()
        for name in ("alias", "small_head_url", "big_head_url"):
            source.contact.execute(f"ALTER TABLE contact ADD COLUMN {name} TEXT")
        source.contact.execute("UPDATE contact SET alias='public-alias',small_head_url='http://wx.qlogo.cn/mmhead/test' WHERE username='target-user'")
        source.message_shards = lambda: self.fail("metadata search opened messages")
        result = search_contacts_from_source("public-alias", source)
        self.assertEqual(result["contacts"][0]["wechatId"], "public-alias")
        self.assertEqual(result["contacts"][0]["avatarUrl"], "https://wx.qlogo.cn/mmhead/test")
        self.assertEqual(result["contacts"][0]["avatarData"], "")
        self.assertTrue(source.closed)

    def test_avatar_url_does_not_allow_untrusted_host_or_credentials(self):
        from background_reader import _avatar_url
        for url in ("https://qlogo.cn.attacker.invalid/avatar", "file:///secret", "javascript:alert(1)",
                    "https://user:password@wx.qlogo.cn/avatar", "http://127.0.0.1/avatar"):
            self.assertEqual(_avatar_url(url), "")

    def test_partial_name_finds_styled_name_without_opening_messages(self):
        source = Source()
        source.contact.execute("UPDATE contact SET nick_name=?,remark='' WHERE username='target-user'", ("ᨳ雅欣ଓ",))
        source.message_shards = lambda: self.fail("search opened message shards")
        result = search_contacts_from_source("雅欣", source)
        self.assertTrue(source.closed)
        self.assertEqual(result["contacts"], [{
            "contactId": "target-user", "label": "ᨳ雅欣ଓ", "nickname": "ᨳ雅欣ଓ", "remark": "",
            "wechatId": "", "avatarUrl": "", "avatarData": ""}])
        self.assertEqual(result["accountKey"], hashlib.sha256(b"test-account").hexdigest())
        self.assertFalse(result["hasMore"])

    def test_same_name_and_literal_suffix_names_get_distinct_labels(self):
        source = Source()
        source.contact.execute("UPDATE contact SET nick_name='雅欣',remark='' WHERE username='target-user'")
        source.contact.execute("INSERT INTO contact VALUES('other-user','雅欣','')")
        source.contact.execute("INSERT INTO contact VALUES('literal-user','雅欣 · #literal','')")
        result = search_contacts_from_source("雅欣", source)
        labels = {item["contactId"]: item["label"] for item in result["contacts"]}
        self.assertEqual(len(labels), 3)
        self.assertEqual(len(set(labels.values())), 3)
        self.assertTrue(labels["target-user"].startswith("雅欣 · #"))
        self.assertTrue(labels["other-user"].startswith("雅欣 · #"))
        self.assertTrue(labels["literal-user"].startswith("雅欣 · #literal · #"))
        self.assertTrue(all(len(label.encode("utf-16-le")) // 2 <= 100 for label in labels.values()))
        source = Source()
        source.contact.execute("UPDATE contact SET nick_name='雅欣',remark='' WHERE username='target-user'")
        source.contact.execute("INSERT INTO contact VALUES('other-user','雅欣','')")
        request = {**REQUEST, "friend": labels["target-user"], "contactId": "target-user",
                   "accountKey": result["accountKey"]}
        batch = capture_from_source(request, lambda _: None, None, source)
        self.assertEqual(batch["friend"], labels["target-user"])

    def test_search_is_bounded_and_wildcards_are_literal(self):
        source = Source()
        for index in range(25):
            source.contact.execute("INSERT INTO contact VALUES(?,?,?)", (f"friend-{index}", f"雅欣 {index}", ""))
        result = search_contacts_from_source("雅欣", source)
        self.assertEqual(len(result["contacts"]), 20)
        self.assertTrue(result["hasMore"])
        source = Source()
        result = search_contacts_from_source("%", source)
        self.assertEqual(result["contacts"], [])
        self.assertIn("没有找到", result["message"])

    def test_selected_id_and_account_are_checked_before_reading_messages(self):
        source = Source()
        source.contact.execute("UPDATE contact SET nick_name='ᨳ雅欣ଓ',remark='' WHERE username='target-user'")
        selection = search_contacts_from_source("雅欣", source)
        item = selection["contacts"][0]
        request = {**REQUEST, "friend": item["label"], "contactId": item["contactId"],
                   "accountKey": selection["accountKey"]}
        source = Source()
        source.contact.execute("UPDATE contact SET nick_name='ᨳ雅欣ଓ',remark='' WHERE username='target-user'")
        source.add(source.shard("message_0.db"), 1, 101)
        batch = capture_from_source(request, lambda _: None, None, source)
        self.assertEqual(batch["friend"], item["label"])
        self.assertEqual(batch["records"][0]["source"]["sessionId"], "target-user")
        for change, code in (({"accountKey": "0" * 64}, "ACCOUNT_CHANGED"),
                             ({"friend": "other label"}, "CONTACT_CHANGED"),
                             ({"contactId": "missing-user"}, "CONTACT_NOT_FOUND")):
            source = Source()
            source.contact.execute("UPDATE contact SET nick_name='ᨳ雅欣ଓ',remark='' WHERE username='target-user'")
            source.message_shards = lambda: self.fail("invalid selection opened message shards")
            with self.assertRaises(BackgroundCaptureError) as raised:
                capture_from_source({**request, **change}, lambda _: None, None, source)
            self.assertEqual(raised.exception.code, code)
            self.assertTrue(source.closed)

    def test_bridge_preserves_selected_identity_on_paged_request(self):
        state = CollectorState(health_provider=lambda: {
            "ready": False, "capabilities": {"backgroundChat": True}},
            capture_target=fake_selected_capture)
        request = {**REQUEST, "mode": "background", "pageSize": 2,
                   "friend": "ᨳ雅欣ଓ", "contactId": "target-user", "accountKey": "a" * 64}
        job_id = state.start(request)["jobId"]
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline:
            job = state.get(job_id)
            if job["status"] == "completed":
                break
            time.sleep(.02)
        self.assertEqual(job["status"], "completed")
        self.assertEqual(job["result"], {"friend": "ᨳ雅欣ଓ", "contactId": "target-user",
                                          "accountKey": "a" * 64, "pageSize": 2})

    def test_capture_start_failure_cleans_job_and_reports_error(self):
        state = CollectorState(health_provider=lambda: {
            "ready": False, "capabilities": {"backgroundChat": True}})
        context = Mock()
        parent, child = Mock(), Mock()
        context.Pipe.return_value = parent, child
        context.Process.return_value.start.side_effect = OSError("synthetic process failure")
        with patch("bridge.mp.get_context", return_value=context):
            with self.assertRaises(BridgeError) as raised:
                state.start({**REQUEST, "mode": "background"})
        self.assertEqual(raised.exception.code, "CAPTURE_START_FAILED")
        self.assertIsNone(state.active)
        self.assertEqual(state.jobs, {})
        parent.close.assert_called_once()
        child.close.assert_called_once()


class ContactSearchHttpTests(unittest.TestCase):
    def setUp(self):
        self.state = CollectorState(health_provider=lambda: {"ready": True})
        self.server = server_for(self.state, port=0)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def request(self, body, token=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=3)
        headers = {"Origin": WEB_ORIGIN, "Content-Type": "application/json"}
        if token:
            headers["Authorization"] = "Bearer " + token
        try:
            connection.request("POST", "/contacts/search", json.dumps(body), headers)
            response = connection.getresponse()
            return response.status, json.loads(response.read())
        finally:
            connection.close()

    def test_search_requires_session_and_nonempty_query(self):
        with patch.object(self.state, "search_contacts", return_value={"contacts": []}) as search:
            self.assertEqual(self.request({"query": "雅欣"})[0], 401)
            search.assert_not_called()
            token = self.state.pair(WEB_ORIGIN, self.state.code)["token"]
            self.assertEqual(self.request({"query": "雅欣", "extra": True}, token)[0], 400)
            self.assertEqual(self.request({"query": "雅欣"}, token), (200, {"contacts": []}))

    def test_search_failure_is_explicit(self):
        token = self.state.pair(WEB_ORIGIN, self.state.code)["token"]
        with patch("background_reader.search_contacts", side_effect=BackgroundCaptureError(
                "DATABASE_KEY_UNAVAILABLE", "本机联系人目录无法解锁。")):
            status, result = self.request({"query": "雅欣"}, token)
        self.assertEqual(status, 409)
        self.assertEqual(result["error"]["code"], "DATABASE_KEY_UNAVAILABLE")
        self.assertIn("无法解锁", result["error"]["message"])
        status, result = self.request({"query": " "}, token)
        self.assertEqual((status, result["error"]["code"]), (400, "INVALID_CONTACT_QUERY"))
        with patch.object(self.state, "search_contacts", side_effect=OSError("synthetic transport failure")):
            status, result = self.request({"query": "雅欣"}, token)
        self.assertEqual((status, result["error"]["code"]), (503, "COLLECTOR_FAILED"))


if __name__ == "__main__":
    unittest.main()
