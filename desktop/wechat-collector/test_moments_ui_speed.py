"""Synthetic album actions only. Does not connect to WeChat or send OS input."""
import json
import re
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from adapter import (CaptureError, _MomentsTimings, _moment_transition, _moments,
                     _try_moment_invoke, _wait_exists, _wait_hidden, _fast_moment_click)


class Clock:
    def __init__(self): self.now = 0.0
    def read(self): return self.now
    def sleep(self, delay): self.now += delay


class MouseSystem:
    def __init__(self, clock):
        self.clock, self.point, self.tick = clock, (500, 500), 0
        self.foreground_pid = self.hit_pid = 123
        self.foreground_root = self.hit_root = 1
        self.swapped = False
        self.events = []
        self.on_up = lambda: None
        self.modules = {
            "win32api": SimpleNamespace(GetCursorPos=lambda: self.point,
                GetLastInputInfo=lambda: self.tick, GetTickCount=lambda: int(clock.now * 1000),
                SetCursorPos=self.move, GetSystemMetrics=lambda n: self.swapped if n == 23 else 4,
                mouse_event=self.event),
            "win32gui": SimpleNamespace(GetDoubleClickTime=lambda: 500, GetForegroundWindow=lambda: 1,
                WindowFromPoint=lambda point: 2, GetAncestor=lambda hwnd, flag:
                    self.foreground_root if hwnd == 1 else self.hit_root if hwnd == 2 else 1),
            "win32process": SimpleNamespace(GetWindowThreadProcessId=lambda hwnd:
                (1, self.foreground_pid if hwnd == 1 else self.hit_pid)),
            "win32con": SimpleNamespace(MOUSEEVENTF_LEFTDOWN=2, MOUSEEVENTF_LEFTUP=4,
                MOUSEEVENTF_RIGHTDOWN=8, MOUSEEVENTF_RIGHTUP=16),
        }
    def move(self, point):
        self.point, self.tick = tuple(point), int(self.clock.now * 1000)
    def event(self, event, *_args):
        self.events.append(event)
        if event in (4, 16): self.on_up()
        self.tick = int(self.clock.now * 1000)


def physical_target(action, point=(100, 100), native=False):
    node = control(action, "back", native)
    node.backend = SimpleNamespace(name="uia")
    node.top_level_parent = lambda: SimpleNamespace(handle=3)
    node.rectangle = lambda: SimpleNamespace(left=point[0]-10, right=point[0]+10,
        top=point[1]-10, bottom=point[1]+10)
    return node


def control(action, role="post", native=True, pid=123):
    target = SimpleNamespace(
        element_info=SimpleNamespace(control_type="Button" if role == "back" else "ListItem"),
        class_name=lambda: "mmui::BackButton" if role == "back" else "mmui::AlbumContentCell",
        is_visible=lambda: True, is_enabled=lambda: True, process_id=lambda: pid,
        click_input=Mock(side_effect=action))
    if native:
        target.iface_invoke = SimpleNamespace(Invoke=Mock(side_effect=action))
    return target


