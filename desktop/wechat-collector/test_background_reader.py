"""Synthetic databases only. Never opens WeChat or private account files."""
import copy
import hashlib
import sqlite3
import unittest
from unittest.mock import patch, Mock

from background_reader import (BackgroundCaptureError, capture_from_source,
                               capture_background, probe_background, _voice_duration, _validate_request,
                               local_chat_image)


class Source:
    account_id = "test-account"
    account_label = "Synthetic account"
    self_username = "self-user"

    def __init__(self):
        self.closed = False
        self.changed = False
        self.contact = sqlite3.connect(":memory:")
        self.contact.execute("CREATE TABLE contact(username TEXT,nick_name TEXT,remark TEXT)")
        self.contact.execute("INSERT INTO contact VALUES('target-user','测试联系人','唯一备注')")
        self.messages, self.media = [], []

    def contacts(self): return self.contact
    def message_shards(self): return iter(self.messages)
    def media_shards(self): return iter(self.media)
    def assert_unchanged(self):
        if self.changed:
            raise BackgroundCaptureError("SOURCE_CHANGED", "测试快照已变化")
    def close(self):
        self.closed = True
        self.contact.close()
        for _, conn in self.messages + self.media:
            conn.close()

    def shard(self, label, self_id=7, other_id=2):
        conn = sqlite3.connect(":memory:")
        conn.execute("CREATE TABLE Name2Id(user_name TEXT)")
        conn.executemany("INSERT INTO Name2Id(rowid,user_name) VALUES(?,?)",
                         [(self_id, self.self_username), (other_id, "target-user")])
        table = "Msg_" + hashlib.md5(b"target-user").hexdigest()
        conn.execute(f"CREATE TABLE {table}(local_id INTEGER,server_id INTEGER,local_type INTEGER,"
                     "real_sender_id INTEGER,create_time INTEGER,sort_seq INTEGER,message_content,compress_content)")
        self.messages.append((label, conn))
        return conn, table

    def add(self, shard, local_id, server_id, mtype=1, sender=7, sequence=1, text="合成测试消息"):
        conn, table = shard
        conn.execute(f"INSERT INTO {table} VALUES(?,?,?,?,?,?,?,NULL)",
                     (local_id, server_id, mtype, sender, 1_750_000_000 + sequence, sequence, text))

    def add_audio(self, server_id, data=b"synthetic-silk", session="target-user", label="media_0.db"):
        conn = sqlite3.connect(":memory:")
        conn.execute("CREATE TABLE Name2Id(user_name TEXT)")
        conn.execute("INSERT INTO Name2Id(rowid,user_name) VALUES(17,?)", (session,))
        conn.execute("CREATE TABLE VoiceInfo(chat_name_id INTEGER,svr_id INTEGER,voice_data BLOB)")
        conn.execute("INSERT INTO VoiceInfo VALUES(17,?,?)", (server_id, data))
        self.media.append((label, conn))


REQUEST = {"kind": "chat", "friend": "测试联系人", "limit": 500, "includeVoice": False}


