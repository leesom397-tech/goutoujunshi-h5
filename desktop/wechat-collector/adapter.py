"""Read one explicitly selected Weixin UI; no cloud calls or automatic uploads.

The user authorized existing website/Qwen analysis AFTER preview and confirmation.
This adapter only returns local records to the paired browser preview. It has no
HTTP client, database/key access, send-message API, or contact enumeration.
UI navigation can bring Weixin forward and mark the selected chat read.
"""
import base64
import hashlib
import io
import re
import sys
import time
from normalize import normalized_capture
from voice_transcript import parse_voice_transcript
from voice_ui import transcribe_visible_voice


class CaptureError(Exception):
    def __init__(self, code, message):
        self.code, self.message = code, message
        super().__init__(code)


def _account(Navigator):
    # Avoid upstream Contacts.check_my_info(): it derives wxid from process paths.
    # Read ONLY the current account's visible WeChat ID in its own profile popup.
    pane, _ = Navigator.open_my_profile(is_maximize=False)
    try:
        group = pane.child_window(control_type="Group", found_index=3).children()[1]
        values = [item.window_text().strip() for item in group.descendants(control_type="Text")]
        nickname = values[0] if values else ""
        account = values[2] if len(values) > 2 else ""
        account = re.sub(r"^(?:微信号|WeChat ID|Weixin ID|微信號)\s*[:：]?\s*", "", account, flags=re.I)
        if not nickname or not re.fullmatch(r"[A-Za-z0-9_-]{5,80}", account):
            raise CaptureError("ACCOUNT_UNREADABLE", "无法从本人资料确认当前微信号，已停止采集，避免不同账号的数据混在一起。")
        return account, nickname
    finally:
        pane.close()


def _image(item, name):
    import win32gui
    import win32process
    foreground = win32gui.GetForegroundWindow()
    if not foreground or win32process.GetWindowThreadProcessId(foreground)[1] != item.process_id():
        raise CaptureError("FOCUS_CHANGED", "微信已不在前台，已跳过截图，请保持采集界面可见。")
    image = item.capture_as_image()
    if image.width < 20 or image.height < 20:
        raise ValueError("invisible image region")
    image.thumbnail((1600, 1600))
    memory = io.BytesIO()
    image.convert("RGB").save(memory, format="JPEG", quality=82)
    if memory.tell() > 750000:
        raise ValueError("preview too large")
    return {"mime": "image/jpeg", "name": name, "data": base64.b64encode(memory.getvalue()).decode("ascii")}


def _assert_target(main, friend, Texts, Tools):
    selector = dict(Texts.CurrentChatNameText)
    selector["title"] = friend
    if not main.child_window(**selector).exists(timeout=1):
        raise CaptureError("FRIEND_MISMATCH", "打开的聊天与所填好友备注不一致，已停止。请填写完整且唯一的备注。")
    if Tools.is_group_chat(main):
        raise CaptureError("GROUP_NOT_SUPPORTED", "目前只采集你指定的一对一聊天，不采集群聊。")


def _safe_text(control):
    try:
        value = control.window_text()
    except Exception:
        value = ""
    return str(value or "").replace("\u200b", "").strip()


def _normalized_label(value):
    return re.sub(r"\s+", " ", str(value or "").replace("\u200b", "").strip()).casefold()


def _children_and_descendants(control, **kwargs):
    """Read both direct and nested UIA nodes without assuming one WeChat build."""
    nodes = []
    for method in ("children", "descendants"):
        try:
            found = getattr(control, method)(**kwargs)
        except Exception:
            found = []
        for node in found or []:
            if node not in nodes:
                nodes.append(node)
    return nodes


def _is_visible(control):
    try:
        return bool(control.is_visible())
    except Exception:
        return True


def _is_enabled(control):
    try:
        return bool(control.is_enabled())
    except Exception:
        return True


def _wait_exists(control, timeout=5.0, visible=False):
    def ready():
        try:
            exists = control.exists(timeout=.15) if hasattr(control, "exists") else True
            return bool(exists and (not visible or _is_visible(control)))
        except Exception:
            try:
                if hasattr(control, "wait"):
                    control.wait("visible" if visible else "ready", timeout=.3)
                    return True
            except Exception:
                return False
        return False
    if ready():
        return control
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if ready():
            return control
        time.sleep(.12)
    return None


def _wait_hidden(control, timeout=3.0):
    def hidden():
        try:
            return not control.exists(timeout=.1) or not control.is_visible()
        except Exception:
            return True
    if hidden():
        return True
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if hidden():
            return True
        time.sleep(.12)
    return False


def _control_rect(control):
    try:
        rect = control.rectangle()
        return rect.left, rect.top, rect.right, rect.bottom
    except Exception:
        return None


def _find_clickable_ancestor(node):
    """Return the closest actionable node for a visible text label."""
    current = node
    for _ in range(5):
        try:
            if _is_visible(current) and _is_enabled(current):
                control_type = str(getattr(current.element_info, "control_type", "") or "")
                if control_type in ("Button", "Hyperlink", "ListItem"):
                    return current
        except Exception:
            pass
        try:
            current = current.parent()
        except Exception:
            break
    return node


def _ensure_foreground(control):
    """Never send physical clicks or wheel events to an occluding window."""
    try:
        target_pid = control.process_id()
    except Exception:
        return
    if not target_pid:
        return
    try:
        import win32gui
        import win32process
        hwnd = win32gui.GetForegroundWindow()
        active_pid = win32process.GetWindowThreadProcessId(hwnd)[1] if hwnd else None
        if active_pid == target_pid:
            return
        try:
            control.top_level_parent().set_focus()
        except Exception:
            control.set_focus()
        time.sleep(.2)
        hwnd = win32gui.GetForegroundWindow()
        active_pid = win32process.GetWindowThreadProcessId(hwnd)[1] if hwnd else None
    except ImportError:
        return
    except Exception:
        active_pid = None
    if active_pid != target_pid:
        raise CaptureError("FOCUS_CHANGED", "微信被其他窗口遮挡，已暂停采集以免点错位置。请把微信放到最前面后重试。")


def _click_control(control, attempts=3):
    last_error = None
    for _ in range(attempts):
        try:
            _ensure_foreground(control)
            control.click_input()
            _ensure_foreground(control)
            return True
        except CaptureError:
            raise
        except Exception as error:
            last_error = error
            time.sleep(.25)
    if last_error:
        raise last_error
    return False


