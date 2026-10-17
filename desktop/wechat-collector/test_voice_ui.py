import re
import unittest
from types import SimpleNamespace
from voice_ui import transcribe_visible_voice


class Node:
    def __init__(self, identity, label="", control="ListItem", pid=10):
        self.element_info = SimpleNamespace(runtime_id=[identity], control_type=control)
        self.label, self.pid, self.keys, self.clicks = label, pid, [], 0
        self.visible = self.enabled = self.focused = True
        self.ui_class = "mmui::ChatVoiceItemView"
    def class_name(self): return self.ui_class
    def process_id(self): return self.pid
    def is_visible(self): return self.visible
    def is_enabled(self): return self.enabled
    def has_keyboard_focus(self): return self.focused
    def window_text(self): return self.label
    def type_keys(self, keys, **kwargs): self.keys.append(keys)
    def click_input(self): self.clicks += 1


class VoiceUITest(unittest.TestCase):
    def setUp(self):
        self.item = Node(1)
        self.menu = Node(2, "语音转文字", "MenuItem")
        self.now, self.menu_calls, self.target_checks = 0.0, 0, 0
        self.foreground = True
        self.body = '语音5"秒这是虚构测试正文。'
        self.before, self.after = [], [self.menu]
    def menus(self):
        self.menu_calls += 1
        return self.before if self.menu_calls == 1 else self.after
    def verify(self): self.target_checks += 1
    def sleep(self, seconds): self.now += seconds
    def run_voice(self, **kwargs):
        args = dict(verify_target=self.verify, menu_items=self.menus, read_body=lambda: self.body,
                    foreground_ok=lambda: self.foreground, timeout=1, clock=lambda: self.now, sleep=self.sleep)
        args.update(kwargs)
        return transcribe_visible_voice(self.item, '语音5"秒', re.compile(r'(?<=语音)\d+"秒(.*)$'), **args)
    def test_native_result_keeps_provenance(self):
        result, reason = self.run_voice()
        self.assertEqual(reason, "converted")
        self.assertEqual(result["text"], "这是虚构测试正文。")
        self.assertEqual(result["source"]["transcriptionSource"], "wechat-native-visible-ui")
        self.assertEqual(self.menu.clicks, 1)
        self.assertEqual(self.item.keys, ["+{F10}"])
        self.assertGreater(self.target_checks, 2)
    def test_wrong_or_existing_menu_never_clicked(self):
        for mode in ("wrong-label", "other-process", "not-menu", "duplicate", "existing"):
            with self.subTest(mode=mode):
                self.setUp()
                if mode == "wrong-label": self.menu.label = "删除"
                if mode == "other-process": self.menu.pid = 20
                if mode == "not-menu": self.menu.element_info.control_type = "Text"
                if mode == "duplicate": self.after.append(Node(3, "转文字", "MenuItem"))
                if mode == "existing": self.before = [self.menu]
                _, reason = self.run_voice()
                self.assertEqual(reason, "conversion-menu-unavailable")
                self.assertEqual(self.menu.clicks, 0)
                self.assertEqual(self.item.keys, ["+{F10}", "{ESC}"])
    def test_delayed_menu_becomes_available_within_original_deadline(self):
        def delayed_menu():
            self.menu_calls += 1
            return [self.menu] if self.now >= 0.4 else []
        result, reason = self.run_voice(menu_items=delayed_menu)
        self.assertEqual(reason, "converted")
        self.assertTrue(result["text"])
        self.assertGreater(self.menu_calls, 3)
        self.assertLess(self.now, 1)
        self.assertEqual(self.menu.clicks, 1)
    def test_initial_empty_popup_snapshot_is_retried(self):
        def empty_then_ready():
            self.menu_calls += 1
            return [self.menu] if self.menu_calls >= 3 else []
        self.assertEqual(self.run_voice(menu_items=empty_then_ready)[1], "converted")
        self.assertEqual(self.menu_calls, 3)
        self.assertEqual(self.menu.clicks, 1)
    def test_ambiguous_popup_stops_even_if_later_snapshot_would_be_unique(self):
        second = Node(3, "转文字", "MenuItem")
        def ambiguous_then_unique():
            self.menu_calls += 1
            if self.menu_calls == 1: return []
            return [self.menu, second] if self.menu_calls == 2 else [self.menu]
        self.assertEqual(self.run_voice(menu_items=ambiguous_then_unique)[1], "conversion-menu-unavailable")
        self.assertEqual(self.menu_calls, 2)
        self.assertEqual((self.menu.clicks, second.clicks), (0, 0))
        self.assertEqual(self.item.keys, ["+{F10}", "{ESC}"])
    def test_unavailable_popup_stays_bounded(self):
        self.after = []
        self.assertEqual(self.run_voice(timeout=8)[1], "conversion-menu-unavailable")
        self.assertLessEqual(self.now, 2)
        self.assertGreater(self.menu_calls, 2)
        self.assertEqual(self.menu.clicks, 0)
    def test_no_focused_source_means_no_native_action(self):
        self.item.focused = False
        self.assertEqual(self.run_voice()[1], "source-not-focused")
        self.assertEqual(self.item.keys, [])
    def test_expensive_menu_scan_cannot_click_after_deadline(self):
        def delayed_menu():
            found = self.menus()
            if self.menu_calls == 2: self.now += 10
            return found
        self.assertEqual(self.run_voice(menu_items=delayed_menu)[1], "time-limit")
        self.assertEqual(self.menu.clicks, 0)
    def test_expensive_target_check_cannot_open_menu(self):
        def verify(): self.now += 10
        self.assertEqual(self.run_voice(verify_target=verify)[1], "time-limit")
        self.assertEqual(self.item.keys, [])
    def test_changed_runtime_cannot_click_or_dismiss_another_source(self):
        def changed_menu():
            found = self.menus()
            if self.menu_calls == 2: self.item.element_info.runtime_id = [999]
            return found
        self.assertEqual(self.run_voice(menu_items=changed_menu)[1], "source-or-window-changed")
        self.assertEqual(self.menu.clicks, 0)
        self.assertNotIn("{ESC}", self.item.keys)
    def test_changed_foreground_never_receives_escape(self):
        def changed_menu():
            found = self.menus()
            if self.menu_calls == 2: self.foreground = False
            return found
        self.assertEqual(self.run_voice(menu_items=changed_menu)[1], "source-or-window-changed")
        self.assertEqual(self.menu.clicks, 0)
        self.assertNotIn("{ESC}", self.item.keys)
    def test_foreground_change_during_empty_popup_poll_stops_immediately(self):
        def empty_then_change():
            self.menu_calls += 1
            if self.menu_calls == 3: self.foreground = False
            return []
        self.assertEqual(self.run_voice(menu_items=empty_then_change)[1], "source-or-window-changed")
        self.assertEqual(self.menu_calls, 3)
        self.assertEqual(self.menu.clicks, 0)
        self.assertEqual(self.item.keys, ["+{F10}"])
    def test_contact_change_blocks_popup_cleanup(self):
        changed = False
        def menus():
            nonlocal changed
            self.menu_calls += 1
            if self.menu_calls == 2: changed = True
            return []
        def verify():
            if changed: raise ValueError("contact changed")
        self.assertEqual(self.run_voice(menu_items=menus, verify_target=verify)[1], "source-or-window-changed")
        self.assertEqual(self.item.keys, ["+{F10}"])
    def test_pending_and_failed_are_not_transcripts(self):
        self.body = '语音5"秒正在转换'
        result, reason = self.run_voice()
        self.assertEqual(reason, "time-limit")
        self.assertEqual(result["text"], "")
        self.assertEqual(result["source"]["transcriptionStatus"], "pending")
        self.setUp()
        self.body = '语音5"秒转换失败'
        result, reason = self.run_voice()
        self.assertEqual(reason, "native-conversion-failed")
        self.assertEqual(result["text"], "")
    def test_changed_sender_body_rejected(self):
        def reject(): raise ValueError("source sender changed")
        result, reason = self.run_voice(read_body=reject)
        self.assertEqual(reason, "source-or-window-changed")
        self.assertEqual(result["text"], "")
    def test_non_voice_not_acted_on(self):
        self.item.ui_class = "mmui::ChatTextItemView"
        self.assertEqual(self.run_voice(), (None, "not-voice"))
        self.assertEqual(self.item.keys, [])

    def test_transcript_must_stop_changing_before_import(self):
        bodies = iter(['语音5"秒测试', '语音5"秒完整测试正文', '语音5"秒完整测试正文'])
        result, outcome = self.run_voice(read_body=lambda: next(bodies))
        self.assertEqual(outcome, "converted")
        self.assertEqual(result["text"], "完整测试正文")
        self.assertAlmostEqual(self.now, .6)

    def test_single_unstable_transcript_at_deadline_is_not_imported(self):
        result, outcome = self.run_voice(timeout=.3)
        self.assertEqual(outcome, "time-limit")
        self.assertEqual(result["text"], "")
        self.assertNotEqual(result["source"]["transcriptionStatus"], "visible-text")

    def test_source_change_while_reading_cannot_return_text(self):
        def changed_body():
            self.item.element_info.runtime_id = [999]
            return self.body
        result, outcome = self.run_voice(read_body=changed_body)
        self.assertEqual(outcome, "source-or-window-changed")
        self.assertEqual(result["text"], "")

    def test_native_popup_fallback_uses_original_open_and_shared_deadline(self):
        self.after = []
        calls = []
        native = SimpleNamespace(snapshot=lambda: set(), close=lambda: None)
        def activate(before, *, deadline):
            calls.append((before, deadline))
            self.now += .4
            return {"action": "conversion-requested"}
        native.activate_opened = activate
        result, outcome = self.run_voice(timeout=5, native_menu=native)
        self.assertEqual(outcome, "converted")
        self.assertTrue(result["text"])
        self.assertEqual(calls, [(set(), 5)])
        self.assertEqual(self.item.keys, ["+{F10}"])
        self.assertEqual(self.menu.clicks, 0)

    def test_existing_native_menu_blocks_opening_context_menu(self):
        native = SimpleNamespace(snapshot=lambda: {55}, close=lambda: None)
        self.assertEqual(self.run_voice(native_menu=native)[1], "menu-already-open")
        self.assertEqual(self.item.keys, [])

    def test_failed_native_menu_does_not_read_or_import_a_transcript(self):
        self.after = []
        native = SimpleNamespace(snapshot=lambda: set(), close=lambda: None,
            activate_opened=lambda *args, **kw: {"reason": "native-menu-content-changed"})
        def forbidden_read(): self.fail("No transcript read without the exact action")
        result, outcome = self.run_voice(timeout=5, native_menu=native, read_body=forbidden_read)
        self.assertEqual(outcome, "native-menu-content-changed")
        self.assertEqual(result["text"], "")

    def test_fallback_cannot_return_success_after_overall_deadline(self):
        self.after = []
        def delayed(*args, **kw):
            self.now = 10
            return {"action": "conversion-requested"}
        native = SimpleNamespace(snapshot=lambda: set(), close=lambda: None, activate_opened=delayed)
        result, outcome = self.run_voice(timeout=5, native_menu=native)
        self.assertEqual(outcome, "time-limit")
        self.assertEqual(result["text"], "")


if __name__ == "__main__":
    unittest.main()