class BackgroundReaderTests(unittest.TestCase):
    def run_capture(self, source, voice=False, limit=500, transcribe=None):
        partials, progress = [], []
        batch = capture_from_source({**REQUEST, "includeVoice": voice, "limit": limit},
                                    progress.append, partials.append, source, transcribe)
        self.assertTrue(source.closed)
        return batch, partials, progress

    def test_probe_fails_closed_without_provider(self):
        with patch("background_reader._provider_module", return_value=None):
            self.assertFalse(probe_background()["ready"])
            with self.assertRaises(BackgroundCaptureError) as error:
                capture_background(REQUEST, lambda _: None)
            self.assertEqual(error.exception.code, "BACKGROUND_SOURCE_UNAVAILABLE")

    def test_shard_sender_id_is_never_hardcoded_two(self):
        source = Source()
        first = source.shard("message_0.db", self_id=7, other_id=2)
        second = source.shard("message_1.db", self_id=2, other_id=7)
        source.add(first, 1, 101, sender=2, sequence=1)
        source.add(second, 1, 102, sender=2, sequence=2)
        batch, _, _ = self.run_capture(source)
        self.assertEqual([x["senderRole"] for x in batch["records"]], ["other", "self"])
        self.assertEqual(len({x["id"] for x in batch["records"]}), 2)
        self.assertIn("+00:00", batch["records"][0]["at"])

    def test_stable_ids_not_dependent_on_limit_or_text(self):
        ids = []
        for limit in (1, 2):
            source = Source()
            shard = source.shard("message_0.db")
            source.add(shard, 1, 101, sequence=1)
            source.add(shard, 2, 102, sequence=2)
            batch, _, _ = self.run_capture(source, limit=limit)
            ids.append(batch["records"][-1]["id"])
        self.assertEqual(ids[0], ids[1])

    def test_thousand_rows_preserves_global_latest_window_across_shards(self):
        source = Source()
        for shard_index in range(3):
            shard = source.shard(f"message_{shard_index}.db")
            for index in range(1000):
                sequence = index * 3 + shard_index
                source.add(shard, index + 1, 10_000 + sequence, sequence=sequence)
        batch, _, _ = self.run_capture(source, limit=1000)
        self.assertEqual(len(batch["records"]), 1000)
        self.assertEqual([int(row["source"]["messageId"]) for row in batch["records"]],
                         list(range(12_000, 13_000)))

    def test_background_request_limit_is_bounded_to_thousand(self):
        self.assertEqual(_validate_request({**REQUEST, "limit": 1000})[1], 1000)
        for invalid in (0, 1001, True):
            with self.assertRaises(BackgroundCaptureError):
                _validate_request({**REQUEST, "limit": invalid})

    def test_exact_contact_no_substring_fallback(self):
        source = Source()
        with self.assertRaises(BackgroundCaptureError) as error:
            capture_from_source({**REQUEST, "friend": "测试"}, lambda _: None, None, source)
        self.assertEqual(error.exception.code, "CONTACT_NOT_FOUND")
        self.assertTrue(source.closed)

    def test_duplicate_name_is_rejected(self):
        source = Source()
        source.contact.execute("INSERT INTO contact VALUES('another-user','测试联系人','')")
        with self.assertRaises(BackgroundCaptureError) as error:
            self.run_capture(source)
        self.assertEqual(error.exception.code, "CONTACT_AMBIGUOUS")

    def test_unknown_sender_remains_unknown(self):
        source = Source()
        source.add(source.shard("message_0.db"), 1, 101, sender=99)
        batch, _, _ = self.run_capture(source)
        self.assertEqual(batch["records"][0]["senderRole"], "unknown")
        self.assertFalse(batch["records"][0]["source"]["senderVerified"])

    def test_missing_audio_stays_incomplete(self):
        source = Source()
        source.add(source.shard("message_0.db"), 1, 101, mtype=34,
                   text='<msg><voicemsg voicelength="6000"/></msg>')
        batch, _, _ = self.run_capture(source, voice=True, transcribe=lambda *_: self.fail("unexpected ASR"))
        item = batch["records"][0]
        self.assertEqual(item["source"]["durationSeconds"], 6)
        self.assertEqual(item["text"], "[语音]")
        self.assertEqual(item["source"]["voiceAvailability"], "missing-local")
        self.assertEqual(item["source"]["transcriptionStatus"], "failed")

    def test_other_contacts_voice_not_attached_on_same_server_id(self):
        source = Source()
        source.add(source.shard("message_0.db"), 1, 101, mtype=34)
        source.add_audio(101, session="other-contact")
        batch, _, _ = self.run_capture(source)
        self.assertEqual(batch["records"][0]["source"]["voiceAvailability"], "missing-local")

    def test_quick_read_never_starts_asr(self):
        source = Source()
        source.add(source.shard("message_0.db"), 1, 101, mtype=34)
        source.add_audio(101)
        batch, partials, _ = self.run_capture(source, transcribe=lambda *_: self.fail("unexpected ASR"))
        self.assertEqual(batch["records"][0]["source"]["voiceAvailability"], "available")
        self.assertEqual(partials, [])

    def test_voice_emits_stable_partial_and_machine_provenance(self):
        source = Source()
        source.add(source.shard("message_0.db"), 1, 101, mtype=34)
        source.add_audio(101)
        calls = []
        def transcribe(blob, cache_key):
            calls.append((blob, cache_key))
            return "这是合成转写结果"
        batch, partials, _ = self.run_capture(source, voice=True, transcribe=transcribe)
        self.assertEqual(len(partials), 2)
        self.assertEqual(partials[0]["records"][0]["source"]["transcriptionStatus"], "not-transcribed")
        self.assertEqual(partials[0]["records"][0]["id"], batch["records"][0]["id"])
        self.assertEqual(calls[0][1], batch["records"][0]["id"])
        self.assertEqual(batch["records"][0]["kind"], "text")
        self.assertEqual(batch["records"][0]["source"]["transcriptionSource"], "local-audio-asr")
        self.assertFalse(batch["records"][0]["source"]["transcriptVerifiedByUser"])

    def test_conflicting_audio_fails_before_partial(self):
        source = Source()
        source.add(source.shard("message_0.db"), 1, 101, mtype=34)
        source.add_audio(101, b"one", label="media_0.db")
        source.add_audio(101, b"two", label="media_1.db")
        partials = []
        with self.assertRaises(BackgroundCaptureError) as error:
            capture_from_source({**REQUEST, "includeVoice": True}, lambda _: None, partials.append, source)
        self.assertEqual(error.exception.code, "VOICE_IDENTITY_AMBIGUOUS")
        self.assertEqual(partials, [])

    def test_changed_source_fails_before_any_partial(self):
        source = Source()
        source.changed = True
        source.add(source.shard("message_0.db"), 1, 101, mtype=34)
        source.add_audio(101)
        partials = []
        with self.assertRaises(BackgroundCaptureError) as error:
            capture_from_source({**REQUEST, "includeVoice": True}, lambda _: None, partials.append, source)
        self.assertEqual(error.exception.code, "SOURCE_CHANGED")
        self.assertEqual(partials, [])

    def test_decode_failure_is_not_a_completed_transcript(self):
        source = Source()
        source.add(source.shard("message_0.db"), 1, 101, mtype=34)
        source.add_audio(101)
        def transcribe(*_):
            raise BackgroundCaptureError("decode-failed", "test")
        batch, _, _ = self.run_capture(source, voice=True, transcribe=transcribe)
        self.assertEqual(batch["records"][0]["source"]["voiceAvailability"], "decode-failed")
        self.assertEqual(batch["records"][0]["source"]["transcriptionStatus"], "failed")

    def test_asr_failure_has_explicit_failed_status(self):
        source = Source()
        source.add(source.shard("message_0.db"), 1, 101, mtype=34)
        source.add_audio(101)
        def transcribe(*_):
            raise BackgroundCaptureError("asr-unavailable", "test")
        batch, _, _ = self.run_capture(source, voice=True, transcribe=transcribe)
        item = batch["records"][0]
        self.assertEqual(item["kind"], "other")
        self.assertEqual(item["source"]["voiceAvailability"], "transcribe-failed")
        self.assertEqual(item["source"]["transcriptionStatus"], "failed")

    def test_undecodable_text_is_not_passed_as_analyzable_text(self):
        source = Source()
        source.add(source.shard("message_0.db"), 1, 101, text=b"\xff\xfe\x00\x80")
        batch, _, _ = self.run_capture(source)
        item = batch["records"][0]
        self.assertEqual(item["kind"], "other")
        self.assertEqual(item["text"], "[文字暂未能识别]")
        self.assertTrue(batch["warnings"])

    def test_account_change_during_asr_does_not_publish_new_partial(self):
        source = Source()
        source.add(source.shard("message_0.db"), 1, 101, mtype=34)
        source.add_audio(101)
        partials = []
        def transcribe(*_):
            source.changed = True
            return "完成但账号核对已失效"
        with self.assertRaises(BackgroundCaptureError) as error:
            capture_from_source({**REQUEST, "includeVoice": True}, lambda _: None, partials.append, source, transcribe)
        self.assertEqual(error.exception.code, "SOURCE_CHANGED")
        self.assertEqual(len(partials), 1)
        self.assertEqual(partials[0]["records"][0]["kind"], "other")
        self.assertTrue(source.closed)

    def test_cancel_keeps_completed_partials_and_closes_source(self):
        source = Source()
        shard = source.shard("message_0.db")
        source.add(shard, 1, 101, mtype=34, sequence=1)
        source.add(shard, 2, 102, mtype=34, sequence=2)
        source.add_audio(101, b"one", label="media_0.db")
        source.add_audio(102, b"two", label="media_1.db")
        def transcribe(blob, _):
            if blob == b"two":
                raise BackgroundCaptureError("cancelled", "test")
            return "第一条已完成"
        partials = []
        with self.assertRaises(BackgroundCaptureError) as error:
            capture_from_source({**REQUEST, "includeVoice": True}, lambda _: None, partials.append, source, transcribe)
        self.assertEqual(error.exception.code, "CANCELLED")
        self.assertEqual(partials[-1]["records"][0]["text"], "第一条已完成")
        self.assertTrue(source.closed)


