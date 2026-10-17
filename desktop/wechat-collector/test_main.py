"""Synthetic startup checks; no browser, network, or WeChat access."""
import sys
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import Mock, patch
from urllib.parse import parse_qs, urlsplit

from bridge import CollectorState
import main as collector_main
from pairing import CONNECTION_PAGE, WEB_ORIGIN, open_connection_page


class StartupConnectionTest(unittest.TestCase):
    def launch(self, browser_opens):
        events = []
        urls = []
        callbacks = []
        captured = {}
        capture = Mock(side_effect=AssertionError("Startup must not read WeChat"))
        health = Mock(side_effect=AssertionError("Startup must not inspect WeChat"))
        root = Mock()
        root.after.side_effect = lambda delay, callback: callbacks.append((delay, callback))
        root.mainloop.side_effect = lambda: next(callback for delay, callback in callbacks if delay == 250)()

        tkinter = ModuleType("tkinter")
        tkinter.Tk = lambda: root
        tkinter.Label = lambda *args, **kwargs: Mock()
        tkinter.Button = lambda *args, **kwargs: Mock()
        tkinter.Frame = lambda *args, **kwargs: Mock()
        tkinter.StringVar = lambda *args, **kwargs: Mock()
        tkinter.messagebox = SimpleNamespace(showerror=Mock())

        server = Mock()
        def make_server(state):
            captured["state"] = state
            events.append("bound")
            return server

        class FakeThread:
            def __init__(self, target, daemon):
                self.target = target

            def start(self):
                events.append("serving")

        def open_page(state):
            self.assertIs(state, captured["state"])
            self.assertEqual(events, ["bound", "serving"])
            events.append("browser")
            return open_connection_page(state, opener=lambda url: urls.append(url) or browser_opens)

        with patch.dict(sys.modules, {"tkinter": tkinter}), \
             patch.object(sys, "argv", ["ChengziWeChatCollector.exe"]), \
             patch.object(collector_main, "CollectorState", side_effect=lambda: CollectorState(health_provider=health, capture_target=capture)), \
             patch.object(collector_main, "server_for", side_effect=make_server), \
             patch.object(collector_main, "threading", SimpleNamespace(Thread=FakeThread)), \
             patch.object(collector_main, "open_connection_page", side_effect=open_page):
            collector_main.main()

        capture.assert_not_called()
        health.assert_not_called()
        return root, captured["state"], urls, events

    def test_startup_opens_one_time_handoff_then_minimizes(self):
        root, state, urls, events = self.launch(True)
        self.assertEqual(events, ["bound", "serving", "browser"])
        self.assertEqual(len(urls), 1)
        self.assertTrue(urls[0].startswith(CONNECTION_PAGE + "#connect="))
        self.assertEqual(state.token, "")
        self.assertEqual(state.jobs, {})
        self.assertIsNone(state.active)
        root.iconify.assert_called_once_with()
        handoff = parse_qs(urlsplit(urls[0]).fragment)["connect"][0]
        self.assertIn("token", state.pair_handoff(WEB_ORIGIN, handoff))

    def test_browser_failure_keeps_visible_code_fallback(self):
        root, state, urls, events = self.launch(False)
        self.assertEqual(events, ["bound", "serving", "browser"])
        self.assertEqual(len(urls), 1)
        root.iconify.assert_not_called()
        self.assertEqual(state.handoff_digest, b"")
        self.assertEqual(len(state.code), 8)
        self.assertIn("连接码", state.local_message)


if __name__ == "__main__":
    unittest.main()