def _open_target(friend, modules, search_query=None):
    # Never delegate candidate selection to upstream search_friend: it chooses
    # the first equal name and can fall back to an online phone/ID lookup.
    Navigator, Tools, ui = modules
    main = Navigator.open_weixin(is_maximize=False)
    main.child_window(**ui.SideBar.Weixin).click_input()
    edits = main.descendants(**ui.Main_window.Search)
    if not edits:
        raise CaptureError("SEARCH_UNREADABLE", "微信搜索框不可读，请关闭弹窗后重试。")
    search = edits[1] if len(edits) == 2 else edits[0]
    search.click_input()
    search.set_text(search_query or friend)
    try:
        listing = main.child_window(**ui.Lists.SearchResult).wait("ready", timeout=5)
        labels = _normalized_label(friend)
        candidates = []
        for item in _children_and_descendants(listing, control_type="ListItem"):
            if not _is_visible(item):
                continue
            try:
                class_name = item.class_name()
            except Exception:
                class_name = ""
            text = _normalized_label(_safe_text(item))
            lines = [_normalized_label(line) for line in _safe_text(item).splitlines()]
            nested = [_normalized_label(_safe_text(node)) for node in
                      _children_and_descendants(item, control_type="Text")]
            if class_name == "mmui::SearchContentCellView" and labels in (lines + nested + [text]):
                candidates.append(item)
    except Exception:
        raise CaptureError("FRIEND_NOT_FOUND", "未找到这个完整备注的本地联系人，请核对微信里显示的完整名称。")
    if not candidates:
        raise CaptureError("FRIEND_NOT_FOUND", "未找到这个完整备注的本地联系人，请核对微信里显示的完整名称。")
    if len(candidates) != 1:
        raise CaptureError("FRIEND_AMBIGUOUS", "微信里有多个同名搜索项，请给目标好友设置唯一备注后重试。")
    selected = candidates[0]
    for attempt in range(3):
        _click_control(selected)
        deadline = time.monotonic() + 4
        while time.monotonic() < deadline:
            try:
                selector = dict(ui.Texts.CurrentChatNameText)
                selector["title"] = friend
                if main.child_window(**selector).exists(timeout=.2):
                    _assert_target(main, friend, ui.Texts, Tools)
                    return main
            except CaptureError:
                raise
            except Exception:
                pass
            time.sleep(.15)
        time.sleep(.3)
    raise CaptureError("CONTACT_OPEN_TIMEOUT", "已找到联系人，但聊天窗口没有打开。请保持微信窗口可见后重试。")


def _native_voice(item, content, friend, sender, at, history, main, modules, timeout):
    Navigator, Tools, ui = modules
    import win32gui
    import win32process
    from pywinauto import Desktop
    process = item.process_id()
    identity = tuple(item.element_info.runtime_id or [])
    def foreground_ok():
        active = win32gui.GetForegroundWindow()
        return bool(active and win32process.GetWindowThreadProcessId(active)[1] == process)
    def read_body():
        raw = item.window_text()
        stamp = ui.Regex_Patterns.Chathistory_Timestamp_pattern.search(raw)
        if (stamp.group(0) if stamp else "") != at:
            raise ValueError("voice timestamp changed")
        body = (raw[:stamp.start()] + raw[stamp.end():]).strip() if stamp else raw.strip()
        if not sender or not (body == sender or body.startswith(sender + " ") or body.startswith(sender + "\n")):
            raise ValueError("voice sender changed")
        body = body[len(sender):].lstrip()
        before = parse_voice_transcript(content, ui.Regex_Patterns.Audio_pattern, ui_class=item.class_name())
        after = parse_voice_transcript(body, ui.Regex_Patterns.Audio_pattern, ui_class=item.class_name())
        if not before or not after or not before["source"].get("rawMediaLabel") or before["source"].get("rawMediaLabel") != after["source"].get("rawMediaLabel"):
            raise ValueError("voice duration/source changed")
        return body
    def menus():
        return [node for window in Desktop(backend="uia").windows(process=process, visible_only=True)
                for node in window.descendants(control_type="MenuItem")]
    def verify_source():
        if (not identity or tuple(item.element_info.runtime_id or []) != identity
                or not foreground_ok() or not item.is_visible() or not history.is_visible()):
            raise ValueError("voice source/window changed")
        _assert_target(main, friend, ui.Texts, Tools)
        read_body()
    # UIA still identifies the exact source message. Only menu recognition
    # falls back to local OCR when Qt does not expose its MenuItem controls.
    from voice_menu_ui import NativeVoiceMenu
    native_menu = NativeVoiceMenu(history, verify_source, timeout=timeout)
    return transcribe_visible_voice(item, content, getattr(ui.Regex_Patterns, "Audio_pattern", None),
        verify_target=verify_source, menu_items=menus,
        read_body=read_body, foreground_ok=foreground_ok, timeout=timeout, native_menu=native_menu)


