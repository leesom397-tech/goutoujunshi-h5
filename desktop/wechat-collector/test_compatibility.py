"""Synthetic Windows metadata only. Never touches a real WeChat window."""
import sys
import threading
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch
import compatibility
import compatibility_ui as ui


def fake_windows(entries):
    return {
        "win32process": SimpleNamespace(GetWindowThreadProcessId=lambda hwnd: (1, entries[hwnd].get("pid", 123))),
        "win32gui": SimpleNamespace(
            EnumWindows=lambda visit,arg: [visit(hwnd,arg) for hwnd in entries],
            GetClassName=lambda hwnd: entries[hwnd].get("class", "Qt51514QWindowIcon"),
            GetWindow=lambda hwnd,flag: entries[hwnd].get("owner", 0),
            GetWindowLong=lambda hwnd,index: entries[hwnd].get("style", 0x00C40000) if index==-16 else entries[hwnd].get("extended", 0),
            GetClientRect=lambda hwnd: entries[hwnd].get("rect", (0,0,1000,700)),
            IsIconic=lambda hwnd:entries[hwnd].get("iconic",False),
            GetWindowPlacement=lambda hwnd:(0,2,(0,0),(0,0),(0,0,1000,700)),
            GetWindowText=lambda hwnd: entries[hwnd].get("title", "微信"),
            IsWindowVisible=lambda hwnd: entries[hwnd].get("visible", True)),
    }


class WindowSelectionTests(unittest.TestCase):
    def test_same_title_tray_shadow_popup_and_other_process_are_not_main_windows(self):
        entries = {1:{}, 2:{"rect":(0,0,1,1)}, 3:{"extended":0x80},
                   4:{"owner":1}, 5:{"pid":999}, 6:{"style":0x40000000},
                   7:{"class":"MMUIRenderSubWindow"}, 8:{"visible":False,"title":"hidden app service"}}
        with patch.dict(sys.modules, fake_windows(entries)):
            self.assertEqual(ui.wechat_windows({123}), [(1,123,True)])

    def test_hidden_main_is_preserved_and_two_real_windows_are_not_merged(self):
        with patch.dict(sys.modules, fake_windows({1:{"visible":False}, 2:{"pid":456}})):
            self.assertEqual(ui.wechat_windows({123,456}), [(1,123,False),(2,456,True)])

    def test_custom_main_title_is_allowed_by_normal_window_style(self):
        with patch.dict(sys.modules, fake_windows({1:{"title":"synthetic nickname"}})):
            self.assertEqual(ui.wechat_windows({123}), [(1,123,True)])

    def test_minimized_main_uses_restored_bounds_instead_of_zero_client_size(self):
        with patch.dict(sys.modules,fake_windows({1:{"iconic":True,"rect":(0,0,0,0)}})):
            self.assertEqual(ui.wechat_windows({123}),[(1,123,True)])


