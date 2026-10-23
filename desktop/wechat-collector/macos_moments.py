"""Read the selected contact's cached macOS WeChat 4.x Moments.

This is an independent implementation of the documented SnsTimeLine XML shape,
not imported code from SIWX (AGPL). Schema evidence, pinned 2026-10-23:
https://github.com/ImUpXuu/SIWX/blob/fa2471b261fc67ace527ad4d4947f8ee0250b66f/docs/module-sns.md

Only the verified provider opens/decrypts databases. No CDN, key, filesystem
discovery, UI clicks or screenshots occur here. Cache coverage is never reported
as a complete album. Images not actually read remain explicitly unavailable.
"""
from __future__ import annotations

import hashlib
import heapq
import re
import time
from datetime import datetime, timezone
from xml.etree import ElementTree

from background_reader import BackgroundCaptureError, _resolve_contact
from normalize import normalized_capture

MAX_POSTS = 1000
MAX_SCAN_ROWS = 100_000
MAX_SCAN_SECONDS = 20
MAX_XML_BYTES = 2 * 1024 * 1024
MAX_XML_NODES = 10_000
MAX_TEXT = 20_000
SCHEMA_SOURCE = "wechat4-sns-xml-v1"


def _fail(code, message):
    raise BackgroundCaptureError(code, message)


def _validate_request(request):
    if not isinstance(request, dict) or request.get("kind") != "moments":
        _fail("INVALID_REQUEST", "请选择朋友圈采集。")
    if set(request) - {"kind", "friend", "contactId", "accountKey", "limit", "allVisible", "mode"}:
        _fail("INVALID_REQUEST", "朋友圈采集包含不支持的参数。")
    friend = request.get("friend")
    contact_id = request.get("contactId")
    account_key = request.get("accountKey")
    if (not isinstance(friend, str) or not friend.strip() or len(friend) > 500
            or any(ord(c) < 32 for c in friend)):
        _fail("INVALID_REQUEST", "请重新选择要读取朋友圈的联系人。")
    if (not isinstance(contact_id, str) or not contact_id or len(contact_id) > 200
            or any(ord(c) < 32 for c in contact_id)
            or not isinstance(account_key, str) or not re.fullmatch(r"[a-f0-9]{64}", account_key)):
        _fail("INVALID_CONTACT_ID", "请先搜索并选择联系人，再读取朋友圈。")
    limit = request.get("limit", MAX_POSTS)
    if type(limit) is not int or not 1 <= limit <= MAX_POSTS or type(request.get("allVisible", False)) is not bool:
        _fail("INVALID_REQUEST", "朋友圈读取范围无效。")
    return friend, contact_id, account_key, limit


def _text(element, path):
    node = element.find(path)
    return "" if node is None or node.text is None else node.text.strip()


def _timestamp(value):
    # Preserve only an explicit source timestamp; never infer it from snsId.
    if not re.fullmatch(r"[0-9]{1,12}", value):
        return ""
    try:
        seconds = int(value)
        if not 946684800 <= seconds <= 7258118400:
            return ""
        return datetime.fromtimestamp(seconds, timezone.utc).isoformat()
    except (ValueError, OverflowError, OSError):
        return ""


def _shared_text(object_node, own_text):
    """Keep visible shared-card text without importing URLs or third-party identity.

    These are explicit XML fields, not interpretations of a numeric content
    type (whose meaning differs between WeChat builds). Label every addition
    so a song, note or quoted article is not treated as the contact's own words.
    """
    parts, seen = [], {own_text}

    def add(label, value):
        value = value.strip()
        if value and value not in seen:
            seen.add(value)
            parts.append(label + "：" + value)

    add("分享标题", _text(object_node, "title"))
    add("分享摘要", _text(object_node, "description"))
    add("分享音乐·歌手", _text(object_node, "musicShareItem/mvSingerName"))
    add("分享音乐·专辑", _text(object_node, "musicShareItem/mvAlbumName"))
    for media in object_node.findall("mediaList/media"):
        add("分享媒体标题", _text(media, "title"))
        add("分享媒体说明", _text(media, "description"))
    for item in object_node.findall("noteinfo//dataitem"):
        if item.get("datatype") == "1":
            add("分享笔记", _text(item, "datadesc"))
    return "\n".join(filter(None, [own_text, *parts]))