def _chat(friend, limit, nickname, progress, modules, convert_voices=False):
    Navigator, Tools, ui = modules
    main = _open_target(friend, modules)
    history = Navigator.open_chat_history(friend=friend, search_pages=0, is_maximize=False, close_weixin=False)
    rows, warnings = [], []
    try:
        listing = history.child_window(**ui.Lists.ChatHistoryList)
        if not listing.exists(timeout=2):
            raise CaptureError("UI_UNREADABLE", "聊天记录列表不可读。请关闭微信弹窗，或改用网页截图上传。")
        if Tools.select_chatHistoryList(history) is None:
            raise CaptureError("NO_READABLE_MESSAGES", "没有可读取的聊天消息。")
        last_runtime, repeats, media_count = None, 0, 0
        # The bridge has a 180 s overall deadline. Native conversion gets at
        # most 45 s in total, preserving already-read rows and explicit leftovers.
        voice_seconds = 0.0
        for _ in range(limit * 4 + 20):
            selected = [item for item in listing.children() if item.has_keyboard_focus()]
            if selected:
                item = selected[0]
                runtime = tuple(item.element_info.runtime_id or [])
                if runtime and runtime == last_runtime:
                    repeats += 1
                    if repeats >= 2:
                        break
                else:
                    repeats = 0
                    last_runtime = runtime
                    class_name = item.class_name()
                    if class_name != "mmui::ChatItemView":
                        raw = item.window_text()
                        stamp = ui.Regex_Patterns.Chathistory_Timestamp_pattern.search(raw)
                        at = stamp.group(0) if stamp else ""
                        content = (raw[:stamp.start()] + raw[stamp.end():]).strip() if stamp else raw.strip()
                        sender, role = "", "unknown"
                        for candidate, candidate_role in ((friend, "other"), (nickname, "self")):
                            if candidate and (content == candidate or content.startswith(candidate + " ") or content.startswith(candidate + "\n")):
                                sender, role = candidate, candidate_role
                                content = content[len(candidate):].lstrip()
                                break
                        if friend == nickname:
                            role = "unknown"
                        voice = parse_voice_transcript(content, getattr(ui.Regex_Patterns, "Audio_pattern", None), ui_class=class_name)
                        if convert_voices and voice is not None and voice["source"].get("transcriptionStatus") != "visible-text":
                            remaining = 45.0 - voice_seconds
                            if sender and role != "unknown" and remaining > 0:
                                progress(min(90, 15 + int(len(rows) / limit * 70)), f"文字已导入，正在补全第 {len(rows)+1} 条语音…")
                                started = time.monotonic()
                                try:
                                    converted, outcome = _native_voice(item, content, friend, sender, at, history, main, modules, min(8.0, remaining))
                                    if isinstance(converted, dict) and isinstance(converted.get("source"), dict):
                                        voice = converted
                                    else:
                                        outcome = "source-or-window-changed"
                                except Exception:
                                    outcome = "source-or-window-changed"
                                voice_seconds += time.monotonic() - started
                                voice["source"]["nativeConversionOutcome"] = outcome
                            else:
                                voice["source"]["nativeConversionOutcome"] = "time-limit" if remaining <= 0 else "sender-unconfirmed"
                        if voice is not None:
                            kind = voice["kind"]
                        elif "ChatTextItemView" in class_name:
                            kind = "text"
                        elif re.match(r"^(?:\[|【)?(?:动画表情|動態貼圖|表情|貼圖|Sticker|Animated Stickers|Animated emoji)", content, re.I):
                            kind = "sticker"
                        elif re.match(r"^(?:\[|【)?(?:图片|圖片|Photo|Image)", content, re.I):
                            kind = "image"
                        else:
                            kind = "other"
                        row = {"kind": kind, "sender": sender, "senderRole": role, "at": at, "text": (voice["text"] or content) if voice else content,
                               "source": {"uiClass": class_name, "timePrecision": "ui-label" if at else "unknown"}}
                        if voice is not None:
                            row["source"].update(voice["source"])
                            row["source"].setdefault("transcriptionSource", "wechat-visible-ui")
                        if voice is None and kind in ("image", "sticker", "other") and media_count < 30:
                            try:
                                row["images"] = [_image(item, f"chat-preview-{len(rows)+1}.jpg")]
                                row["source"]["imageType"] = "visible-ui-preview"
                                media_count += 1
                            except Exception:
                                warnings.append("部分媒体的界面预览无法截取，已保留原消息占位；未推测图片内容。")
                        if not sender:
                            warnings.append("部分消息发送人无法由界面确认，已标为未知，请导入前核对。")
                        rows.append(row)
                        progress(min(90, 15 + int(len(rows) / limit * 70)), f"已读取 {len(rows)} 条聊天")
                        if len(rows) >= limit:
                            break
            listing.type_keys("{DOWN}", pause=0.05, set_foreground=True)
        if not rows:
            raise CaptureError("NO_READABLE_MESSAGES", "未读取到消息，请确认这位好友有本机可见的聊天记录。")
        warnings.append("聊天采集从新到旧遍历，结果已按旧到新整理；时间保留界面原标签，未知时间不补写。")
        if media_count:
            warnings.append("图片和表情仅保存消息区域的可见预览，不是原始文件；视频内容未转写。")
        voices = [row for row in rows if row["source"].get("mediaKind") == "voice"]
        if voices:
            readable = sum(row["source"].get("transcriptionStatus") == "visible-text" for row in voices)
            warnings.append(f"采集到 {len(voices)} 条语音，已保留 {readable} 条微信界面转文字；其余 {len(voices)-readable} 条未取得转写，不参与文字分析。转写内容请核对。")
        return rows, warnings
    finally:
        try:
            history.type_keys("{ESC}")
            history.close()
        except Exception:
            pass


def _moments_window(main, window):
    # Weixin 4.1.15 embeds the selected friend's album directly in the main
    # window; upstream still returns an older, now absent nested WeChat pane.
    deadline = time.monotonic() + 4
    visible_lists = []
    while time.monotonic() < deadline:
        visible_lists = [item for item in main.descendants(control_type="List")
                         if item.element_info.automation_id == "sns_list" and item.is_visible()]
        if visible_lists:
            break
        time.sleep(.2)
    if len(visible_lists) == 1:
        # 4.1.15 may also expose an SNSWindow while embedding it in the main
        # window. That nested native handle is recreated after some details;
        # anchor queries to the stable verified main window instead.
        return main
    if not visible_lists and window.exists(timeout=0.3):
        return window
    raise CaptureError("MOMENTS_UNREADABLE", "指定好友的朋友圈界面无法唯一确认，已停止采集。")


def _prepare_capture_ui():
    from compatibility import prepare_capture_ui
    status = prepare_capture_ui()
    if not status.get("ready"):
        raise CaptureError(status.get("uiCode") or "WECHAT_NOT_READY",
                           status.get("message") or "微信界面当前不可读，尚未开始采集。")


def _moments_at_visible_end(listing):
    """Repeated focus alone may be a stuck keyboard, not the album's end."""
    try:
        scroll = listing.iface_scroll
        if not scroll.CurrentVerticallyScrollable:
            return True
        percent = float(scroll.CurrentVerticalScrollPercent)
        return 99.9 <= percent <= 100
    except Exception:
        return False


def _control_is_visible(control):
    """UIA controls in older WeChat builds may not expose is_visible()."""
    try:
        value = getattr(control, "is_visible", None)
        return bool(value() if callable(value) else value) if value is not None else True
    except Exception:
        return True


