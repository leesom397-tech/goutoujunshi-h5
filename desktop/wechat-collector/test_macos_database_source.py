"""Synthetic Mac source/authorization tests. No process memory or WeChat access."""
from dataclasses import replace
import hashlib
import importlib
import json
import os
from pathlib import Path
import plistlib
import shutil
import sys
import tempfile
import time
import unittest
from unittest.mock import Mock, patch

import apsw
from background_reader import BackgroundCaptureError
import macos_database_source as source
import macos_key_provider as provider
import sqlcipher_primitives as primitives
from test_local_database_source import encrypt_database


class MacSourceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="chengzi-mac-synthetic-")
        # macOS exposes temporary directories via /var -> /private/var. Keep
        # fixtures canonical like the authorized account proof and source path.
        self.root = Path(self.temp.name).resolve()
        self.account = self.root / "wxid_example_deadbeef"
        self.contact = self.account / "db_storage/contact/contact.db"
        self.contact.parent.mkdir(parents=True)
        self.master = hashlib.sha256(b"synthetic mac master").digest()
        self.salt = hashlib.md5(b"synthetic contact salt").digest()
        self.page_key = primitives._pbkdf2(self.master, self.salt, 256000)
        plain_path = self.root / "synthetic-fixture.db"
        conn = apsw.Connection(str(plain_path))
        conn.execute("PRAGMA page_size=4096")
        conn.reserve_bytes("main", 80)
        conn.execute("VACUUM")
        conn.execute("CREATE TABLE contact(username TEXT, nick_name TEXT)")
        conn.execute("INSERT INTO contact VALUES('wxid_example','Synthetic self')")
        conn.execute("INSERT INTO contact VALUES('wxid_friend','Synthetic friend')")
        conn.close()
        self.contact.write_bytes(encrypt_database(plain_path.read_bytes(), self.page_key, self.salt))
        self.proof = {"pid": 123, "started": 456.0, "account": self.account.resolve(), "build": ("4.1.15", "270102")}
        provider.clear_authorization()
        provider._authorization = provider._Authorization(self.account.resolve(), bytearray(self.master), self.salt, self.proof["build"])

    def tearDown(self):
        provider.clear_authorization()
        self.temp.cleanup()

    def test_real_password_mode_and_authenticated_source_leave_no_plaintext(self):
        before = {str(path.relative_to(self.root)): hashlib.sha256(path.read_bytes()).hexdigest()
                  for path in self.root.rglob("*") if path.is_file()}
        with patch.object(provider, "current_account_proof", return_value=dict(self.proof)), patch.object(provider, "verify_account_proof"):
            db = source.open_authorized_source()
            try:
                self.assertEqual(db.self_username, "wxid_example")
                self.assertEqual(list(db.contacts().execute("SELECT nick_name FROM contact WHERE username=?", ("wxid_friend",))), [("Synthetic friend",)])
                self.assertEqual(list(db.moments_shards()), [])
                db.assert_unchanged()
                with self.assertRaises(BackgroundCaptureError):
                    db.open_database("../outside.db")
            finally:
                db.close()
        after = {str(path.relative_to(self.root)): hashlib.sha256(path.read_bytes()).hexdigest()
                 for path in self.root.rglob("*") if path.is_file()}
        self.assertEqual(before, after)

    def test_raw_and_password_keys_are_selected_by_hmac(self):
        page = self.contact.read_bytes()[:4096]
        self.assertEqual(primitives.effective_page_key(self.master, page), self.page_key)
        self.assertEqual(primitives.effective_page_key(self.page_key, page), self.page_key)
        self.assertIsNone(primitives.effective_page_key(b"x" * 32, page))

    def test_current_account_requires_exact_open_database_and_process_generation(self):
        with patch.object(provider, "_require_supported_bundle", return_value=self.proof["build"]), \
                patch.object(provider, "_processes", return_value=[(123, 456.0)]), \
                patch.object(provider, "data_roots", return_value=[self.root]), \
                patch.object(provider, "_open_database_files", return_value=[str(self.contact)]):
            self.assertEqual(provider.current_account_proof(), self.proof)
        with patch.object(provider, "current_account_proof", return_value={**self.proof, "started": 457.0}):
            with self.assertRaises(BackgroundCaptureError) as raised:
                provider.verify_account_proof(self.proof)
            self.assertEqual(raised.exception.code, "ACCOUNT_CHANGED")

    def test_multiple_open_accounts_are_not_guessed(self):
        second = self.root / "wxid_other_deadbeef/db_storage/contact/contact.db"
        second.parent.mkdir(parents=True)
        second.write_bytes(self.contact.read_bytes())
        with patch.object(provider, "_require_supported_bundle", return_value=self.proof["build"]), \
                patch.object(provider, "_processes", return_value=[(123, 456.0)]), \
                patch.object(provider, "data_roots", return_value=[self.root]), \
                patch.object(provider, "_open_database_files", return_value=[str(self.contact), str(second)]):
            with self.assertRaises(BackgroundCaptureError) as raised:
                provider.current_account_proof()
            self.assertEqual(raised.exception.code, "MAC_ACCOUNT_UNVERIFIED")

    def test_worker_handoff_is_account_scoped_expires_and_erases_copy(self):
        with patch.object(provider, "current_account_proof", return_value=dict(self.proof)):
            payload = provider.export_worker_authorization()
            self.assertNotIn(self.master.hex(), repr(payload))
            self.assertNotIn("wxid", repr(payload))
            provider.import_worker_authorization(payload)
            self.assertEqual(len(payload.key), 0)
            self.assertEqual(provider.get_authorized_key(self.account), self.master)
            expired = provider.WorkerAuthorization(str(self.account.resolve()), bytearray(self.master), self.salt, self.proof["build"], time.monotonic() - 1)
            with self.assertRaises(BackgroundCaptureError):
                provider.import_worker_authorization(expired)
            self.assertEqual(len(expired.key), 0)

    def test_worker_handoff_rejects_other_account(self):
        payload = provider.WorkerAuthorization(str(self.root / "other"), bytearray(self.master), self.salt, self.proof["build"], time.monotonic() + 60)
        with patch.object(provider, "current_account_proof", return_value=dict(self.proof)):
            with self.assertRaises(BackgroundCaptureError) as raised:
                provider.import_worker_authorization(payload)
            self.assertEqual(raised.exception.code, "ACCOUNT_CHANGED")
        self.assertEqual(len(payload.key), 0)

    def test_worker_authorization_spans_job_timeout_but_rejects_longer_grant(self):
        with patch.object(provider, "current_account_proof", return_value=dict(self.proof)), \
                patch.object(provider.time, "monotonic", return_value=1000):
            payload = provider.export_worker_authorization()
            self.assertGreater(payload.expires - 1000, 20 * 60)
            provider.import_worker_authorization(payload)
        with patch.object(provider.time, "monotonic", return_value=1000 + 20 * 60):
            self.assertEqual(provider.get_authorized_key(self.account), self.master)
        with patch.object(provider.time, "monotonic", return_value=1000 + provider.WORKER_TTL):
            with self.assertRaises(BackgroundCaptureError):
                provider.get_authorized_key(self.account)
        oversized = provider.WorkerAuthorization(str(self.account.resolve()), bytearray(self.master),
            self.salt, self.proof["build"], 1000 + provider.WORKER_TTL + 1)
        with patch.object(provider.time, "monotonic", return_value=1000):
            with self.assertRaises(BackgroundCaptureError):
                provider.import_worker_authorization(oversized)
        self.assertEqual(len(oversized.key), 0)
        self.assertIsNone(provider._authorization)

    def test_database_key_change_invalidates_authorization(self):
        encrypted = bytearray(self.contact.read_bytes())
        encrypted[20] ^= 1
        self.contact.write_bytes(encrypted)
        with self.assertRaises(BackgroundCaptureError) as raised:
            provider.get_authorized_key(self.account)
        self.assertEqual(raised.exception.code, "ACCOUNT_CHANGED")
        self.assertEqual(len(provider._authorization.key), 0)

    def test_missing_explicit_consent_never_prepares_or_launches(self):
        with patch.object(provider, "_load_upstream") as loader:
            with self.assertRaises(BackgroundCaptureError) as raised:
                provider.initialize_authorized_access()
            self.assertEqual(raised.exception.code, "MAC_LOCAL_CONSENT_REQUIRED")
            loader.assert_not_called()

    def test_unknown_bundle_never_loads_extractor(self):
        with patch.object(provider, "_require_mac"), patch.object(provider, "bundle_metadata", return_value=("4.9", "999999")), \
                patch.object(provider, "_load_upstream") as loader:
            with self.assertRaises(BackgroundCaptureError) as raised:
                provider.initialize_authorized_access(consent=True)
            self.assertEqual(raised.exception.code, "MAC_WECHAT_VERSION_UNSUPPORTED")
            loader.assert_not_called()

    def test_running_daily_client_is_never_terminated(self):
        with patch.object(provider, "_require_supported_bundle", return_value=self.proof["build"]), \
                patch.object(provider, "_verify_official_bundle"), patch.object(provider, "_processes", return_value=[(123, 456.0)]), \
                patch.object(provider, "current_account_proof", return_value=dict(self.proof)), patch.object(provider, "_load_upstream") as loader:
            with self.assertRaises(BackgroundCaptureError) as raised:
                provider.initialize_authorized_access(consent=True)
            self.assertEqual(raised.exception.code, "MAC_WECHAT_MUST_CLOSE")
            self.assertEqual(provider._prepared[0], self.account.resolve())
            loader.assert_not_called()

    def test_initialization_uses_selected_contact_only_and_does_not_persist_key(self):
        provider.clear_authorization()
        provider._prepared = (self.account.resolve(), self.salt, self.proof["build"], time.monotonic() + 60)
        upstream = Mock()
        upstream.extract_wechat_key_active.return_value = self.master
        before = set(self.root.rglob("*"))
        with patch.object(provider, "_require_supported_bundle", return_value=self.proof["build"]), \
                patch.object(provider, "_verify_official_bundle"), patch.object(provider, "_processes", return_value=[]), \
                patch.object(provider, "_load_upstream", return_value=upstream):
            result = provider.initialize_authorized_access(consent=True)
        self.assertEqual(result["status"], "authorized")
        self.assertEqual(upstream.extract_wechat_key_active.call_args.kwargs["db_path"], str(self.contact))
        self.assertEqual(provider.get_authorized_key(self.account), self.master)
        self.assertEqual(before, set(self.root.rglob("*")))

    def test_cancellation_before_initialization_never_loads_extractor(self):
        with patch.object(provider, "_require_supported_bundle", return_value=self.proof["build"]), patch.object(provider, "_load_upstream") as loader:
            with self.assertRaises(BackgroundCaptureError) as raised:
                provider.initialize_authorized_access(consent=True, cancel=lambda: True)
            self.assertEqual(raised.exception.code, "CANCELLED")
            loader.assert_not_called()

    def test_health_never_inspects_database_or_process_memory(self):
        with patch.object(provider, "_require_supported_bundle", return_value=self.proof["build"]), \
                patch.object(provider, "_read_contact_header") as read, patch.object(provider, "_load_upstream") as upstream, \
                patch.object(provider, "_open_database_files") as opened:
            self.assertTrue(provider.probe_setup()["ready"])
            read.assert_not_called()
            upstream.assert_not_called()
            opened.assert_not_called()


