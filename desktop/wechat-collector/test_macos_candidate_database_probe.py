"""Synthetic-only crypto/VFS and lifecycle checks; never opens real WeChat."""
import hashlib
import json
import os
from pathlib import Path
import struct
import tempfile
import time
import unittest
from contextlib import ExitStack
from unittest.mock import Mock, patch

import apsw
import macos_candidate_database_probe as probe
import sqlcipher_primitives as primitive
from test_local_database_source import encrypt_database, wal_bytes


def event(code, detail=0):
    return b"WXS1" + bytes([code]) + struct.pack("<I", detail) + b"\0" * 7


class CandidateParserTests(unittest.TestCase):
    def test_fragmented_frames_deduplicate_and_clear_buffers(self):
        value = hashlib.sha256(b"synthetic candidate").digest()
        stream = event(1) + event(2, 1) + b"WXK1" + value + b"WXK1" + value
        reader = probe.CandidateReader()
        for offset in range(0, len(stream), 7):
            reader.feed(stream[offset:offset + 7])
        self.assertEqual(reader.frames, 2)
        self.assertEqual(len(reader.pending), 1)
        borrowed = reader.pending[0]
        public = json.dumps(reader.aggregate())
        self.assertNotIn(value.hex(), public)
        reader.close()
        self.assertEqual(borrowed, bytearray())
        self.assertFalse(reader.buffer or reader.pending)

    def test_unknown_event_and_malformed_magic_reject(self):
        for raw in (b"XXXX", event(99), event(2, 0), event(5), event(9), event(1)[:-1] + b"x"):
            reader = probe.CandidateReader()
            try:
                with self.assertRaises(probe.Rejected):
                    reader.feed(raw)
            finally:
                reader.close()

    def test_candidate_and_buffer_bounds(self):
        reader = probe.CandidateReader()
        try:
            for index in range(probe.MAX_CANDIDATES):
                reader.feed(b"WXK1" + hashlib.sha256(str(index).encode()).digest())
            with self.assertRaises(probe.Rejected):
                reader.feed(b"WXK1" + hashlib.sha256(b"overflow").digest())
        finally:
            reader.close()
        reader = probe.CandidateReader()
        try:
            with self.assertRaises(probe.Rejected):
                reader.feed(b"x" * 65537)
        finally:
            reader.close()

    def test_authenticate_wrong_and_right_candidate_in_memory(self):
        reader = probe.CandidateReader()
        good = hashlib.sha256(b"valid synthetic key").digest()
        reader.feed(b"WXK1" + b"x" * 32 + b"WXK1" + good)
        mock = Mock()
        mock.effective_page_key.side_effect = lambda key, page: key if key == good else None
        result = probe.authenticate(reader, b"encrypted synthetic page", mock,
                                    deadline=time.monotonic() + 2)
        self.assertEqual(result, bytearray(good))
        result[:] = b"\0" * len(result)
        reader.close()

    def test_expired_authentication_does_not_call_crypto(self):
        reader = probe.CandidateReader()
        reader.feed(b"WXK1" + b"x" * 32)
        mock = Mock()
        try:
            with self.assertRaises(probe.Rejected):
                probe.authenticate(reader, b"header", mock, deadline=0)
            mock.effective_page_key.assert_not_called()
        finally:
            reader.close()

    def test_same_header_tests_only_new_candidates(self):
        reader = probe.CandidateReader()
        reader.feed(b"WXK1" + b"a" * 32 + b"WXK1" + b"b" * 32)
        mock = Mock()
        mock.effective_page_key.return_value = None
        try:
            self.assertIsNone(probe.authenticate(reader, b"header", mock,
                start=1, deadline=time.monotonic() + 2))
            self.assertEqual(mock.effective_page_key.call_count, 1)
            self.assertEqual(mock.effective_page_key.call_args.args[0], b"b" * 32)
        finally:
            reader.close()

    def test_crypto_result_after_acceptance_deadline_is_rejected(self):
        for returned in (b"b" * 32, None):
            with self.subTest(valid_key=returned is not None):
                reader, crypto, now = probe.CandidateReader(), Mock(), [0]
                reader.feed(b"WXK1" + b"a" * 32)
                def slow_crypto(*args):
                    now[0] = 2
                    return returned
                crypto.effective_page_key.side_effect = slow_crypto
                try:
                    with self.assertRaisesRegex(probe.Rejected, "candidate-authentication-timeout"):
                        probe.authenticate(reader, b"header", crypto, deadline=1, clock=lambda: now[0])
                    crypto.effective_page_key.assert_called_once()
                finally:
                    reader.close()


class ContactCountTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="chengzi-synthetic-contact-probe-")
        self.root = Path(self.temp.name).resolve()
        self.account = self.root / "account-synthetic"
        (self.account / "db_storage/contact").mkdir(parents=True)
        self.path = self.account / "db_storage/contact/contact.db"
        plain = self.root / "synthetic-plain.db"
        db = apsw.Connection(str(plain))
        db.execute("PRAGMA page_size=4096")
        db.reserve_bytes("main", 80)
        db.execute("VACUUM")
        db.execute("CREATE TABLE contact(username TEXT, remark TEXT)")
        db.executemany("INSERT INTO contact VALUES(?,?)", [(f"synthetic-{i}", "private synthetic text") for i in range(23)])
        db.close()
        self.key = hashlib.sha256(b"contact probe synthetic key").digest()
        self.salt = hashlib.sha256(b"contact probe synthetic salt").digest()[:16]
        self.path.write_bytes(encrypt_database(plain.read_bytes(), self.key, self.salt))
        self.scope = Mock()
        self.uid_patch = patch.object(os, "getuid", return_value=self.path.stat().st_uid, create=True)
        self.uid_patch.start()

    def tearDown(self):
        self.uid_patch.stop()
        self.temp.cleanup()

    def query(self, key=None, **kwargs):
        return probe.count_contact_rows(self.path, self.key if key is None else key,
            deadline=time.monotonic() + 5, verify_scope=self.scope, **kwargs)

    def test_real_authenticated_count_no_new_files_or_modified_bytes(self):
        before = {str(p.relative_to(self.root)): hashlib.sha256(p.read_bytes()).hexdigest()
                  for p in self.root.rglob("*") if p.is_file()}
        result = self.query()
        after = {str(p.relative_to(self.root)): hashlib.sha256(p.read_bytes()).hexdigest()
                 for p in self.root.rglob("*") if p.is_file()}
        self.assertEqual(result["contactRows"], 23)
        self.assertTrue(result["databaseReadOnlyValidated"])
        self.assertGreater(result["consumedPageCount"], 0)
        self.assertEqual(before, after)
        self.assertEqual(self.scope.call_count, 2)
        self.assertNotIn("synthetic-", json.dumps(result))
        self.assertNotIn("private synthetic text", json.dumps(result))

    def test_real_header_authentication_then_count(self):
        with patch.object(os, "getuid", return_value=self.path.stat().st_uid, create=True):
            path, first = probe.contact_header(self.account)
        self.assertEqual(path, self.path)
        key = primitive.effective_page_key(self.key, first)
        self.assertEqual(self.query(key)["contactRows"], 23)

    def test_wrong_key_rejected(self):
        with self.assertRaises(Exception):
            self.query(b"x" * 32)

    def test_changed_scope_invalidates_count(self):
        self.scope.side_effect = [None, probe.Rejected("active-account-changed")]
        with self.assertRaisesRegex(probe.Rejected, "active-account-changed"):
            self.query()

    def test_count_bound_rejected(self):
        with patch.object(probe, "MAX_CONTACT_ROWS", 10):
            with self.assertRaisesRegex(probe.Rejected, "contact-row-count-rejected"):
                self.query()

    def test_page_budget_rejected(self):
        with patch.object(probe, "MAX_QUERY_PAGES", 1):
            with self.assertRaises(probe.Rejected):
                self.query()

    def test_current_descriptor_mapping_only(self):
        self.assertEqual(probe.account_for_open_path(str(self.path), (self.root,)), self.account)
        self.assertIsNone(probe.account_for_open_path(str(self.root / "unrelated.db"), (self.root,)))
        self.assertIsNone(probe.account_for_open_path("relative/db_storage/contact/contact.db", (self.root,)))

    def test_modified_encrypted_page_rejected(self):
        data = bytearray(self.path.read_bytes())
        data[4096 + 20] ^= 1
        self.path.write_bytes(data)
        with self.assertRaises(Exception):
            self.query()

    def test_expired_query_never_returns_counts(self):
        with self.assertRaises(probe.Rejected):
            probe.count_contact_rows(self.path, self.key, deadline=0, verify_scope=self.scope)

    def test_captured_oversize_wal_rejects_before_parent_index(self):
        import local_database_source as source
        original_stat = source._stat
        def captured(path):
            if str(path).endswith("-wal"):
                return probe.MAX_WAL_BYTES + 1, 0, 0, 0
            return original_stat(path)
        with patch.object(source, "_stat", side_effect=captured), \
             patch.object(source.EncryptedSnapshot, "_index_wal") as index:
            with self.assertRaisesRegex(probe.Rejected, "contact-snapshot-size-bound"):
                self.query()
            index.assert_not_called()

    def test_captured_oversize_main_rejects_before_parent_index(self):
        import local_database_source as source
        original_stat = source._stat
        def captured(path):
            value = original_stat(path)
            if Path(path) == self.path:
                return probe.MAX_DB_BYTES + 4096, *value[1:]
            return value
        with patch.object(source, "_stat", side_effect=captured), \
             patch.object(source.EncryptedSnapshot, "_index_wal") as index:
            with self.assertRaisesRegex(probe.Rejected, "contact-snapshot-size-bound"):
                self.query()
            index.assert_not_called()

    def test_constructor_and_final_checks_disable_equivalent_reopen(self):
        import local_database_source as source
        original = source.EncryptedSnapshot.assert_unchanged
        calls = []
        def checked(snapshot, *, allow_equivalent=True):
            calls.append(allow_equivalent)
            return original(snapshot, allow_equivalent=allow_equivalent)
        with patch.object(source.EncryptedSnapshot, "assert_unchanged", checked):
            self.assertEqual(self.query()["contactRows"], 23)
        self.assertGreaterEqual(len(calls), 2)
        self.assertTrue(all(value is False for value in calls))

    def test_wal_index_over_result_deadline_never_opens_sqlite(self):
        import local_database_source as source
        now = [0]
        def delayed_index(snapshot):
            now[0] = 2
        with patch.object(source.EncryptedSnapshot, "_index_wal", delayed_index), \
             patch.object(source, "open_encrypted_connection") as opened:
            with self.assertRaisesRegex(probe.Rejected, "contact-query-timeout"):
                probe.count_contact_rows(self.path, self.key, deadline=1,
                    verify_scope=self.scope, clock=lambda: now[0])
            opened.assert_not_called()

    def test_real_authenticated_wal_count(self):
        encrypted = self.path.read_bytes()
        pages = len(encrypted) // 4096
        wal_path = Path(str(self.path) + "-wal")
        wal_path.write_bytes(wal_bytes([(pages, pages, encrypted[-4096:])]))
        before = hashlib.sha256(wal_path.read_bytes()).hexdigest()
        self.assertEqual(self.query()["contactRows"], 23)
        self.assertEqual(hashlib.sha256(wal_path.read_bytes()).hexdigest(), before)


