"""Read one explicitly selected Weixin UI; no cloud calls or automatic uploads.

The user authorized existing website/Qwen analysis AFTER preview and confirmation.
This adapter only returns local records to the paired browser preview. It has no
HTTP client, database/key access, send-message API, or contact enumeration.
UI navigation can bring Weixin forward and mark the selected chat read.
"""
import base64
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
        listing = main.child_window(**ui.Lists.SearchResult).wait("ready", timeout=4)
        candidates = [item for item in listing.children(control_type="ListItem")
                      if item.class_name() == "mmui::SearchContentCellView" and item.window_text().strip() == friend]
    except Exception:
        raise CaptureError("FRIEND_NOT_FOUND", "未找到这个完整备注的本地联系人，请核对微信里显示的完整名称。")
    if not candidates:
        raise CaptureError("FRIEND_NOT_FOUND", "未找到这个完整备注的本地联系人，请核对微信里显示的完整名称。")
    if len(candidates) != 1:
        raise CaptureError("FRIEND_AMBIGUOUS", "微信里有多个同名搜索项，请给目标好友设置唯一备注后重试。")
    candidates[0].click_input()
    _assert_target(main, friend, ui.Texts, Tools)
    return main


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
    if not window.exists(timeout=0.3):
        visible_lists = [item for item in main.descendants(control_type="List")
                         if item.element_info.automation_id == "sns_list" and item.is_visible()]
        if len(visible_lists) != 1:
            raise CaptureError("MOMENTS_UNREADABLE", "指定好友的朋友圈界面无法唯一确认，已停止采集。")
        return main
    return window


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


def _resolve_moments_contact(request):
    """Resolve the selected local contact; never read any message bodies."""
    from background_reader import _provider_module, _resolve_contact, _contact_display, _duplicate_displays, _contact_metadata_columns, _contact_text
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
        source.close()


def _open_moments_from_chat(main, friend, modules):
    """Open the already verified chat's album, without upstream's second search."""
    from pywinauto import Desktop
    _, Tools, ui = modules
    pane = main.child_window(auto_id="single_chat_info_view", control_type="Group")
    if not pane.exists(timeout=.2):
        main.child_window(**ui.Buttons.ChatInfoButton).click_input()
    avatar = pane.child_window(title=friend, control_type="Button").wait("ready", timeout=3)
    buttons = avatar.children(control_type="Button")
    if not buttons:
        raise CaptureError("MOMENTS_UNREADABLE", "无法打开所选好友的资料，请关闭微信弹窗后重试。")
    buttons[0].click_input()
    profile = Desktop(backend="uia").window(**ui.Windows.PopUpProfileWindow)
    if not profile.exists(timeout=1):
        profile = main.window(**ui.Windows.PopUpProfileWindow)
    link = profile.child_window(**ui.Texts.MomentsText).wait("ready", timeout=3)
    link.parent().parent().descendants(control_type="Button")[0].click_input()
    window = Desktop(backend="uia").window(**ui.Windows.MomentsWindow)
    return _moments_window(main, window)


