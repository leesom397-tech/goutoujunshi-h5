"""Synthetic encrypted account handoff; never launches or reads actual WeChat."""
from dataclasses import replace
import hashlib
import json
import os
from pathlib import Path
import pickle
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import apsw
from background_reader import BackgroundCaptureError
from macos_album_snapshot import Generation
from macos_candidate_source import CandidateSession, CandidateDatabaseSource
import macos_candidate_handoff as handoff
import macos_key_provider as provider
from test_local_database_source import encrypt_database


class HandoffTests(unittest.TestCase):
    def test_explicit_experimental_registration_is_separate_and_wipes_lease(self):
        _,lease=self.rebound()
        fake=SimpleNamespace(register_experimental_original=Mock(),get_authorized_key=Mock(return_value=self.master),
                             clear_experimental_authorization=Mock())
        result=lease.register_experimental_with_provider(fake,consent=True)
        self.assertTrue(result["providerRegistered"] and result["experimental"])
        self.assertFalse(result["realDeviceValidated"] or lease._master or lease._contact_key)
        fake.register_experimental_original.assert_called_once()
        self.assertEqual(fake.register_experimental_original.call_args.kwargs["expires"],self.session.deadline)
        fake.clear_experimental_authorization.assert_not_called()

    def test_experimental_registration_close_failure_revokes_only_experimental_state(self):
        _,lease=self.rebound()
        fake=SimpleNamespace(register_experimental_original=Mock(),get_authorized_key=Mock(return_value=self.master),
                             clear_experimental_authorization=Mock())
        with patch.object(lease,"close",side_effect=handoff.HandoffError("handoff-source-cleanup-failed")):
            with self.assertRaises(handoff.HandoffError):lease.register_experimental_with_provider(fake,consent=True)
        fake.clear_experimental_authorization.assert_called_once()
        self.assertFalse(lease.aggregate()["providerRegistered"])
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="chengzi-handoff-synthetic-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.account = self.root / "synthetic_owner_123"
        self.uid = patch.object(os, "getuid", return_value=self.root.stat().st_uid, create=True)
        self.uid.start()
        self.addCleanup(self.uid.stop)
        self.master = hashlib.sha256(b"synthetic handoff key only").digest()
        plain = self.root / "generated.sqlite"
        db = apsw.Connection(str(plain))
        db.execute("PRAGMA page_size=4096")
        db.reserve_bytes("main", 80)
        db.execute("VACUUM")
        db.execute("CREATE TABLE contact(username TEXT,nick_name TEXT,remark TEXT)")
        db.execute("INSERT INTO contact VALUES('synthetic_owner','Synthetic owner','')")
        db.close()
        self.contact = self.account / "db_storage/contact/contact.db"
        self.contact.parent.mkdir(parents=True)
        self.contact.write_bytes(encrypt_database(plain.read_bytes(), self.master, b"s" * 16))
        plain.unlink()
        self.clock_value = time.monotonic()
        self.clock = lambda: self.clock_value
        self.session = CandidateSession(Path("synthetic-receipt"))
        self.session.deadline = self.clock_value + 300
        self.session.digest = b"d" * 32
        self.session.master, self.session.contact_key = bytearray(self.master), bytearray(self.master)
        self.session.proof = (101, (b"/private/synthetic/Candidate.app/Contents/MacOS/WeChat", 100, 5), self.account)
        self.session.verify_scope = Mock()
        self.session.debug = Mock()
        self.session.key = Mock()
        self.session.shadow = Path("/private/synthetic/Candidate.app")
        self.session.status.update({name: True for name in ("candidateAuthenticated", "officialSignatureVerified",
            "copyIntegrityVerified", "productionPolicyUnchangedVerified", "originalUnchangedVerified")})
        self.created = []
        def open_source():
            source = CandidateDatabaseSource(self.account, self.master, self.master, self.session.verify_scope,
                                             deadline=self.session.deadline)
            self.created.append(source)
            self.session.sources.append(source)
            return source
        self.session.open_source = open_source
        self.original = handoff.OriginalProof(Generation(202, os.getuid(), 200, 8), self.account, handoff.EXPECTED_BUILD)
        self.verify = Mock(side_effect=lambda expected=None: self.original)
        self.leases = []
        self.addCleanup(self.cleanup)

    def cleanup(self):
        for lease in self.leases:
            lease.close()
        for source in self.created:
            source.close()

    def restored(self):
        for source in self.session.sources:
            source.close()
        self.session.sources.clear()
        self.session.master.clear()
        self.session.contact_key.clear()
        self.session.proof = None
        self.session.closed = True
        self.session.status.update(runtimeCleanupComplete=True, originalRestored=True, ownedCandidateBuffersCleared=True)

    def grant(self):
        return handoff.capture_handoff_grant(self.session, clock=self.clock)

    def rebound(self):
        grant = self.grant()
        self.restored()
        lease = handoff.rebind_after_restore(grant, _verifier=self.verify)
        self.leases.append(lease)
        return grant, lease

    def fake_provider(self):
        state = {"key": bytearray(), "payload": None, "expires": None}
        def receive(payload):
            state["key"].extend(payload.key)
            state["payload"], state["expires"] = payload, payload.expires
        def clear():
            state["key"].clear()
        fake = SimpleNamespace(_require_supported_bundle=Mock(return_value=handoff.EXPECTED_BUILD),
            WorkerAuthorization=provider.WorkerAuthorization, import_worker_authorization=Mock(side_effect=receive),
            get_authorized_key=Mock(side_effect=lambda account: bytes(state["key"])),
            clear_authorization=Mock(side_effect=clear))
        return fake, state

    def test_actual_hmac_readonly_vfs_rebinds_to_new_original_generation_and_same_self(self):
        before = hashlib.sha256(self.contact.read_bytes()).hexdigest()
        grant, lease = self.rebound()
        self.assertFalse(grant._master or grant._contact_key)
        self.assertEqual(lease.ui_generation(), self.original.generation)
        self.assertNotEqual(lease.ui_generation().pid, 101)
        source = lease.open_source()
        self.assertEqual(source.account_id, "synthetic_owner")
        self.assertEqual(list(source.contacts().execute("SELECT count(*) FROM contact")), [(1,)])
        with self.assertRaises(apsw.ReadOnlyError):
            source.contacts().execute("DELETE FROM contact")
        source.close()
        self.assertEqual(hashlib.sha256(self.contact.read_bytes()).hexdigest(), before)
        public = json.dumps(lease.aggregate())
        for private in (str(self.account), "synthetic_owner", self.master.hex()):
            self.assertNotIn(private, public)
            self.assertNotIn(private, repr(lease))
        self.assertFalse(lease.aggregate()["providerRegistered"] or lease.aggregate()["captureCompatibilityValidated"])

    def test_grant_can_be_minted_only_while_authenticated_candidate_is_live(self):
        self.session.status["candidateAuthenticated"] = False
        with self.assertRaisesRegex(handoff.HandoffError, "handoff-candidate-unverified"):
            self.grant()
        self.session.verify_scope.assert_called()

    def test_candidate_master_must_authenticate_exact_contact_page_before_grant(self):
        self.session.master[:] = b"x" * 32
        with self.assertRaisesRegex(handoff.HandoffError, "handoff-contact-hmac-failed"):
            self.grant()
        self.assertTrue(all(source.closed for source in self.created))

    def test_source_close_failure_also_wipes_unreturned_grant_buffers(self):
        create = self.session.open_source
        def source_with_close_failure():
            source = create()
            close = source.close
            calls = [0]
            def fail_once():
                close()
                calls[0] += 1
                if calls[0] == 1:
                    raise RuntimeError("synthetic-close-failed")
            source.close = fail_once
            return source
        self.session.open_source = source_with_close_failure
        closed = []
        close_grant = handoff.HandoffGrant.close
        def remember(grant):
            close_grant(grant)
            closed.append(grant)
        with patch.object(handoff.HandoffGrant, "close", remember), self.assertRaisesRegex(RuntimeError, "synthetic-close-failed"):
            self.grant()
        self.assertTrue(closed)
        self.assertTrue(all(not grant._master and not grant._contact_key for grant in closed))

    def test_rebound_lease_implements_existing_session_reader_scope_and_deadline(self):
        _, lease = self.rebound()
        lease.verify_scope()
        self.assertEqual(lease.deadline, self.session.deadline)
        with self.assertRaises(AttributeError):
            lease.deadline = lease.deadline + 100
        with patch.object(lease, "assert_current") as check:
            lease.verify_scope()
            check.assert_called_once()

    def test_restore_cleanup_failure_live_copy_or_uncleared_buffers_never_rebind(self):
        for change in ("cleanup", "restore", "buffers", "proof"):
            self.setUp()
            grant = self.grant()
            self.restored()
            if change == "cleanup": self.session.status["runtimeCleanupComplete"] = False
            if change == "restore": self.session.status["originalRestored"] = False
            if change == "buffers": self.session.master.extend(b"still-live")
            if change == "proof": self.session.proof = (101, None, self.account)
            with self.subTest(change=change), self.assertRaisesRegex(handoff.HandoffError, "handoff-original-restore-unverified"):
                handoff.rebind_after_restore(grant, _verifier=self.verify)
            self.assertFalse(grant._master or grant._contact_key)

    def test_grant_is_one_use_and_window_does_not_renew_absolute_deadline(self):
        grant, lease = self.rebound()
        self.assertEqual(lease._expires, self.session.deadline)
        with self.assertRaisesRegex(handoff.HandoffError, "handoff-grant-consumed"):
            handoff.rebind_after_restore(grant, _verifier=self.verify)
        self.clock_value = self.session.deadline
        with self.assertRaisesRegex(handoff.HandoffError, "handoff-lease-expired"):
            lease.assert_current()

    def test_expired_handoff_window_wipes_unconsumed_grant(self):
        grant = self.grant()
        self.restored()
        self.clock_value += handoff.HANDOFF_SECONDS + 1
        with self.assertRaisesRegex(handoff.HandoffError, "handoff-window-expired"):
            handoff.rebind_after_restore(grant, _verifier=self.verify)
        self.assertFalse(grant._master or grant._contact_key)

    def test_new_original_must_use_same_account_directory_and_build(self):
        for proof in (replace(self.original, account=self.root / "different_account"),
                      replace(self.original, build=("4.1.15", "270102"))):
            grant = self.grant()
            self.restored()
            with self.subTest(proof=repr(proof)), self.assertRaisesRegex(handoff.HandoffError, "handoff-original-account-changed"):
                handoff.rebind_after_restore(grant, _verifier=Mock(return_value=proof))
            break  # Each real grant is one-use; the build case has its own test below.

    def test_changed_original_build_rejected_even_if_account_same(self):
        grant = self.grant()
        self.restored()
        with self.assertRaisesRegex(handoff.HandoffError, "handoff-original-account-changed"):
            handoff.rebind_after_restore(grant, _verifier=Mock(return_value=replace(self.original, build=("4.1.15", "270102"))))

    def test_original_restart_or_uid_change_revokes_existing_lease(self):
        _, lease = self.rebound()
        self.original = replace(self.original, generation=replace(self.original.generation, microseconds=9))
        with self.assertRaisesRegex(handoff.HandoffError, "handoff-original-account-changed"):
            lease.assert_current()

    def test_contact_page_or_salt_rotation_revokes_handoff(self):
        grant = self.grant()
        self.restored()
        raw = bytearray(self.contact.read_bytes())
        raw[100] ^= 1
        self.contact.write_bytes(raw)
        with self.assertRaisesRegex(handoff.HandoffError, "handoff-contact-hmac-failed"):
            handoff.rebind_after_restore(grant, _verifier=self.verify)
        self.assertFalse(grant._master)

    def test_failed_hmac_never_sets_proof_or_reports_verified_state(self):
        grant = self.grant()
        self.restored()
        lease = handoff.ReboundOriginalLease(grant, self.verify, CandidateDatabaseSource)
        self.leases.append(lease)
        self.addCleanup(grant.close)
        raw = bytearray(self.contact.read_bytes())
        raw[100] ^= 1
        self.contact.write_bytes(raw)
        with self.assertRaisesRegex(handoff.HandoffError, "handoff-contact-hmac-failed"):
            lease.assert_current()
        self.assertIsNone(lease._proof)
        self.assertFalse(lease.aggregate()["sameAccountHmacVerified"] or lease.aggregate()["freshOriginalVerified"])

    def test_expired_or_failed_existing_lease_does_not_advertise_old_proof_as_current(self):
        _, lease = self.rebound()
        self.original = replace(self.original, generation=replace(self.original.generation, microseconds=9))
        with self.assertRaises(handoff.HandoffError):
            lease.assert_current()
        self.assertFalse(lease.aggregate()["sameAccountHmacVerified"])
        self.assertFalse(lease.aggregate()["freshOriginalVerified"])

    def test_ui_generation_compares_fresh_original_exact_tuple(self):
        _, lease = self.rebound()
        lease.verify_ui_generation(self.original.generation)
        with self.assertRaisesRegex(handoff.HandoffError, "handoff-ui-generation-changed"):
            lease.verify_ui_generation(replace(self.original.generation, pid=101))

    def test_existing_provider_policy_rejection_leaves_allowlist_and_old_auth_untouched(self):
        _, lease = self.rebound()
        fake, state = self.fake_provider()
        fake._require_supported_bundle.side_effect = BackgroundCaptureError("MAC_WECHAT_VERSION_UNSUPPORTED", "fixed")
        before = provider.SUPPORTED_BUILDS
        with self.assertRaises(BackgroundCaptureError):
            lease.register_with_provider(fake)
        fake.import_worker_authorization.assert_not_called()
        fake.clear_authorization.assert_not_called()
        self.assertIs(provider.SUPPORTED_BUILDS, before)
        self.assertNotIn(handoff.EXPECTED_BUILD, provider.SUPPORTED_BUILDS)

    def test_existing_worker_registration_contract_gets_remaining_ttl_and_wipes_local_buffers(self):
        grant, lease = self.rebound()
        fake, state = self.fake_provider()
        result = lease.register_with_provider(fake)
        self.assertTrue(result["providerRegistered"])
        self.assertEqual(state["expires"], self.session.deadline)
        self.assertEqual(state["key"], self.master)
        self.assertFalse(state["payload"].key)
        self.assertFalse(lease._master or lease._contact_key)
        self.assertTrue(lease._closed)
        self.assertFalse(result["productionPolicyChanged"] or result["captureCompatibilityValidated"])

    def test_failed_final_registration_check_revokes_partial_provider_state(self):
        _, lease = self.rebound()
        fake, state = self.fake_provider()
        fake.get_authorized_key.return_value = b"different"
        fake.get_authorized_key.side_effect = None
        with self.assertRaisesRegex(handoff.HandoffError, "handoff-provider-registration-failed"):
            lease.register_with_provider(fake)
        fake.clear_authorization.assert_called_once()
        self.assertFalse(state["key"] or state["payload"].key)
        self.assertFalse(lease.aggregate()["providerRegistered"])

    def test_cleanup_failure_after_provider_accept_revokes_registration_and_wipes_keys(self):
        _, lease = self.rebound()
        fake, state = self.fake_provider()
        lease._sources.append(Mock(close=Mock(side_effect=RuntimeError("synthetic-close-failed"))))
        with self.assertRaisesRegex(handoff.HandoffError, "handoff-source-cleanup-failed"):
            lease.register_with_provider(fake)
        fake.import_worker_authorization.assert_called_once()
        fake.clear_authorization.assert_called_once()
        self.assertFalse(state["key"] or state["payload"].key or lease._master or lease._contact_key)
        self.assertFalse(lease.aggregate()["providerRegistered"] or lease.aggregate()["sameAccountHmacVerified"])

    def test_native_original_verifier_honors_vendor_optional_tuple_process_contract(self):
        grant = self.grant()
        self.restored()
        self.addCleanup(grant.close)
        self.session.debug._bundle_source_digest.return_value = grant._source_digest
        original_executable = handoff.OFFICIAL_APP / "Contents/MacOS/WeChat"
        process_proof = (202, (os.fsencode(original_executable), 200, 8), self.account)
        with patch.object(provider, "_verify_official_bundle"), \
                patch.object(provider, "bundle_metadata", return_value=handoff.EXPECTED_BUILD), \
                patch.object(handoff, "_code_state", return_value=(1, 2, 3, 4)), \
                patch.object(handoff.probe, "process_account", return_value=process_proof) as account:
            for empty in ((), []):
                self.session.debug._exact_process_pids.side_effect = lambda path, empty=empty: empty if path == self.session.executable else (202,)
                proof = handoff._NativeOriginalVerifier(grant)()
                self.assertEqual(proof.generation.pid, 202)
            self.assertEqual(account.call_count, 2)
            for not_empty in (None, (101,), [101]):
                self.session.debug._exact_process_pids.side_effect = lambda path, value=not_empty: value if path == self.session.executable else (202,)
                with self.subTest(value=not_empty), self.assertRaisesRegex(handoff.HandoffError, "handoff-candidate-still-running"):
                    handoff._NativeOriginalVerifier(grant)()
            self.assertEqual(account.call_count, 2)

    def test_grant_and_lease_cannot_be_serialized_or_print_secrets(self):
        grant, lease = self.rebound()
        for value in (grant, lease, self.original):
            with self.assertRaisesRegex(handoff.HandoffError, "handoff-serialization-prohibited"):
                pickle.dumps(value)
            self.assertNotIn(str(self.account), repr(value))


if __name__ == "__main__":
    unittest.main()
