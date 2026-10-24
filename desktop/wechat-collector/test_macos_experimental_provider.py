"""Synthetic account/crypto and cold worker checks, never real WeChat."""
from contextlib import ExitStack
from dataclasses import replace
import hashlib
import json
import multiprocessing as mp
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch

import apsw
from background_reader import BackgroundCaptureError
from macos_album_snapshot import Generation
from macos_candidate_handoff import OriginalProof
import macos_key_provider as provider
from test_local_database_source import encrypt_database

STAMP=((1,2,3,4),(1,3,4,5),(1,4,5,6))


def proof_patches(stack,account):
    stack.enter_context(patch.object(provider,"_require_mac"))
    stack.enter_context(patch.object(provider,"bundle_metadata",return_value=provider.EXPERIMENTAL_BUILD))
    stack.enter_context(patch.object(provider,"_verify_official_bundle"))
    stack.enter_context(patch.object(provider,"_processes",return_value=[(123,100.0002)]))
    stack.enter_context(patch.object(provider,"_native_generation",return_value=(501,100,200)))
    stack.enter_context(patch.object(provider,"_open_database_files",return_value=[str(account/"db_storage/contact/contact.db")]))
    stack.enter_context(patch.object(provider,"_account_from_file",return_value=account))
    stack.enter_context(patch.object(provider,"_original_code_stamp",return_value=STAMP))


def cold_worker(connection,payload,account):
    provider.clear_authorization()
    try:
        with ExitStack() as stack:
            proof_patches(stack,Path(account))
            from macos_candidate_setup_controller import _authorization_worker
            _authorization_worker(connection,payload)
    except Exception:
        connection.send({"ready":False,"contentIncluded":False})
    finally:
        payload.close();provider.clear_authorization();connection.close()


class ExperimentalProviderTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix="chengzi-experimental-synthetic-")
        self.addCleanup(self.temp.cleanup)
        self.account=Path(self.temp.name).resolve()/"synthetic_owner_123"
        self.contact=self.account/"db_storage/contact/contact.db";self.contact.parent.mkdir(parents=True)
        plain=Path(self.temp.name)/"plain.sqlite"
        db=apsw.Connection(str(plain));db.execute("PRAGMA page_size=4096");db.reserve_bytes("main",80);db.execute("VACUUM")
        db.execute("CREATE TABLE contact(username TEXT,nick_name TEXT,remark TEXT)")
        db.execute("INSERT INTO contact VALUES('synthetic_owner','Owner','')");db.close()
        self.key=hashlib.sha256(b"synthetic experimental key").digest();self.salt=b"s"*16
        self.contact.write_bytes(encrypt_database(plain.read_bytes(),self.key,self.salt));plain.unlink()
        provider.clear_authorization();self.addCleanup(provider.clear_authorization)
        self.stack=ExitStack();self.addCleanup(self.stack.close);proof_patches(self.stack,self.account)
        self.proof=OriginalProof(Generation(123,501,100,200),self.account,provider.EXPERIMENTAL_BUILD)
        self.expires=time.monotonic()+120

    def register(self):
        return provider.register_experimental_original(proof=self.proof,key=bytearray(self.key),salt=self.salt,expires=self.expires,consent=True)

    def test_default_policy_stays_closed_and_registration_requires_explicit_consent(self):
        self.assertNotIn(provider.EXPERIMENTAL_BUILD,provider.SUPPORTED_BUILDS)
        with self.assertRaises(BackgroundCaptureError):provider.current_account_proof()
        with self.assertRaises(BackgroundCaptureError):
            provider.register_experimental_original(proof=self.proof,key=self.key,salt=self.salt,expires=self.expires)
        self.assertIsNone(provider._experimental_authorization)

    def test_valid_original_registration_opens_existing_source_without_allowlist_change(self):
        result=self.register()
        self.assertTrue(result["ready"] and result["experimental"])
        self.assertFalse(result["productionReady"] or result["realDeviceValidated"])
        import macos_database_source
        source=macos_database_source.open_authorized_source(contacts_only=True)
        self.assertEqual(source.self_username,"synthetic_owner");source.assert_unchanged();source.close()
        self.assertNotIn(provider.EXPERIMENTAL_BUILD,provider.SUPPORTED_BUILDS)
        self.assertNotIn(self.key.hex(),json.dumps(provider.probe_setup()))

    def test_worker_export_never_renews_original_deadline_and_payload_is_distinct(self):
        self.register();payload=provider.export_worker_authorization()
        self.assertIs(type(payload),provider.ExperimentalWorkerAuthorization)
        self.assertEqual(payload.expires,self.expires)
        self.assertNotIn(self.key.hex(),repr(payload));payload.close()

    def test_cold_spawned_worker_imports_only_explicit_payload_and_uses_real_source_factory(self):
        self.register();payload=provider.export_worker_authorization()
        context=mp.get_context("spawn");receive,send=context.Pipe(duplex=False)
        process=context.Process(target=cold_worker,args=(send,payload,str(self.account)))
        try:
            process.start();send.close();payload.close()
            self.assertTrue(receive.poll(15));result=receive.recv();process.join(5)
            self.assertEqual(process.exitcode,0)
            self.assertEqual(result,{"ready":True,"experimental":True,"workerAuthorizationVersion":2})
            self.assertTrue(provider.experimental_status()["ready"])
        finally:
            payload.close();receive.close();send.close()
            if process.is_alive():process.terminate();process.join(5)

    def test_normal_version1_payload_cannot_unlock_experimental_build(self):
        payload=provider.WorkerAuthorization(str(self.account),bytearray(self.key),self.salt,provider.EXPERIMENTAL_BUILD,self.expires)
        with self.assertRaises(BackgroundCaptureError):provider.import_worker_authorization(payload)
        self.assertFalse(payload.key);self.assertIsNone(provider._experimental_authorization)

    def test_build_generation_and_capability_tampering_reject_and_wipe(self):
        self.register()
        for changes in ({"build":("4.9","999")},{"pid":124},{"uid":502},{"start_microseconds":201},
                        {"capability":"arbitrary"},{"version":1},{"expires":time.monotonic()+601}):
            self.register();payload=provider.export_worker_authorization()
            for name,value in changes.items():setattr(payload,name,value)
            with self.subTest(changes=changes),self.assertRaises(BackgroundCaptureError):provider.import_worker_authorization(payload)
            self.assertFalse(payload.key);self.assertIsNone(provider._experimental_authorization)

    def test_original_restart_or_account_change_revokes_health_and_existing_source(self):
        self.register();owned=provider._experimental_authorization.key
        with patch.object(provider,"_native_generation",return_value=(501,101,200)):
            self.assertFalse(provider.probe_setup()["ready"])
        self.assertFalse(owned);self.assertIsNone(provider._experimental_authorization)

    def test_contact_hmac_code_change_and_expiry_revoke_authorization(self):
        for mutation in ("hmac","code","expiry"):
            self.register();owned=provider._experimental_authorization.key
            with ExitStack() as stack:
                if mutation=="hmac":
                    raw=bytearray(self.contact.read_bytes());raw[100]^=1;original=self.contact.read_bytes();self.contact.write_bytes(raw)
                if mutation=="code":stack.enter_context(patch.object(provider,"_original_code_stamp",return_value=()))
                if mutation=="expiry":stack.enter_context(patch.object(provider.time,"monotonic",return_value=self.expires))
                self.assertFalse(provider.experimental_status()["ready"])
            self.assertFalse(owned)
            if mutation=="hmac":self.contact.write_bytes(original)

    def test_clearing_experiment_does_not_clear_normal_authorization(self):
        self.register()
        normal=provider._Authorization(self.account,bytearray(b"n"*32),self.salt,("4.1.15","270102"))
        provider._authorization=normal
        provider.clear_experimental_authorization()
        self.assertEqual(normal.key,b"n"*32)

    def test_import_failure_after_copy_never_retains_worker_key(self):
        self.register();payload=provider.export_worker_authorization()
        with patch.object(provider,"_original_code_stamp",return_value=()):
            with self.assertRaises(BackgroundCaptureError):provider.import_worker_authorization(payload)
        self.assertFalse(payload.key);self.assertIsNone(provider._experimental_authorization)


if __name__=="__main__":unittest.main()
