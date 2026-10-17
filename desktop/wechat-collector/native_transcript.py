"""Read text produced by the verified transcript's native Copy action only.

Never reads the pre-existing clipboard. A new clipboard sequence and an owner
from the verified Weixin process are both required. No cloud or audio access.
"""
import time
from difflib import SequenceMatcher
from voice_context import compact
from voice_transcript import _status


class WindowsClipboard:
    def sequence(self):
        import win32clipboard
        return win32clipboard.GetClipboardSequenceNumber()

    def owner(self):
        import win32clipboard, win32process
        handle = win32clipboard.GetClipboardOwner()
        return win32process.GetWindowThreadProcessId(handle)[1] if handle else None

    def text(self):
        import win32clipboard, win32con
        win32clipboard.OpenClipboard()
        try:
            if not win32clipboard.IsClipboardFormatAvailable(win32con.CF_UNICODETEXT):
                return None
            return win32clipboard.GetClipboardData(win32con.CF_UNICODETEXT)
        finally:
            win32clipboard.CloseClipboard()


def copy_transcript(menu, body, *, process_id, verify, visible_text, clipboard=None,
                    timeout=2, clock=time.monotonic, sleep=time.sleep):
    """Return native words only when they agree with the selected visible body.

    OCR is a cross-check, never the imported text. It may contain minor errors;
    the complete copied words, not OCR reconstructions, are returned.
    """
    clipboard = clipboard or WindowsClipboard()
    verify()
    before = clipboard.sequence()
    action = menu.convert(body)
    if action.get('action') != 'copy-requested':
        return {'status': 'needs-review', 'reason': action.get('reason', 'copy-not-confirmed')}
    deadline = clock()+min(3, max(0, timeout))
    while clock() < deadline:
        verify()
        sequence = clipboard.sequence()
        if sequence != before:
            # Never inspect a clipboard change from another application.
            if clipboard.owner() != process_id:
                return {'status': 'needs-review', 'reason': 'clipboard-owner-changed'}
            try:
                text = clipboard.text()
            except Exception:
                sleep(.05)
                continue
            verify()
            if clipboard.sequence() != sequence or clipboard.owner() != process_id:
                return {'status': 'needs-review', 'reason': 'clipboard-changed-during-read'}
            if not isinstance(text, str) or not 1 <= len(text.strip()) <= 20000 or _status(text):
                return {'status': 'needs-review', 'reason': 'native-text-unavailable'}
            expected, actual = compact(visible_text), compact(text)
            threshold = 1 if len(expected) < 8 else .9 if len(expected) < 20 else .8
            if not expected or SequenceMatcher(None, expected, actual, autojunk=False).ratio() < threshold:
                return {'status': 'needs-review', 'reason': 'native-text-does-not-match-visible-body'}
            return {'status': 'ready', 'text': text.strip(), 'source': 'wechat-native-transcript-copy'}
        sleep(.05)
    return {'status': 'needs-review', 'reason': 'native-copy-timeout'}
