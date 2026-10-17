"""Synthetic connection secrets only; no browser, WeChat, or remote requests."""
from concurrent.futures import ThreadPoolExecutor
import http.client
import json
import threading
import unittest
from unittest.mock import Mock, patch
from urllib.parse import parse_qs, urlsplit

from bridge import BridgeError, CollectorState, server_for
from normalize import VERSION
from pairing import CONNECTION_PAGE, HANDOFF_TTL, SESSION_TTL, WEB_ORIGIN, open_connection_page


def exchange_secret(url):
    return parse_qs(urlsplit(url).fragment)["connect"][0]


class PairingStateTest(unittest.TestCase):
    def setUp(self):
        self.capture = Mock(side_effect=AssertionError("Pairing must not read WeChat"))
        self.health = Mock(side_effect=AssertionError("Pairing does not inspect the account"))
        self.state = CollectorState(health_provider=self.health, capture_target=self.capture)

    def assert_error(self, code, action):
        with self.assertRaises(BridgeError) as raised:
            action()
        self.assertEqual(raised.exception.code, code)

    def test_local_click_opens_fixed_page_with_only_short_lived_secret(self):
        opener = Mock(return_value=True)
        self.assertTrue(open_connection_page(self.state, opener))
        url = opener.call_args.args[0]
        self.assertTrue(url.startswith(CONNECTION_PAGE + "#connect="))
        self.assertEqual(urlsplit(url).query, "method=desktop")
        handoff = exchange_secret(url)
        self.assertRegex(handoff, r"^[A-Za-z0-9_-]{43}$")
        self.assertEqual(self.state.token, "")
        self.assertNotIn(handoff, vars(self.state).values())
        session = self.state.pair_handoff(WEB_ORIGIN, handoff)
        self.assertEqual(session["expiresIn"], SESSION_TTL)
        self.assertNotIn(session["token"], url)
        self.assertEqual(self.state.jobs, {})
        self.assertIsNone(self.state.active)
        self.capture.assert_not_called()
        self.health.assert_not_called()

    def test_open_failure_revokes_ticket_and_preserves_code_fallback(self):
        for failure in (False, OSError("synthetic launch failure")):
            code = self.state.code
            opener = Mock(side_effect=failure) if isinstance(failure, Exception) else Mock(return_value=failure)
            self.assertFalse(open_connection_page(self.state, opener))
            handoff = exchange_secret(opener.call_args.args[0])
            self.assert_error("HANDOFF_INVALID", lambda: self.state.pair_handoff(WEB_ORIGIN, handoff))
            self.assertEqual(self.state.code, code)
            self.assertIn("连接码", self.state.local_message)

    def test_handoff_requires_local_issue_and_cannot_be_replayed(self):
        self.assert_error("HANDOFF_INVALID", lambda: self.state.pair_handoff(WEB_ORIGIN, "a" * 43))
        handoff = exchange_secret(self.state.create_handoff())
        session = self.state.pair_handoff(WEB_ORIGIN, handoff)
        self.assert_error("HANDOFF_INVALID", lambda: self.state.pair_handoff(WEB_ORIGIN, handoff))
        self.assertEqual(self.state.token, session["token"])

    def test_expiry_uses_exact_deadline_and_clears_secret(self):
        with patch("bridge.time.monotonic", return_value=1000):
            handoff = exchange_secret(self.state.create_handoff())
        with patch("bridge.time.monotonic", return_value=1000 + HANDOFF_TTL):
            self.assert_error("HANDOFF_EXPIRED", lambda: self.state.pair_handoff(WEB_ORIGIN, handoff))
        self.assertEqual(self.state.handoff_digest, b"")
        self.assertEqual(self.state.token, "")

    def test_other_allowed_origin_cannot_consume_production_handoff(self):
        handoff = exchange_secret(self.state.create_handoff())
        self.assert_error("HANDOFF_ORIGIN_DENIED", lambda: self.state.pair_handoff("http://localhost:3000", handoff))
        session = self.state.pair_handoff(WEB_ORIGIN, handoff)
        self.assertEqual(self.state.origin, WEB_ORIGIN)
        self.assert_error("PAIR_REQUIRED", lambda: self.state.authorize("http://localhost:3000", "Bearer " + session["token"]))

    def test_new_local_click_replaces_only_pending_ticket(self):
        session = self.state.pair(WEB_ORIGIN, self.state.code)
        old = exchange_secret(self.state.create_handoff())
        new = exchange_secret(self.state.create_handoff())
        self.assert_error("HANDOFF_INVALID", lambda: self.state.pair_handoff(WEB_ORIGIN, old))
        self.assertTrue(self.state.authorize(WEB_ORIGIN, "Bearer " + session["token"])["connected"])
        replacement = self.state.pair_handoff(WEB_ORIGIN, new)
        self.assertNotEqual(replacement["token"], session["token"])
        self.assert_error("TOKEN_INVALID", lambda: self.state.authorize(WEB_ORIGIN, "Bearer " + session["token"]))

    def test_rotate_and_code_pairing_revoke_pending_handoff(self):
        first = exchange_secret(self.state.create_handoff())
        self.state.rotate()
        self.assert_error("HANDOFF_INVALID", lambda: self.state.pair_handoff(WEB_ORIGIN, first))
        second = exchange_secret(self.state.create_handoff())
        self.state.pair(WEB_ORIGIN, self.state.code.lower())
        self.assert_error("HANDOFF_INVALID", lambda: self.state.pair_handoff(WEB_ORIGIN, second))

    def test_handoff_and_manual_code_share_failure_limit(self):
        with patch("bridge.time.monotonic", return_value=1000):
            handoff = exchange_secret(self.state.create_handoff())
            for _ in range(3):
                self.assert_error("HANDOFF_INVALID", lambda: self.state.pair_handoff(WEB_ORIGIN, "b" * 43))
            for _ in range(2):
                self.assert_error("PAIR_INVALID", lambda: self.state.pair(WEB_ORIGIN, "bad-code"))
            self.assert_error("PAIR_RATE_LIMIT", lambda: self.state.pair_handoff(WEB_ORIGIN, handoff))
            self.assert_error("PAIR_RATE_LIMIT", lambda: self.state.pair(WEB_ORIGIN, self.state.code))
        with patch("bridge.time.monotonic", return_value=1060):
            self.assertIn("token", self.state.pair_handoff(WEB_ORIGIN, handoff))

    def test_concurrent_redemption_succeeds_exactly_once(self):
        handoff = exchange_secret(self.state.create_handoff())
        barrier = threading.Barrier(2)
        def redeem():
            barrier.wait(timeout=2)
            try:
                return self.state.pair_handoff(WEB_ORIGIN, handoff)
            except BridgeError as error:
                return error.code
        with ThreadPoolExecutor(max_workers=2) as pool:
            outcomes = list(pool.map(lambda _: redeem(), range(2)))
        self.assertEqual(sum(isinstance(value, dict) for value in outcomes), 1)
        self.assertEqual(outcomes.count("HANDOFF_INVALID"), 1)

    def test_active_capture_is_preserved_when_opening_or_redeeming(self):
        handoff = exchange_secret(self.state.create_handoff())
        self.state.active = "synthetic-active"
        self.state.jobs[self.state.active] = {"partial": "synthetic local data"}
        self.assert_error("CAPTURE_BUSY", self.state.create_handoff)
        self.assert_error("CAPTURE_BUSY", lambda: self.state.pair_handoff(WEB_ORIGIN, handoff))
        self.assertEqual(self.state.jobs[self.state.active]["partial"], "synthetic local data")

    def test_session_validation_reports_remaining_lifetime_and_expiry(self):
        with patch("bridge.time.monotonic", return_value=1000):
            session = self.state.pair(WEB_ORIGIN, self.state.code)
        authorization = "Bearer " + session["token"]
        with patch("bridge.time.monotonic", return_value=1000 + SESSION_TTL - 3.25):
            self.assertEqual(self.state.authorize(WEB_ORIGIN, authorization),
                             {"connected": True, "expiresIn": 4, "version": VERSION})
        with patch("bridge.time.monotonic", return_value=1000 + SESSION_TTL):
            self.assert_error("PAIR_REQUIRED", lambda: self.state.authorize(WEB_ORIGIN, authorization))

    def test_malformed_unicode_secrets_are_rejected_without_crashing(self):
        self.state.create_handoff()
        for supplied in ("中文", "\ud800", None, 42):
            self.assert_error("HANDOFF_INVALID", lambda value=supplied: self.state.pair_handoff(WEB_ORIGIN, value))
        self.assert_error("PAIR_INVALID", lambda: self.state.pair(WEB_ORIGIN, "\ud800"))