def parse_moment_xml(content):
    """Return metadata from one XML item, or raise ValueError on unknown input.

    No opaque XML, media URLs, tokens, keys or unrelated comments are returned.
    Media counts are source metadata, not a claim that image pixels were read.
    """
    if isinstance(content, str):
        content = content.encode("utf-8")
    if not isinstance(content, bytes) or not content or len(content) > MAX_XML_BYTES:
        raise ValueError("invalid-size")
    if b"<!DOCTYPE" in content.upper() or b"<!ENTITY" in content.upper():
        raise ValueError("unsupported-declaration")
    try:
        root = ElementTree.fromstring(content)
    except (ElementTree.ParseError, ValueError):
        raise ValueError("invalid-xml") from None
    if sum(1 for _ in root.iter()) > MAX_XML_NODES:
        raise ValueError("too-many-nodes")
    if root.tag == "SnsDataItem":
        timeline = root.find("TimelineObject")
    elif root.tag == "TimelineObject":
        timeline = root
    else:
        raise ValueError("unsupported-root")
    if timeline is None:
        raise ValueError("missing-timeline")
    author = _text(timeline, "username")
    if not author or len(author) > 200 or any(ord(c) < 32 for c in author):
        raise ValueError("unknown-author")
    content_text = _text(timeline, "contentDesc")
    object_node = timeline.find("ContentObject")
    media_count = 0
    if object_node is not None:
        content_text = _shared_text(object_node, content_text)
        media_count = len(object_node.findall("mediaList/media"))
        # Finder/Live media paths vary; do not label them as selfies or pictures.
        media_count += len(object_node.findall("finderFeed/mediaList/media"))
        media_count += sum(item.get("datatype") == "2" for item in object_node.findall("noteinfo//dataitem"))
    if len(content_text) > MAX_TEXT:
        raise ValueError("post-too-large")
    source_id = _text(timeline, "id")
    if source_id and not re.fullmatch(r"-?[0-9]{1,20}", source_id):
        raise ValueError("invalid-id")
    raw_time = _text(timeline, "createTime")
    return {"author": author, "source_id": source_id, "at": _timestamp(raw_time),
            "text": content_text, "pinned": _text(timeline, "isTop") == "1",
            "media_count": media_count, "time_known": bool(_timestamp(raw_time))}


def read_moments_connection(connection, contact_id, friend, *, limit=MAX_POSTS,
                            assert_unchanged=None, progress=None):
    """Read a provider-owned immutable read-only connection (APSW or sqlite3).

    Prefer the real schema's author column before decoding XML, then verify its
    embedded author again. Older schemas without that column retain the bounded
    scan. We do not assume rowid insertion order is chronological.
    The query does not read contact/comment tables or mutate the database.
    """
    if type(limit) is not int or not 1 <= limit <= MAX_POSTS:
        _fail("INVALID_REQUEST", "朋友圈读取范围无效。")
    check = assert_unchanged or (lambda: None)
    check()
    try:
        columns = {str(row[1]) for row in connection.execute('PRAGMA table_info("SnsTimeLine")')}
        if not {"tid", "content"} <= columns:
            _fail("MAC_MOMENTS_SCHEMA_UNSUPPORTED", "当前微信朋友圈缓存结构尚未适配，请保留当前微信版本并提交兼容性诊断。")
        # A byte-valued user_name is valid in SQLite, too. Explicit BINARY
        # equality avoids inheriting a case-insensitive column collation and
        # never turns a wxid into a wildcard pattern. Empty legacy author
        # fields still get their XML identity checked; mismatches are excluded.
        author_filter = "user_name" in columns
        where = (' WHERE "user_name" COLLATE BINARY IN (?, ?) OR "user_name" IS NULL '
                 'OR "user_name" = \'\' OR "user_name" = X\'\'' if author_filter else "")
        parameters = (MAX_XML_BYTES, contact_id, contact_id.encode("utf-8"), MAX_SCAN_ROWS + 1) if author_filter else (MAX_XML_BYTES, MAX_SCAN_ROWS + 1)
        deadline = time.monotonic() + MAX_SCAN_SECONDS
        cursor = connection.execute('SELECT "tid", CASE WHEN length(CAST("content" AS BLOB)) <= ? '
                                    'THEN "content" ELSE NULL END FROM "SnsTimeLine"' + where + ' LIMIT ?', parameters)
        posts, seen, unknown, scanned, scan_limited = [], set(), 0, 0, False
        for tid, content in cursor:
            scanned += 1
            if scanned > MAX_SCAN_ROWS or time.monotonic() >= deadline:
                scan_limited = True
                break
            if scanned % 250 == 0:
                check()
                if progress:
                    progress(35, "正在读取本机已缓存的朋友圈；不会操作微信窗口。")
            try:
                parsed = parse_moment_xml(content)
            except ValueError:
                unknown += 1
                continue
            if parsed["author"] != contact_id:
                continue
            if not parsed["text"] and not parsed["media_count"]:
                unknown += 1
                continue
            post_id = parsed["source_id"] or str(tid)
            if not re.fullmatch(r"-?[0-9]{1,20}", post_id):
                unknown += 1
                continue
            if post_id in seen:
                continue
            seen.add(post_id)
            # Empty image/video-only posts are retained so a missing image is
            # visible to the caller rather than silently reducing the corpus.
            source = {"method": "macos-local-cache", "materialRole": "moment",
                      "pinned": parsed["pinned"], "sourceRecordId": post_id,
                      "idStability": "database-record", "schema": SCHEMA_SOURCE,
                      "timePrecision": "source-timestamp" if parsed["time_known"] else "unknown",
                      "cachedMediaCount": parsed["media_count"], "imageType": "not-read"}
            if parsed["media_count"]:
                source["previewUnavailable"] = "mac-moments-media-not-yet-read"
            row = {"kind": "post", "sender": friend, "senderRole": "other",
                   "at": parsed["at"], "text": parsed["text"], "source": source}
            item = (row["at"], post_id, row)
            if len(posts) < limit:
                heapq.heappush(posts, item)
            else:
                heapq.heappushpop(posts, item)
        check()
    except BackgroundCaptureError:
        raise
    except Exception:
        _fail("MAC_MOMENTS_READ_FAILED", "朋友圈缓存暂时不可读取；已停止，未把不明数据归给所选联系人。")
    total = len(seen)
    posts = [item[2] for item in sorted(posts, reverse=True)]
    return posts, {"cachedTargetCount": total, "scanLimited": scan_limited,
                   "unparsedCacheRecords": unknown,
                   "scannedCacheRecords": min(scanned, MAX_SCAN_ROWS),
                   "authorFilterApplied": author_filter}


