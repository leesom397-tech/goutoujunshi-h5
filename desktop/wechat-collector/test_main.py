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


class ConnectionCodeCopyTest(unittest.TestCase):
    def setUp(self):
        self.root = Mock()
        self.root.after.side_effect = lambda delay, callback: "synthetic-timer"
        self.widgets = []

        class Variable:
            def __init__(self, value=""):
                self.value = value

            def set(self, value):
                self.value = value

            def get(self):
                return self.value

        class TclError(Exception):
            pass

        def widget(kind):
            def create(*args, **kwargs):
                item = Mock()
                self.widgets.append((kind, kwargs, item))
                return item
            return create

        self.tk = SimpleNamespace(Frame=widget("frame"), Label=widget("label"),
                                  Button=widget("button"), StringVar=Variable, TclError=TclError)
        self.state = CollectorState(health_provider=Mock(), capture_target=Mock())
        self.state.code = "ABCD1234"
        self.state.token = "synthetic-existing-session"
        self.state.active = "synthetic-task"
        self.state.jobs = {"synthetic-task": {"status": "running"}}
        self.code, self.reset_feedback = collector_main.connection_code_controls(self.tk, self.root, self.state)
        _, self.button, self.button_widget = next(item for item in self.widgets if item[0] == "button")
        _, self.label, self.label_widget = next(item for item in self.widgets if item[0] == "label")

    def test_button_and_clickable_code_copy_without_changing_pairing_or_capture(self):
        before = (self.state.code, self.state.token, self.state.active, dict(self.state.jobs))
        self.assertEqual(self.button["textvariable"].get(), "复制连接码")
        self.button["command"]()
        self.root.clipboard_clear.assert_called_once_with()
        self.root.clipboard_append.assert_called_once_with("ABCD1234")
        self.assertEqual(self.button["textvariable"].get(), "已复制")
        self.assertEqual((self.state.code, self.state.token, self.state.active, self.state.jobs), before)
        bindings = dict(call.args for call in self.label_widget.bind.call_args_list)
        self.assertEqual(set(bindings), {"<Button-1>", "<Return>", "<space>"})
        self.assertTrue(all(callback is self.button["command"] for callback in bindings.values()))
        delay, reset = self.root.after.call_args.args
        self.assertEqual(delay, 1800)
        reset()
        self.assertEqual(self.button["textvariable"].get(), "复制连接码")

    def test_copies_current_code_and_replaces_previous_feedback_timer(self):
        self.button["command"]()
        self.state.code = "NEWC5678"
        self.button["command"]()
        self.assertEqual(self.code.get(), "NEWC5678")
        self.root.clipboard_append.assert_called_with("NEWC5678")
        self.root.after_cancel.assert_called_with("synthetic-timer")
        self.assertEqual(self.state.token, "synthetic-existing-session")

    def test_clipboard_failure_can_be_retried_without_claiming_success(self):
        self.root.clipboard_append.side_effect = self.tk.TclError("synthetic clipboard busy")
        self.button["command"]()
        self.assertEqual(self.button["textvariable"].get(), "未复制，请重试")
        self.root.clipboard_append.side_effect = None
        self.button["command"]()
        self.assertEqual(self.button["textvariable"].get(), "已复制")
        self.assertEqual(self.state.jobs, {"synthetic-task": {"status": "running"}})


if __name__ == "__main__":
    unittest.main()
