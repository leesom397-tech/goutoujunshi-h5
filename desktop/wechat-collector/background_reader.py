"""Bounded, read-only capture from an explicitly authorized local source.

The database provider is intentionally separate. This module does not discover
private databases, inspect process memory, extract keys, or decrypt databases.
Without an installed authorized source provider, capability probing fails closed.
"""
from __future__ import annotations

import base64
import binascii
import copy
import hashlib
import importlib.util
import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Protocol
from urllib.parse import urlsplit, urlunsplit
from xml.etree import ElementTree

MAX_ROWS = 1000
MAX_TEXT = 20_000
MAX_AUDIO = 8 * 1024 * 1024
MAX_AUDIO_BATCH = 64 * 1024 * 1024
MAX_SHARDS = 64
MAX_PAGE_SIZE = 500
MAX_VOICE_REFS = 500
MAX_IMAGE_REFS = 100
MAX_CURSOR_LENGTH = 24_000
MAX_CONTACT_RESULTS = 20
HISTORY_FIELDS = {"pageSize", "direction", "cursor", "since"}


class BackgroundCaptureError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code, self.message = code, message


class AuthorizedSource(Protocol):
    """Provider must independently verify the current account, never guess it.

    Connections are read-only snapshots. Shard labels are stable relative names;
    the provider must not expose paths, credentials, or other contacts in metadata.
    Caller closes the source on success, cancellation, or failure.
    """
    account_id: str
    account_label: str
    self_username: str

    def contacts(self): ...
    def message_shards(self): ...
    def media_shards(self): ...
    def assert_unchanged(self): ...
    def close(self): ...


def _provider_module():
    if importlib.util.find_spec("local_database_source") is None:
        return None
    import local_database_source
    return local_database_source


def probe_background():
    """Metadata-only; never opens chat databases or starts transcription/download."""
    provider = _provider_module()
    if provider is None:
        return {"ready": False, "voiceReady": False, "modelReady": False,
                "message": "尚未连接经过授权的本地聊天数据源；可继续快速导入可见聊天。"}
    try:
        state = provider.probe_authorized_source()
        from local_voice_transcriber import probe_transcriber
        transcriber = probe_transcriber()
        return {"ready": state.get("ready") is True,
                "maxRows": MAX_ROWS, "pageSize": MAX_PAGE_SIZE,
                "voiceReady": state.get("ready") is True and transcriber.get("dependenciesReady") is True,
                "modelReady": transcriber.get("modelReady") is True,
                "status": str(state.get("status") or "unavailable")[:80],
                "message": str(state.get("message") or "")[:300]}
    except Exception:
        return {"ready": False, "voiceReady": False, "modelReady": False,
                "message": "本地后台读取尚不可用，可继续使用快速导入。"}


def _validate_request(request):
    if not isinstance(request, dict) or request.get("kind") != "chat":
        raise BackgroundCaptureError("INVALID_REQUEST", "后台读取目前仅支持一对一聊天。")
    if set(request) - ({"kind", "friend", "contactId", "accountKey", "limit", "includeVoice", "mode", "voiceOnly", "voiceIds", "imageOnly", "imageIds"} | HISTORY_FIELDS):
        raise BackgroundCaptureError("INVALID_REQUEST", "采集请求包含不支持的参数。")
    friend = request.get("friend")
    limit = request.get("limit", 500)
    voice = request.get("includeVoice", False)
    selected = "contactId" in request or "accountKey" in request
    if not isinstance(friend, str) or not friend.strip() or len(friend) > (500 if selected else 100) or any(ord(c) < 32 for c in friend):
        raise BackgroundCaptureError("INVALID_REQUEST", "请填写联系人的完整昵称或备注。")
    if selected:
        contact_id, account_key = request.get("contactId"), request.get("accountKey")
        if not isinstance(contact_id, str) or not contact_id or len(contact_id) > 200 or any(ord(c) < 32 for c in contact_id):
            raise BackgroundCaptureError("INVALID_CONTACT_ID", "联系人选择已失效，请重新搜索并选择。")
        if not isinstance(account_key, str) or not re.fullmatch(r"[0-9a-f]{64}", account_key):
            raise BackgroundCaptureError("INVALID_ACCOUNT_KEY", "微信账号选择已失效，请重新搜索并选择。")
    if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= MAX_ROWS:
        raise BackgroundCaptureError("INVALID_REQUEST", "每次读取范围必须在 1 至 1000 条之间。")
    if not isinstance(voice, bool):
        raise BackgroundCaptureError("INVALID_REQUEST", "语音选项必须明确为开启或关闭。")
    voice_only = request.get("voiceOnly", False)
    if type(voice_only) is not bool:
        raise BackgroundCaptureError("INVALID_REQUEST", "语音补全范围必须明确。")
    refs = request.get("voiceIds")
    if voice_only:
        if not voice or request.get("mode") != "background" or not isinstance(refs, list) or not 1 <= len(refs) <= MAX_VOICE_REFS:
            raise BackgroundCaptureError("INVALID_REQUEST", "语音补全请求缺少可核对的消息来源。")
        if "cursor" in request or "since" in request:
            raise BackgroundCaptureError("INVALID_REQUEST", "语音补全不能复用历史分页位置。")
        seen = set()
        for ref in refs:
            if not isinstance(ref, dict) or not {"messageShard", "messageId"} <= set(ref) or set(ref) - {"messageShard", "messageId", "localId"}:
                raise BackgroundCaptureError("INVALID_REQUEST", "语音消息来源格式无效。")
            shard, message_id = ref.get("messageShard"), ref.get("messageId")
            if (not isinstance(shard, str) or not shard or len(shard) > 200 or any(ord(c) < 32 for c in shard)
                    or not isinstance(message_id, str) or not message_id or len(message_id) > 300 or any(ord(c) < 32 for c in message_id)):
                raise BackgroundCaptureError("INVALID_REQUEST", "语音消息来源无法核对。")
            local_id = ref.get("localId")
            if local_id is not None and (not isinstance(local_id, str) or not re.fullmatch(r"[0-9]{1,20}", local_id)):
                raise BackgroundCaptureError("INVALID_REQUEST", "语音本地消息编号无法核对。")
            if not re.fullmatch(r"[0-9]{1,20}", message_id):
                raise BackgroundCaptureError("INVALID_REQUEST", "语音消息编号无法核对。")
            pair = (shard, message_id, local_id)
            if pair in seen:
                raise BackgroundCaptureError("INVALID_REQUEST", "语音消息来源不能重复。")
            seen.add(pair)
    elif refs is not None:
        raise BackgroundCaptureError("INVALID_REQUEST", "未启用定向语音补全。")
    image_only = request.get("imageOnly", False)
    image_refs = request.get("imageIds")
    if type(image_only) is not bool:
        raise BackgroundCaptureError("INVALID_REQUEST", "图片补全范围必须明确。")
    if image_only:
        if (voice or voice_only or refs is not None or request.get("mode") != "background"
                or not isinstance(image_refs, list) or not 1 <= len(image_refs) <= MAX_IMAGE_REFS
                or "cursor" in request or "since" in request):
            raise BackgroundCaptureError("INVALID_REQUEST", "图片补全每批最多100条，不能混用语音或历史分页位置。")
        seen = set()
        for ref in image_refs:
            if (not isinstance(ref, dict) or not {"messageShard", "messageId"} <= set(ref)
                    or set(ref) - {"messageShard", "messageId", "localId"}):
                raise BackgroundCaptureError("INVALID_REQUEST", "图片消息来源格式无效。")
            shard, message_id, local_id = ref.get("messageShard"), ref.get("messageId"), ref.get("localId")
            if (not isinstance(shard, str) or not shard or len(shard) > 200 or any(ord(c) < 32 for c in shard)
                    or not isinstance(message_id, str) or not re.fullmatch(r"[0-9]{1,20}", message_id)
                    or local_id is not None and (not isinstance(local_id, str) or not re.fullmatch(r"[0-9]{1,20}", local_id))):
                raise BackgroundCaptureError("INVALID_REQUEST", "图片消息来源无法核对。")
            pair = (shard, message_id, local_id)
            if pair in seen:
                raise BackgroundCaptureError("INVALID_REQUEST", "图片消息来源不能重复。")
            seen.add(pair)
    elif image_refs is not None:
        raise BackgroundCaptureError("INVALID_REQUEST", "未启用定向图片补全。")
    _history_request(request)
    return friend.strip(), limit, voice


