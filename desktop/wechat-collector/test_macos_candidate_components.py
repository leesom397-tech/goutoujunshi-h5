"""Source/frozen loader contracts; never launch or read real WeChat data."""
from pathlib import Path
import shutil
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import macos_candidate_components as components
import macos_candidate_prepare as prepare
import macos_candidate_device_runtime as device
import macos_key_provider as provider


class CandidateComponentTests(unittest.TestCase):
    def test_real_pinned_components_can_be_loaded_twice_in_the_same_service(self):
        # This used to reject the second call after prepare(), before start().
        before = set(sys.modules)
        with patch.object(components.subprocess, "run") as native:
            first = prepare._debug_module()
            second = prepare._debug_module()
            package, files = components.verified_package(device.EXTRA_SOURCES)
        self.assertIs(first, second)
        self.assertEqual(Path(first.__file__), package / "macos_debug_app.py")
        self.assertTrue(set(device.EXTRA_SOURCES) <= files.keys())
        native.assert_not_called()
        # No module from another subsystem should be removed for retry.
        self.assertTrue(before <= set(sys.modules))

    def test_foreign_parent_or_child_module_is_rejected_without_removing_it(self):
        package, files = components.verified_package(prepare.SOURCES)
        for name in ("chatlog_keeper", "chatlog_keeper.macos_debug_app", "chatlog_keeper.not_pinned"):
            foreign = SimpleNamespace(__file__="/untrusted/source.py",
                                      __spec__=SimpleNamespace(origin="/untrusted/source.py"))
            with self.subTest(module=name), patch.dict(sys.modules, {name: foreign}):
                with self.assertRaisesRegex(components.runtime.DiagnosticError, "existing-vendor"):
                    components._verify_existing_modules(package, files)
                self.assertIs(sys.modules[name], foreign)

    def test_changed_component_is_rejected_before_import(self):
        original = Path(prepare.__file__).parent / "vendor"
        with tempfile.TemporaryDirectory() as temporary:
            vendor = Path(temporary) / "vendor"
            shutil.copytree(original, vendor, ignore=shutil.ignore_patterns("__pycache__"))
            source = vendor / "chatlog_keeper/macos_debug_app.py"
            source.write_bytes(source.read_bytes() + b"\n# synthetic corruption\n")
            with patch.object(provider, "_upstream_vendor_root", return_value=vendor), \
                    patch.object(components.importlib, "import_module") as imported:
                with self.assertRaisesRegex(components.runtime.DiagnosticError, "pinned-source"):
                    components.load_debug_module(prepare.SOURCES)
            imported.assert_not_called()

    def test_frozen_resource_root_is_resolved_by_the_fixed_app_contract(self):
        original = Path(prepare.__file__).parent / "vendor"
        with tempfile.TemporaryDirectory() as temporary:
            vendor = Path(temporary) / "Fixed.app/Contents/Resources/vendor"
            shutil.copytree(original, vendor, ignore=shutil.ignore_patterns("__pycache__"))
            with patch.object(provider, "_upstream_vendor_root", return_value=vendor) as resolve:
                package, files = components.verified_package(prepare.SOURCES)
            self.assertEqual(package, vendor / "chatlog_keeper")
            resolve.assert_called_once_with()
            self.assertTrue(all(files[key] == value for key, value in prepare.SOURCES.items()))

    def test_source_mode_still_rejects_unpinned_native_helpers(self):
        with tempfile.TemporaryDirectory() as temporary:
            package = Path(temporary)
            (package / "scripts").mkdir()
            with patch.object(components.sys, "frozen", False, create=True):
                components.verify_runtime_helpers(package)
                (package / "scripts/macos_memory_scan").write_bytes(b"synthetic-not-executed")
                with self.assertRaisesRegex(components.runtime.DiagnosticError, "unpinned-prebuilt"):
                    components.verify_runtime_helpers(package)

    def test_frozen_helpers_require_fixed_resources_and_verified_bundle(self):
        vendor = Path("/Fixed.app/Contents/Resources/vendor")
        with patch.object(components.sys, "frozen", True, create=True), \
                patch.object(provider, "_upstream_vendor_root", return_value=vendor), \
                patch.object(provider, "_verify_frozen_native_inputs") as verify, \
                patch.object(components.subprocess, "run", return_value=SimpleNamespace(returncode=0)) as run:
            components.verify_runtime_helpers(vendor / "chatlog_keeper")
            verify.assert_called_once_with(vendor)
            self.assertEqual(run.call_args.args[0],
                ["/usr/bin/codesign", "--verify", "--deep", "--strict", str(vendor.parents[2])])
            self.assertEqual(run.call_args.kwargs["timeout"], 60)

    def test_missing_or_escaped_frozen_helper_never_runs_a_compiler(self):
        vendor = Path("/Fixed.app/Contents/Resources/vendor")
        with patch.object(components.sys, "frozen", True, create=True), \
                patch.object(provider, "_upstream_vendor_root", return_value=vendor), \
                patch.object(provider, "_verify_frozen_native_inputs", side_effect=ValueError("private path")), \
                patch.object(components.subprocess, "run") as run:
            with self.assertRaisesRegex(components.runtime.DiagnosticError, "native-bundle-invalid"):
                components.verify_runtime_helpers(vendor / "chatlog_keeper")
            run.assert_not_called()

    def test_invalid_bundle_signature_does_not_authorize_bundled_helpers(self):
        vendor = Path("/Fixed.app/Contents/Resources/vendor")
        with patch.object(components.sys, "frozen", True, create=True), \
                patch.object(provider, "_upstream_vendor_root", return_value=vendor), \
                patch.object(provider, "_verify_frozen_native_inputs"), \
                patch.object(components.subprocess, "run", return_value=SimpleNamespace(returncode=1)):
            with self.assertRaisesRegex(components.runtime.DiagnosticError, "native-bundle-invalid"):
                components.verify_runtime_helpers(vendor / "chatlog_keeper")


if __name__ == "__main__":
    unittest.main()
