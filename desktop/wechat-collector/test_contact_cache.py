"""Synthetic encrypted contacts, fake live proofs; no real WeChat access."""
import hashlib
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

import apsw

from background_reader import BackgroundCaptureError, search_contacts_from_source
from bridge import CollectorState
from local_database_source import ContactSourceCache, LocalDatabaseSource, _needed_database_files
from test_local_database_source import encrypt_database, encrypt_page, wal_bytes


class ContactCacheTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="chengzi-synthetic-contacts-")
        self.root = Path(self.temp.name)
        self.account = self.root / "synthetic-self_abcd"
        self.db = self.account / "db_storage/contact/contact.db"
        self.db.parent.mkdir(parents=True)
        self.key = hashlib.sha256(b"synthetic contact key").digest()
        self.salt = hashlib.md5(b"synthetic contact salt").digest()
        self.proof = {"username": "synthetic-self", "pid": 123, "created": 55,
                      "cfg": 100, "rootPointer": 200, "cipherFingerprint": b"synthetic"}
        self.raw = self.contact_bytes("Audrey")
        self.db.write_bytes(encrypt_database(self.raw, self.key, self.salt))
        self.login = patch("local_database_source._verify_login").start()
        self.processes = patch("local_database_source._running_processes", return_value=[(123, 55)]).start()
        self.open = patch("local_database_source.open_authorized_source", side_effect=self.open_source).start()
        self.cache = ContactSourceCache()
        self.sources = []

    def tearDown(self):
        self.cache.clear()
        patch.stopall()
        self.temp.cleanup()

    def contact_bytes(self, nickname):
        path = self.root / f"plain-{nickname}.db"
        connection = apsw.Connection(str(path))
        connection.execute("PRAGMA page_size=4096")
        connection.reserve_bytes("main", 80)
        connection.execute("VACUUM")
        connection.execute("CREATE TABLE contact(username TEXT PRIMARY KEY,nick_name TEXT,remark TEXT)")
        connection.execute("INSERT INTO contact VALUES('synthetic-self','Myself','')")
        connection.execute("INSERT INTO contact VALUES('synthetic-target',?,'')", (nickname,))
        connection.close()
        return path.read_bytes()

    def open_source(self, *, contacts_only):
        self.assertTrue(contacts_only)
        source = LocalDatabaseSource(self.account, self.key, dict(self.proof), None)
        source.login_processes = ((123, 55),)
        self.sources.append(source)
        return source

    def search(self, query="Au", **kwargs):
        return self.cache.run(lambda source: search_contacts_from_source(query, source), **kwargs)

    def test_reuses_only_contact_key_and_creates_fresh_verified_snapshot(self):
        first = self.search()
        credentials = self.cache._credentials
        self.assertEqual(self.search("aud")["contacts"], first["contacts"])
        self.open.assert_called_once_with(contacts_only=True)
        self.assertEqual(len(first["contacts"]), 1)
        self.assertTrue(all(source.closed and not source.keys for source in self.sources))
        self.assertGreaterEqual(self.login.call_count, 4)
        self.assertNotIn("synthetic", repr(credentials))
        self.assertFalse(hasattr(credentials, "master"))
        self.cache.clear()
        self.assertEqual(credentials.key, bytearray())
        self.assertEqual(credentials.proof, {})

    def test_new_committed_contact_wal_is_seen_without_scanning_keys_again(self):
        self.search()
        new_raw = self.contact_bytes("NewAudrey")
        frames = [(offset // 4096 + 1, len(new_raw) // 4096 if offset + 4096 == len(new_raw) else 0,
                   encrypt_page(new_raw[offset:offset+4096], offset // 4096 + 1, self.key, self.salt))
                  for offset in range(0, len(new_raw), 4096)]
        Path(str(self.db) + "-wal").write_bytes(wal_bytes(frames))
        result = self.search("NewAud")
        self.assertEqual(result["contacts"][0]["nickname"], "NewAudrey")
        self.assertEqual(self.open.call_count, 1)
        corrupted = bytearray(Path(str(self.db) + "-wal").read_bytes())
        corrupted[100] ^= 1
        Path(str(self.db) + "-wal").write_bytes(corrupted)
        with self.assertRaises(BackgroundCaptureError) as error:
            self.search()
        self.assertEqual(error.exception.code, "DATABASE_INTEGRITY")
        self.assertIsNone(self.cache._credentials)

    def test_changed_login_or_process_set_fails_closed_and_clears_key(self):
        for mode in ("login", "process"):
            self.login.side_effect = None
            self.processes.return_value = [(123, 55)]
            self.search()
            credentials = self.cache._credentials
            if mode == "login":
                self.login.side_effect = BackgroundCaptureError("ACCOUNT_CHANGED", "synthetic account changed")
            else:
                self.processes.return_value = [(123, 55), (456, 66)]
            with self.assertRaises(BackgroundCaptureError):
                self.search()
            self.assertIsNone(self.cache._credentials)
            self.assertFalse(credentials.key)

    def test_expiry_automatically_drops_credentials_and_refresh_reopens(self):
        self.cache.TTL_SECONDS = .03
        self.search()
        credentials = self.cache._credentials
        threading.Event().wait(.1)
        self.assertIsNone(self.cache._credentials)
        self.assertFalse(credentials.key)
        self.cache.TTL_SECONDS = 120
        self.search()
        self.search(refresh=True)
        self.assertEqual(self.open.call_count, 3)

    def test_revoke_during_query_rejects_result_without_blocking_bridge(self):
        self.search()
        def read(source):
            result = search_contacts_from_source("Au", source)
            self.cache.clear()
            return result
        with self.assertRaises(BackgroundCaptureError) as error:
            self.cache.run(read)
        self.assertEqual(error.exception.code, "CONTACT_SEARCH_REVOKED")
        self.assertIsNone(self.cache._credentials)
        self.cache._operation.acquire()
        try:
            state = CollectorState(health_provider=lambda: {"ready": True})
            state.contact_cache = self.cache
            started = time.monotonic()
            state.health()
            state.rotate()
            self.assertLess(time.monotonic() - started, 1)
            with self.assertRaises(BackgroundCaptureError) as error:
                self.search()
            self.assertEqual(error.exception.code, "CONTACT_SEARCH_BUSY")
        finally:
            self.cache._operation.release()

    def test_contact_only_header_discovery_does_not_visit_message_directory(self):
        original = Path.glob
        def guarded_glob(path, pattern):
            if path.name == "message":
                self.fail("contact search traversed message shards")
            return original(path, pattern)
        with patch.object(Path, "glob", guarded_glob):
            files = _needed_database_files(self.account, contacts_only=True)
        self.assertEqual([row[0] for row in files], ["contact/contact.db"])


if __name__ == "__main__":
    unittest.main()
