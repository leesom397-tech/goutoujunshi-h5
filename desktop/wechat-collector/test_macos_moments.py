"""Synthetic schema/AX contract tests. These are not a macOS device pass."""
import hashlib
import json
import sqlite3
import unittest
from unittest.mock import patch
from xml.sax.saxutils import escape

import macos_accessibility as ax
import macos_moments as moments
from background_reader import BackgroundCaptureError


def xml(author="wxid_friend", text="今天去爬山", stamp="1780000000", post_id="20", extra=""):
    return (f"<SnsDataItem><TimelineObject><id>{post_id}</id><username>{escape(author)}</username>"
            f"<createTime>{stamp}</createTime><contentDesc>{escape(text)}</contentDesc>{extra}"
            "</TimelineObject><LocalExtraInfo><comment_user_list>PRIVATE COMMENT</comment_user_list>"
            "</LocalExtraInfo></SnsDataItem>")


def connection(*rows):
    conn = sqlite3.connect(":memory:")
    conn.execute("CREATE TABLE SnsTimeLine(tid INTEGER, content TEXT)")
    conn.executemany("INSERT INTO SnsTimeLine VALUES (?,?)", rows)
    return conn


class Source:
    account_id = "wxid_owner"
    self_username = "wxid_owner"
    account_label = "Owner"

    def __init__(self, conn):
        self.conn = conn
        self.closed = False
        self.checks = 0

    def assert_unchanged(self):
        self.checks += 1

    def database_exists(self, relative):
        assert relative == "sns/sns.db"
        return True

    def open_database(self, relative):
        assert relative == "sns/sns.db"
        return self.conn

    def close(self):
        self.closed = True


def request(**extras):
    return {"kind": "moments", "friend": "好友", "contactId": "wxid_friend",
            "accountKey": hashlib.sha256(b"wxid_owner").hexdigest(), "limit": 100,
            "allVisible": True, **extras}


