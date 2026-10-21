import unittest
from types import SimpleNamespace
from unittest.mock import patch
import browser_return


class BrowserReturnTests(unittest.TestCase):
    def api(self, foreground=10, kind="WeChatMainWndForPC", pid=7):
        def process(handle, pointer):
            pointer._obj.value = pid
        def class_name(handle, buffer, size):
            buffer.value = kind
        return SimpleNamespace(GetForegroundWindow=lambda: foreground,
            GetWindowThreadProcessId=process, GetClassNameW=class_name,
            IsWindow=lambda handle: True, ShowWindow=lambda *args: True,
            SetForegroundWindow=lambda handle: True)

    def test_completed_capture_returns_from_wechat(self):
        with patch.object(browser_return, 'os', SimpleNamespace(name='nt')), patch.object(browser_return, 'window_api', return_value=self.api()):
            self.assertTrue(browser_return.return_to_browser((99, 7)))

    def test_does_not_steal_focus_from_other_app(self):
        with patch.object(browser_return, 'os', SimpleNamespace(name='nt')), patch.object(browser_return, 'window_api', return_value=self.api(kind='Notepad')):
            self.assertFalse(browser_return.return_to_browser((99, 7)))

    def test_reused_window_handle_is_rejected(self):
        with patch.object(browser_return, 'os', SimpleNamespace(name='nt')), patch.object(browser_return, 'window_api', return_value=self.api(pid=8)):
            self.assertFalse(browser_return.return_to_browser((99, 7)))

    def test_missing_original_window_does_not_open_another_tab(self):
        self.assertFalse(browser_return.return_to_browser(None))

    def test_wechat_four_native_qt_window_is_verified_by_process(self):
        with patch.object(browser_return, 'os', SimpleNamespace(name='nt')), patch.object(browser_return, 'window_api', return_value=self.api(kind='Qt51514QWindowIcon')):
            with patch.object(browser_return, 'is_wechat_process', return_value=True):
                self.assertTrue(browser_return.return_to_browser((99, 7)))
            with patch.object(browser_return, 'is_wechat_process', return_value=False):
                self.assertFalse(browser_return.return_to_browser((99, 7)))


if __name__ == '__main__':
    unittest.main()
