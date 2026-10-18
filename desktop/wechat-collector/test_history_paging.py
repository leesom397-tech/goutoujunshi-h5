"""Only in-memory synthetic SQLite fixtures; never opens a WeChat account."""
import base64
import hashlib
import json
import sqlite3
import unittest
from unittest.mock import patch

from background_reader import BackgroundCaptureError, capture_from_source, _message_id, _validate_request
from bridge import BridgeError, CollectorState
from test_background_reader import Source, REQUEST


class HistoryPagingTests(unittest.TestCase):
    def setUp(self):
        self.template = Source()
        self.expected = []
        self.tables = []
        for shard_index in range(3):
            label = f"message_{shard_index}.db"
            shard = self.template.shard(label)
            self.tables.append(shard)
            # Both sort_seq and local_id tie within and across shards. rowid is
            # the final traversal tie-breaker; server IDs keep messages distinct.
            for index in range(901):
                server = 100_000 + shard_index * 1000 + index
                self.template.add(shard, index // 2 + 1, server, sequence=index // 4)
                self.expected.append(((index // 4, label, index // 2 + 1, index + 1),
                                      _message_id("test-account", "target-user", label, server, index // 2 + 1)))
        self.expected.sort()

    def tearDown(self):
        self.template.close()

    def source(self, reverse=False):
        # Every request gets a fresh provider snapshot with the same SQLite
        # rowids, like separate bridge worker processes opening the databases.
        result = Source()
        self.template.contact.commit()
        result.contact.commit()
        self.template.contact.backup(result.contact)
        for target, original in ((result.messages, self.template.messages), (result.media, self.template.media)):
            for label, conn in original:
                conn.commit()
                clone = sqlite3.connect(":memory:")
                conn.backup(clone)
                target.append((label, clone))
        if reverse:
            result.messages.reverse()
        return result

    def capture(self, request=None, source=None, transcribe=None, partials=None):
        src = source or self.source()
        try:
            return capture_from_source({**REQUEST, "pageSize": 500, **(request or {})}, lambda _: None,
                                       partials.append if partials is not None else None, src, transcribe)
        finally:
            self.assertTrue(src.closed)

    def test_more_than_2500_tied_messages_are_complete_both_directions(self):
        expected = [message_id for _, message_id in self.expected]
        for direction in ("backward", "forward"):
            with self.subTest(direction=direction):
                request = {"direction": direction}
                pages, snapshots, cursors = [], set(), set()
                for page in range(10):
                    batch = self.capture(request, source=self.source(reverse=bool(page % 2)))
                    meta = batch["history"]
                    ids = [record["id"] for record in batch["records"]]
                    positions = [expected.index(message_id) for message_id in ids]
                    self.assertEqual(positions, sorted(positions))
                    self.assertEqual(meta["count"], len(ids))
                    self.assertLessEqual(len(ids), 500)
                    self.assertEqual(meta["complete"], not meta["hasMore"])
                    snapshots.add(meta["snapshot"])
                    pages.append(ids)
                    if not meta["hasMore"]:
                        self.assertIsNone(meta["nextCursor"])
                        break
                    self.assertNotIn(meta["nextCursor"], cursors)
                    cursors.add(meta["nextCursor"])
                    request["cursor"] = meta["nextCursor"]
                else:
                    self.fail("pagination did not terminate")
                flattened = [item for ids in (reversed(pages) if direction == "backward" else pages) for item in ids]
                self.assertEqual(flattened, expected)
                self.assertEqual(len(set(flattened)), 2703)
                self.assertEqual(len(snapshots), 1)

    def test_new_messages_and_new_shard_stay_outside_snapshot_then_arrive_via_since(self):
        first = self.capture({"direction": "forward"})
        self.template.add(self.tables[0], 8000, 900001, sequence=99999)
        self.template.add(self.tables[1], 8001, 900002, sequence=0)  # late arrival
        new_shard = self.template.shard("message_9.db")
        self.template.add(new_shard, 1, 900003, sequence=-5)
        ids = [row["id"] for row in first["records"]]
        page = first
        while page["history"]["hasMore"]:
            page = self.capture({"cursor": page["history"]["nextCursor"]})
            ids.extend(row["id"] for row in page["records"])
        self.assertEqual(ids, [message_id for _, message_id in self.expected])
        increment = self.capture({"since": page["history"]["snapshot"], "direction": "forward", "pageSize": 2})
        self.assertEqual([row["source"]["messageId"] for row in increment["records"]], ["900003", "900002"])
        self.assertTrue(increment["history"]["hasMore"])
        final = self.capture({"cursor": increment["history"]["nextCursor"], "pageSize": 2})
        self.assertEqual([row["source"]["messageId"] for row in final["records"]], ["900001"])
        self.assertFalse(final["history"]["hasMore"])
        empty = self.capture({"since": final["history"]["snapshot"]})
        self.assertEqual(empty["history"]["count"], 0)
        self.assertTrue(empty["history"]["complete"])

    def test_retrying_same_cursor_is_idempotent_with_different_page_size(self):
        first = self.capture({"pageSize": 73})
        request = {"cursor": first["history"]["nextCursor"], "pageSize": 113}
        one, two = self.capture(request), self.capture(request)
        self.assertEqual(one["records"], two["records"])
        self.assertEqual(one["history"], two["history"])
        self.assertFalse({row["id"] for row in first["records"]} & {row["id"] for row in one["records"]})

    def test_text_history_page_does_not_scan_encrypted_media_shards(self):
        # Full-history import is text-first.  Real media shards can be very
        # large and lack a useful composite index; voice enrichment runs as a
        # separate bounded pass after the text pages are committed.
        source = self.source()
        _label, conn = source.messages[0]
        source.add((conn, "Msg_" + hashlib.md5(b"target-user").hexdigest()), 9_999, 990_001, mtype=34, sequence=99_999)
        with patch.object(source, "media_shards", side_effect=AssertionError("history text pass must not scan media")):
            batch = self.capture({"pageSize": 2}, source=source)
        self.assertEqual(batch["history"]["count"], 2)
        self.assertEqual(batch["records"][-1]["source"]["voiceAvailability"], "missing-local")

    def test_account_and_contact_cursor_misuse_rejected_before_message_read(self):
        first = self.capture()
        for field in ("cursor", "since"):
            token = first["history"]["nextCursor" if field == "cursor" else "snapshot"]
            for mismatch in ("account", "contact"):
                with self.subTest(field=field, mismatch=mismatch):
                    source = self.source()
                    request = {field: token}
                    if mismatch == "account":
                        source.account_id = "changed-account"
                    else:
                        source.contact.execute("INSERT INTO contact VALUES('different-user','其他联系人','')")
                        request["friend"] = "其他联系人"
                    with patch.object(source, "message_shards", side_effect=AssertionError("must not read other messages")):
                        with self.assertRaises(BackgroundCaptureError) as error:
                            self.capture(request, source=source)
                    self.assertEqual(error.exception.code, "CURSOR_IDENTITY_MISMATCH")

    def test_cancelled_voice_page_can_retry_without_skipping_or_claiming_transcript(self):
        for index, server in ((1, 900001), (2, 900002), (3, 900003), (4, 900004)):
            self.template.add(self.tables[0], 9000 + index, server, mtype=34, sequence=1000 + index)
            self.template.add_audio(server, data=str(server).encode(), label=f"media_{index}.db")
        first = self.capture({"pageSize": 2})
        request = {"cursor": first["history"]["nextCursor"], "pageSize": 2, "includeVoice": True}
        partials = []
        calls = []
        def cancelled(blob, key):
            calls.append(key)
            if len(calls) == 2:
                raise BackgroundCaptureError("cancelled", "synthetic cancellation")
            return "已转写的合成文字"
        with self.assertRaises(BackgroundCaptureError) as error:
            self.capture(request, transcribe=cancelled, partials=partials)
        self.assertEqual(error.exception.code, "CANCELLED")
        self.assertEqual(partials[-1]["records"][1]["text"], "[语音]")
        self.assertEqual(partials[-1]["records"][1]["source"]["transcriptionStatus"], "not-transcribed")
        final = self.capture(request, transcribe=lambda *_: "重试转写成功")
        self.assertEqual([row["id"] for row in final["records"]], [row["id"] for row in partials[0]["records"]])
        self.assertTrue(all(partial["history"] == final["history"] for partial in partials))
        self.assertTrue(all(row["source"]["transcriptionStatus"] == "visible-text" for row in final["records"]))

    def test_voice_pagination_reaches_audio_older_than_latest_thousand_messages(self):
        self.template.add(self.tables[0], 9000, 990001, mtype=34, sequence=-5)
        self.template.add_audio(990001, data=b"old-voice")
        self.template.add(self.tables[0], 9001, 990002, mtype=34, sequence=10000)
        self.template.add_audio(990002, data=b"recent-voice", label="media_1.db")
        seen, calls, cursor, pages = set(), [], None, 0
        def transcribe(blob, key):
            calls.append((blob, key))
            return "合成语音已转写"
        while True:
            request = {"pageSize": 500, "includeVoice": True, **({"cursor": cursor} if cursor else {})}
            batch = self.capture(request, transcribe=transcribe)
            pages += 1
            for row in batch["records"]:
                self.assertNotIn(row["id"], seen)
                seen.add(row["id"])
            if batch["history"]["complete"]:
                break
            cursor = batch["history"]["nextCursor"]
        self.assertGreater(pages, 2)
        self.assertEqual(len(seen), len(self.expected) + 2)
        self.assertEqual([blob for blob, _ in calls], [b"recent-voice", b"old-voice"])

    def test_deleted_interior_messages_terminate_and_removed_boundary_fails_closed(self):
        first = self.capture({"direction": "forward"})
        conn, table = self.tables[0]
        conn.execute(f'DELETE FROM "{table}" WHERE rowid BETWEEN 400 AND 500')
        page, seen = first, set(row["id"] for row in first["records"])
        for _ in range(10):
            if not page["history"]["hasMore"]:
                break
            page = self.capture({"cursor": page["history"]["nextCursor"]})
            ids = {row["id"] for row in page["records"]}
            self.assertFalse(ids & seen)
            seen.update(ids)
        else:
            self.fail("deletions caused an unbounded pagination loop")
        self.assertEqual(len(seen), 2703 - 101)
        conn.execute(f'DELETE FROM "{table}" WHERE rowid=901')
        with self.assertRaises(BackgroundCaptureError) as error:
            self.capture({"cursor": first["history"]["nextCursor"]})
        self.assertEqual(error.exception.code, "CURSOR_SOURCE_CHANGED")

    def test_account_change_during_page_publishes_nothing(self):
        source, partials = self.source(), []
        source.changed = True
        with self.assertRaises(BackgroundCaptureError) as error:
            self.capture(source=source, partials=partials)
        self.assertEqual(error.exception.code, "SOURCE_CHANGED")
        self.assertEqual(partials, [])

    def test_empty_contact_has_complete_zero_page_and_supports_new_arrival(self):
        for conn, table in self.tables:
            conn.execute(f'DELETE FROM "{table}"')
        first = self.capture()
        self.assertEqual(first["history"]["count"], 0)
        self.assertTrue(first["history"]["complete"])
        self.template.add(self.tables[0], 1, 12345)
        self.assertEqual(self.capture({"since": first["history"]["snapshot"]})["history"]["count"], 1)

    def test_invalid_tokens_and_parameters_reject_before_provider_access(self):
        token = self.capture()["history"]["nextCursor"]
        decoded = json.loads(base64.urlsafe_b64decode(token + "=" * (-len(token) % 4)))
        def encode(value):
            return base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip("=")
        changes = [{"pageSize": True}, {"pageSize": 501}, {"direction": "sideways"},
                   {"cursor": None}, {"cursor": "../private.db"}, {"cursor": "x" * 24001},
                   {"cursor": token, "since": token}, {"cursor": token, "direction": "forward"},
                   {"cursor": encode({**decoded, "extra": "untrusted"})},
                   {"cursor": encode({**decoded, "after": [1, "message_0.db", 2, 0]})},
                   {"cursor": encode({**decoded, "upper": {"bad": True}})}]
        for change in changes:
            with self.subTest(change=list(change)):
                with self.assertRaises(BackgroundCaptureError):
                    _validate_request({**REQUEST, **change})


class HistoryBridgeTests(unittest.TestCase):
    def test_health_advertises_history_and_rejects_ui_paging(self):
        state = CollectorState(health_provider=lambda: {"ready": True, "capabilities": {"backgroundChat": True}})
        self.assertTrue(state.health()["capabilities"]["backgroundHistory"])
        self.assertEqual(state.health()["backgroundPageSize"], 500)
        for extra in ({"mode": "ui", "pageSize": 500}, {"mode": "background", "pageSize": 501},
                      {"mode": "background", "cursor": "malformed"}):
            with self.assertRaises(BridgeError):
                state.start({**REQUEST, **extra})
        self.assertIsNone(state.active)

    def test_page_fields_pass_to_worker_and_limit_is_optional(self):
        state = CollectorState(health_provider=lambda: {"ready": False, "capabilities": {"backgroundChat": True}})
        request = {"kind": "chat", "friend": "测试联系人", "mode": "background", "pageSize": 273, "direction": "forward"}
        with patch("bridge.mp.get_context") as context, patch("bridge.threading.Thread"):
            context.return_value.Pipe.return_value = (object(), unittest.mock.Mock())
            state.start(request)
            payload = context.return_value.Process.call_args.kwargs["args"][1]
        self.assertEqual(payload["pageSize"], 273)
        self.assertEqual(payload["direction"], "forward")
        self.assertEqual(payload["limit"], 500)


if __name__ == "__main__":
    unittest.main()