class RecoveryTests(unittest.TestCase):
    def test_explicit_recovery_requires_fresh_provider_and_reports_rollback_failure(self):
        from unittest.mock import Mock
        unavailable = {"ready":False,"uiCode":"WECHAT_UI_UNAVAILABLE"}
        ready = {"ready":True,"uiCode":"READY"}
        gate = Mock(side_effect=lambda hwnd, verify: verify())
        modules={"psutil":SimpleNamespace(process_iter=lambda *args:[SimpleNamespace(pid=123,info={"name":"Weixin.exe"})]),
                 "win32gui":SimpleNamespace(GetWindowText=lambda hwnd:"微信",SetForegroundWindow=lambda hwnd:None),
                 "qt_accessibility_recovery":SimpleNamespace(recover_qt_accessibility=gate,AccessibilityRollbackError=RuntimeError)}
        with patch.dict(sys.modules,modules), patch.object(compatibility,"wechat_windows",return_value=[(1,123,True)]), \
             patch.object(compatibility,"restore_window"),patch.object(compatibility,"ui_metadata",return_value=[(1,"mmui::MainWindow")]), \
             patch.object(compatibility.time,"sleep"), \
             patch.object(compatibility,"compatibility_probe",side_effect=[unavailable]*5+[ready]):
            self.assertEqual(compatibility.prepare_capture_ui(),ready)
        gate.assert_called_once()
        # UIA may briefly verify before the transaction rejects a changed
        # window or gate readback. Never publish its intermediate ready state.
        gate.reset_mock()
        def rejected_after_verification(hwnd, verify):
            self.assertTrue(verify())
            return False
        gate.side_effect=rejected_after_verification
        with patch.dict(sys.modules,modules), patch.object(compatibility,"wechat_windows",return_value=[(1,123,True)]), \
             patch.object(compatibility,"restore_window"),patch.object(compatibility,"ui_metadata",return_value=[(1,"mmui::MainWindow")]), \
             patch.object(compatibility.time,"sleep"), \
             patch.object(compatibility,"compatibility_probe",side_effect=[unavailable]*5+[ready]):
            self.assertEqual(compatibility.prepare_capture_ui(),unavailable)
        gate.assert_called_once()
        # A rejected binary or an unsuccessful provider check is not readiness.
        gate.reset_mock();gate.side_effect=None;gate.return_value=False
        with patch.dict(sys.modules,modules), patch.object(compatibility,"wechat_windows",return_value=[(1,123,True)]), \
             patch.object(compatibility,"restore_window"),patch.object(compatibility,"ui_metadata"), \
             patch.object(compatibility.time,"sleep"),patch.object(compatibility,"compatibility_probe",return_value=unavailable):
            self.assertFalse(compatibility.prepare_capture_ui()["ready"])
        gate.side_effect=RuntimeError("synthetic rollback failure")
        with patch.dict(sys.modules,modules), patch.object(compatibility,"wechat_windows",return_value=[(1,123,True)]), \
             patch.object(compatibility,"restore_window"),patch.object(compatibility,"ui_metadata"), \
             patch.object(compatibility.time,"sleep"),patch.object(compatibility,"compatibility_probe",return_value=unavailable):
            self.assertEqual(compatibility.prepare_capture_ui()["uiCode"],"WECHAT_UI_RECOVERY_FAILED")

    def test_shell_recovers_after_standard_accessibility_request_without_restart(self):
        events=[]
        modules={"psutil":SimpleNamespace(process_iter=lambda *args:[SimpleNamespace(pid=123,info={"name":"Weixin.exe"})]),
                 "win32gui":SimpleNamespace(ShowWindowAsync=lambda *args:events.append("restore"),
                                              GetWindowText=lambda hwnd:"微信",
                                              SetForegroundWindow=lambda *args:events.append("foreground")),
                 "win32process":SimpleNamespace()}
        status={"ready":False,"uiCode":"WECHAT_UI_UNAVAILABLE"}
        def metadata(windows,activate=False):
            self.assertEqual(windows,[(1,123,True)])
            self.assertTrue(activate)
            events.append("activate")
            return [(1,"mmui::MainWindow")]
        with patch.dict(sys.modules,modules), patch.object(compatibility,"wechat_windows",return_value=[(1,123,True)]), \
             patch.object(compatibility,"restore_window",side_effect=lambda hwnd:events.append("restore")), \
             patch.object(compatibility,"ui_metadata",side_effect=metadata), patch.object(compatibility.time,"sleep"), \
             patch.object(compatibility,"compatibility_probe",side_effect=[status,status,{"ready":True}]):
            self.assertTrue(compatibility.prepare_capture_ui()["ready"])
        self.assertEqual(events,["restore","foreground","activate"])

    def test_probe_does_not_activate_restore_or_cache_a_shell_result(self):
        modules={"psutil":SimpleNamespace(process_iter=lambda *args:[SimpleNamespace(pid=123,info={"name":"Weixin.exe","exe":"test.exe"})]),
                 "win32api":SimpleNamespace(GetFileVersionInfo=lambda *args:{"FileVersionMS":(4<<16)|1,"FileVersionLS":15<<16}),
                 "win32gui":SimpleNamespace(),"win32process":SimpleNamespace()}
        with patch.dict(sys.modules,modules), patch.object(compatibility.sys,"platform","win32"), \
             patch.object(compatibility.importlib.metadata,"version",return_value="test"), \
             patch.object(compatibility,"wechat_windows",return_value=[(1,123,True)]), \
             patch.object(compatibility,"ui_metadata",side_effect=[[(1,"Qt51514QWindowIcon")],[(1,"mmui::MainWindow")]]) as request:
            self.assertFalse(compatibility.compatibility_probe()["ready"])
            self.assertTrue(compatibility.compatibility_probe()["ready"])
        self.assertEqual(request.call_count,2)
        self.assertTrue(all(not call.kwargs.get("activate") for call in request.call_args_list))


class BoundedRequestTests(unittest.TestCase):
    def test_fresh_mta_com_request_uses_timeouts_and_does_not_read_ui_text(self):
        events=[]
        class Element:
            CurrentProcessId=123
            CurrentClassName="mmui::MainWindow"
            @property
            def CurrentName(self):
                raise AssertionError("UI text must not be read")
        class Automation:
            def ElementFromHandle(self,handle):
                self.assertions=(self.ConnectionTimeout,self.TransactionTimeout,self.AutoSetFocus)
                events.append(("element",handle))
                return Element()
        automation=Automation()
        client=SimpleNamespace(GetModule=lambda *args:SimpleNamespace(CUIAutomation8="class",IUIAutomation2="interface"),
                               CreateObject=lambda *args,**kwargs:automation)
        comtypes=SimpleNamespace(client=client,CoInitializeEx=lambda value:events.append(("com",value)),CoUninitialize=lambda:events.append("uninit"))
        with patch.dict(sys.modules,{"comtypes":comtypes,"comtypes.client":client}), \
             patch.object(ui,"_activate_accessibility",side_effect=lambda hwnd:events.append(("activate",hwnd))):
            self.assertEqual(ui._read_ui_metadata([(1,123,True)],True),[(1,"mmui::MainWindow")])
        self.assertEqual(automation.assertions,(350,350,False))
        self.assertEqual(events,[("com",0),("activate",1),("element",1),"uninit"])

    def test_timed_out_request_is_bounded_and_late_result_cannot_be_reused(self):
        started,release=threading.Event(),threading.Event()
        def blocked(*args):
            started.set()
            release.wait(2)
            return [(1,"mmui::MainWindow")]
        client=SimpleNamespace()
        with patch.dict(sys.modules,{"comtypes":SimpleNamespace(client=client),"comtypes.client":client}), \
             patch.object(ui,"UIA_REQUEST_SECONDS",.03), patch.object(ui,"_read_ui_metadata",side_effect=blocked) as read:
            began=time.monotonic()
            self.assertIsNone(ui.ui_metadata([(1,123,True)]))
            self.assertLess(time.monotonic()-began,.3)
            self.assertTrue(started.is_set())
            self.assertIsNone(ui.ui_metadata([(1,123,True)]))
            self.assertEqual(read.call_count,1)
            release.set()
            ui._uia_request.join(1)
            read.side_effect=None
            read.return_value=[(1,"Qt51514QWindowIcon")]
            self.assertEqual(ui.ui_metadata([(1,123,True)]),[(1,"Qt51514QWindowIcon")])
            self.assertEqual(read.call_count,2)


if __name__ == "__main__":
    unittest.main()