def _identity(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _cursor_error(message="历史读取位置已失效，请重新开始导入。"):
    return BackgroundCaptureError("INVALID_CURSOR", message)


def _watermarks(value):
    if not isinstance(value, dict) or len(value) > MAX_SHARDS:
        raise _cursor_error()
    for shard, bound in value.items():
        if not isinstance(shard, str) or not re.fullmatch(r"[0-9a-f]{64}", shard):
            raise _cursor_error()
        if type(bound) is not int or not 0 <= bound <= 2**63 - 1:
            raise _cursor_error()
    return value


def _decode_cursor(token, kind):
    if not isinstance(token, str) or not 1 <= len(token) <= MAX_CURSOR_LENGTH or not re.fullmatch(r"[A-Za-z0-9_-]+", token):
        raise _cursor_error()
    try:
        raw = base64.urlsafe_b64decode(token + "=" * (-len(token) % 4))
        def unique_object(pairs):
            result = {}
            for key, value in pairs:
                if key in result:
                    raise ValueError("duplicate cursor key")
                result[key] = value
            return result
        value = json.loads(raw.decode("utf-8"), object_pairs_hook=unique_object)
    except (ValueError, UnicodeError, binascii.Error, RecursionError):
        raise _cursor_error() from None
    fields = {"v", "kind", "account", "contact", "upper"}
    if kind == "page":
        fields |= {"lower", "direction", "after"}
    if not isinstance(value, dict) or set(value) != fields or type(value.get("v")) is not int or value["v"] != 1 or value.get("kind") != kind:
        raise _cursor_error()
    if any(not isinstance(value[key], str) or not re.fullmatch(r"[0-9a-f]{64}", value[key]) for key in ("account", "contact")):
        raise _cursor_error()
    _watermarks(value["upper"])
    if kind == "page":
        _watermarks(value["lower"])
        if set(value["lower"]) - set(value["upper"]) or any(bound > value["upper"][shard] for shard, bound in value["lower"].items()):
            raise _cursor_error()
        key = value["after"]
        if value["direction"] not in ("forward", "backward") or not isinstance(key, list) or len(key) != 4:
            raise _cursor_error()
        if any(type(key[index]) is not int or not -(2**63) <= key[index] < 2**63 for index in (0, 2, 3)):
            raise _cursor_error()
        if not isinstance(key[1], str) or not key[1] or len(key[1]) > 200 or any(ord(c) < 32 for c in key[1]):
            raise _cursor_error()
        shard = _identity(key[1])
        if shard not in value["upper"] or not value["lower"].get(shard, 0) < key[3] <= value["upper"][shard]:
            raise _cursor_error()
    return value


def _encode_cursor(value):
    token = base64.urlsafe_b64encode(json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8")).decode("ascii").rstrip("=")
    if len(token) > MAX_CURSOR_LENGTH:
        raise BackgroundCaptureError("SOURCE_TOO_LARGE", "本地消息索引超过分页支持范围。")
    return token


def _history_request(request):
    if not HISTORY_FIELDS.intersection(request):
        return None
    size = request.get("pageSize", MAX_PAGE_SIZE)
    if type(size) is not int or not 1 <= size <= MAX_PAGE_SIZE:
        raise BackgroundCaptureError("INVALID_PAGE_SIZE", "历史导入每页必须为 1 至 500 条。")
    if "cursor" in request and "since" in request:
        raise _cursor_error("续读位置与增量快照不能同时使用。")
    cursor = _decode_cursor(request["cursor"], "page") if "cursor" in request else None
    since = _decode_cursor(request["since"], "snapshot") if "since" in request else None
    direction = request.get("direction", cursor["direction"] if cursor else "backward")
    if direction not in ("forward", "backward") or cursor and direction != cursor["direction"]:
        raise _cursor_error("历史读取方向与续读位置不一致。")
    return {"size": size, "direction": direction, "cursor": cursor, "since": since}


def _short_id(value, label):
    if not isinstance(value, str) or not value or len(value) > 200 or any(ord(c) < 32 for c in value):
        raise BackgroundCaptureError("SOURCE_IDENTITY_INVALID", f"{label}标识无法核对，未导入。")
    return value


def _execute(conn, sql, parameters=()):
    # SQLite query_only also protects providers inadvertently opened read/write.
    conn.execute("PRAGMA query_only=ON")
    return conn.execute(sql, parameters)


def _contact_text(value):
    return "".join(" " if ord(c) < 32 else c for c in str(value or "")[:200]).strip()


def _contact_display(row):
    return _contact_text(row[2]) or _contact_text(row[1]) or _short_id(str(row[0]), "联系人")


def _contact_label(row, duplicate=False):
    username = _short_id(str(row[0]), "联系人")
    base = _contact_display(row)
    # The suffix form is reserved: a literal name containing it is suffixed too.
    # This keeps ordinary unique names clean and selected vault labels distinct.
    if not duplicate and " · #" not in base and len(base.encode("utf-16-le")) // 2 <= 100:
        return base
    units, clipped = 0, []
    for char in base:
        width = 2 if ord(char) > 0xFFFF else 1
        if units + width > 80:
            break
        units += width
        clipped.append(char)
    suffix = hashlib.sha256(username.encode("utf-8")).hexdigest()[:16]
    return f"{''.join(clipped)} · #{suffix}"


def _duplicate_displays(conn, displays):
    if not displays:
        return set()
    marks = ",".join("?" for _ in displays)
    expression = "COALESCE(NULLIF(TRIM(remark),''),NULLIF(TRIM(nick_name),''),username)"
    rows = _execute(conn, f"SELECT {expression},COUNT(DISTINCT username) FROM contact "
                    f"WHERE {expression} IN ({marks}) GROUP BY {expression}", tuple(displays)).fetchall()
    return {name for name, count in rows if count > 1}


def _contact_metadata_columns(conn):
    return {str(row[1]) for row in _execute(conn, "PRAGMA table_info(contact)").fetchall()}


def _avatar_url(value):
    """Only actual WeChat avatar hosts; never return arbitrary DB URLs."""
    if not isinstance(value, str) or len(value) > 2000:
        return ""
    try:
        url = urlsplit(value)
        host = (url.hostname or "").lower()
        if url.scheme not in ("http", "https") or url.username or url.password or url.port not in (None, 80, 443):
            return ""
        if not any(host == base or host.endswith("." + base) for base in ("qlogo.cn", "qpic.cn")):
            return ""
        return urlunsplit(("https", host, url.path, url.query, ""))
    except ValueError:
        return ""


def _contact_extras(row):
    alias, thumbnail, full, cached = row[3:7]
    alias = _contact_text(alias)
    # Missing aliases stay empty; an internal wxid is not a public WeChat ID.
    avatar_data = ""
    if isinstance(cached, (bytes, bytearray)) and len(cached) <= 64 * 1024:
        image = _plain_image(bytes(cached))
        if image:
            avatar_data = "data:" + image[0] + ";base64," + base64.b64encode(image[1]).decode("ascii")
    return {"wechatId": alias, "avatarUrl": _avatar_url(thumbnail) or _avatar_url(full), "avatarData": avatar_data}


def validate_contact_search(query, offset=0, account_key=None, refresh=False):
    if not isinstance(query, str) or not query.strip() or len(query) > 100 or any(ord(c) < 32 for c in query):
        raise BackgroundCaptureError("INVALID_CONTACT_QUERY", "请输入联系人昵称或备注中的文字。")
    if type(offset) is not int or offset < 0 or offset > 100_000 or offset % MAX_CONTACT_RESULTS:
        raise BackgroundCaptureError("INVALID_CONTACT_OFFSET", "联系人分页位置无效，请重新搜索。")
    if (account_key is not None and (not isinstance(account_key, str) or not re.fullmatch(r"[0-9a-f]{64}", account_key))
            or offset and account_key is None):
        raise BackgroundCaptureError("INVALID_ACCOUNT_KEY", "请重新搜索后再加载更多联系人。")
    if type(refresh) is not bool or refresh and offset:
        raise BackgroundCaptureError("INVALID_CONTACT_REFRESH", "刷新联系人时请从第一页开始。")
    return query.strip()


def search_contacts_from_source(query, source, offset=0, account_key=None):
    """Search only contact names in the verified account; never open messages."""
    try:
        query = validate_contact_search(query, offset, account_key)
        current_account = _identity(_short_id(source.account_id, "账号"))
        if account_key is not None and account_key != current_account:
            raise BackgroundCaptureError("ACCOUNT_CHANGED", "当前微信账号已变化，请重新搜索联系人。")
        escaped = query.replace("!", "!!").replace("%", "!%").replace("_", "!_")
        pattern, prefix = f"%{escaped}%", f"{escaped}%"
        conn = source.contacts()
        columns = _contact_metadata_columns(conn)
        alias = "alias" if "alias" in columns else "''"
        extras = [alias] + [name if name in columns else "NULL" for name in ("small_head_url", "big_head_url", "head_image")]
        rows = _execute(conn,
            "SELECT username,nick_name,remark," + ",".join(extras) + " FROM contact "
            "WHERE username<>? AND username NOT LIKE '%@chatroom' "
            "AND (username LIKE ? ESCAPE '!' OR nick_name LIKE ? ESCAPE '!' OR remark LIKE ? ESCAPE '!' OR " + alias + " LIKE ? ESCAPE '!') "
            "ORDER BY CASE "
            "WHEN remark=? COLLATE NOCASE THEN 0 WHEN nick_name=? COLLATE NOCASE THEN 1 "
            "WHEN remark LIKE ? ESCAPE '!' THEN 2 WHEN nick_name LIKE ? ESCAPE '!' THEN 3 "
            "WHEN remark LIKE ? ESCAPE '!' THEN 4 WHEN nick_name LIKE ? ESCAPE '!' THEN 5 "
            "WHEN " + alias + "=? COLLATE NOCASE THEN 6 WHEN " + alias + " LIKE ? ESCAPE '!' THEN 7 "
            "WHEN " + alias + " LIKE ? ESCAPE '!' THEN 8 "
            "WHEN username=? COLLATE NOCASE THEN 9 WHEN username LIKE ? ESCAPE '!' THEN 10 ELSE 11 END, "
            "COALESCE(NULLIF(TRIM(remark),''),NULLIF(TRIM(nick_name),''),username) COLLATE NOCASE,"
            "username COLLATE NOCASE,username LIMIT ? OFFSET ?",
            (source.self_username, pattern, pattern, pattern, pattern, query, query, prefix, prefix,
             pattern, pattern, query, prefix, pattern, query, prefix, MAX_CONTACT_RESULTS + 1, offset)).fetchall()
        duplicates = _duplicate_displays(conn, {_contact_display(row) for row in rows[:MAX_CONTACT_RESULTS]})
        contacts = []
        seen = set()
        for row in rows[:MAX_CONTACT_RESULTS]:
            contact_id = _short_id(str(row[0]), "联系人")
            if contact_id in seen:
                continue
            seen.add(contact_id)
            contacts.append({"contactId": contact_id, "label": _contact_label(row, _contact_display(row) in duplicates),
                             "nickname": _contact_text(row[1]), "remark": _contact_text(row[2]), **_contact_extras(row)})
        source.assert_unchanged()
        return {"contacts": contacts, "accountKey": current_account,
                "hasMore": len(rows) > MAX_CONTACT_RESULTS,
                "nextOffset": offset + MAX_CONTACT_RESULTS if len(rows) > MAX_CONTACT_RESULTS else None,
                "message": "没有找到匹配的联系人，请尝试昵称、备注或微信号。" if not contacts else ""}
    finally:
        source.close()


def search_contacts(query, offset=0, account_key=None, *, cache=None, refresh=False):
    query = validate_contact_search(query, offset, account_key, refresh)
    provider = _provider_module()
    if provider is None:
        raise BackgroundCaptureError("BACKGROUND_SOURCE_UNAVAILABLE", "本机联系人目录暂不可读取，请检查助手组件。")
    read = lambda source: search_contacts_from_source(query, source, offset, account_key)
    if cache is not None:
        return cache.run(read, refresh=refresh)
    return read(provider.open_authorized_source(contacts_only=True))


def _resolve_contact(source, friend, contact_id=None, account_key=None):
    conn = source.contacts()
    if contact_id is not None:
        if account_key != _identity(_short_id(source.account_id, "账号")):
            raise BackgroundCaptureError("ACCOUNT_CHANGED", "当前微信账号与选联系人时不同，请重新搜索并选择。")
        rows = _execute(conn, "SELECT username,nick_name,remark FROM contact WHERE username=? LIMIT 2", (contact_id,)).fetchall()
        if len(rows) != 1:
            raise BackgroundCaptureError("CONTACT_NOT_FOUND", "选中的联系人已不在当前微信账号中，请重新搜索并选择。")
        display = _contact_display(rows[0])
        if friend != _contact_label(rows[0], display in _duplicate_displays(conn, {display})):
            raise BackgroundCaptureError("CONTACT_CHANGED", "联系人昵称或备注已变化，请重新搜索并选择。")
    else:
        rows = _execute(conn,
            "SELECT username,nick_name,remark FROM contact "
            "WHERE username=? OR nick_name=? OR remark=? LIMIT 3", (friend, friend, friend)).fetchall()
    unique = {str(r[0]): r for r in rows}
    if not unique:
        raise BackgroundCaptureError("CONTACT_NOT_FOUND", "本地聊天中没有匹配的联系人，请核对完整昵称或备注并同步聊天。")
    if len(unique) != 1:
        raise BackgroundCaptureError("CONTACT_AMBIGUOUS", "有多个同名联系人，请使用唯一的完整备注或微信号。")
    username = _short_id(next(iter(unique)), "联系人")
    if username.endswith("@chatroom") or username == source.self_username:
        raise BackgroundCaptureError("UNSUPPORTED_CONTACT", "请选择一位一对一聊天联系人。")
    return username


def _plain_image(data: bytes):
    if len(data) < 32 or len(data) > 180_000:
        return None
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg", data
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png", data
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp", data
    key = data[0] ^ 0xFF
    if key and (data[1] ^ key) == 0xD8 and (data[2] ^ key) == 0xFF:
        decoded = bytes(byte ^ key for byte in data)
        if decoded[:3] == b"\xff\xd8\xff":
            return "image/jpeg", decoded
    return None


def local_chat_image(account_dir, content: str):
    """Compatibility helper; the batch path shares one filename index."""
    from local_chat_images import LocalChatImages
    return LocalChatImages(account_dir, [content]).resolve(content)[0]


def _decode_text(value):
    if value is None:
        return ""
    if isinstance(value, str):
        return value[:MAX_TEXT]
    if isinstance(value, bytes):
        if len(value) > 2 * 1024 * 1024:
            return ""
        if value.startswith(b"\x28\xb5\x2f\xfd"):
            try:
                import zstandard
                value = zstandard.ZstdDecompressor().decompress(value, max_output_size=MAX_TEXT * 4)
            except Exception:
                return ""
        try:
            return value.decode("utf-8").strip("\x00 \r\n")[:MAX_TEXT]
        except UnicodeDecodeError:
            return ""
    return ""


def _voice_duration(text):
    # WeChat voicelength is milliseconds. Never infer duration from file size.
    if not text or len(text) > MAX_TEXT or "<!DOCTYPE" in text.upper() or "<!ENTITY" in text.upper():
        return None
    try:
        tree = ElementTree.fromstring(text)
        node = tree if tree.tag == "voicemsg" else tree.find(".//voicemsg")
        raw = node.attrib.get("voicelength") if node is not None else None
        milliseconds = int(raw) if raw is not None else 0
        return round(milliseconds / 1000, 3) if 0 < milliseconds <= 600_000 else None
    except (ValueError, ElementTree.ParseError):
        return None


def _message_id(account, session, shard, server_id, local_id):
    material = json.dumps([account, session, shard, str(server_id or ""), str(local_id)],
                          ensure_ascii=False, separators=(",", ":"))
    return "wechat-db:" + hashlib.sha256(material.encode("utf-8")).hexdigest()


def _read_messages(source, session, limit):
    table = "Msg_" + hashlib.md5(session.encode("utf-8")).hexdigest()
    rows = []
    seen_shards = set()
    for shard, conn in source.message_shards():
        _short_id(shard, "消息分片")
        if shard in seen_shards or len(seen_shards) >= MAX_SHARDS:
            raise BackgroundCaptureError("SOURCE_INVALID", "消息分片重复或超过支持的读取范围。")
        seen_shards.add(shard)
        if not _execute(conn, "SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone():
            continue
        got = _execute(conn,
            f'SELECT local_id,server_id,local_type,real_sender_id,create_time,sort_seq,'
            f'CAST(message_content AS BLOB),CAST(compress_content AS BLOB) FROM "{table}" '
            'ORDER BY sort_seq DESC,local_id DESC LIMIT ?', (limit,)).fetchall()
        sender_ids = tuple({int(row[3]) for row in got if row[3] is not None})
        sender_map = {}
        if sender_ids:
            marks = ",".join("?" for _ in sender_ids)
            sender_map = {int(row[0]): str(row[1]) for row in _execute(conn,
                f"SELECT rowid,user_name FROM Name2Id WHERE rowid IN ({marks})", sender_ids)}
        for row in got:
            rows.append({"localId": row[0], "serverId": row[1], "type": int(row[2]) & 0xFFFFFFFF,
                         "sender": sender_map.get(row[3], ""), "timestamp": row[4], "sequence": row[5],
                         "content": _decode_text(row[6]) or _decode_text(row[7]), "shard": shard})
        # Retain only the global newest window after every shard. Large accounts
        # must not accumulate MAX_SHARDS * limit decoded private messages.
        rows.sort(key=lambda r: (int(r["sequence"] or 0), r["shard"], int(r["localId"] or 0)), reverse=True)
        del rows[limit:]
    return list(reversed(rows))


def _history_key(row):
    return (int(row["sequence"] or 0), row["shard"], int(row["localId"] or 0), row["rowId"])


def _read_history_page(source, session, options):
    """Keyset pagination over one contact, with append watermarks per shard.

    No OFFSET or timestamp-only boundary: ties across shards and late messages
    remain addressable. Each page reopens the provider's read-only snapshots;
    their rowid upper bounds exclude subsequent appends, even with older dates.
    The cursor is strictly validated data, never a path, SQL or account selector.
    """
    account = _short_id(source.account_id, "账号")
    identity = {"account": _identity(account), "contact": _identity(session)}
    previous = options["cursor"] or options["since"]
    if previous and any(previous[key] != value for key, value in identity.items()):
        raise BackgroundCaptureError("CURSOR_IDENTITY_MISMATCH", "续读位置属于其他账号或联系人，请重新开始此联系人的导入。")
    table = "Msg_" + hashlib.md5(session.encode("utf-8")).hexdigest()
    shards, current, seen = {}, {}, set()
    for label, conn in source.message_shards():
        _short_id(label, "消息分片")
        if label in seen or len(seen) >= MAX_SHARDS:
            raise BackgroundCaptureError("SOURCE_INVALID", "消息分片重复或超过支持的读取范围。")
        seen.add(label)
        if not _execute(conn, "SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone():
            continue
        high = _execute(conn, f'SELECT MAX(rowid) FROM "{table}"').fetchone()[0]
        high = 0 if high is None else high
        if type(high) is not int or high < 0:
            raise BackgroundCaptureError("SOURCE_INVALID", "本地消息索引无法核对，未继续导入。")
        key = _identity(label)
        shards[key], current[key] = (label, conn), high
    if previous and (set(previous["upper"]) - set(current) or
                     any(current[key] < bound for key, bound in previous["upper"].items() if key in current)):
        raise BackgroundCaptureError("CURSOR_SOURCE_CHANGED", "本地聊天索引已重建或删除，请重新开始导入以核对完整历史。")
    cursor, since = options["cursor"], options["since"]
    upper = cursor["upper"] if cursor else current
    lower = cursor["lower"] if cursor else since["upper"] if since else {}
    direction, size = options["direction"], options["size"]
    newest_first = direction == "backward"
    order, comparison = ("DESC", "<") if newest_first else ("ASC", ">")
    rows = []
    for shard_key, bound in upper.items():
        label, conn = shards[shard_key]
        where = "rowid>? AND rowid<=?"
        parameters = [lower.get(shard_key, 0), bound]
        if cursor:
            where += f" AND (COALESCE(sort_seq,0),?,COALESCE(local_id,0),rowid) {comparison} (?,?,?,?)"
            parameters.extend([label, *cursor["after"]])
        got = _execute(conn,
            f'SELECT local_id,server_id,local_type,real_sender_id,create_time,sort_seq,'
            f'CAST(message_content AS BLOB),CAST(compress_content AS BLOB),rowid FROM "{table}" '
            f'WHERE {where} ORDER BY COALESCE(sort_seq,0) {order},COALESCE(local_id,0) {order},rowid {order} LIMIT ?',
            (*parameters, size + 1)).fetchall()
        sender_ids = tuple({int(row[3]) for row in got if row[3] is not None})
        sender_map = {}
        if sender_ids:
            marks = ",".join("?" for _ in sender_ids)
            sender_map = {int(row[0]): str(row[1]) for row in _execute(conn,
                f"SELECT rowid,user_name FROM Name2Id WHERE rowid IN ({marks})", sender_ids)}
        for row in got:
            rows.append({"localId": row[0], "serverId": row[1], "type": int(row[2]) & 0xFFFFFFFF,
                         "sender": sender_map.get(row[3], ""), "timestamp": row[4], "sequence": row[5],
                         "content": _decode_text(row[6]) or _decode_text(row[7]), "shard": label, "rowId": row[8]})
        # Only one page plus its lookahead survives each shard merge.
        rows.sort(key=_history_key, reverse=newest_first)
        del rows[size + 1:]
    more = len(rows) > size
    rows = rows[:size]
    snapshot = {"v": 1, "kind": "snapshot", **identity, "upper": upper}
    next_cursor = None
    if more:
        next_cursor = _encode_cursor({**snapshot, "kind": "page", "lower": lower,
                                      "direction": direction, "after": list(_history_key(rows[-1]))})
    if newest_first:
        rows.reverse()
    return rows, {"version": 1, "direction": direction, "count": len(rows), "hasMore": more,
                  "nextCursor": next_cursor, "snapshot": _encode_cursor(snapshot), "complete": not more}


def _read_voice_page(source, session, options, refs, *, media_type=34):
    """Resolve selected media references, never replay text history."""
    if media_type not in (3, 34):
        raise BackgroundCaptureError("INVALID_REQUEST", "媒体补全类型无效。")
    media_label = "图片" if media_type == 3 else "语音"
    account = _short_id(source.account_id, "账号")
    identity = {"account": _identity(account), "contact": _identity(session)}
    table = "Msg_" + hashlib.md5(session.encode("utf-8")).hexdigest()
    grouped = {}
    for ref in refs:
        grouped.setdefault(ref["messageShard"], []).append(ref)
    rows_by_ref, current, seen = {}, {}, set()
    selected_shards = getattr(source, "selected_message_shards", None)
    shards = selected_shards(set(grouped)) if selected_shards else source.message_shards()
    for label, conn in shards:
        _short_id(label, "消息分片")
        if label in seen or len(seen) >= MAX_SHARDS:
            raise BackgroundCaptureError("SOURCE_INVALID", "消息分片重复或超过支持的读取范围。")
        seen.add(label)
        if label not in grouped:
            continue
        if not _execute(conn, "SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone():
            continue
        ids = sorted({ref["messageId"] for ref in grouped[label]})
        marks = ",".join("?" for _ in ids)
        # messageId uses server_id where present, and local_id for unsent/local
        # voice messages. Query once per shard, not once per voice bubble.
        matches = _execute(conn,
            f'SELECT local_id,server_id,local_type,real_sender_id,create_time,sort_seq,'
            f'CAST(message_content AS BLOB),CAST(compress_content AS BLOB),rowid FROM "{table}" '
            f'WHERE (local_type & 4294967295)={media_type} AND (server_id IN ({marks}) '
            f'OR ((server_id IS NULL OR server_id=0) AND local_id IN ({marks}))) LIMIT 1001',
            (*ids, *ids)).fetchall()
        if len(matches) > 1000:
            raise BackgroundCaptureError("MESSAGE_IDENTITY_AMBIGUOUS", f"{media_label}来源编号重复过多，未自动合并。")
        current[_identity(label)] = max((row[8] for row in matches), default=0)
        # The same two sender identities recur across a voice batch. Resolve
        # only IDs from selected messages once, keeping shard-local identities.
        sender_ids = tuple({int(row[3]) for row in matches if row[3] is not None})
        sender_map = {}
        if sender_ids:
            sender_marks = ",".join("?" for _ in sender_ids)
            sender_map = {int(row[0]): str(row[1]) for row in _execute(conn,
                f"SELECT rowid,user_name FROM Name2Id WHERE rowid IN ({sender_marks})", sender_ids)}
        by_id = {}
        for row in matches:
            by_id.setdefault(str(row[1] or row[0]), []).append(row)
        for ref in grouped[label]:
            candidates = [row for row in by_id.get(ref["messageId"], ())
                          if ref.get("localId") is None or str(row[0]) == ref["localId"]]
            if len(candidates) > 1:
                raise BackgroundCaptureError("MESSAGE_IDENTITY_AMBIGUOUS", f"同一条{media_label}来源编号重复，未自动合并。")
            if not candidates:
                continue
            row = candidates[0]
            rows_by_ref[(label, ref["messageId"], ref.get("localId"))] = {
                "localId": row[0], "serverId": row[1], "type": int(row[2]) & 0xFFFFFFFF,
                "sender": sender_map.get(row[3], ""), "timestamp": row[4], "sequence": row[5],
                "content": _decode_text(row[6]) or _decode_text(row[7]), "shard": label, "rowId": row[8]}
    if len(rows_by_ref) != len(refs):
        raise BackgroundCaptureError("IMAGE_MESSAGE_MISSING" if media_type == 3 else "VOICE_MESSAGE_MISSING",
            f"有 {len(refs) - len(rows_by_ref)} 条待补全{media_label}已无法在本机核对，请重新同步该联系人的聊天后重试；已保存文字不会丢失。")
    rows = [rows_by_ref[(ref["messageShard"], ref["messageId"], ref.get("localId"))] for ref in refs]
    snapshot = {"v": 1, "kind": "snapshot", **identity, "upper": current}
    return rows, {"version": 1, "direction": options.get("direction", "backward"), "count": len(rows),
                  "hasMore": False, "nextCursor": None, "snapshot": _encode_cursor(snapshot), "complete": True}


def _read_audio(source, session, wanted, load_audio=False, progress=None, cache_writes=None):
    """Read only selected session/server IDs, never export an entire media table."""
    wanted = {str(x) for x in wanted if x not in (None, "", 0, "0")}
    result, seen, total_bytes = {}, set(), 0
    def bounded_rows(cursor):
        collected, retained = [], 0
        for row in cursor:
            if len(collected) >= 2000:
                raise BackgroundCaptureError("SOURCE_INVALID", "本地语音索引重复过多，未自动合并。")
            retained += len(row[3]) if isinstance(row[3], bytes) else 0
            if retained > MAX_AUDIO_BATCH:
                raise BackgroundCaptureError("SOURCE_TOO_LARGE", "本次语音材料过大，请缩小聊天读取范围。")
            collected.append(row)
        return collected
    if not wanted:
        return result
    if progress:
        progress({"stage": "voice-locating", "percent": 12, "message": f"正在定位 {len(wanted)} 条语音文件，尚未开始转写。"})
    for shard, conn in source.media_shards():
        _short_id(shard, "语音分片")
        if shard in seen or len(seen) >= MAX_SHARDS:
            raise BackgroundCaptureError("SOURCE_INVALID", "语音分片重复或超过支持的读取范围。")
        seen.add(shard)
        if progress:
            progress({"stage": "voice-locating", "percent": 15,
                      "message": f"正在核对第 {len(seen)} 个语音分片 · 已找到 {len(result)}/{len(wanted)} 条"})
        cids = [r[0] for r in _execute(conn, "SELECT rowid FROM Name2Id WHERE user_name=? LIMIT 10", (session,))]
        if not cids:
            continue
        if len(cids) == 10:
            raise BackgroundCaptureError("SOURCE_INVALID", "本地语音会话映射无法唯一核对。")
        if cids:
            marks = ",".join("?" for _ in wanted)
            contact_marks = ",".join("?" for _ in cids)
            # A corrupt or unexpectedly huge blob is never materialized in Python.
            value = "CASE WHEN length(voice_data)<=? THEN voice_data ELSE NULL END" if load_audio else "NULL"
            query = (f"SELECT rowid,svr_id,length(voice_data),{value} "
                     f"FROM VoiceInfo WHERE chat_name_id IN ({contact_marks}) AND svr_id IN ({marks}) LIMIT 2001")
            # Older shards can have several IDs for the same selected contact.
            # One bounded query avoids rescanning an unindexed VoiceInfo table
            # once for every alias; conflicting blobs are still rejected below.
            parameters = ((MAX_AUDIO,) if load_audio else ()) + (*cids, *sorted(wanted))
            locator, hints, located = None, None, None
            revision_fn = getattr(source, "voice_cache_revision", None)
            if load_audio and cache_writes is not None and callable(revision_fn):
                revision = revision_fn(shard)
                if revision is not None:
                    from voice_media_cache import VoiceMediaCache
                    locator = VoiceMediaCache(source.account_id, session, shard, revision)
                    hints = locator.lookup(wanted)
            if hints is not None:
                rowids = sorted({row[0] for values in hints.values() for row in values})
                if len(rowids) <= 2000:
                    if rowids:
                        row_marks = ",".join("?" for _ in rowids)
                        direct = query.replace(" LIMIT 2001", f" AND rowid IN ({row_marks}) LIMIT 2001")
                        candidate = bounded_rows(_execute(conn, direct, (*parameters, *rowids)))
                    else:
                        candidate = []
                    expected = sorted((rowid, server_id, length) for server_id, values in hints.items() for rowid, length in values)
                    actual = sorted((rowid, str(server_id), length) for rowid, server_id, length, _ in candidate)
                    if actual == expected:
                        located = candidate
            if located is None:
                located = bounded_rows(_execute(conn, query, parameters))
                if locator is not None and len(located) <= 2000:
                    # Do not persist a locator until all read pages and the live
                    # account have passed the caller's existing snapshot seal.
                    cache_writes.append(locator.stage(wanted, located))
            for count, (_, server_id, length, blob) in enumerate(located):
                if count >= 2000:
                    raise BackgroundCaptureError("SOURCE_INVALID", "本地语音索引重复过多，未自动合并。")
                if not length:
                    continue
                key = str(server_id)
                if length > MAX_AUDIO:
                    result[key] = None
                    continue
                if not load_audio:
                    result[key] = b""  # Verified availability; no audio blob loaded.
                    continue
                if not isinstance(blob, bytes) or not blob:
                    continue
                if key in result and result[key] != blob:
                    raise BackgroundCaptureError("VOICE_IDENTITY_AMBIGUOUS", "同一条语音对应不同音频，未自动合并。")
                if key not in result:
                    total_bytes += len(blob)
                if total_bytes > MAX_AUDIO_BATCH:
                    raise BackgroundCaptureError("SOURCE_TOO_LARGE", "本次语音材料过大，请缩小聊天读取范围。")
                result[key] = blob
    return result


def _build_batch(source, friend, session, rows, audio):
    account = _short_id(source.account_id, "账号")
    self_username = _short_id(source.self_username, "本人")
    records = []
    warnings = []
    image_bytes = 0
    photo_rows = [row for row in rows if row["type"] == 3]
    image_reader = None
    if photo_rows and getattr(source, "account_dir", None):
        from local_chat_images import LocalChatImages
        image_reader = LocalChatImages(source.account_dir, [row["content"] for row in photo_rows],
                                       account_id=account,
                                       image_key_context=getattr(source, "image_key_context", None))
    for index, row in enumerate(rows):
        try:
            at = datetime.fromtimestamp(int(row["timestamp"]), timezone.utc).isoformat()
        except (ValueError, TypeError, OverflowError, OSError):
            raise BackgroundCaptureError("SOURCE_TIME_INVALID", "有消息时间无法核对，未导入。")
        sender = row["sender"]
        role = "self" if sender == self_username else "other" if sender == session else "unknown"
        if role == "unknown":
            warnings.append("部分消息未能核对发言人，保留为未知，未猜测双方身份。")
        media_type = row["type"]
        kind = {1: "text", 3: "image", 47: "sticker", 11000: "sticker"}.get(media_type, "other")
        text = row["content"] if kind == "text" else {
            3: "[图片]", 34: "[语音]", 43: "[视频]", 47: "[表情包]",
            11000: "[表情包]", 48: "[位置]", 49: "[文件或链接]", 50: "[音视频通话]",
        }.get(media_type, "[其他消息]")
        if kind == "text" and not text:
            kind = "other"
            text = "[文字暂未能识别]"
            warnings.append("部分文字无法解码，已明确保留占位。")
        rid = _message_id(account, session, row["shard"], row["serverId"], row["localId"])
        metadata = {"label": f"电脑微信 · {friend} · 聊天 · 第 {index + 1} 条", "method": "wechat-local-db",
                    "index": index, "order": "oldest-first", "idStability": "stable",
                    "accountId": account, "sessionId": session, "messageShard": row["shard"],
                    "messageId": str(row["serverId"] or row["localId"]), "localId": str(row["localId"]),
                    "atRaw": at, "timestampOrigin": "wechat-create-time", "senderVerified": role != "unknown"}
        if media_type == 34:
            duration = _voice_duration(row["content"])
            audio_key = str(row["serverId"])
            availability = "missing-local" if audio_key not in audio else "decode-failed" if audio[audio_key] is None else "available"
            metadata.update(mediaKind="voice", transcriptionStatus="not-transcribed",
                            rawMediaLabel=f'语音{duration:g}"秒' if duration else "语音",
                            voiceAvailability=availability)
            if availability == "decode-failed":
                metadata["transcriptionError"] = "audio-too-large"
            if duration:
                metadata["durationSeconds"] = duration
        elif media_type in (3, 43, 47, 11000):
            metadata["mediaAvailability"] = "not-collected"
        image = None
        if media_type == 3:
            image, availability = image_reader.resolve(row["content"]) if image_reader else (None, "missing-local")
            if image and image_bytes + len(image["data"]) > 20 * 1024 * 1024:
                image, availability = None, "batch-image-budget"
            metadata["mediaAvailability"] = availability
            if image:
                image_bytes += len(image["data"])
                metadata["imageType"] = "local-cache-preview"
            else:
                metadata["previewUnavailable"] = availability
        record = {"id": rid, "kind": kind, "sender": "我" if role == "self" else friend if role == "other" else "未知发言人",
                        "senderRole": role, "at": at, "text": text, "source": metadata}
        if image:
            record["images"] = [image]
        records.append(record)
    if len({r["id"] for r in records}) != len(records):
        raise BackgroundCaptureError("MESSAGE_IDENTITY_AMBIGUOUS", "本地消息标识重复，未导入。")
    if photo_rows:
        readable = sum(bool(record.get("images")) for record in records if record["kind"] == "image")
        warnings.append(f"本批 {len(photo_rows)} 条图片消息已取得 {readable} 张本机缓存预览；其余 {len(photo_rows)-readable} 张未取得可读画面，不参与图片内容判断。预览经过缩放，不是原始图片文件。")
        if image_reader and not image_reader.complete:
            warnings.append("本机图片目录较大，限时检索尚未遍历完；未找到的图片不能当作不存在。文字和已找到的图片已保留。")
    return {"version": 1, "kind": "chat", "friend": friend, "account": account,
            "capturedAt": datetime.now(timezone.utc).isoformat(), "records": records,
            "warnings": list(dict.fromkeys(warnings))}


def _coverage(batch):
    voices = [r for r in batch["records"] if r["source"].get("mediaKind") == "voice"]
    return {"total": len(voices), "available": sum(r["source"].get("voiceAvailability") == "available" for r in voices),
            "missingLocal": sum(r["source"].get("voiceAvailability") == "missing-local" for r in voices),
            "transcribed": sum(r["source"].get("transcriptionStatus") == "visible-text" for r in voices)}


def _finish_voice_status(batch):
    voices = [record for record in batch["records"] if record["source"].get("mediaKind") == "voice"]
    for record in voices:
        if record["source"].get("transcriptionStatus") != "visible-text":
            record["source"]["transcriptionStatus"] = "failed"
            record["source"].setdefault("transcriptionError", record["source"].get("voiceAvailability", "unavailable"))
    coverage = _coverage(batch)
    missing = coverage["missingLocal"]
    failed = coverage["total"] - coverage["transcribed"] - missing
    if missing or failed:
        batch["warnings"].append(f"语音已处理：{coverage['transcribed']} 条已转文字，{missing} 条本机缺少音频，{failed} 条转写失败；未识别的语音未纳入内容判断。")
    return batch


def capture_from_source(request, progress, on_partial, source, transcribe=None):
    """Injectable pure orchestration for authorized providers and synthetic tests."""
    try:
        friend, limit, include_voice = _validate_request(request)
        session = _resolve_contact(source, friend, request.get("contactId"), request.get("accountKey"))
        history = _history_request(request)
        if request.get("voiceOnly") is True:
            rows, history = _read_voice_page(source, session, history or {"direction": "backward"}, request["voiceIds"])
        elif request.get("imageOnly") is True:
            rows, history = _read_voice_page(source, session, history or {"direction": "backward"}, request["imageIds"], media_type=3)
        elif history:
            rows, history = _read_history_page(source, session, history)
        else:
            rows = _read_messages(source, session, limit)
        # The first full-history pass is deliberately text-first.  Looking up
        # every voice id in every encrypted media shard here can turn a 500-row
        # page into a multi-minute scan on real WeChat databases (the media
        # tables often have no usable composite index).  The web client starts
        # a separate bounded voice-enrichment pass after the text pages are
        # saved, so skipping this availability probe keeps history import fast
        # without losing the voice records or their stable ids.  Normal quick
        # capture and explicit voice enrichment still verify/read audio here.
        voice_cache_writes = []
        audio = {} if history and not include_voice else _read_audio(
            source, session, [r["serverId"] for r in rows if r["type"] == 34], load_audio=include_voice,
            progress=progress if include_voice else None, cache_writes=voice_cache_writes if include_voice else None)
        # All queried rows/audio are now bounded in memory. Seal their database
        # view before directory lookup, image decoding or transcription. Normal
        # WeChat writes during that slower work must not invalidate copied rows.
        # The later assert remains mandatory: it independently verifies the live
        # login/account proof even after the database view has been sealed.
        source.assert_unchanged()
        for save_locator in voice_cache_writes:
            save_locator()
        batch = _build_batch(source, friend, session, rows, audio)
        if history:
            batch["history"] = history
        source.assert_unchanged()  # No partial data escapes a changed-account snapshot.
        progress({"stage": "chat-read", "percent": 25 if include_voice else 95,
                  "message": (f"已核对 {len(rows)} 条图片消息" if request.get("imageOnly") else
                              f"已找到 {len(rows)} 条待转写语音" if request.get("voiceOnly") else f"已读取 {len(rows)} 条聊天"), "voice": _coverage(batch)})
        if not include_voice:
            return batch
        if not any(isinstance(blob, bytes) and blob for blob in audio.values()):
            return _finish_voice_status(batch)
        if on_partial:
            source.assert_unchanged()
            on_partial(copy.deepcopy(batch))
        work = [(row, record) for row, record in zip(rows, batch["records"])
                if row["type"] == 34 and isinstance(audio.get(str(row["serverId"])), bytes) and audio[str(row["serverId"])]]
        inputs = [(audio[str(row["serverId"])], record["id"]) for row, record in work]
        if transcribe is None:
            from local_voice_transcriber import configure_transcriber, transcribe_silk_batches
            configure_transcriber(progress=progress)
            groups = transcribe_silk_batches(inputs)
        else:
            # Keep alternate providers/tests on the same per-message error contract.
            def single_results():
                for index, (blob, key) in enumerate(inputs):
                    try:
                        result = {"index": index, "text": transcribe(blob, key)}
                    except Exception as error:
                        result = {"index": index, "error": error}
                    yield [result]
            groups = single_results()
        completed = cached = 0
        began = time.monotonic()
        try:
            for results in groups:
                for result in results:
                    _, record = work[result["index"]]
                    text, error = result.get("text"), result.get("error")
                    if error is None and (not isinstance(text, str) or not text.strip() or len(text) > MAX_TEXT):
                        error = BackgroundCaptureError("ASR_EMPTY", "这条语音未得到可读文字。")
                    if error is not None:
                        code = getattr(error, "code", "transcription-failed")
                        if code == "cancelled":
                            raise BackgroundCaptureError("CANCELLED", "语音转写已停止，已完成的内容保留。") from None
                        record["source"]["voiceAvailability"] = "decode-failed" if code in ("invalid-audio", "decode-failed") else "transcribe-failed"
                        record["source"]["transcriptionError"] = str(code)[:80]
                    else:
                        record["kind"], record["text"] = "text", text.strip()
                        record["source"].update(transcriptionStatus="visible-text", voiceAvailability="transcribed",
                            transcriptionSource="local-audio-asr", machineTranscribed=True, transcriptVerifiedByUser=False)
                        cached += int(result.get("cached") is True)
                    completed += 1
                progress({"stage": "voice-transcribing", "percent": 30 + int(65 * completed / max(1, len(work))),
                          "message": f"语音已处理 {completed}/{len(work)} 条" + (f" · 复用 {cached} 条已有转写" if cached else ""),
                          "voice": _coverage(batch), "elapsedSeconds": round(time.monotonic() - began, 1),
                          "cachedCount": cached})
                if on_partial:
                    # Identity remains mandatory after every completed group,
                    # including cache hits, before any transcript is published.
                    source.assert_unchanged()
                    on_partial(copy.deepcopy(batch))
        except Exception as error:
            if getattr(error, "code", "") == "cancelled":
                raise BackgroundCaptureError("CANCELLED", "语音转写已停止，已完成的内容保留。") from None
            raise
        source.assert_unchanged()
        return _finish_voice_status(batch)
    finally:
        source.close()


def capture_background(request, progress, on_partial=None):
    _validate_request(request)
    provider = _provider_module()
    if provider is None:
        raise BackgroundCaptureError("BACKGROUND_SOURCE_UNAVAILABLE", "尚未连接经过授权的本地数据源；当前不能后台读取微信语音。")
    def emit(event):
        percent = event.get("percent", 27)
        try:
            percent = min(99, max(0, int(percent)))
        except (TypeError, ValueError):
            percent = 27
        message = str(event.get("message") or "正在准备本地语音转写。")[:300]
        if str(event.get("stage", "")).startswith("voice-model-"):
            percent = 25 + min(5, int(percent * .05))
            message = "首次使用，正在准备本地语音模型；聊天已保存，可继续使用电脑。"
        progress(percent, message)
    published = False
    def publish(batch):
        nonlocal published
        published = True
        if on_partial:
            on_partial(batch)
    for attempt in range(3):
        progress(3, "正在核对本机微信账号与聊天数据；无需操作微信窗口。" if not attempt
                 else "微信刚更新了聊天，正在重新核对本次材料。")
        try:
            source = provider.open_authorized_source()
            return capture_from_source(request, emit, publish if on_partial else None, source)
        except BackgroundCaptureError as error:
            if error.code != "SOURCE_CHANGED" or published or attempt == 2:
                raise