class LifecycleTests(unittest.TestCase):
    def test_generation_is_bound_before_account_database_ready(self):
        shadow = Path("synthetic-candidate").absolute()
        executable = shadow / "Contents/MacOS/WeChat"
        debug, key, watcher, channel, reader = (Mock() for _ in range(5))
        debug._exact_process_pids.return_value = [100]
        key.process_identity.side_effect = [(os.fsencode(executable.resolve()), 1, 2),
                                           (os.fsencode(executable.resolve()), 3, 4)]
        watcher.poll.return_value = None
        with patch.object(probe, "process_account", side_effect=probe.Rejected("active-account-not-ready")), \
             patch.object(probe.time, "sleep"):
            with self.assertRaisesRegex(probe.Rejected, "candidate-generation-changed"):
                probe.observe_database(shadow, debug, key, watcher, channel, reader, {}, 30)
        self.assertEqual(key.process_identity.call_count, 2)

    def test_account_is_bound_while_contact_database_is_not_ready(self):
        shadow = Path("synthetic-candidate").absolute()
        executable = shadow / "Contents/MacOS/WeChat"
        debug, key, watcher, channel, reader = (Mock() for _ in range(5))
        debug._exact_process_pids.return_value = [100]
        identity = (os.fsencode(executable.resolve()), 1, 2)
        key.process_identity.return_value = identity
        watcher.poll.return_value = None
        first = (100, identity, Path("synthetic-account-a"))
        def account(*args, expected=None, **kwargs):
            if expected is None:
                return first
            self.assertEqual(expected, first)
            raise probe.Rejected("active-account-changed")
        with patch.object(probe, "process_account", side_effect=account) as proof, \
             patch.object(probe, "contact_header", side_effect=probe.Rejected("contact-database-not-ready")), \
             patch.object(probe.time, "sleep"):
            with self.assertRaisesRegex(probe.Rejected, "active-account-changed"):
                probe.observe_database(shadow, debug, key, watcher, channel, reader, {}, 30)
        self.assertEqual(proof.call_count, 2)
        self.assertEqual(proof.call_args.kwargs["expected"], first)

    def run_mock(self, *, query_error=False, cleanup_success=True, restore_success=True):
        import macos_candidate_device_runtime as device
        import macos_candidate_runtime as runtime
        debug, capture, key, channel = (Mock() for _ in range(4))
        capture.ensure_capture_library.return_value = Path("synthetic-observer")
        capture.validate_capture_fifo.return_value = True
        key.ensure_helper.return_value = Path("synthetic-identity-helper")
        key.debug_copy_bundle_is_running.return_value = False
        key.request_debug_copy_watchdog_cleanup.return_value = cleanup_success
        key.cleanup_debug_copy_bundle.return_value = cleanup_success
        channel.close.return_value = True
        source = Path("synthetic-private-work").absolute()
        def observed(*args):
            args[6].update(candidateAuthenticated=True, databaseReadOnlyValidated=True, contactRows=23)
            if query_error:
                raise probe.Rejected("active-account-changed")
        with ExitStack() as stack:
            stack.enter_context(patch.object(probe.sys, "platform", "darwin"))
            stack.enter_context(patch.object(probe.platform, "machine", return_value="arm64"))
            stack.enter_context(patch.object(probe, "check_dependencies", return_value={}))
            stack.enter_context(patch.object(device, "_sip_state", return_value="enabled"))
            stack.enter_context(patch.object(device, "_load_receipt", return_value=(source, source / "Candidate.app", b"digest")))
            stack.enter_context(patch.object(device, "_load_modules", return_value=(debug, capture, key)))
            stack.enter_context(patch.object(device, "_verify", return_value={"originalUnchangedVerified": True}))
            stack.enter_context(patch.object(device, "_original_is_closed"))
            restore = stack.enter_context(patch.object(device, "_restore_original", return_value=restore_success))
            stack.enter_context(patch.object(runtime, "_new_channel", return_value=channel))
            stack.enter_context(patch.object(probe, "observe_database", side_effect=observed))
            result = probe.run(source / "prepare-receipt.json", seconds=30)
        return result, restore, key, channel

    def test_validation_failure_still_closes_copy_fifo_and_restores_original(self):
        result, restore, key, channel = self.run_mock(query_error=True)
        self.assertFalse(result["ok"])
        self.assertEqual(result["reason"], "active-account-changed")
        self.assertTrue(result["originalRestored"])
        self.assertTrue(result["runtimeCleanupComplete"])
        self.assertTrue(result["ownedCandidateBuffersCleared"])
        restore.assert_called_once()
        key.cleanup_debug_copy_bundle.assert_called_once()
        channel.close.assert_called_once()

    def test_success_requires_restoration(self):
        result, _, _, _ = self.run_mock(restore_success=False)
        self.assertFalse(result["ok"])
        self.assertFalse(result["originalRestored"])

    def test_cleanup_failure_does_not_relaunch_original_or_report_success(self):
        result, restore, _, channel = self.run_mock(cleanup_success=False)
        self.assertFalse(result["ok"])
        self.assertFalse(result["runtimeCleanupComplete"])
        restore.assert_not_called()
        channel.close.assert_called_once()

    def test_dependency_failure_never_loads_or_starts_candidate(self):
        import macos_candidate_device_runtime as device
        with patch.object(probe.sys, "platform", "darwin"), \
             patch.object(probe.platform, "machine", return_value="arm64"), \
             patch.object(probe, "check_dependencies", side_effect=probe.Rejected("dependency-missing-apsw")), \
             patch.object(device, "_load_receipt") as load:
            result = probe.run(Path("synthetic-receipt"))
        self.assertFalse(result["ok"])
        self.assertEqual(result["reason"], "dependency-missing-apsw")
        load.assert_not_called()


if __name__ == "__main__":
    unittest.main()