def _moments(friend, limit, progress, modules, *, all_visible=False, on_rows=None, search_query=None):
    Navigator, Tools, ui = modules
    main = _open_target(friend, modules, search_query=search_query)
    window = _open_moments_from_chat(main, friend, modules)
    listing = window.child_window(**ui.Lists.MomentsList)
    detail = window.child_window(**ui.Lists.SnsDetailList)
    back = window.child_window(**ui.Buttons.BackButton)
    if not listing.exists(timeout=2):
        raise CaptureError("MOMENTS_UNREADABLE", "朋友圈列表不可读，可能未开放、暂无内容或当前微信版本界面不兼容。")
    Tools.activate_momentsList(listing)
    rows, warnings, seen = [], [], set()
    idle, image_bytes = 0, 0
    completion = {"scope": "all-visible" if all_visible else "requested-count", "complete": False,
                  "stopReason": "scanning", "recordCount": 0, "imageOmittedCount": 0, "unreadableCount": 0}
    last_publish = time.monotonic()
    while True:
        listing.type_keys("{DOWN}", pause=0.12, set_foreground=True)
        selected = [item for item in listing.children(control_type="ListItem") if item.has_keyboard_focus()]
        if not selected:
            idle += 1
            if idle >= 5:
                completion["stopReason"] = "focus-unavailable"
                break
            continue
        item = selected[0]
        # Virtualized lists recycle runtime IDs. Include visible content so
        # thousands of old posts are not mistaken for the first loaded page.
        runtime = (tuple(item.element_info.runtime_id or []), item.window_text())
        if runtime in seen:
            idle += 1
            if idle >= 8:
                at_end = _moments_at_visible_end(listing)
                completion.update(complete=at_end and not completion["unreadableCount"],
                                  stopReason="unreadable-posts" if completion["unreadableCount"] else
                                  "visible-end" if at_end else "navigation-stalled")
                break
            progress(50 if all_visible else min(90, 15 + int(len(rows) / limit * 70)),
                     f"已读取 {len(rows)} 条朋友圈，正在确认是否还有更早动态…")
            time.sleep(.5)
            continue
        seen.add(runtime)
        if item.class_name() in ("mmui::AlbumBaseCell", "mmui::AlbumTopCell"):
            continue
        idle = 0
        item.click_input()
        if not detail.exists(timeout=1):
            completion["unreadableCount"] += 1
            warnings.append("部分朋友圈无法打开详情，已跳过。")
            continue
        try:
            items = detail.children(control_type="ListItem")
            if not items:
                completion["unreadableCount"] += 1
                continue
            content_item = items[0]
            raw = content_item.window_text()
            matches = list(ui.Regex_Patterns.Snsdetail_Timestamp_pattern.finditer(raw))
            stamp = matches[-1] if matches else None
            at = stamp.group(0).strip() if stamp else ""
            content = (raw[:stamp.start()] + raw[stamp.end():]).strip() if stamp else raw.strip()
            if content.startswith(friend):
                content = content[len(friend):].lstrip()
            row = {"kind": "post", "sender": friend, "senderRole": "other", "at": at, "text": content,
                   "source": {"imageType": "visible-ui-preview", "timePrecision": "ui-label" if at else "unknown"}}
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
                warnings.append("部分朋友圈详情截图未获取，已保留可读文字。")
            if not content.strip() and not row.get("images"):
                completion["unreadableCount"] += 1
                continue
            rows.append(row)
            completion["recordCount"] = len(rows)
            progress(50 if all_visible else min(90, 15 + int(len(rows) / limit * 70)), f"已读取 {len(rows)} 条朋友圈，继续读取更早动态…")
        finally:
            if detail.exists(timeout=0.2):
                back.click_input()
                listing.wait("ready", timeout=2)
        if on_rows and (len(rows) == 1 or time.monotonic() - last_publish >= 5):
            on_rows(rows, warnings, dict(completion))
            last_publish = time.monotonic()
        if not all_visible and len(rows) >= limit:
            completion["stopReason"] = "requested-count"
            break
    if not rows:
        raise CaptureError("NO_VISIBLE_MOMENTS", "没有读到可见朋友圈。可能被限制可见、暂无内容或界面不可读；不会绕过可见范围。")
    if completion["stopReason"] == "focus-unavailable":
        warnings.append("微信列表焦点丢失，本次只保留已读取的动态，尚未确认读到可见末尾。请将微信放在前台后重试。")
    if completion["stopReason"] == "navigation-stalled":
        warnings.append("朋友圈列表没有继续向下，且未确认到达可见末尾；已保留读到的内容，请检查微信窗口后继续采集。")
    if completion["imageOmittedCount"]:
        warnings.append(f"已保留所有读到的动态文字；其中 {completion['imageOmittedCount']} 条详情预览因容量或截图不可用未附加图片，不能据此分析画面。")
    warnings.append("仅采集当前账号可见的朋友圈；可见末尾可能由三天、半年或分组权限决定，不代表对方全部历史。配图为详情区域预览，可能只显示部分缩略图。")
    warnings.append("朋友圈时间保留原界面标签，未出现完整日期的内容不会推测年份。")
    return rows, warnings, completion


def capture(request, progress, on_partial=None):
    if sys.platform != "win32":
        raise CaptureError("UNSUPPORTED_PLATFORM", "本采集器仅支持Windows。Mac请使用网页屏幕共享采集。")
    import pythoncom
    pythoncom.CoInitialize()
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
            moments_selection = (_resolve_moments_contact(request) if request.get("contactId")
                                 else (request["friend"], request["friend"], account))
            target, search_query, canonical_account = moments_selection
            def publish_moments(rows, warnings, completion):
                if on_partial is None:
                    return
                if _account(Navigator) != (account, nickname):
                    raise CaptureError("ACCOUNT_CHANGED", "微信账号已变化，已停止；已核对的动态仍可查看。")
                if request.get("contactId") and _resolve_moments_contact(request) != moments_selection:
                    raise CaptureError("ACCOUNT_CHANGED", "当前账号或所选联系人已变化，已停止本次采集。")
                partial = normalized_capture("moments", request["friend"], canonical_account, rows, warnings)
                partial["coverage"] = completion
                on_partial(partial)
            rows, warnings, completion = _moments(target, request["limit"], progress, modules,
                all_visible=request.get("allVisible", False), on_rows=publish_moments, search_query=search_query)
        progress(50 if two_phase else 95, "正在核对采集账号并整理原文")
        final_account, final_nickname = _account(Navigator)
        if (account, nickname) != (final_account, final_nickname):
            raise CaptureError("ACCOUNT_CHANGED", "采集期间微信账号发生变化，结果已丢弃，请重新采集。")
        if moments_selection and request.get("contactId") and _resolve_moments_contact(request) != moments_selection:
            raise CaptureError("ACCOUNT_CHANGED", "当前账号或所选联系人已变化，未合并本轮动态。")
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
        pythoncom.CoUninitialize()
