"""Synthetic encrypted Mac account -> contact/chat/audio/SNS integration.

This exercises the actual authenticated VFS and source adapters, not a live
account or proof of any particular official client's database schema. The only
transcription callback decodes a generated tone; it is explicitly not an ASR
accuracy test. No native client is started and no model is downloaded.
"""
import hashlib
import io
import json
import math
import os
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch

import apsw
import pysilk
import zstandard

from background_reader import (BackgroundCaptureError, capture_from_source,
                               search_contacts_from_source)
from local_voice_transcriber import _decode_silk
import macos_database_source as source
import macos_key_provider as authorization
import macos_moments as moments
from test_local_database_source import encrypt_database


class MacEncryptedCaptureIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="chengzi-mac-account-fixture-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.account = self.root / "wxid_synthetic_deadbeef"
        self.master = hashlib.sha256(b"synthetic integration only").digest()
        self.friend = "目标好友"
        self.target = "wxid_selected"
        self.other = "wxid_unselected"
        self.self_id = "wxid_synthetic"
        self.proof = {"pid": 123, "started": 456.0, "account": self.account,
                      "build": ("4.1.15", "270102")}
        self.codec_calls = 0
        samples = b"".join(struct.pack("<h", round(math.sin(i * 2 * math.pi * 440 / 16000) * 3000))
                           for i in range(16000))
        encoded = io.BytesIO()
        pysilk.encode(io.BytesIO(samples), encoded, 16000, 24000)
        self.audio = encoded.getvalue()
        self._write_db("contact/contact.db", self._contacts)
        self._write_db("message/message_0.db", self._messages)
        self._write_db("message/media_0.db", self._media)
        self._write_sns("selected cached post")
        authorization.clear_authorization()
        authorization._authorization = authorization._Authorization(
            self.account, bytearray(self.master), self._salt("contact/contact.db"), self.proof["build"])
        self.addCleanup(authorization.clear_authorization)
        proof = patch.object(authorization, "current_account_proof", return_value=self.proof)
        proof.start()
        self.addCleanup(proof.stop)
        environment = patch.dict(os.environ, {"CHENGZI_VOICE_DATA_DIR": str(self.root / "synthetic-voice-cache")})
        environment.start()
        self.addCleanup(environment.stop)

    def _salt(self, relative):
        return hashlib.sha256(relative.encode()).digest()[:16]

    def _write_db(self, relative, populate):
        plain = self.root / "fixture.sqlite"
        plain.unlink(missing_ok=True)
        conn = apsw.Connection(str(plain))
        try:
            conn.execute("PRAGMA page_size=4096")
            conn.reserve_bytes("main", 80)
            conn.execute("VACUUM")
            populate(conn)
        finally:
            conn.close()
        target = self.account / "db_storage" / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        salt = self._salt(relative)
        key = hashlib.pbkdf2_hmac("sha512", self.master, salt, 256000, 32)
        target.write_bytes(encrypt_database(plain.read_bytes(), key, salt))
        plain.unlink()

    def _contacts(self, conn):
        conn.execute("CREATE TABLE contact(username TEXT,nick_name TEXT,remark TEXT)")
        conn.executemany("INSERT INTO contact VALUES(?,?,?)", [
            (self.self_id, "synthetic self", ""), (self.target, self.friend, ""),
            (self.other, "unselected synthetic contact", "")])

    def _messages(self, conn):
        conn.execute("CREATE TABLE Name2Id(user_name TEXT)")
        conn.executemany("INSERT INTO Name2Id(rowid,user_name) VALUES(?,?)",
                         [(7, self.self_id), (2, self.target), (19, self.other)])
        for username in (self.target, self.other):
            table = "Msg_" + hashlib.md5(username.encode()).hexdigest()
            conn.execute(f"CREATE TABLE {table}(local_id INTEGER,server_id INTEGER,local_type INTEGER,"
                         "real_sender_id INTEGER,create_time INTEGER,sort_seq INTEGER,message_content,compress_content)")
            if username == self.target:
                conn.execute(f"INSERT INTO {table} VALUES(1,101,1,7,1780000000,1,NULL,?)",
                             (zstandard.ZstdCompressor().compress("压缩的合成消息".encode()),))
                conn.execute(f"INSERT INTO {table} VALUES(2,102,34,2,1780000001,2,?,NULL)",
                             ('<msg><voicemsg voicelength="1000"/></msg>',))
            else:
                conn.execute(f"INSERT INTO {table} VALUES(1,102,1,19,1780000001,1,'UNSELECTED_CHAT',NULL)")

    def _media(self, conn):
        conn.execute("CREATE TABLE Name2Id(user_name TEXT)")
        conn.executemany("INSERT INTO Name2Id(rowid,user_name) VALUES(?,?)", [(17, self.target), (19, self.other)])
        conn.execute("CREATE TABLE VoiceInfo(chat_name_id INTEGER,svr_id INTEGER,voice_data BLOB)")
        conn.executemany("INSERT INTO VoiceInfo VALUES(?,?,?)",
                         [(17, 102, self.audio), (19, 102, b"UNSELECTED_AUDIO")])

    def _write_sns(self, text):
        def populate(conn):
            conn.execute("CREATE TABLE SnsTimeLine(tid INTEGER,content BLOB)")
            for identifier, username, body in [(101, self.target, text), (102, self.other, "UNSELECTED_SNS")]:
                xml = (f"<SnsDataItem><TimelineObject><id>{identifier}</id><username>{username}</username>"
                       f"<createTime>1780000000</createTime><contentDesc>{body}</contentDesc>"
                       "<ContentObject><mediaList><media><url>https://example.invalid/never-fetch</url>"
                       "</media></mediaList></ContentObject></TimelineObject></SnsDataItem>")
                conn.execute("INSERT INTO SnsTimeLine VALUES(?,?)", (identifier, xml.encode()))
        self._write_db("sns/sns.db", populate)

    def _selection(self):
        result = search_contacts_from_source(self.friend, source.open_authorized_source(contacts_only=True))
        self.assertEqual([row["contactId"] for row in result["contacts"]], [self.target])
        return {"friend": self.friend, "contactId": self.target, "accountKey": result["accountKey"], "limit": 500}

    def test_selected_encrypted_contact_chat_voice_and_cached_moments(self):
        before = {p: hashlib.sha256(p.read_bytes()).digest() for p in self.account.rglob("*.db")}
        selected = self._selection()
        partials = []
        def decode_only(blob, _record_id):
            self.assertEqual(blob, self.audio)
            self.assertEqual(len(_decode_silk(blob)), 16000)
            self.codec_calls += 1
            return "[合成夹具：音频解码通过，未运行语义转写]"
        batch = capture_from_source({**selected, "kind": "chat", "includeVoice": True},
                                    lambda event: None, partials.append, source.open_authorized_source(), decode_only)
        self.assertEqual(self.codec_calls, 1)
        self.assertEqual([row["senderRole"] for row in batch["records"]], ["self", "other"])
        self.assertEqual(batch["records"][0]["text"], "压缩的合成消息")
        self.assertEqual(batch["records"][1]["source"]["transcriptionSource"], "local-audio-asr")
        self.assertTrue(partials)
        cache = moments.capture_moments_from_source({**selected, "kind": "moments", "allVisible": False},
                    lambda *args: None, None, source.open_authorized_source())
        self.assertEqual([row["text"] for row in cache["records"]], ["selected cached post"])
        self.assertEqual(cache["coverage"]["scope"], "local-cache")
        self.assertFalse(cache["coverage"]["complete"])
        self.assertEqual(cache["coverage"]["imageOmittedCount"], 1)
        self.assertNotIn("UNSELECTED_", json.dumps([batch, cache]))
        self.assertNotIn("never-fetch", json.dumps(cache))
        self.assertEqual(before, {p: hashlib.sha256(p.read_bytes()).digest() for p in self.account.rglob("*.db")})
        self.assertFalse((self.root / "fixture.sqlite").exists())

    def test_new_sns_snapshot_is_not_covered_by_earlier_contact_seal(self):
        db = source.open_authorized_source()
        try:
            # Moments performs an identity check before opening the SNS DB.
            db.assert_unchanged()
            sns = db.open_database("sns/sns.db")
            self.assertEqual(len(list(sns.execute("SELECT tid,content FROM SnsTimeLine"))), 2)
            # A valid encrypted rewrite, not a damaged HMAC or a mocked VFS.
            self._write_sns("changed selected cached post")
            with self.assertRaises(BackgroundCaptureError) as raised:
                db.assert_unchanged()
            self.assertEqual(raised.exception.code, "SOURCE_CHANGED")
        finally:
            db.close()

    def test_cached_moments_rechecks_after_its_intermediate_identity_checks(self):
        selected = self._selection()
        read_cached_rows = moments.read_moments_connection
        def finish_read_then_change(*args, **kwargs):
            result = read_cached_rows(*args, **kwargs)
            # The parser already performed its initial/periodic/final identity
            # checks. The capture must still validate before publishing rows.
            self._write_sns("changed before publishing cached post")
            return result
        db = source.open_authorized_source()
        with patch.object(moments, "read_moments_connection", side_effect=finish_read_then_change):
            with self.assertRaises(BackgroundCaptureError) as raised:
                moments.capture_moments_from_source({**selected, "kind": "moments", "allVisible": False},
                    lambda *args: None, None, db)
        self.assertEqual(raised.exception.code, "SOURCE_CHANGED")
        self.assertTrue(db.closed)


if __name__ == "__main__":
    unittest.main()