class MomentsActionTests(unittest.TestCase):
    def test_return_does_not_resolve_destroyed_back_control_after_clicking(self):
        clock, active = Clock(), [True]
        mouse = MouseSystem(clock)
        def close():
            active[0] = False
            mouse.move((100,100))
        target = physical_target(close)
        def resolve():
            if not active[0]:
                clock.sleep(5)
                raise RuntimeError("disposed provider")
            return target
        query = SimpleNamespace(wrapper_object=Mock(side_effect=resolve))
        with patch.dict(sys.modules, mouse.modules), patch("adapter._ensure_foreground"):
            self.assertTrue(_moment_transition(query, "back", 123, lambda timeout: not active[0],
                3, {"back":False}, _MomentsTimings(), {}))
        query.wrapper_object.assert_called_once()
        self.assertEqual(clock.now, 0)

    def test_physical_fast_path_works_without_invoke_and_respects_swapped_buttons(self):
        for swapped in (False, True):
            clock = Clock()
            clock.now = .1
            mouse = MouseSystem(clock)
            mouse.swapped = swapped
            state = {"point":(500,500), "inputTick":0, "pid":123}
            target = physical_target(lambda: None)
            with patch.dict(sys.modules, mouse.modules), patch("adapter._ensure_foreground"):
                self.assertTrue(_fast_moment_click(target, "back", 123, state))
            self.assertEqual(mouse.events, [8,16] if swapped else [2,4])
            self.assertEqual(state["point"], (100,100))
            target.click_input.assert_not_called()

    def test_close_click_or_intervening_input_uses_guarded_path(self):
        for reason in ("nearby", "user-input"):
            clock, mouse = Clock(), None
            clock.now = .1
            mouse = MouseSystem(clock)
            state = {"point":(100,100) if reason == "nearby" else (500,500), "inputTick":0, "pid":123}
            if reason == "user-input": mouse.tick = 50
            target = physical_target(lambda: None)
            with patch.dict(sys.modules, mouse.modules), patch("adapter._ensure_foreground"):
                self.assertFalse(_fast_moment_click(target, "back", 123, state))
            self.assertEqual(mouse.events, [])

    def test_occluded_or_moving_target_receives_no_fast_click(self):
        for reason in ("occlusion", "same-process-popup", "same-process-foreground", "moved"):
            clock = Clock()
            clock.now = .1
            mouse = MouseSystem(clock)
            state = {"point":(500,500), "inputTick":0, "pid":123}
            target = physical_target(lambda: None)
            if reason == "occlusion": mouse.hit_pid = 999
            elif reason == "same-process-popup": mouse.hit_root = 77
            elif reason == "same-process-foreground": mouse.foreground_root = 77
            else:
                target.rectangle = Mock(side_effect=[
                    SimpleNamespace(left=90,top=90,right=110,bottom=110),
                    SimpleNamespace(left=190,top=90,right=210,bottom=110)])
            with patch.dict(sys.modules, mouse.modules), patch("adapter._ensure_foreground"):
                if reason in ("occlusion", "same-process-popup", "same-process-foreground"):
                    with self.assertRaises(CaptureError): _fast_moment_click(target, "back", 123, state)
                else:
                    self.assertFalse(_fast_moment_click(target, "back", 123, state))
            self.assertEqual(mouse.events, [])

    def test_supported_action_is_verified_before_any_physical_fallback(self):
        clock, state = Clock(), [False]
        target = control(lambda: state.__setitem__(0, True))
        with patch("adapter._ensure_foreground") as foreground:
            metrics = _MomentsTimings()
            self.assertTrue(_moment_transition(target, "post", 123, lambda timeout: state[0], 4, {}, metrics))
        target.click_input.assert_not_called()
        target.iface_invoke.Invoke.assert_called_once()
        self.assertEqual(foreground.call_count, 2)
        self.assertEqual(metrics.snapshot()["actions"]["postInvokeConfirmed"], 1)

    def test_missing_pattern_falls_back_immediately_and_is_only_probed_once(self):
        target = control(lambda: None, native=False)
        state, metrics = {}, _MomentsTimings()
        with patch("adapter._ensure_foreground"), patch("adapter._try_moment_invoke", wraps=_try_moment_invoke) as invoke:
            for _ in range(5):
                self.assertTrue(_moment_transition(target, "post", 123, lambda timeout: True, 4, state, metrics))
        self.assertEqual(invoke.call_count, 1)
        self.assertEqual(target.click_input.call_count, 5)
        self.assertEqual(metrics.snapshot()["actions"]["postInvokeUnsupported"], 1)

    def test_noop_provider_gets_full_deadline_then_physical_fallback_once(self):
        clock, active = Clock(), [False]
        target = control(lambda: active.__setitem__(0, True))
        target.iface_invoke.Invoke.side_effect = lambda: None
        detail = SimpleNamespace(exists=lambda **kw: active[0], is_visible=lambda: active[0])
        modes = {}
        with patch("adapter.time.monotonic", side_effect=clock.read), patch("adapter.time.perf_counter", side_effect=clock.read), \
             patch("adapter.time.sleep", side_effect=clock.sleep), patch("adapter._ensure_foreground"):
            metrics = _MomentsTimings()
            self.assertTrue(_moment_transition(target, "post", 123, lambda timeout: _wait_exists(detail, timeout, True), 4, modes, metrics))
            self.assertEqual(clock.now, 4)
            active[0] = False
            self.assertTrue(_moment_transition(target, "post", 123, lambda timeout: _wait_exists(detail, timeout, True), 4, modes, metrics))
            self.assertEqual(clock.now, 4, "a no-op provider must not add four seconds to every subsequent post")
        target.iface_invoke.Invoke.assert_called_once()
        self.assertEqual(target.click_input.call_count, 2)

    def test_slow_native_open_and_close_are_not_interrupted_by_fallback(self):
        clock = Clock()
        detail = SimpleNamespace(exists=lambda **kw: clock.now >= 3.6,
                                 is_visible=lambda: 3.6 <= clock.now < 6.4)
        target = control(lambda: None)
        back = control(lambda: None, role="back")
        with patch("adapter.time.monotonic", side_effect=clock.read), patch("adapter.time.perf_counter", side_effect=clock.read), \
             patch("adapter.time.sleep", side_effect=clock.sleep), patch("adapter._ensure_foreground"):
            metrics = _MomentsTimings()
            self.assertTrue(_moment_transition(target, "post", 123, lambda timeout: _wait_exists(detail, timeout, True), 4, {}, metrics))
            self.assertTrue(_moment_transition(back, "back", 123, lambda timeout: _wait_hidden(detail, timeout), 3, {}, metrics))
        self.assertGreaterEqual(clock.now, 6.4)
        target.click_input.assert_not_called()
        back.click_input.assert_not_called()

    def test_ambiguous_dispatch_error_still_checks_state_before_second_action(self):
        active = [False]
        def dispatched_then_failed():
            active[0] = True
            raise RuntimeError("synthetic provider response failure")
        target = control(dispatched_then_failed)
        with patch("adapter._ensure_foreground"):
            self.assertTrue(_moment_transition(target, "post", 123, lambda timeout: active[0], 4, {}, _MomentsTimings()))
        target.click_input.assert_not_called()

    def test_wrong_process_and_lost_foreground_stop_without_clicking(self):
        for failure in ("process", "foreground"):
            target = control(lambda: None, pid=999 if failure == "process" else 123)
            guard = CaptureError("FOCUS_CHANGED", "synthetic") if failure == "foreground" else None
            with patch("adapter._ensure_foreground", side_effect=guard), self.assertRaises(CaptureError):
                _moment_transition(target, "post", 123, lambda timeout: True, 4, {}, _MomentsTimings())
            target.click_input.assert_not_called()
            target.iface_invoke.Invoke.assert_not_called()

    def test_unsupported_item_type_is_never_invoked(self):
        target = control(lambda: None)
        target.class_name = lambda: "mmui::UnrelatedContact"
        with patch("adapter._ensure_foreground"):
            self.assertFalse(_try_moment_invoke(target, "post", 123))
        target.iface_invoke.Invoke.assert_not_called()

    def test_cancel_is_not_swallowed_by_native_dispatch_or_fallback(self):
        target = control(lambda: (_ for _ in ()).throw(KeyboardInterrupt()))
        with patch("adapter._ensure_foreground"), self.assertRaises(KeyboardInterrupt):
            _moment_transition(target, "post", 123, lambda timeout: True, 4, {}, _MomentsTimings())
        target.click_input.assert_not_called()

    def run_synthetic_album(self, native, fast=False):
        clock = Clock()
        mouse = MouseSystem(clock)
        album = SimpleNamespace(index=-1, opened=False, pending=None, ready_at=0)
        def visible():
            if album.pending is not None and clock.now >= album.ready_at:
                album.opened, album.pending = album.pending, None
            return album.opened
        def dispatch(opened, physical):
            album.pending, album.ready_at = opened, clock.now + .08
            # Scenario: 500 ms system double-click guard + 100 ms cursor/click
            # waits; semantic UIA dispatch costs 10 ms. Not a real-device claim.
            clock.sleep(.6 if physical else .01)
            mouse.move((500,500) if opened else (100,100))
        def target(opened):
            node = control(lambda: dispatch(opened, True), role="post" if opened else "back", native=native)
            if native:
                node.iface_invoke.Invoke.side_effect = lambda: dispatch(opened, False)
            if opened:
                node.window_text = lambda: f"合成动态 {album.index}"
            if fast:
                node.backend = SimpleNamespace(name="uia")
                node.top_level_parent = lambda: SimpleNamespace(handle=3)
                point = (500,500) if opened else (100,100)
                node.rectangle = lambda: SimpleNamespace(left=point[0]-10, top=point[1]-10,
                    right=point[0]+10, bottom=point[1]+10)
            return node
        mouse.on_up = lambda: dispatch(mouse.point == (500,500), False)
        album.exists = lambda **kw: True
        album.is_visible = lambda: True
        album.wait = lambda *args, **kw: album
        album.wrapper_object = lambda: album
        album.type_keys = lambda *args, **kw: setattr(album, "index", min(119, album.index + 1))
        album.children = lambda **kw: [target(True)]
        album.iface_scroll = SimpleNamespace(CurrentVerticalScrollPercent=100)
        detail = SimpleNamespace(exists=lambda **kw: visible(), is_visible=visible,
            children=lambda **kw: [SimpleNamespace(window_text=lambda: f"合成好友 动态 {album.index} 2026年10月18日")])
        back = target(False)
        window = SimpleNamespace(child_window=lambda **kw: {"album": album, "detail": detail, "back": back}[kw["auto_id"]])
        main = SimpleNamespace(handle=123, process_id=lambda: 123)
        ui = SimpleNamespace(Lists=SimpleNamespace(MomentsList={"auto_id":"album"}, SnsDetailList={"auto_id":"detail"}),
            Buttons=SimpleNamespace(BackButton={"auto_id":"back"}),
            Regex_Patterns=SimpleNamespace(Snsdetail_Timestamp_pattern=re.compile(r"2026年10月18日")))
        def advance(_listing):
            if album.index >= 119: return False
            album.index += 1
            # A real scroll is intervening input: with this one-post viewport
            # the next post uses guarded input, so this is a conservative case.
            mouse.tick = int(clock.now * 1000)
            return True
        with patch("adapter.time.monotonic", side_effect=clock.read), patch("adapter.time.perf_counter", side_effect=clock.read), \
             patch("adapter.time.sleep", side_effect=clock.sleep), patch("adapter._ensure_foreground"), \
             patch("adapter._open_target", return_value=main), patch("adapter._open_moments_from_chat", return_value=window), \
             patch("adapter._advance_moments_list", side_effect=advance), patch("adapter._image", return_value={"mime":"image/jpeg","data":"synthetic"}), \
             patch.dict(sys.modules, mouse.modules):
            result = _moments("合成好友", 200, lambda *_args, **_kw: None,
                (None, SimpleNamespace(activate_momentsList=lambda *_: None), ui), all_visible=True)
        return result, clock.now

    def test_no_invoke_capture_also_speeds_up_without_changing_records_or_end(self):
        (before, before_warnings, old_coverage), old_time = self.run_synthetic_album(False)
        (after, warnings, coverage), new_time = self.run_synthetic_album(False, fast=True)
        self.assertEqual(after, before)
        self.assertEqual(warnings, before_warnings)
        self.assertTrue(coverage["complete"])
        self.assertEqual(coverage["scrollAttempts"], old_coverage["scrollAttempts"])
        actions = coverage["timings"]["actions"]
        self.assertEqual(actions["postPhysicalGuarded"], 120)
        self.assertEqual(actions["backPhysicalFast"], 120)
        self.assertLess(new_time, old_time * .65)
        print(json.dumps({"scenario":"120 synthetic posts without Invoke, intervening scroll before each next post",
            "beforeSeconds":round(old_time,2), "afterSeconds":round(new_time,2), "actions":actions}))

    def test_full_capture_semantic_actions_preserve_all_rows_images_and_end_proof(self):
        (before, before_warnings, old_coverage), old_time = self.run_synthetic_album(False)
        (after, warnings, coverage), new_time = self.run_synthetic_album(True)
        self.assertEqual(after, before)
        self.assertEqual(warnings, before_warnings)
        self.assertEqual(len(after), 120)
        self.assertEqual(len({row["text"] for row in after}), 120)
        self.assertTrue(all(row["images"] for row in after))
        self.assertTrue(coverage["complete"])
        self.assertEqual(coverage["stopReason"], "visible-end")
        self.assertEqual(coverage["scrollAttempts"], old_coverage["scrollAttempts"])
        self.assertEqual(coverage["timings"]["actions"]["postInvokeConfirmed"], 120)
        self.assertEqual(coverage["timings"]["actions"]["backInvokeConfirmed"], 120)
        self.assertNotIn("PhysicalClick", json.dumps(coverage["timings"]))
        self.assertNotIn("合成", json.dumps(coverage["timings"], ensure_ascii=False))
        self.assertLess(new_time, old_time / 4)
        print(json.dumps({"scenario":"120 synthetic posts, 600 ms physical input / 10 ms Invoke / 80 ms UI render",
            "physicalSeconds":round(old_time, 2), "invokeSeconds":round(new_time, 2), "posts":len(after),
            "beforePhysicalActions":240, "afterPhysicalActions":0, "timings":coverage["timings"]}))


if __name__ == "__main__":
    unittest.main()