class MomentsTests(unittest.TestCase):
    def test_author_column_filters_before_xml_decode_including_blob_ids(self):
        conn = sqlite3.connect(":memory:")
        conn.execute("CREATE TABLE SnsTimeLine(tid INTEGER,user_name,content TEXT)")
        conn.executemany("INSERT INTO SnsTimeLine VALUES(?,?,?)", [
            *[(i, "wxid_unselected", xml("wxid_unselected", "UNSELECTED", post_id=str(i))) for i in range(1, 501)],
            (501, "wxid_friend", xml(post_id="501")),
            (502, b"wxid_friend", xml(post_id="502")),
        ])
        with patch.object(moments, "parse_moment_xml", wraps=moments.parse_moment_xml) as parse, \
                patch.object(moments, "MAX_SCAN_ROWS", 3):
            rows, detail = moments.read_moments_connection(conn, "wxid_friend", "好友")
        self.assertEqual(parse.call_count, 2)
        self.assertEqual(len(rows), 2)
        self.assertEqual(detail["scannedCacheRecords"], 2)
        self.assertTrue(detail["authorFilterApplied"])
        self.assertFalse(detail["scanLimited"])
        self.assertNotIn("UNSELECTED", json.dumps(rows))

    def test_author_index_is_not_substitute_for_xml_identity_and_empty_legacy_ids(self):
        conn = sqlite3.connect(":memory:")
        conn.execute("CREATE TABLE SnsTimeLine(tid INTEGER,user_name TEXT COLLATE NOCASE,content TEXT)")
        conn.executemany("INSERT INTO SnsTimeLine VALUES(?,?,?)", [
            (1, "wxid_friend", xml("wxid_someone_else", "WRONG_XML_AUTHOR", post_id="1")),
            (2, "WXID_FRIEND", xml("WXID_FRIEND", "WRONG_CASE", post_id="2")),
            (3, None, xml(post_id="3")),
            (4, "", xml(post_id="4")),
            (5, b"", xml(post_id="5")),
        ])
        with patch.object(moments, "parse_moment_xml", wraps=moments.parse_moment_xml) as parse:
            rows, detail = moments.read_moments_connection(conn, "wxid_friend", "好友")
        self.assertEqual(parse.call_count, 4)
        self.assertEqual({row["source"]["sourceRecordId"] for row in rows}, {"3", "4", "5"})
        self.assertNotIn("WRONG_", json.dumps(rows))
        self.assertTrue(detail["authorFilterApplied"])

    def test_author_filter_uses_literal_id_not_sql_or_like_pattern(self):
        target = "wxid_%' OR 1=1--"
        conn = sqlite3.connect(":memory:")
        conn.execute("CREATE TABLE SnsTimeLine(tid INTEGER,user_name TEXT,content TEXT)")
        conn.executemany("INSERT INTO SnsTimeLine VALUES(?,?,?)", [
            (1, target, xml(target, post_id="1")),
            (2, "wxid_other", xml("wxid_other", "UNSELECTED", post_id="2")),
        ])
        with patch.object(moments, "parse_moment_xml", wraps=moments.parse_moment_xml) as parse:
            rows, _ = moments.read_moments_connection(conn, target, "好友")
        self.assertEqual(parse.call_count, 1)
        self.assertEqual(len(rows), 1)

    def test_exact_author_filter_not_display_name(self):
        conn = connection((1, xml("wxid_friend", "selected", post_id="1")),
                          (2, xml("wxid_someone_else", "other private", post_id="2")))
        rows, _ = moments.read_moments_connection(conn, "wxid_friend", "好友")
        self.assertEqual([row["text"] for row in rows], ["selected"])
        self.assertNotIn("other private", json.dumps(rows))

    def test_actual_timestamps_sorted_not_cache_insertion_order(self):
        conn = connection((1, xml(stamp="1780000002", post_id="1")),
                          (2, xml(stamp="1780000000", post_id="2")),
                          (3, xml(stamp="1780000001", post_id="3")))
        rows, info = moments.read_moments_connection(conn, "wxid_friend", "好友", limit=2)
        self.assertEqual([r["source"]["sourceRecordId"] for r in rows], ["1", "3"])
        self.assertEqual(info["cachedTargetCount"], 3)

    def test_duplicate_id_dedup_and_repeated_text_preserved(self):
        conn = connection((1, xml(post_id="1")), (1, xml(post_id="1")), (2, xml(post_id="2")))
        rows, _ = moments.read_moments_connection(conn, "wxid_friend", "好友")
        self.assertEqual(len(rows), 2)

    def test_card_text_label_and_media_tokens_never_exported(self):
        parsed = moments.parse_moment_xml(xml(extra=("<ContentObject><title>分享</title><description>摘要</description>"
            '<mediaList><media><url key="SECRET_KEY" token="SECRET_TOKEN">https://example.invalid/private</url>'
            "</media></mediaList></ContentObject>")))
        self.assertIn("分享标题：分享", parsed["text"])
        self.assertIn("分享摘要：摘要", parsed["text"])
        self.assertEqual(parsed["media_count"], 1)
        exported = json.dumps(parsed)
        for value in ["SECRET_KEY", "SECRET_TOKEN", "private", "PRIVATE COMMENT"]:
            self.assertNotIn(value, exported)

    def test_music_note_and_media_text_are_kept_as_shared_content(self):
        content = xml(text="", extra=(
            "<ContentObject><type>999</type><title>歌曲标题</title><description>媒体说明</description>"
            "<musicShareItem><mvSingerName>歌手名字</mvSingerName><mvAlbumName>专辑名字</mvAlbumName>"
            "<mid>PRIVATE_MUSIC_ID</mid></musicShareItem>"
            "<mediaList><media><title>歌曲标题</title><description>媒体说明</description>"
            "<url token='PRIVATE_TOKEN'>https://example.invalid/PRIVATE_URL</url></media></mediaList>"
            "<noteinfo><datalist><dataitem datatype='1'><datadesc>笔记正文</datadesc></dataitem>"
            "<dataitem datatype='2'><datadesc>PRIVATE_IMAGE_DETAIL</datadesc></dataitem>"
            "</datalist></noteinfo></ContentObject>"))
        parsed = moments.parse_moment_xml(content)
        self.assertEqual(parsed["text"], "分享标题：歌曲标题\n分享摘要：媒体说明\n分享音乐·歌手：歌手名字\n分享音乐·专辑：专辑名字\n分享笔记：笔记正文")
        self.assertEqual(parsed["media_count"], 2)
        self.assertNotIn("PRIVATE_", json.dumps(parsed))

    def test_media_description_without_caption_is_not_silently_lost(self):
        content = xml(text="", extra="<ContentObject><mediaList><media><description>分享文章内容</description></media></mediaList></ContentObject>")
        rows, _ = moments.read_moments_connection(connection((1, content)), "wxid_friend", "好友")
        self.assertEqual(rows[0]["text"], "分享媒体说明：分享文章内容")

    def test_xml_sql_bound_is_bytes_not_unicode_characters(self):
        content = xml(text="多" * 150)
        limit = len(content) + 1
        self.assertGreater(len(content.encode("utf-8")), limit)
        with patch.object(moments, "MAX_XML_BYTES", limit), \
                patch.object(moments, "parse_moment_xml", wraps=moments.parse_moment_xml) as parse:
            rows, detail = moments.read_moments_connection(connection((1, content)), "wxid_friend", "好友")
        self.assertIsNone(parse.call_args.args[0])
        self.assertEqual(rows, [])
        self.assertEqual(detail["unparsedCacheRecords"], 1)

    def test_unknown_time_not_inferred_from_record_id(self):
        parsed = moments.parse_moment_xml(xml(stamp="昨天", post_id="4291130000000000"))
        self.assertEqual(parsed["at"], "")
        self.assertFalse(parsed["time_known"])

    def test_doctype_entities_unsupported_and_malformed_xml_rejected(self):
        for content in [b'<!DOCTYPE x [<!ENTITY a "secret">]><SnsDataItem>&a;</SnsDataItem>', b"<not xml>"]:
            with self.subTest(content=content), self.assertRaises(ValueError):
                moments.parse_moment_xml(content)

    def test_no_guess_on_unknown_schema(self):
        conn = sqlite3.connect(":memory:")
        conn.execute("CREATE TABLE SNS_Timeline(Buffer BLOB)")
        with self.assertRaises(BackgroundCaptureError) as error:
            moments.read_moments_connection(conn, "wxid_friend", "好友")
        self.assertEqual(error.exception.code, "MAC_MOMENTS_SCHEMA_UNSUPPORTED")

    def test_scan_bound_does_not_claim_cache_complete(self):
        conn = connection(*[(i, xml(post_id=str(i))) for i in range(1, 5)])
        with patch.object(moments, "MAX_SCAN_ROWS", 2):
            rows, info = moments.read_moments_connection(conn, "wxid_friend", "好友")
        self.assertEqual(len(rows), 2)
        self.assertTrue(info["scanLimited"])

    def test_wall_time_limit_returns_partial_without_sleep(self):
        conn = connection((1, xml(post_id="1")), (2, xml(post_id="2")))
        with patch.object(moments.time, "monotonic", side_effect=[0, 1, 30]):
            rows, info = moments.read_moments_connection(conn, "wxid_friend", "好友")
        self.assertEqual(len(rows), 1)
        self.assertTrue(info["scanLimited"])

    def test_invalid_author_or_oversized_content_not_exported(self):
        conn = connection((1, xml(author="")), (2, "x" * 300))
        with patch.object(moments, "MAX_XML_BYTES", 250):
            rows, info = moments.read_moments_connection(conn, "wxid_friend", "好友")
        self.assertEqual(rows, [])
        self.assertEqual(info["unparsedCacheRecords"], 2)

    def test_identity_change_discards_read(self):
        conn = connection((1, xml()))
        calls = []
        def check():
            calls.append(1)
            if len(calls) == 2:
                raise BackgroundCaptureError("ACCOUNT_CHANGED", "changed")
        with self.assertRaises(BackgroundCaptureError) as error:
            moments.read_moments_connection(conn, "wxid_friend", "好友", assert_unchanged=check)
        self.assertEqual(error.exception.code, "ACCOUNT_CHANGED")

    def test_batch_never_claims_all_visible_or_images_read(self):
        source = Source(connection((1, xml(extra="<ContentObject><mediaList><media/><media/></mediaList></ContentObject>"))))
        with patch.object(moments, "_resolve_contact", return_value="wxid_friend"):
            batch = moments.capture_moments_from_source(request(), lambda *args: None, None, source)
        self.assertFalse(batch["coverage"]["complete"])
        self.assertEqual(batch["coverage"]["scope"], "local-cache")
        self.assertEqual(batch["coverage"]["imageOmittedCount"], 2)
        self.assertEqual(batch["coverage"]["scrollAttempts"], 0)
        self.assertNotIn("images", batch["records"][0])
        self.assertNotIn("upstreamCommit", batch["records"][0]["source"])
        self.assertTrue(source.closed)
        self.assertGreaterEqual(source.checks, 4)

    def test_empty_cache_returns_no_claim_about_friends_history(self):
        source = Source(connection())
        with patch.object(moments, "_resolve_contact", return_value="wxid_friend"):
            batch = moments.capture_moments_from_source(request(), lambda *args: None, None, source)
        self.assertEqual(batch["records"], [])
        self.assertFalse(batch["coverage"]["complete"])
        self.assertTrue(any("不代表对方没有" in w for w in batch["warnings"]))

    def test_missing_cache_closes_source(self):
        source = Source(connection())
        source.database_exists = lambda _: False
        with patch.object(moments, "_resolve_contact", return_value="wxid_friend"), self.assertRaises(BackgroundCaptureError) as error:
            moments.capture_moments_from_source(request(), lambda *args: None, None, source)
        self.assertEqual(error.exception.code, "MAC_MOMENTS_CACHE_MISSING")
        self.assertTrue(source.closed)

    def test_request_requires_selected_contact_and_boolean(self):
        for req in [request(contactId=None), request(allVisible="yes"), request(limit=True), request(extra="bad")]:
            with self.subTest(req=req), self.assertRaises(BackgroundCaptureError):
                moments._validate_request(req)


