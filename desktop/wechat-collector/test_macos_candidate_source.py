"""Generated encrypted fixtures only; never launches or opens real WeChat."""
from contextlib import ExitStack, redirect_stderr, redirect_stdout
import hashlib
import io
import json
import os
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import Mock, patch

import apsw
import macos_candidate_source as candidate
import macos_candidate_device_runtime as device
import macos_candidate_runtime as runtime
from test_local_database_source import encrypt_database


class EncryptedSelectedHistoryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="chengzi-candidate-synthetic-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.account = self.root / "synthetic_owner_123"
        self.master = hashlib.sha256(b"synthetic master").digest()
        self.scope = Mock()
        self.created = []
        self.addCleanup(self.close_sources)
        self.uid = patch.object(os, "getuid", return_value=self.root.stat().st_uid, create=True)
        self.uid.start()
        self.addCleanup(self.uid.stop)
        self.make_db("contact/contact.db", [
            ("CREATE TABLE contact(username TEXT,nick_name TEXT,remark TEXT,alias TEXT)", ()),
            ("INSERT INTO contact VALUES(?,?,?,?)", ("synthetic_owner", "Owner", "", "owner-alias")),
            ("INSERT INTO contact VALUES(?,?,?,?)", ("synthetic_target", "Same display", "", "target-alias")),
            ("INSERT INTO contact VALUES(?,?,?,?)", ("synthetic_other", "Same display", "", "other-alias"))])
        table = "Msg_" + hashlib.md5(b"synthetic_target").hexdigest()
        other = "Msg_" + hashlib.md5(b"synthetic_other").hexdigest()
        for shard in range(2):
            sql = [("CREATE TABLE Name2Id(user_name TEXT)", ()),
                   ("INSERT INTO Name2Id(rowid,user_name) VALUES(?,?)", (1, "synthetic_owner")),
                   ("INSERT INTO Name2Id(rowid,user_name) VALUES(?,?)", (2, "synthetic_target")),
                   (f"CREATE TABLE {table}(local_id INTEGER,server_id INTEGER,local_type INTEGER,real_sender_id INTEGER,create_time INTEGER,sort_seq INTEGER,message_content,compress_content)", ()),
                   (f"CREATE TABLE {other}(secret TEXT)", ()),
                   (f"INSERT INTO {other} VALUES(?)", ("unselected secret",))]
            for index in range(7):
                seq = index * 2 + shard
                sql.append((f"INSERT INTO {table} VALUES(?,?,?,?,?,?,?,NULL)",
                            (index + 1, 100 + seq, 34 if seq == 13 else 1, 1 if seq % 2 else 2,
                             1750000000 + seq, seq, "private synthetic selected message")))
            self.make_db(f"message/message_{shard}.db", sql)

    def close_sources(self):
        for source in self.created:
            source.close()

    def make_db(self, relative, statements, key=None):
        plain = self.root / "generated.db"
        db = apsw.Connection(str(plain))
        db.execute("PRAGMA page_size=4096")
        db.reserve_bytes("main", 80)
        db.execute("VACUUM")
        for sql, args in statements:
            db.execute(sql, args)
        db.close()
        raw = plain.read_bytes()
        plain.unlink()
        target = self.account / "db_storage" / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        salt = hashlib.sha256(relative.encode()).digest()[:16]
        target.write_bytes(encrypt_database(raw, key or self.master, salt))
        return target

    def source(self, **kw):
        source = candidate.CandidateDatabaseSource(self.account, self.master, self.master, self.scope,
                                                   deadline=time.monotonic() + 10, **kw)
        self.created.append(source)
        return source

    def test_real_crypto_parser_multishard_paging_exact_target_and_no_new_files(self):
        before = {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in self.root.rglob("*") if p.is_file()}
        session = Mock()
        session.open_source.side_effect = self.source
        batches = []
        result = candidate.capture_selected_history(session, "synthetic_target", pages=6, page_size=3, on_batch=batches.append)
        self.assertEqual(result["messageCount"], 14)
        self.assertEqual(result["historyPageCount"], 5)
        self.assertTrue(result["historyComplete"])
        self.assertEqual(result["messageKinds"], {"text": 13, "other": 1})
        self.assertEqual(result["speakerCounts"], {"self": 7, "other": 7})
        self.assertEqual(result["mediaMessageCounts"], {"voice": 1})
        self.assertFalse(result["voiceAvailabilityChecked"])
        self.assertTrue(all(source.closed for source in self.created))
        records = [row for batch in batches for row in batch["records"]]
        self.assertTrue(all(row["source"]["sessionId"] == "synthetic_target" for row in records))
        self.assertEqual({row["senderRole"] for row in records}, {"self", "other"})
        self.assertTrue(all(row["source"]["senderVerified"] for row in records))
        public = json.dumps(result)
        for private in ("synthetic_target", "synthetic_owner", "private synthetic", self.master.hex(), "Same display"):
            self.assertNotIn(private, public)
        self.assertFalse(any("unselected secret" in json.dumps(batch) for batch in batches))
        after = {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in self.root.rglob("*") if p.is_file()}
        self.assertEqual(before, after)

    def test_bounded_pages_do_not_claim_complete(self):
        session = Mock()
        session.open_source.side_effect = self.source
        result = candidate.capture_selected_history(session, "synthetic_target", pages=2, page_size=3)
        self.assertEqual(result["messageCount"], 6)
        self.assertFalse(result["historyComplete"])

    def test_batch_callback_cannot_mutate_capture_completion_or_cursor(self):
        session = Mock()
        session.open_source.side_effect = self.source
        def mutate(batch):
            batch["history"].update(complete=True, nextCursor="invalid synthetic cursor")
            batch["records"].clear()
        result = candidate.capture_selected_history(session, "synthetic_target", pages=2, page_size=3, on_batch=mutate)
        self.assertEqual(result["messageCount"], 6)
        self.assertEqual(result["historyPageCount"], 2)
        self.assertFalse(result["historyComplete"])

    def test_exact_unique_public_alias_resolves_internal_id_without_nickname_guessing(self):
        session = Mock()
        session.open_source.side_effect = self.source
        result = candidate.capture_selected_history(session, "target-alias", pages=1, page_size=3, by_alias=True)
        self.assertEqual(result["messageCount"], 3)
        with self.assertRaisesRegex(candidate.probe.Rejected, "selected-contact-unverified"):
            candidate.selected_request(self.source(), "Same display", by_alias=True)

    def test_duplicate_public_alias_is_rejected(self):
        self.make_db("contact/contact.db", [
            ("CREATE TABLE contact(username TEXT,nick_name TEXT,remark TEXT,alias TEXT)", ()),
            ("INSERT INTO contact VALUES(?,?,?,?)", ("synthetic_owner", "Owner", "", "owner-alias")),
            ("INSERT INTO contact VALUES(?,?,?,?)", ("synthetic_target", "Same display", "", "duplicate-alias")),
            ("INSERT INTO contact VALUES(?,?,?,?)", ("synthetic_other", "Same display", "", "duplicate-alias"))])
        with self.assertRaisesRegex(candidate.probe.Rejected, "selected-contact-unverified"):
            candidate.selected_request(self.source(), "duplicate-alias", by_alias=True)

    def test_nocase_schema_cannot_loosen_exact_alias_or_username_selection(self):
        self.make_db("contact/contact.db", [
            ("CREATE TABLE contact(username TEXT COLLATE NOCASE,nick_name TEXT,remark TEXT,alias TEXT COLLATE NOCASE)", ()),
            ("INSERT INTO contact VALUES(?,?,?,?)", ("synthetic_owner", "Owner", "", "owner-alias")),
            ("INSERT INTO contact VALUES(?,?,?,?)", ("synthetic_target", "Target", "", "target-alias"))])
        source = self.source()
        for selector, by_alias in (("TARGET-ALIAS", True), ("SYNTHETIC_TARGET", False)):
            with self.assertRaisesRegex(candidate.probe.Rejected, "selected-contact-unverified"):
                candidate.selected_request(source, selector, by_alias=by_alias)

    def test_nocase_schema_cannot_loosen_self_account_membership(self):
        self.make_db("contact/contact.db", [
            ("CREATE TABLE contact(username TEXT COLLATE NOCASE,nick_name TEXT,remark TEXT)", ()),
            ("INSERT INTO contact VALUES(?,?,?)", ("SYNTHETIC_OWNER", "Owner", ""))])
        with self.assertRaisesRegex(candidate.probe.Rejected, "source-self-identity-unverified"):
            self.source()

    def test_source_scope_work_crossing_deadline_is_rejected(self):
        source = self.source()
        now = [0]
        source.deadline = 1
        def delayed_header(*args):
            now[0] = 2
            return b"synthetic header"
        with patch.object(candidate.time, "monotonic", side_effect=lambda: now[0]), \
                patch.object(candidate, "_header", side_effect=delayed_header), \
                patch.object(candidate.primitive, "_verify_enc_key", return_value=True):
            with self.assertRaisesRegex(candidate.probe.Rejected, "source-grant-expired"):
                source._guard()

    def test_every_other_database_independently_requires_hmac(self):
        path = self.account / "db_storage/message/message_1.db"
        raw = bytearray(path.read_bytes())
        raw[40] ^= 1
        path.write_bytes(raw)
        session = Mock()
        session.open_source.side_effect = self.source
        with self.assertRaisesRegex(candidate.probe.Rejected, "source-database-key-unavailable"):
            candidate.capture_selected_history(session, "synthetic_target")
        self.assertTrue(self.created[0].closed)

    def test_same_master_can_derive_different_salt_database_key(self):
        from sqlcipher_primitives import _pbkdf2
        relative = "sns/sns.db"
        salt = hashlib.sha256(relative.encode()).digest()[:16]
        page_key = _pbkdf2(self.master, salt, 256000)
        self.make_db(relative, [("CREATE TABLE sample(value INTEGER)", ()), ("INSERT INTO sample VALUES(17)", ())], page_key)
        source = self.source()
        self.assertEqual(list(source.open_database(relative).execute("SELECT value FROM sample")), [(17,)])
        self.assertNotEqual(source.keys[relative], source.master)
        source.assert_unchanged()

    def test_process_or_account_change_prevents_publication_and_closes_all_sources(self):
        session = Mock()
        session.open_source.side_effect = self.source
        session.verify_scope.side_effect = candidate.probe.Rejected("active-account-changed")
        publish = Mock()
        with self.assertRaisesRegex(candidate.probe.Rejected, "active-account-changed"):
            candidate.capture_selected_history(session, "synthetic_target", on_batch=publish)
        publish.assert_not_called()
        self.assertTrue(all(source.closed for source in self.created))

    def test_selected_self_group_missing_id_never_reads_history(self):
        for contact in ("synthetic_owner", "group@chatroom", "missing_target"):
            source = self.source()
            with self.assertRaises(candidate.probe.Rejected), patch.object(source, "message_shards") as shards:
                candidate.selected_request(source, contact)
            shards.assert_not_called()

    def test_contact_hmac_rotation_and_deadline_revoke_existing_source(self):
        source = self.source()
        first = self.account / "db_storage/contact/contact.db"
        raw = bytearray(first.read_bytes())
        raw[100] ^= 1
        first.write_bytes(raw)
        with self.assertRaisesRegex(candidate.probe.Rejected, "source-account-key-changed"):
            source.assert_unchanged()
        source.deadline = 0
        with self.assertRaisesRegex(candidate.probe.Rejected, "source-grant-expired"):
            source.contacts()

    def test_readonly_vfs_refuses_mutation_and_close_wipes_owned_key_buffers(self):
        source = self.source()
        with self.assertRaises(apsw.ReadOnlyError):
            source.contacts().execute("DELETE FROM contact")
        borrowed = list(source._owned_keys)
        source.close()
        self.assertTrue(all(not key for key in borrowed))
        self.assertFalse(source.snapshots or source.keys or source.connections)

    def test_page_and_wal_bounds_and_equivalent_reopen_disabled(self):
        source = self.source()
        self.assertTrue(all(snapshot.budget is source._budget for snapshot in source.snapshots.values()))
        with patch.object(candidate, "MAX_QUERY_PAGES", source._budget[0]):
            with self.assertRaisesRegex(candidate.probe.Rejected, "source-query-page-bound"):
                list(source.message_shards())
        with patch.object(candidate, "MAX_WAL_BYTES", -1):
            wal = Path(str(self.account / "db_storage/message/message_0.db") + "-wal")
            wal.write_bytes(b"bounded synthetic WAL")
            with self.assertRaises(candidate.probe.Rejected):
                list(source.message_shards())

    def test_path_redirection_and_arbitrary_database_names_rejected(self):
        source = self.source()
        for relative in ("../contact/contact.db", "message/../../other.db", "other/private.db"):
            with self.assertRaisesRegex(candidate.probe.Rejected, "source-database-type-rejected"):
                source.open_database(relative)