class MacPackagedComponentTests(unittest.TestCase):
    """Real pinned module imports against a synthetic PyInstaller .app tree."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="chengzi-bundle-synthetic-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.bundle = self.root / "Renamed Collector.app"
        self.executable = self.bundle / "Contents/MacOS/ChengziWeChatCollector"
        self.executable.parent.mkdir(parents=True)
        self.executable.write_bytes(b"synthetic executable; never launched")
        self.resources = self.bundle / "Contents/Resources"
        self.frameworks = self.bundle / "Contents/Frameworks"
        self.vendor = self.resources / "vendor"
        self.links_available = True
        self.vendor.mkdir(parents=True)
        upstream_vendor = Path(provider.__file__).resolve().parent / "vendor"
        pin = json.loads((upstream_vendor / "chatlog-keeper-pin.json").read_text("utf-8"))
        shutil.copyfile(upstream_vendor / "chatlog-keeper-pin.json", self.vendor / "chatlog-keeper-pin.json")
        for name in pin["files"]:
            target = self.vendor / "chatlog_keeper" / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(upstream_vendor / "chatlog_keeper" / name, target)
            linked = self.frameworks / "vendor/chatlog_keeper" / name
            linked.parent.mkdir(parents=True, exist_ok=True)
            self._link(linked, target, required=False)
        for name in ("macos_memory_scan", "macos_wechat_key_capture.dylib"):
            binary = self.frameworks / "vendor/chatlog_keeper/scripts" / name
            binary.write_bytes(b"synthetic native input; never launched")
            self._link(self.vendor / "chatlog_keeper/scripts" / name, binary, required=False)
        self.info = {"CFBundleIdentifier": provider.COLLECTOR_BUNDLE_ID,
                     "CFBundleExecutable": self.executable.name}
        (self.bundle / "Contents/Info.plist").write_bytes(plistlib.dumps(self.info))
        self.addCleanup(patch.stopall)
        patch.object(provider.sys, "frozen", True, create=True).start()
        patch.object(provider.sys, "executable", str(self.executable)).start()
        patch.object(provider, "__file__", str(self.frameworks / "macos_key_provider.py")).start()
        # Import actual modules, but never permit a native process or support
        # directory creation. Restore the module cache after every fixture.
        patch.dict(sys.modules).start()
        for name in list(sys.modules):
            if name == "chatlog_keeper" or name.startswith("chatlog_keeper."):
                del sys.modules[name]
        self.launch = patch.object(provider.subprocess, "run", side_effect=AssertionError("no native launches in synthetic test")).start()
        self.support = patch.object(provider, "_private_support_dir", side_effect=AssertionError("no user directory access in synthetic test")).start()

    def _link(self, link, target, *, directory=False, required=True):
        try:
            link.symlink_to(os.path.relpath(target, link.parent), target_is_directory=directory)
        except OSError as exc:
            if required:
                self.skipTest("Synthetic bundle links require symlink support: " + str(exc))
            self.links_available = False
            shutil.copyfile(target, link)

    def assert_invalid(self):
        with self.assertRaises(BackgroundCaptureError) as raised:
            provider._load_upstream()
        self.assertEqual(raised.exception.code, "MAC_COMPONENT_INVALID")
        self.launch.assert_not_called()
        self.support.assert_not_called()

    def test_frozen_imports_resources_and_reads_bundled_native_inputs(self):
        loaded = provider._load_upstream()
        self.assertEqual(Path(loaded.__file__).parent, self.vendor / "chatlog_keeper")
        self.assertEqual((self.frameworks / "vendor/chatlog_keeper/macos_key.py").is_symlink(), self.links_available)
        for module_name in ("macos_key", "macos_wechat_capture"):
            module = importlib.import_module("chatlog_keeper." + module_name)
            self.assertEqual(module._prebuilt_path().is_symlink(), self.links_available)
            input_path = module._helper_input_path()
            self.assertEqual(input_path.read_bytes(), b"synthetic native input; never launched")
        self.launch.assert_not_called()
        self.support.assert_not_called()

    def test_frozen_real_pyinstaller_cross_links(self):
        if not self.links_available:
            self.skipTest("Actual PyInstaller cross-link fixture needs symlink support")
        self.test_frozen_imports_resources_and_reads_bundled_native_inputs()

    def test_nonfrozen_keeps_source_vendor_root(self):
        with patch.object(provider.sys, "frozen", False), patch.object(provider, "__file__", str(self.resources / "macos_key_provider.py")):
            self.assertEqual(Path(provider._load_upstream().__file__).parent, self.vendor / "chatlog_keeper")

    def test_frozen_does_not_use_meipass_or_module_location(self):
        with patch.object(provider.sys, "_MEIPASS", str(self.root / "external"), create=True), \
                patch.object(provider, "__file__", str(self.root / "external/macos_key_provider.py")):
            self.assertEqual(Path(provider._load_upstream().__file__).parent, self.vendor / "chatlog_keeper")

    def test_changed_pinned_source_is_rejected(self):
        (self.vendor / "chatlog_keeper/macos_key.py").write_text("raise RuntimeError('not pinned')", "utf-8")
        self.assert_invalid()

    def test_external_source_link_even_with_identical_bytes_is_rejected(self):
        source_path = self.vendor / "chatlog_keeper/macos_key.py"
        external = self.root / "external.py"
        external.write_bytes(source_path.read_bytes())
        source_path.unlink()
        self._link(source_path, external)
        self.assert_invalid()

    def test_external_source_parent_link_is_rejected(self):
        core = self.vendor / "chatlog_keeper/core"
        external = self.root / "external-core"
        core.rename(external)
        self._link(core, external, directory=True)
        self.assert_invalid()

    def test_external_native_input_link_is_rejected(self):
        external = self.root / "external-native"
        external.write_bytes(b"synthetic native input; never launched")
        linked = self.vendor / "chatlog_keeper/scripts/macos_memory_scan"
        linked.unlink()
        self._link(linked, external)
        self.assert_invalid()

    def test_external_resources_link_is_rejected(self):
        external = self.root / "external-resources"
        self.resources.rename(external)
        self._link(self.resources, external, directory=True)
        self.assert_invalid()

    def test_wrong_bundle_identity_is_rejected(self):
        self.info["CFBundleIdentifier"] = "example.unrelated"
        (self.bundle / "Contents/Info.plist").write_bytes(plistlib.dumps(self.info))
        self.assert_invalid()

    def test_executable_link_is_rejected(self):
        external = self.root / "external-executable"
        self.executable.rename(external)
        self._link(self.executable, external)
        self.assert_invalid()

    def test_frozen_non_bundle_path_does_not_fall_back_to_sources(self):
        with patch.object(provider.sys, "executable", str(self.root / "python")):
            self.assert_invalid()


if __name__ == "__main__":
    unittest.main()