class LocalImageTests(unittest.TestCase):
    def test_named_jpeg_is_attached_and_missing_file_is_skipped(self):
        import tempfile
        from pathlib import Path
        md5 = "a" * 32
        xml = f'<msg><img md5="{md5}" /></msg>'
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory) / "FileStorage" / "Image"
            folder.mkdir(parents=True)
            from PIL import Image
            Image.new("RGB", (32, 32), "red").save(folder / f"{md5}.jpg")
            found = local_chat_image(directory, xml)
            self.assertEqual(found["mime"], "image/jpeg")
            self.assertTrue(found["data"])
            self.assertIsNone(local_chat_image(directory, "<msg><img md5=\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\" /></msg>"))

    def test_voice_duration_rejects_entities_and_out_of_bounds(self):
        self.assertIsNone(_voice_duration('<!DOCTYPE a><voicemsg voicelength="6000"/>'))
        self.assertIsNone(_voice_duration('<voicemsg voicelength="9999999"/>'))

    def test_invalid_parameters_fail_before_provider_open(self):
        with patch("background_reader._provider_module") as provider:
            for change in ({"limit": True}, {"limit": 1001}, {"includeVoice": "yes"}, {"kind": "moments"}, {"path": "private.db"}):
                with self.assertRaises(BackgroundCaptureError):
                    capture_background({**REQUEST, **change}, lambda _: None)
            provider.assert_not_called()

    def test_initial_snapshot_change_retries_before_any_partial(self):
        first, second = Source(), Source()
        first.changed = True
        second.add(second.shard("message_0.db"), 1, 101)
        provider = Mock()
        provider.open_authorized_source.side_effect = [first, second]
        with patch("background_reader._provider_module", return_value=provider):
            result = capture_background(REQUEST, lambda *_: None)
        self.assertEqual(len(result["records"]), 1)
        self.assertEqual(provider.open_authorized_source.call_count, 2)
        self.assertTrue(first.closed and second.closed)

    def test_account_change_is_never_automatically_retried(self):
        provider = Mock()
        provider.open_authorized_source.side_effect = BackgroundCaptureError("ACCOUNT_CHANGED", "test")
        with patch("background_reader._provider_module", return_value=provider):
            with self.assertRaises(BackgroundCaptureError):
                capture_background(REQUEST, lambda *_: None)
        provider.open_authorized_source.assert_called_once()

    def test_source_change_after_partial_is_never_retried(self):
        provider = Mock()
        partials = []
        def capture(request, progress, publish, source):
            publish({"records": []})
            raise BackgroundCaptureError("SOURCE_CHANGED", "test")
        with patch("background_reader._provider_module", return_value=provider), \
             patch("background_reader.capture_from_source", side_effect=capture):
            with self.assertRaises(BackgroundCaptureError):
                capture_background(REQUEST, lambda *_: None, partials.append)
        provider.open_authorized_source.assert_called_once()
        self.assertEqual(len(partials), 1)


if __name__ == "__main__":
    unittest.main()
