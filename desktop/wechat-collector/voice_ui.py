"""Bounded native voice-to-text for a verified, focused UIA voice message.

No media download, audio playback, clipboard access, or sending.
If Weixin does not expose the exact message/menu, the caller gets a reason and
keeps its original unread placeholder. Qt-only visual workflows are separate.
"""
import time
from voice_transcript import VOICE_CLASS, parse_voice_transcript

CONVERT_LABELS = frozenset(("语音转文字", "转文字", "語音轉文字", "轉文字", "Convert to Text", "Transcribe"))


def transcribe_visible_voice(item, content, audio_pattern, *, verify_target, menu_items,
                             read_body, foreground_ok, timeout=8.0, clock=time.monotonic,
                             sleep=time.sleep, native_menu=None):
    """Only the focused source message may open an exact native context action.

    ``verify_target`` rechecks the selected one-to-one contact. ``read_body``
    must strip the original sender/timestamp and reject a changed row identity.
    Dependency injection allows genuine control-flow tests without real Weixin.
    """
    if item.class_name() != VOICE_CLASS:
        return None, "not-voice"
    existing = parse_voice_transcript(content, audio_pattern, ui_class=VOICE_CLASS)
    if existing["source"]["transcriptionStatus"] == "visible-text":
        return existing, "already-visible"
    started = clock()
    deadline = started + min(12.0, max(0.0, float(timeout)))
    if deadline <= started:
        return existing, "time-limit"
    identity = tuple(item.element_info.runtime_id or [])
    latest = existing

    class DeadlineReached(Exception):
        pass

    def guard():
        if clock() >= deadline:
            raise DeadlineReached()
        if not identity or tuple(item.element_info.runtime_id or []) != identity:
            raise RuntimeError("voice source changed")
        if not foreground_ok() or not item.is_visible():
            raise RuntimeError("voice window changed")
        verify_target()
        if clock() >= deadline:
            raise DeadlineReached()

    opened = False
    native_before = None
    try:
        guard()
        if not item.has_keyboard_focus():
            return existing, "source-not-focused"
        # A menu from another same-process chat must never be mistaken for the
        # menu opened by this source action. Only newly visible runtime IDs count.
        before = {tuple(node.element_info.runtime_id or []) for node in menu_items()}
        if native_menu is not None:
            native_before = native_menu.snapshot()
            if native_before:
                return existing, "menu-already-open"
        guard()
        # Context-menu key acts on the focused message; never guess its bubble
        # position from the sender name, duration, or current screen size.
        item.type_keys("+{F10}", set_foreground=False)
        opened = True
        # UIA can expose the popup before its items are populated. Retry empty
        # snapshots briefly within the original deadline, preserving time for
        # conversion. Ambiguous snapshots must never choose a first match.
        menu_deadline = min(deadline, clock() + 2.0)
        choices = []
        while clock() < menu_deadline:
            guard()
            choices = [node for node in menu_items()
                       if node.element_info.control_type == "MenuItem"
                       and node.process_id() == item.process_id()
                       and tuple(node.element_info.runtime_id or [])
                       and tuple(node.element_info.runtime_id or []) not in before
                       and node.is_visible() and node.is_enabled()
                       and node.window_text().strip() in CONVERT_LABELS]
            # Scanning controls itself can take time or expose a changed source.
            guard()
            if len(choices) > 1:
                return existing, "conversion-menu-unavailable"
            if choices:
                break
            sleep(min(0.1, max(0.0, menu_deadline - clock())))
        if choices:
            guard()
            choices[0].click_input()
            opened = False
        elif native_menu is not None:
            guard()
            # Use the menu opened by this focused row; never guess a voice
            # bubble inside the history row or open another context menu.
            action = native_menu.activate_opened(native_before, deadline=deadline)
            opened = False  # Native controller dismisses only its owned popup.
            guard()
            if action.get("action") != "conversion-requested":
                return existing, action.get("reason", "conversion-menu-unavailable")
        else:
            return existing, "conversion-menu-unavailable"
        previous_text = None
        while clock() < deadline:
            sleep(min(0.2, max(0, deadline-clock())))
            guard()
            result = parse_voice_transcript(read_body(), audio_pattern, ui_class=VOICE_CLASS)
            guard()
            if result["source"]["transcriptionStatus"] == "visible-text":
                # Native conversion may update the row more than once. Keep
                # incomplete text out of the capture until two reads agree.
                if result["text"] == previous_text:
                    result["source"]["transcriptionSource"] = "wechat-native-visible-ui"
                    return result, "converted"
                previous_text = result["text"]
            else:
                latest = result
                previous_text = None
            if result["source"]["transcriptionStatus"] == "failed":
                return result, "native-conversion-failed"
        return latest, "conversion-timeout"
    except DeadlineReached:
        return latest, "time-limit"
    except Exception:
        return latest, "source-or-window-changed"
    finally:
        # Do not send Esc into a newly focused app or an unrelated source.
        if opened:
            try:
                if native_menu is not None:
                    native_menu.close()
                if foreground_ok() and item.is_visible() and tuple(item.element_info.runtime_id or []) == identity:
                    verify_target()
                    if foreground_ok() and item.is_visible() and tuple(item.element_info.runtime_id or []) == identity:
                        item.type_keys("{ESC}", set_foreground=False)
            except Exception:
                pass