def _open_moments_source(request, visible_account):
    """Keep one authorized account snapshot; verification must not navigate UI."""
    from background_reader import _provider_module, _contact_metadata_columns
    provider = _provider_module()
    if provider is None:
        raise CaptureError("CONTACT_SEARCH_UNAVAILABLE", "联系人目录暂不可读，请重新连接助手后选择好友。")
    source = provider.open_authorized_source()
    try:
        source.assert_unchanged()
        # Current clients bind the explicit contact to the account fingerprint.
        # Legacy name-only requests also need to match the visible account ID.
        if not request.get("contactId"):
            identities = {source.account_id, source.self_username}
            if "alias" in _contact_metadata_columns(source.contacts()):
                row = source.contacts().execute("SELECT alias FROM contact WHERE username=?", (source.self_username,)).fetchone()
                if row and row[0]:
                    identities.add(str(row[0]))
            if visible_account not in identities:
                raise CaptureError("ACCOUNT_CHANGED", "当前微信账号无法与采集账号核对，请重新选择好友后导入。")
        return source
    except BaseException:
        source.close()
        raise


def _resolve_moments_contact(request, source=None):
    """Resolve the selected local contact; never read any message bodies."""
    from background_reader import _provider_module, _resolve_contact, _contact_display, _duplicate_displays, _contact_metadata_columns, _contact_text
    owned = source is None
    if owned:
        provider = _provider_module()
        if provider is None:
            raise CaptureError("CONTACT_SEARCH_UNAVAILABLE", "联系人目录暂不可读，请重新连接助手后选择好友。")
        source = provider.open_authorized_source()
    try:
        username = _resolve_contact(source, request["friend"], request.get("contactId"), request.get("accountKey"))
        conn = source.contacts()
        row = conn.execute("SELECT username,nick_name,remark FROM contact WHERE username=?", (username,)).fetchone()
        display = _contact_display(row)
        duplicate = display in _duplicate_displays(conn, {display})
        alias = ""
        if duplicate and "alias" in _contact_metadata_columns(conn):
            alias = _contact_text(conn.execute("SELECT alias FROM contact WHERE username=?", (username,)).fetchone()[0])
        source.assert_unchanged()
        return display, (alias or username) if duplicate else display, source.account_id
    finally:
        if owned:
            source.close()