def capture_moments_from_source(request, progress, on_partial, source):
    """Own source lifecycle; identity is checked before reading and publishing."""
    try:
        friend, contact_id, account_key, limit = _validate_request(request)
        source.assert_unchanged()
        target = _resolve_contact(source, friend, contact_id, account_key)
        if not source.database_exists("sns/sns.db"):
            _fail("MAC_MOMENTS_CACHE_MISSING", "本机还没有朋友圈缓存。请先在 Mac 微信打开这位好友的朋友圈并浏览要导入的内容。")
        progress(12, "正在读取所选好友已缓存的朋友圈。")
        started = time.monotonic()
        rows, detail = read_moments_connection(source.open_database("sns/sns.db"), target, friend,
                limit=limit, assert_unchanged=source.assert_unchanged, progress=progress)
        source.assert_unchanged()
        if _resolve_contact(source, friend, contact_id, account_key) != target:
            _fail("CONTACT_CHANGED", "采集期间联系人发生变化，未导入本轮朋友圈。")
        warnings = ["Mac 当前读取本机已缓存的朋友圈，未自动滚动扫描；缓存结束不代表这位好友全部可见历史。"]
        media_missing = sum(row["source"]["cachedMediaCount"] for row in rows)
        if media_missing:
            warnings.append(f"有 {media_missing} 项朋友圈媒体尚未读取画面；本次不会据此判断自拍、场景或图片内容。")
        if detail["unparsedCacheRecords"]:
            warnings.append("部分缓存记录结构无法识别，未归入所选联系人，也未算作已读内容。")
        if detail["scanLimited"] or detail["cachedTargetCount"] > limit:
            warnings.append("本次达到缓存读取上限，已保留已读到的动态；更早或尚未扫描的缓存需要继续读取。")
        if not rows:
            warnings.append("当前缓存中没有找到这位好友的可读动态；不代表对方没有发布朋友圈。")
        batch = normalized_capture("moments", friend, source.account_id, rows, warnings)
        for row in batch["records"]:
            identity = "\0".join((source.account_id, target, row["source"]["sourceRecordId"]))
            row["id"] = "mac-sns:" + hashlib.sha256(identity.encode("utf-8")).hexdigest()
            row["source"].pop("upstreamCommit", None)
            row["source"]["label"] = f"Mac 微信 · {friend} · 朋友圈缓存"
        unreadable = detail["unparsedCacheRecords"] + sum(not r["text"] and not r["source"]["cachedMediaCount"] for r in rows)
        batch["coverage"] = {"scope": "local-cache", "complete": False,
                "stopReason": "cache-only", "recordCount": len(rows), "pinnedCount": sum(r["source"]["pinned"] for r in rows),
                "imageOmittedCount": media_missing, "unreadableCount": unreadable,
                "phase": "cached-moments-read", "scrollAttempts": 0, "lastAction": "read_cache",
                "cacheComplete": not detail["scanLimited"] and detail["cachedTargetCount"] <= limit and not unreadable,
                "elapsedMs": round((time.monotonic() - started) * 1000)}
        source.assert_unchanged()
        progress(98, f"已读取 {len(rows)} 条缓存动态；未确认朋友圈完整范围。")
        return batch
    finally:
        source.close()


def capture_moments(request, progress, on_partial=None):
    _validate_request(request)
    from macos_database_source import open_authorized_source
    return capture_moments_from_source(request, progress, on_partial, open_authorized_source())
