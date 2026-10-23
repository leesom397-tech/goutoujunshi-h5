"""Build integrity/format checks runnable without Mac hardware or private data."""
import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

import build_macos as build
import macos_runtime_self_test as runtime


class MacBuildTests(unittest.TestCase):
    def test_actual_fixed_vendor_manifest_matches_all_executable_sources(self):
        receipt = build.verify_vendor()
        self.assertEqual(receipt["commit"], build.PINNED_KEEPER_COMMIT)

    def test_changed_or_extra_vendor_python_is_rejected_before_build(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            shutil.copytree(build.ROOT / "vendor", root / "vendor",
                            ignore=shutil.ignore_patterns("__pycache__"))
            source = root / "vendor" / "chatlog_keeper" / "macos_key.py"
            source.write_bytes(source.read_bytes() + b"\n# modified\n")
            with self.assertRaisesRegex(RuntimeError, "integrity"):
                build.verify_vendor(root)
            shutil.copyfile(build.ROOT / "vendor" / "chatlog_keeper" / "macos_key.py", source)
            (source.parent / "unexpected.py").write_text("pass\n", "utf-8")
            with self.assertRaisesRegex(RuntimeError, "source set"):
                build.verify_vendor(root)

    def test_manifest_path_escape_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "vendor" / "chatlog_keeper").mkdir(parents=True)
            source = root / "outside.py"
            source.write_text("pass\n", "utf-8")
            manifest = {"repository": "https://github.com/labazhou2024/chatlog-keeper",
                        "commit": build.PINNED_KEEPER_COMMIT,
                        "files": {"../../outside.py": build.sha256(source)}}
            (root / "vendor" / "chatlog-keeper-pin.json").write_text(json.dumps(manifest), "utf-8")
            with self.assertRaisesRegex(RuntimeError, "integrity"):
                build.verify_vendor(root)

    def test_icon_export_is_valid_icns_and_leaves_approved_source_intact(self):
        from PIL import Image
        source = build.ROOT.parents[1] / "assets" / "brand" / "chengzi-fluted-chat-source.png"
        original = build.sha256(source)
        with tempfile.TemporaryDirectory() as temporary:
            icon = build.export_icon(temporary, source)
            with Image.open(icon) as loaded:
                self.assertEqual(loaded.format, "ICNS")
                loaded.load()
                self.assertEqual(loaded.size, (1024, 1024))
            self.assertEqual(build.sha256(source), original)

    def test_runtime_gate_rejects_other_platforms_without_loading_native_modules(self):
        with patch.object(runtime.sys, "platform", "win32"), \
                patch.object(runtime.importlib, "import_module") as imported:
            result = runtime.run_runtime_self_test()
        self.assertFalse(result["ok"])
        self.assertEqual(result["reason"], "macos-arm64-required")
        imported.assert_not_called()

    def test_app_missing_prebuilt_helper_fails_before_archive(self):
        with tempfile.TemporaryDirectory() as temporary:
            bundle = Path(temporary) / "Synthetic.app"
            resources = bundle / "Contents" / "Resources"
            shutil.copytree(build.ROOT / "vendor", resources / "vendor",
                            ignore=shutil.ignore_patterns("__pycache__"))
            with patch.object(build.subprocess, "run") as run:
                with self.assertRaisesRegex(RuntimeError, "bundled native helper is missing"):
                    build.verify_packaged_helpers(bundle)
                run.assert_not_called()
            scripts = resources / "vendor" / "chatlog_keeper" / "scripts"
            for name in ("macos_memory_scan", "macos_wechat_key_capture.dylib"):
                (scripts / name).write_bytes(b"synthetic-placeholder-not-executed")
            with patch.object(build.subprocess, "run") as run:
                build.verify_packaged_helpers(bundle)
                self.assertEqual(run.call_count, 2)
                for call in run.call_args_list:
                    self.assertEqual(call.args[0][0], "lipo")
                    self.assertTrue(Path(call.args[0][1]).is_file())
                    self.assertEqual(call.args[0][2:], ["-verify_arch", "arm64"])

    def test_pinned_upstream_prefers_prebuilt_even_when_source_is_newer(self):
        import importlib
        from macos_key_provider import _load_upstream
        _load_upstream()  # Fixed-source imports only; no key extraction or helper invocation.
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, prebuilt = root / "synthetic.c", root / "synthetic-prebuilt"
            source.write_bytes(b"synthetic source")
            prebuilt.write_bytes(b"synthetic compiled fixture")
            os.utime(prebuilt, (1000, 1000))
            os.utime(source, (2000, 2000))
            for name in ("macos_key", "macos_wechat_capture"):
                module = importlib.import_module("chatlog_keeper." + name)
                with patch.object(module, "_source_path", return_value=source), \
                        patch.object(module, "_prebuilt_path", return_value=prebuilt):
                    self.assertEqual(module._helper_input_path(), prebuilt)


if __name__ == "__main__":
    unittest.main()