def _open_moments_from_chat(main, friend, modules, expected_identifier=None, _retry=0):
    """Open the already verified chat's album, without upstream's second search."""
    from pywinauto import Desktop
    _, Tools, ui = modules
    pane = main.child_window(auto_id="single_chat_info_view", control_type="Group")
    if not _wait_exists(pane, timeout=.5, visible=True):
        try:
            _click_control(main.child_window(**ui.Buttons.ChatInfoButton))
        except Exception:
            raise CaptureError("PROFILE_PANE_OPEN_TIMEOUT", "好友资料面板没有打开，请保持微信窗口可见后重试。") from None
        # The original wrapper is stale after ChatInfoButton creates the pane.
        pane = main.child_window(auto_id="single_chat_info_view", control_type="Group")
    if not _wait_exists(pane, timeout=4, visible=True):
        raise CaptureError("PROFILE_PANE_OPEN_TIMEOUT", "好友资料面板没有加载完成，请保持微信窗口可见后重试。")
    avatar = pane.child_window(title=friend, control_type="Button")
    if not _wait_exists(avatar, timeout=4, visible=True):
        # Some WeChat builds expose the remark/nickname only in a nested text
        # node. Select the nearest button whose subtree contains the label.
        matches = []
        for button in _children_and_descendants(pane, control_type="Button"):
            labels = [_normalized_label(_safe_text(button))]
            labels.extend(_normalized_label(_safe_text(node)) for node in
                          _children_and_descendants(button, control_type="Text"))
            if _normalized_label(friend) in " ".join(labels):
                matches.append(button)
        if matches:
            avatar = matches[0]
    if not _wait_exists(avatar, timeout=3, visible=True):
        raise CaptureError("MOMENTS_UNREADABLE", "无法打开所选好友的资料，请关闭微信弹窗后重试。")
    try:
        if hasattr(avatar, "wait"):
            avatar = avatar.wait("ready", timeout=3)
    except Exception:
        pass
    nested_buttons = [button for button in _children_and_descendants(avatar, control_type="Button")
                      if _is_visible(button) and _is_enabled(button)]
    # The first click may only focus the chat detail pane. Verify the profile
    # after each click instead of assuming a successful click_input opened it.
    profile = Desktop(backend="uia").window(class_name="mmui::ProfileUniquePop",
                                               process=main.process_id(), visible_only=True)
    if not _wait_exists(profile, timeout=.2, visible=True):
        for target in [avatar, avatar, *nested_buttons, avatar]:
            try:
                _click_control(target, attempts=1)
            except Exception:
                continue
            if _wait_exists(profile, timeout=1.5, visible=True):
                break
    if not _wait_exists(profile, timeout=.5, visible=True):
        raise CaptureError("PROFILE_OPEN_TIMEOUT", "已找到好友，但资料卡尚未打开。请关闭微信遮挡弹窗后重试；本次没有开始读取朋友圈。") from None
    identity_text = " ".join(_normalized_label(_safe_text(node)) for node in
                              _children_and_descendants(profile, control_type="Text"))
    identity_ok = _normalized_label(friend) in identity_text
    if not identity_text:
        try:
            identity_ok = profile.child_window(
                auto_id="right_v_view.nickname_button_view.display_name_text",
                title=friend, control_type="Text").exists(timeout=1)
        except Exception:
            identity_ok = True
    if not identity_ok:
        raise CaptureError("FRIEND_MISMATCH", "打开的资料卡与所选好友不一致，已停止读取。")
    # A duplicate display name alone cannot identify the selected contact.
    # A visible WeChat ID/alias from the authorized local contact directory
    # must also match the opened card when one was used for the search.
    if expected_identifier and _normalized_label(expected_identifier) != _normalized_label(friend):
        marker = _normalized_label(expected_identifier)
        if not marker.startswith("wxid_") and marker not in identity_text:
            raise CaptureError("MOMENTS_OWNER_UNVERIFIED", "好友资料中的微信号与所选联系人不一致，已停止读取，避免混入同名好友。")
    link = profile.child_window(**ui.Texts.MomentsText)
    for attempt in range(8):
        if _wait_exists(link, timeout=.4, visible=True):
            break
        # WeChat preserves the profile's scroll position across openings.
        # Restore only this selected contact's detail viewport, never the chat.
        scroll = profile.child_window(class_name="mmui::GradientMaskScrollView")
        if scroll.exists(timeout=.2):
            from pywinauto import mouse
            rect = scroll.rectangle()
            mouse.scroll(coords=(rect.left + rect.width() // 2, rect.top + rect.height() // 2), wheel_dist=8)
            time.sleep(.5)
        else:
            time.sleep(.3)
    if not _wait_exists(link, timeout=.5, visible=True):
        raise CaptureError("MOMENTS_ENTRY_UNAVAILABLE", "已打开所选好友资料，但未找到可点击的朋友圈入口。本次未开始读取；请确认这位好友资料中是否显示朋友圈。")
    target = _find_clickable_ancestor(link)
    click_targets = []
    try:
        container = link.parent().parent()
        buttons = [button for button in _children_and_descendants(container, control_type="Button")
                   if _is_visible(button) and _is_enabled(button)]
        semantic = [button for button in buttons
                    if "SnsView" in getattr(button, "class_name", lambda: "")() or
                    "value_sns_view" in str(getattr(getattr(button, "element_info", None), "automation_id", ""))]
        click_targets.extend(semantic or buttons)
    except Exception:
        pass
    click_targets.extend([target, link])
    window = Desktop(backend="uia").window(**ui.Windows.MomentsWindow)
    for candidate in click_targets:
        try:
            _click_control(candidate)
            album = _moments_window(main, window)
            if _wait_exists(album.child_window(**ui.Lists.MomentsList), timeout=2, visible=True):
                return album
        except Exception:
            continue
    if _retry < 1:
        # Some WeChat builds close the profile on the first click without
        # opening the embedded album. Reopen the verified contact card and
        # resolve a fresh Moments button rather than clicking stale wrappers.
        time.sleep(.35)
        return _open_moments_from_chat(main, friend, modules,
                                       expected_identifier=expected_identifier, _retry=_retry + 1)
    raise CaptureError("MOMENTS_ENTRY_UNAVAILABLE", "朋友圈入口没有打开，请保持微信窗口可见后重试。") from None


def _visible_moment_cells(listing):
    try:
        nodes = listing.children(control_type="ListItem")
    except Exception:
        nodes = []
    if not nodes:
        nodes = _children_and_descendants(listing, control_type="ListItem")
    bounds = _control_rect(listing)
    cells = []
    for cell in nodes:
        try:
            class_name = cell.class_name()
        except Exception:
            class_name = ""
        if class_name in ("mmui::AlbumBaseCell", "mmui::AlbumTopCell"):
            continue
        rect = _control_rect(cell)
        # Qt/UIA may report a recycled cell as visible even when its click
        # centre is outside the scroll viewport. Clicking it can hit the app
        # underneath or a different post.
        if bounds and rect and not (bounds[1] + 48 <= (rect[1] + rect[3]) / 2 <= bounds[3] - 32):
            continue
        if _is_visible(cell):
            cells.append(cell)
    return cells


def _viewport_has_trailing_space(listing):
    """Positive end proof for WeChat builds without a UIA ScrollPattern."""
    bounds = _control_rect(listing)
    if not bounds:
        return False
    try:
        posts = [cell for cell in listing.children(control_type="ListItem")
                 if getattr(cell, "class_name", lambda: "")() == "mmui::AlbumContentCell"]
    except Exception:
        return False
    rects = [_control_rect(cell) for cell in posts]
    rects = [rect for rect in rects if rect]
    return bool(rects and max(rect[3] for rect in rects) <= bounds[3] - 16)


def _cell_scan_key(cell):
    """Keep a post marked as visited while Qt moves/recycles its wrapper."""
    label = _normalized_label(_safe_text(cell))
    try:
        kind = cell.class_name()
    except Exception:
        kind = ""
    return kind, label if label else _control_rect(cell)


def _viewport_fingerprint(listing):
    values = []
    for cell in _visible_moment_cells(listing):
        rect = _control_rect(cell)
        y = rect[1] if rect else len(values)
        try:
            class_name = cell.class_name()
        except Exception:
            class_name = ""
        values.append((class_name, _normalized_label(_safe_text(cell))[:180], y))
    scroll = None
    try:
        scroll = round(float(listing.iface_scroll.CurrentVerticalScrollPercent), 2)
    except Exception:
        pass
    return tuple(values), scroll


def _scroll_percent(listing):
    try:
        return float(listing.iface_scroll.CurrentVerticalScrollPercent)
    except Exception:
        return None


def _advance_moments_list(listing):
    """Advance a virtualized WeChat list and prove that it moved."""
    try:
        from pywinauto import mouse
    except (ImportError, AttributeError):
        mouse = None
    before = _viewport_fingerprint(listing)
    before_percent = _scroll_percent(listing)
    actions = []
    try:
        rect = listing.rectangle()
        center = (rect.left + rect.width() // 2, rect.top + rect.height() // 2)
        if mouse is not None:
            actions.append(lambda: mouse.scroll(coords=center, wheel_dist=-6))
    except Exception:
        pass
    actions.extend((
        lambda: listing.type_keys("{PAGEDOWN}", pause=.1, set_foreground=True),
        lambda: listing.type_keys("{DOWN}", pause=.1, set_foreground=True),
    ))
    for action in actions:
        try:
            _ensure_foreground(listing)
            try:
                listing.set_focus()
            except Exception:
                pass
            action()
        except CaptureError:
            raise
        except Exception:
            continue
        current = _viewport_fingerprint(listing)
        current_percent = _scroll_percent(listing)
        if current != before or (before_percent is not None and current_percent is not None and current_percent > before_percent + .01):
            return True
        deadline = time.monotonic() + .9
        while time.monotonic() < deadline:
            time.sleep(.12)
            current = _viewport_fingerprint(listing)
            current_percent = _scroll_percent(listing)
            if current != before or (before_percent is not None and current_percent is not None and current_percent > before_percent + .01):
                return True
    return False


def _moments(friend, limit, progress, modules, *, all_visible=False, on_rows=None, search_query=None):
    Navigator, Tools, ui = modules
    try:
        progress(8, "正在打开所选好友", phase="searching_contact", recordCount=0, pinnedCount=0,
                 lastAction="open_chat")
    except TypeError:
        progress(8, "正在打开所选好友")
    main = _open_target(friend, modules, search_query=search_query)
    main_identity = (main.handle, main.process_id())
    try:
        progress(12, "正在核对好友资料和朋友圈入口", phase="opening_profile", recordCount=0,
                 pinnedCount=0, lastAction="open_profile")
    except TypeError:
        progress(12, "正在核对好友资料和朋友圈入口")
    window = _open_moments_from_chat(main, friend, modules, expected_identifier=search_query)
    listing = window.child_window(**ui.Lists.MomentsList)
    detail = window.child_window(**ui.Lists.SnsDetailList)
    back = window.child_window(**ui.Buttons.BackButton)
    if not _wait_exists(listing, timeout=8, visible=True):
        raise CaptureError("MOMENTS_UNREADABLE", "朋友圈列表不可读，可能未开放、暂无内容或当前微信版本界面不兼容。")
    try:
        listing.wait("ready", timeout=4)
    except Exception:
        pass

    phase = "opening_moments"
    def assert_view():
        if (main.handle, main.process_id()) != main_identity:
            raise CaptureError("MOMENTS_VIEW_CHANGED", "当前朋友圈已切换，已停止读取，避免混入另一位好友的动态。")

    def refresh_listing():
        nonlocal listing, detail, back
        try:
            current_lists = [item for item in main.descendants(control_type="List")
                             if getattr(item.element_info, "automation_id", "") == "sns_list"
                             and _is_visible(item)]
            if len(current_lists) == 1:
                listing = current_lists[0]
        except Exception:
            pass
        try:
            detail = window.child_window(**ui.Lists.SnsDetailList)
            back = window.child_window(**ui.Buttons.BackButton)
        except Exception:
            pass
        return listing

    try:
        Tools.activate_momentsList(listing)
    except Exception:
        pass
    # The first synthetic/real list cell is not selected until the list receives
    # one navigation event. This also prevents an initial virtual index of -1
    # from being treated as a real post.
    try:
        listing.type_keys("{DOWN}", pause=.05, set_foreground=True)
    except Exception:
        pass
    rows, warnings = [], []
    pinned_seen, normal_seen, post_keys = set(), set(), set()
    pinned_attempts, normal_attempts = {}, {}
    image_bytes = 0
    last_publish = time.monotonic()
    completion = {"scope": "all-visible" if all_visible else "requested-count", "complete": False,
                  "stopReason": "scanning", "recordCount": 0, "imageOmittedCount": 0,
                  "unreadableCount": 0, "phase": phase, "scrollAttempts": 0,
                  "pinnedCount": 0, "lastAction": "open_moments"}

    def report(value, message, action=None):
        completion["phase"] = phase
        if action:
            completion["lastAction"] = action
        try:
            progress(value, message, phase=phase, recordCount=moment_count(),
                     pinnedCount=completion["pinnedCount"], lastAction=completion["lastAction"])
        except TypeError:
            progress(value, message)

    def moment_count():
        return sum(row.get("kind") == "post" for row in rows)

    # Header cells contain the cover and signature on supported WeChat builds.
    header = [cell for cell in _children_and_descendants(listing, control_type="ListItem")
              if getattr(cell, "class_name", lambda: "")() == "mmui::AlbumBaseCell"]
    if len(header) >= 2:
        try:
            rows.append({"kind": "image", "sender": friend, "senderRole": "other", "text": "朋友圈封面",
                         "images": [_image(header[0], "moments-cover.jpg")],
                         "source": {"materialRole": "moments-cover", "imageType": "visible-ui-preview"}})
        except Exception:
            warnings.append("朋友圈封面未能读取，未纳入画面分析。")
        signature = _safe_text(header[1])
        if signature:
            rows.append({"kind": "text", "sender": friend, "senderRole": "other", "text": signature,
                         "source": {"materialRole": "profile-signature"}})

    def read_detail(item, pinned=False):
        nonlocal image_bytes, listing, detail, phase
        parent_phase = phase
        phase = "reading_pinned_detail" if pinned else "reading_feed_detail"
        completion["phase"] = phase
        opened = False
        try:
            if not _wait_hidden(detail, timeout=2):
                raise CaptureError("MOMENTS_DETAIL_STALE", "上一条动态详情尚未关闭，已暂停以避免把内容归到错误动态。")
            _click_control(item)
            if not _wait_exists(detail, timeout=4, visible=True):
                raise CaptureError("MOMENTS_DETAIL_TIMEOUT", "动态详情没有打开，已保留当前进度。")
            opened = True
            content_item = None
            deadline = time.monotonic() + 3
            while True:
                items = _children_and_descendants(detail, control_type="ListItem")
                if items:
                    content_item = items[0]
                    if _safe_text(content_item) or _is_visible(content_item):
                        break
                if time.monotonic() >= deadline:
                    break
                time.sleep(.12)
            if content_item is None:
                raise CaptureError("MOMENTS_DETAIL_UNREADABLE", "动态详情已打开，但内容尚未加载。")
            raw = _safe_text(content_item)
            matches = list(ui.Regex_Patterns.Snsdetail_Timestamp_pattern.finditer(raw))
            stamp = matches[-1] if matches else None
            at = stamp.group(0).strip() if stamp else ""
            content = (raw[:stamp.start()] + raw[stamp.end():]).strip() if stamp else raw.strip()
            if content.startswith(friend):
                content = content[len(friend):].lstrip()
            row = {"kind": "post", "sender": friend, "senderRole": "other", "at": at, "text": content,
                   "source": {"materialRole": "moment", "pinned": pinned,
                              "imageType": "visible-ui-preview",
                              "timePrecision": "ui-label" if at else "unknown"}}
            try:
                preview = _image(content_item, f"moment-preview-{len(rows)+1}.jpg")
                size = len(preview["data"])
                if image_bytes + size <= 20 * 1024 * 1024:
                    row["images"] = [preview]
                    image_bytes += size
                else:
                    completion["imageOmittedCount"] += 1
                    row["source"]["previewUnavailable"] = "batch-image-budget"
            except Exception:
                completion["imageOmittedCount"] += 1
                row["source"]["previewUnavailable"] = "capture-unavailable"
            if not content.strip() and not row.get("images"):
                completion["unreadableCount"] += 1
                warnings.append("部分朋友圈无法读取文字或图片，已保留位置并继续。")
                return None
            preview_hash = hashlib.sha256(row["images"][0]["data"].encode("ascii")).hexdigest() if row.get("images") else ""
            post_key = (at, _normalized_label(content) or preview_hash)
            if post_key in post_keys:
                return None
            post_keys.add(post_key)
            rows.append(row)
            completion["recordCount"] = moment_count()
            if pinned:
                completion["pinnedCount"] += 1
            return row
        finally:
            if opened:
                try:
                    _click_control(back)
                except Exception:
                    pass
                if not _wait_hidden(detail, timeout=3):
                    raise CaptureError("MOMENTS_DETAIL_STALE", "上一条动态详情没有关闭，已保留当前进度。")
                _wait_exists(listing, timeout=3, visible=True)
                refresh_listing()
            phase = parent_phase

    def read_pinned():
        nonlocal phase, listing, last_publish
        phase = "reading_pinned"
        completion["phase"] = phase
        top_cells = [cell for cell in _children_and_descendants(listing, control_type="ListItem")
                     if getattr(cell, "class_name", lambda: "")() == "mmui::AlbumTopCell"
                     and "置顶" in _safe_text(cell)]
        if not top_cells:
            return
        top = top_cells[0]
        before = _viewport_fingerprint(listing)
        try:
            _click_control(_find_clickable_ancestor(top))
        except Exception:
            _click_control(top)
        deadline = time.monotonic() + 4
        entered = False
        while time.monotonic() < deadline:
            if _viewport_fingerprint(listing) != before:
                entered = True
                break
            time.sleep(.15)
        if not entered:
            warnings.append("置顶区域没有展开，已继续读取普通朋友圈；置顶内容需要再次确认。")
            completion["unreadableCount"] += 1
            return
        pinned_stall = 0
        pinned_steps = 0
        while pinned_stall < 3 and pinned_steps < 100:
            if not all_visible and moment_count() >= limit:
                break
            pinned_steps += 1
            refresh_listing()
            cells = _visible_moment_cells(listing)
            fresh = []
            for cell in cells:
                key = _cell_scan_key(cell)
                if key not in pinned_seen:
                    fresh.append((cell, key))
            if fresh:
                pinned_stall = 0
                cell, key = fresh[0]
                try:
                    read_detail(cell, pinned=True)
                    pinned_seen.add(key)
                except CaptureError as error:
                    if error.code not in ("MOMENTS_DETAIL_TIMEOUT", "MOMENTS_DETAIL_UNREADABLE", "MOMENTS_DETAIL_STALE"):
                        raise
                    pinned_attempts[key] = pinned_attempts.get(key, 0) + 1
                    if pinned_attempts[key] >= 3:
                        pinned_seen.add(key)
                        completion["unreadableCount"] += 1
                        warnings.append(f"一条置顶动态无法打开（{error.code}），已保留其他已读内容。")
                report(50 if all_visible else min(90, 15 + int(moment_count() / max(limit, 1) * 70)),
                       f"已读取置顶 {completion['pinnedCount']} 条朋友圈", "read_pinned")
                if on_rows and moment_count() and (moment_count() == 1 or time.monotonic() - last_publish >= 5):
                    on_rows(rows, warnings, dict(completion))
                    last_publish = time.monotonic()
                continue
            if not _advance_moments_list(listing):
                pinned_stall += 1
            else:
                pinned_stall = 0
        if pinned_steps >= 100 and all_visible:
            completion["unreadableCount"] += 1
            warnings.append("置顶区域达到本次翻页上限，已保留已读内容；置顶动态可能尚未读完。")
        elif pinned_stall >= 3 and not ((_scroll_percent(listing) is not None and _scroll_percent(listing) >= 99.9)
                                         or _viewport_has_trailing_space(listing)):
            completion["unreadableCount"] += 1
            warnings.append("置顶区域没有继续向下，未确认到达末尾；已保留已读内容。")
        # In WeChat 4.1.15 the pinned album replaces the ordinary list in the
        # same sns_list. Its BackButton returns to the ordinary album header.
        try:
            _click_control(back)
            deadline = time.monotonic() + 4
            returned = False
            while time.monotonic() < deadline:
                refresh_listing()
                returned = any(getattr(cell, "class_name", lambda: "")() == "mmui::AlbumTopCell"
                               for cell in _children_and_descendants(listing, control_type="ListItem"))
                if returned:
                    break
                time.sleep(.15)
            if not returned:
                raise CaptureError("PINNED_EXIT_FAILED", "置顶内容已读取，但无法回到普通朋友圈列表；已保留已读内容。")
        except CaptureError:
            raise
        except Exception:
            raise CaptureError("PINNED_EXIT_FAILED", "置顶内容已读取，但无法回到普通朋友圈列表；已保留已读内容。") from None

    read_pinned()
    phase = "reading_feed"
    completion["phase"] = phase
    scroll_stalls = 0
    while True:
        if not all_visible and moment_count() >= limit:
            completion["stopReason"] = "requested-count"
            break
        assert_view()
        refresh_listing()
        cells = _visible_moment_cells(listing)
        fresh = []
        for cell in cells:
            key = _cell_scan_key(cell)
            if key not in normal_seen:
                fresh.append((cell, key))
        if fresh:
            scroll_stalls = 0
            item, key = fresh[0]
            try:
                read_detail(item, pinned=False)
                normal_seen.add(key)
            except CaptureError as error:
                if error.code in ("MOMENTS_DETAIL_TIMEOUT", "MOMENTS_DETAIL_UNREADABLE", "MOMENTS_DETAIL_STALE"):
                    normal_attempts[key] = normal_attempts.get(key, 0) + 1
                    if normal_attempts[key] >= 3:
                        normal_seen.add(key)
                        completion["unreadableCount"] += 1
                        warnings.append(error.message)
                else:
                    raise
            report(50 if all_visible else min(90, 15 + int(moment_count() / max(limit, 1) * 70)),
                   f"已读取 {moment_count()} 条朋友圈，正在继续向下翻页…", "read_feed")
            if on_rows and moment_count() and (moment_count() == 1 or time.monotonic() - last_publish >= 5):
                on_rows(rows, warnings, dict(completion))
                last_publish = time.monotonic()
            if not all_visible and moment_count() >= limit:
                completion["stopReason"] = "requested-count"
                break
            continue
        completion["lastAction"] = "scroll"
        completion["scrollAttempts"] += 1
        if _advance_moments_list(listing):
            scroll_stalls = 0
            continue
        scroll_stalls += 1
        if scroll_stalls < 3:
            time.sleep(.35)
            continue
        percent = _scroll_percent(listing)
        at_end = (percent is not None and percent >= 99.9) or _viewport_has_trailing_space(listing)
        completion["complete"] = bool(at_end and not completion["unreadableCount"])
        completion["stopReason"] = "unreadable-posts" if completion["unreadableCount"] else ("visible-end" if at_end else "navigation-stalled")
        break

    if not rows:
        raise CaptureError("NO_VISIBLE_MOMENTS", "没有读到可见朋友圈。可能被限制可见、暂无内容或界面不可读；不会绕过可见范围。")
    if completion["stopReason"] == "navigation-stalled":
        warnings.append("朋友圈列表没有继续向下，且未确认到达可见末尾；已保留读到的内容，请点击继续采集。")
    if completion["imageOmittedCount"]:
        warnings.append(f"已保留所有读到的动态文字；其中 {completion['imageOmittedCount']} 条详情预览因容量或截图不可用未附加图片。")
    warnings.append("仅采集当前账号可见的朋友圈；可见末尾可能由权限决定，不代表对方全部历史。")
    warnings.append("朋友圈时间保留原界面标签，未出现完整日期的内容不会推测年份。")
    return rows, warnings, completion


def capture(request, progress, on_partial=None):
    if sys.platform != "win32":
        raise CaptureError("UNSUPPORTED_PLATFORM", "本采集器仅支持Windows。Mac请使用网页屏幕共享采集。")
    import pythoncom
    pythoncom.CoInitialize()
    moments_source = None
    try:
        from pyweixin import Navigator, Tools, GlobalConfig
        from pyweixin import Uielements as ui
        GlobalConfig.close_weixin = False
        GlobalConfig.is_maximize = False
        progress(2, "正在准备微信采集窗口")
        _prepare_capture_ui()
        progress(5, "正在核对当前微信账号")
        account, nickname = _account(Navigator)
        canonical_account = account
        moments_selection = None
        modules = Navigator, Tools, ui
        include_voice = request.get("includeVoice", False)
        if type(include_voice) is not bool:
            raise CaptureError("INVALID_REQUEST", "语音补全选项必须明确为是或否。")
        two_phase = request["kind"] == "chat" and include_voice and on_partial is not None
        first_progress = (lambda value, message: progress(5 + int(value * .45), message)) if two_phase else progress
        if request["kind"] == "chat":
            rows, warnings = _chat(request["friend"], request["limit"], nickname, first_progress, modules, convert_voices=False)
        else:
            moments_source = _open_moments_source(request, account)
            moments_selection = _resolve_moments_contact(request, moments_source)
            target, search_query, canonical_account = moments_selection
            def publish_moments(rows, warnings, completion):
                if on_partial is None:
                    return
                # open_my_profile -> open_weixin closes the embedded album in
                # WeChat 4.1.15. Check the same authorized login/contact without
                # opening any UI, both before partial publication and at end.
                if _resolve_moments_contact(request, moments_source) != moments_selection:
                    raise CaptureError("ACCOUNT_CHANGED", "当前账号或所选联系人已变化，已停止本次采集。")
                partial = normalized_capture("moments", request["friend"], canonical_account, rows, warnings)
                partial["coverage"] = completion
                on_partial(partial)
            rows, warnings, completion = _moments(target, request["limit"], progress, modules,
                all_visible=request.get("allVisible", False), on_rows=publish_moments, search_query=search_query)
        progress(50 if two_phase else 95, "正在核对采集账号并整理原文")
        if moments_selection:
            if _resolve_moments_contact(request, moments_source) != moments_selection:
                raise CaptureError("ACCOUNT_CHANGED", "当前账号或所选联系人已变化，未合并本轮动态。")
        else:
            final_account, final_nickname = _account(Navigator)
            if (account, nickname) != (final_account, final_nickname):
                raise CaptureError("ACCOUNT_CHANGED", "采集期间微信账号发生变化，结果已丢弃，请重新采集。")
        batch = normalized_capture(request["kind"], request["friend"], canonical_account, rows, warnings)
        if request["kind"] == "moments":
            batch["coverage"] = completion
        missing = any(row.get("source", {}).get("mediaKind") == "voice" and row["source"].get("transcriptionStatus") != "visible-text" for row in rows)
        # Default capture releases the desktop after the quick read. Conversion
        # requires an explicit request and a consumer able to retain partials.
        if not two_phase or not missing:
            return batch
        on_partial(batch)
        progress(55, "文字已导入，正在补全语音…请保持微信前台，可随时停止。")
        converted, converted_warnings = _chat(request["friend"], request["limit"], nickname,
            lambda value, message: progress(55 + int(value * .4), message if message.startswith("文字已导入") else "文字已导入，正在补全语音…" + message), modules, convert_voices=True)
        final_account, final_nickname = _account(Navigator)
        if (account, nickname) != (final_account, final_nickname):
            raise CaptureError("ACCOUNT_CHANGED", "补全期间微信账号发生变化。已保留此前核对的文字，本轮语音未导入。")
        def identity(row):
            source = row.get("source", {})
            voice = source.get("mediaKind") == "voice"
            return (row.get("sender"), row.get("senderRole"), row.get("at"), source.get("uiClass"),
                    "voice" if voice else row.get("kind"), source.get("rawMediaLabel") if voice else row.get("text"))
        if [identity(row) for row in rows] != [identity(row) for row in converted]:
            raise CaptureError("SOURCE_CHANGED", "补全期间聊天范围或说话人发生变化。已保留此前核对的文字，请重新选择范围。")
        progress(95, "文字与语音已核对，正在整理原文。")
        return normalized_capture(request["kind"], request["friend"], account, converted, converted_warnings)
    finally:
        if moments_source is not None:
            moments_source.close()
        pythoncom.CoUninitialize()
