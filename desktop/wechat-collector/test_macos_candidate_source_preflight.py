"""Dependency/preflight tests; never opens a real account or process."""
import hashlib
import importlib.metadata
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import macos_candidate_source_preflight as preflight


class PreflightTests(unittest.TestCase):
    def test_desktop_profile_matches_production_requirements_without_broadening_private_probe(self):
        root=Path(__file__).resolve().parent
        self.assertIn("pycparser==3.11",(root/"requirements-macos-voice.txt").read_text("utf-8"))
        def version(name):return "3.11" if name=="pycparser" else preflight.DEPENDENCIES[name][0]
        with patch.object(preflight.importlib.metadata,"version",side_effect=version):
            desktop=preflight.check_dependencies(require_mac=False,profile="desktop")
            private=preflight.check_dependencies(require_mac=False)
        self.assertTrue(desktop["ok"])
        self.assertFalse(private["ok"])
        self.assertEqual(next(row for row in desktop["dependencies"] if row["name"]=="pycparser")["expected"],"3.11")
    def versions(self, name):
        return preflight.DEPENDENCIES[name][0]

    def test_real_in_memory_codecs_without_process_or_account_action(self):
        with patch.object(preflight.importlib.metadata, "version", side_effect=self.versions), \
                patch("subprocess.run", side_effect=AssertionError("preflight cannot launch apps")), \
                patch("psutil.process_iter", side_effect=AssertionError("preflight cannot inspect processes")), \
                patch.object(Path, "home", side_effect=AssertionError("preflight cannot inspect account roots")):
            result = preflight.check_dependencies(require_mac=False)
        self.assertTrue(result["ok"])
        self.assertTrue(result["compressedTextValidated"] and result["imageCodecsValidated"])
        self.assertFalse(result["accountDataRead"] or result["processesInspected"] or result["appsStarted"])

    def test_missing_zstandard_stops_before_runtime_can_silently_drop_text(self):
        def version(name):
            if name == "zstandard":
                raise importlib.metadata.PackageNotFoundError(name)
            return self.versions(name)
        with patch.object(preflight.importlib.metadata, "version", side_effect=version), \
                patch.object(preflight, "RUNTIME_MODULES", ("must_never_import_runtime",)):
            result = preflight.check_dependencies(require_mac=False)
        self.assertFalse(result["ok"])
        self.assertEqual(result["reason"], "history-dependencies-unavailable")
        missing = next(item for item in result["dependencies"] if item["name"] == "zstandard")
        self.assertEqual(missing["reason"], "dependency-missing")

    def test_manifest_hash_and_scope_reject_modified_or_external_files(self):
        with tempfile.TemporaryDirectory(prefix="chengzi-preflight-synthetic-") as temp:
            root = Path(temp).resolve()
            source = root / "synthetic.py"
            source.write_bytes(b"synthetic package source")
            manifest = root / "manifest.json"
            manifest.write_text(json.dumps({"files": {source.name: hashlib.sha256(source.read_bytes()).hexdigest()}}), "utf-8")
            self.assertTrue(preflight.verify_manifest(manifest))
            source.write_bytes(b"changed synthetic source")
            self.assertFalse(preflight.verify_manifest(manifest))
            manifest.write_text(json.dumps({"files": {"../outside.py": "a" * 64}}), "utf-8")
            self.assertFalse(preflight.verify_manifest(manifest))


if __name__ == "__main__":
    unittest.main()