class PairingHttpTest(unittest.TestCase):
    def setUp(self):
        self.state = CollectorState(health_provider=lambda: {"ready": True})
        self.server = server_for(self.state, port=0)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def request(self, method, path, body=None, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=3)
        sent_headers = {"Origin": WEB_ORIGIN, **(headers or {})}
        if body is not None:
            sent_headers["Content-Type"] = "application/json"
        try:
            connection.request(method, path, body=json.dumps(body) if body is not None else None, headers=sent_headers)
            response = connection.getresponse()
            return response.status, json.loads(response.read()), dict(response.getheaders())
        finally:
            connection.close()

    def test_handoff_exchange_and_authenticated_session(self):
        self.assertEqual(self.request("GET", "/session")[0], 401)
        handoff = exchange_secret(self.state.create_handoff())
        status, session, headers = self.request("POST", "/pair/handoff", {"handoff": handoff})
        self.assertEqual(status, 200)
        self.assertEqual(set(session), {"token", "expiresIn", "version"})
        self.assertEqual(headers["Cache-Control"], "no-store")
        token_headers = {"Authorization": "Bearer " + session["token"]}
        status, connected, headers = self.request("GET", "/session", headers=token_headers)
        self.assertEqual(status, 200)
        self.assertEqual(set(connected), {"connected", "expiresIn", "version"})
        self.assertTrue(connected["connected"])
        self.assertEqual(headers["Access-Control-Allow-Origin"], WEB_ORIGIN)
        self.assertEqual(self.request("GET", "/session", headers={"Authorization": "Bearer wrong"})[0], 401)
        self.assertEqual(self.request("GET", "/session", headers={**token_headers, "Origin": "http://localhost:3000"})[0], 401)
        self.state.token_created -= SESSION_TTL
        self.assertEqual(self.request("GET", "/session", headers=token_headers)[0], 401)

    def test_handoff_schema_origin_host_and_preflight(self):
        handoff = exchange_secret(self.state.create_handoff())
        for body in ({"handoff": handoff, "origin": WEB_ORIGIN}, {"code": handoff}, {}):
            self.assertEqual(self.request("POST", "/pair/handoff", body)[0], 400)
        self.assertEqual(self.request("POST", "/pair/handoff", {"handoff": handoff}, {"Origin": "https://evil.example"})[0], 403)
        self.assertEqual(self.request("POST", "/pair/handoff", {"handoff": handoff}, {"Host": "evil.example"})[0], 403)
        status, body, _ = self.request("POST", "/pair/handoff", {"handoff": handoff}, {"Origin": "http://localhost:3000"})
        self.assertEqual((status, body["error"]["code"]), (403, "HANDOFF_ORIGIN_DENIED"))
        status, _, headers = self.request("OPTIONS", "/pair/handoff", headers={
            "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type",
            "Access-Control-Request-Private-Network": "true"})
        self.assertEqual(status, 200)
        self.assertEqual(headers["Access-Control-Allow-Private-Network"], "true")
        self.assertEqual(self.request("POST", "/pair/handoff", {"handoff": handoff})[0], 200)
        self.assertEqual(self.request("POST", "/pair/handoff", {"handoff": handoff})[0], 401)

    def test_no_http_endpoint_creates_a_handoff(self):
        for method, body in (("GET", None), ("POST", {})):
            self.assertEqual(self.request(method, "/pair/handoff", body)[0], 401 if method == "GET" else 400)
        self.assertEqual(self.state.handoff_digest, b"")


if __name__ == "__main__":
    unittest.main()