class SyntheticAX:
    def role(self, node):
        return "AXApplication" if node == 0 else "AXGroup"

    def attribute_names(self, node):
        return ["AXRole", "AXTitle", "AXValue", "SECRET_CHAT_VALUE"]

    def action_names(self, node):
        return ["AXPress"]

    def geometry(self, node):
        return (0, 0, 100, 100)

    def children(self, node, limit):
        nodes = list(range(node * 3 + 1, node * 3 + 4))
        return nodes[:limit], len(nodes) > limit


class AccessibilityTests(unittest.TestCase):
    def test_anonymous_tree_has_bounds_and_no_text_values(self):
        result = ax.anonymous_tree(0, SyntheticAX(), max_nodes=10, max_depth=3)
        self.assertLessEqual(len(result["nodes"]), 10)
        self.assertTrue(result["truncated"])
        self.assertFalse(result["contentIncluded"])
        self.assertNotIn("SECRET_CHAT_VALUE", json.dumps(result))
        self.assertTrue(all(node["depth"] <= 3 for node in result["nodes"]))

    def test_deadline_stops_traversal(self):
        ticks = iter([0, .1, .9, 1.1, 2])
        result = ax.anonymous_tree(0, SyntheticAX(), budget_seconds=1, clock=lambda: next(ticks))
        self.assertLessEqual(len(result["nodes"]), 1)
        self.assertTrue(result["truncated"])

    def test_native_error_not_included_or_duplicate_node(self):
        backend = SyntheticAX()
        def fail(*args):
            raise RuntimeError("PRIVATE WINDOW TITLE")
        backend.children = fail
        result = ax.anonymous_tree(0, backend)
        self.assertEqual(len(result["nodes"]), 1)
        self.assertNotIn("PRIVATE WINDOW TITLE", json.dumps(result))

    def test_non_mac_probe_does_not_import_native_or_read_data(self):
        with patch.object(ax.sys, "platform", "win32"):
            result = ax.probe_accessibility(include_tree=True)
        self.assertEqual(result["status"], "unsupported-platform")
        self.assertNotIn("tree", result)


if __name__ == "__main__":
    unittest.main()