class SessionLifecycleTests(unittest.TestCase):
    def waiting_session(self):
        session = candidate.CandidateSession(Path("receipt"))
        session.shadow = Path("synthetic-candidate").absolute()
        session.debug, session.key, session.watcher, session.channel, session.reader = (Mock() for _ in range(5))
        session.watcher.poll.return_value = None
        session.debug._exact_process_pids.return_value = [100]
        session.deadline = time.monotonic() + 10
        return session

    def test_generation_is_bound_before_active_account_is_ready(self):
        session = self.waiting_session()
        session.key.process_identity.side_effect = [(os.fsencode(session.executable.resolve()), 1, 2),
                                                   (os.fsencode(session.executable.resolve()), 3, 4)]
        with patch.object(candidate.probe, "process_account", side_effect=candidate.probe.Rejected("active-account-not-ready")), \
                patch.object(candidate.time, "sleep"):
            with self.assertRaisesRegex(candidate.probe.Rejected, "candidate-generation-changed"):
                session._authenticate()

    def test_account_is_bound_before_contact_database_is_ready(self):
        session = self.waiting_session()
        identity = (os.fsencode(session.executable.resolve()), 1, 2)
        session.key.process_identity.return_value = identity
        expected = (100, identity, Path("/synthetic-account-a"))
        def account(*args, expected=None):
            if expected is None:
                return (100, identity, Path("/synthetic-account-a"))
            self.assertEqual(expected, session.proof)
            raise candidate.probe.Rejected("active-account-changed")
        with patch.object(candidate.probe, "process_account", side_effect=account), \
                patch.object(candidate.probe, "contact_header", side_effect=candidate.probe.Rejected("contact-database-not-ready")), \
                patch.object(candidate.time, "sleep"):
            with self.assertRaisesRegex(candidate.probe.Rejected, "active-account-changed"):
                session._authenticate()
        self.assertEqual(session.proof, expected)

    def setup_mock(self, stack, *, fail_auth=False, cleanup=True, restore=True):
        work, shadow = Path("/private/synthetic"), Path("/private/synthetic/Candidate.app")
        debug, capture, key, channel, watcher = Mock(), Mock(), Mock(), Mock(), Mock()
        key.debug_copy_bundle_is_running.return_value = False
        key.launch_debug_copy_watchdog.return_value = watcher
        key.request_debug_copy_watchdog_cleanup.return_value = cleanup
        key.cleanup_debug_copy_bundle.return_value = cleanup
        watcher.poll.return_value = None
        channel.close.return_value = cleanup
        stack.enter_context(patch.object(candidate.sys, "platform", "darwin"))
        stack.enter_context(patch.object(candidate.platform, "machine", return_value="arm64"))
        stack.enter_context(patch.object(candidate, "_disable_core_dumps"))
        stack.enter_context(patch.object(candidate.probe, "check_dependencies"))
        stack.enter_context(patch.object(device, "_sip_state", return_value="enabled"))
        stack.enter_context(patch.object(device, "_load_receipt", return_value=(work, shadow, b"d" * 32)))
        stack.enter_context(patch.object(device, "_load_modules", return_value=(debug, capture, key)))
        verify = stack.enter_context(patch.object(device, "_verify", return_value={"originalUnchangedVerified": True}))
        stack.enter_context(patch.object(device, "_original_is_closed"))
        original = stack.enter_context(patch.object(device, "_restore_original", return_value=restore))
        stack.enter_context(patch.object(runtime, "_new_channel", return_value=channel))
        def auth(owner):
            owner.master.extend(b"m" * 32)
            owner.contact_key.extend(b"c" * 32)
            owner.status["candidateAuthenticated"] = True
            if fail_auth:
                raise candidate.probe.Rejected("synthetic-auth-failed")
        stack.enter_context(patch.object(candidate.CandidateSession, "_authenticate", auth))
        return debug, key, channel, watcher, original, verify

    def test_grant_never_hands_private_pid_to_original_and_closes_sources_before_cleanup(self):
        with ExitStack() as stack:
            debug, key, channel, watcher, original, verify = self.setup_mock(stack)
            session = candidate.CandidateSession(Path("receipt"))
            source = Mock()
            def clean(_):
                self.assertTrue(source.close.called)
                self.assertFalse(session.master or session.contact_key)
                original.assert_not_called()
                return True
            key.request_debug_copy_watchdog_cleanup.side_effect = clean
            with session:
                session.sources.append(source)
                original.assert_not_called()
            self.assertTrue(session.status["originalRestored"])
            self.assertTrue(session.status["ownedCandidateBuffersCleared"])
            self.assertEqual(verify.call_count, 2)
            self.assertIsNone(session.proof)
            debug._release_launch_lock.assert_called_once()
            self.assertFalse(session.status["productionAuthorizationChanged"])

    def test_failed_authentication_still_cleans_and_restores(self):
        with ExitStack() as stack:
            _, key, channel, _, original, _ = self.setup_mock(stack, fail_auth=True)
            session = candidate.CandidateSession(Path("receipt"))
            with self.assertRaisesRegex(candidate.probe.Rejected, "synthetic-auth-failed"):
                session.__enter__()
            self.assertTrue(session.status["ownedCandidateBuffersCleared"])
            original.assert_called_once()
            key.cleanup_debug_copy_bundle.assert_called_once()
            channel.close.assert_called_once()

    def test_cleanup_failure_does_not_restore_or_report_success(self):
        with ExitStack() as stack:
            _, _, _, _, original, _ = self.setup_mock(stack, cleanup=False)
            session = candidate.CandidateSession(Path("receipt"))
            with self.assertRaisesRegex(candidate.probe.Rejected, "source-cleanup-or-restore-failed"):
                with session:
                    pass
            original.assert_not_called()
            self.assertFalse(session.status["runtimeCleanupComplete"])

    def test_restore_failure_is_not_success(self):
        with ExitStack() as stack:
            self.setup_mock(stack, restore=False)
            session = candidate.CandidateSession(Path("receipt"))
            with self.assertRaisesRegex(candidate.probe.Rejected, "source-cleanup-or-restore-failed"):
                with session:
                    pass

    def test_dependency_failure_never_loads_receipt_or_launches(self):
        with patch.object(candidate.sys, "platform", "darwin"), patch.object(candidate.platform, "machine", return_value="arm64"), \
                patch.object(candidate, "_disable_core_dumps"), \
                patch.object(candidate.probe, "check_dependencies", side_effect=candidate.probe.Rejected("dependency-version-mismatch-apsw")), \
                patch.object(device, "_load_receipt") as receipt:
            result = candidate.run(Path("receipt"), "synthetic_target")
        self.assertFalse(result["ok"])
        receipt.assert_not_called()
        self.assertNotIn("synthetic_target", json.dumps(result))

    def test_version_or_receipt_integrity_rejection_never_launches(self):
        with ExitStack() as stack:
            _, key, _, _, original, verify = self.setup_mock(stack)
            verify.side_effect = runtime.DiagnosticError("candidate-public-binaries-not-matched")
            session = candidate.CandidateSession(Path("receipt"))
            with self.assertRaises(runtime.DiagnosticError):
                session.__enter__()
            key.launch_debug_copy_watchdog.assert_not_called()
            original.assert_not_called()

    def test_generic_exception_text_is_not_serialized(self):
        private = "private account path /private/synthetic/private-key-012345"
        with patch.object(candidate.CandidateSession, "__enter__", side_effect=RuntimeError(private)):
            result = candidate.run(Path("receipt"), "synthetic_target")
        self.assertFalse(result["ok"])
        self.assertEqual(result["reason"], "source-private-test-failed")
        self.assertNotIn(private, json.dumps(result))

    def test_invalid_cli_arguments_never_echo_private_values(self):
        output, errors = io.StringIO(), io.StringIO()
        argv = ["candidate-source", "--receipt", "/private/synthetic/receipt", "--contact-alias", "synthetic-private-alias",
                "--start", "--restore-original", "--unknown-option", "synthetic-private-extra"]
        with patch.object(candidate.sys, "argv", argv), redirect_stdout(output), redirect_stderr(errors):
            with self.assertRaisesRegex(candidate.probe.Rejected, "source-arguments-rejected"):
                candidate.main()
        self.assertFalse(output.getvalue() or errors.getvalue())

    def test_exact_ui_generation_callback_rejects_same_pid_new_start_time(self):
        from macos_album_snapshot import Generation
        session = candidate.CandidateSession(Path("receipt"))
        session.proof = (101, (b"/private/synthetic/WeChat", 1750000000, 123456), Path("/synthetic_account"))
        with patch.object(session, "verify_scope"), patch.object(os, "getuid", return_value=501, create=True):
            session.verify_ui_generation(Generation(101, 501, 1750000000, 123456))
            for wrong in (Generation(101, 501, 1750000000, 123457), Generation(101, 502, 1750000000, 123456)):
                with self.assertRaisesRegex(candidate.probe.Rejected, "source-ui-generation-changed"):
                    session.verify_ui_generation(wrong)

    def test_session_native_scope_work_crossing_deadline_is_rejected(self):
        session = self.waiting_session()
        session.reader.pending = []
        session.contact_key = bytearray(b"x" * 32)
        session.proof = (100, (os.fsencode(session.executable.resolve()), 1, 2), Path("/synthetic-account"))
        session.deadline = 1
        now = [0]
        def delayed_proof(*args, **kwargs):
            now[0] = 2
        with patch.object(candidate.time, "monotonic", side_effect=lambda: now[0]), \
                patch.object(device, "_original_is_closed"), \
                patch.object(candidate.probe, "process_account", side_effect=delayed_proof), \
                patch.object(candidate.probe, "contact_header", return_value=(Path("/synthetic"), b"header")), \
                patch.object(candidate.primitive, "_verify_enc_key", return_value=True):
            with self.assertRaisesRegex(candidate.probe.Rejected, "source-grant-expired"):
                session.verify_scope()


if __name__ == "__main__":
    unittest.main()
