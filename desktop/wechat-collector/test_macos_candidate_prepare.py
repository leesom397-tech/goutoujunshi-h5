"""Preparation is code-only and must never interact with the logged-in app."""
import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import macos_candidate_prepare as candidate


class CandidatePrepareTests(unittest.TestCase):
    def test_receipt_is_explicitly_private_even_with_umask_zero(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "receipt.json"
            previous = os.umask(0)
            try:
                original_open = os.open
                with patch.object(candidate.os, "open", wraps=original_open) as opened, \
                        patch.object(candidate.os, "fchmod", wraps=getattr(os, "fchmod", None), create=True) as chmod:
                    candidate._write_private_receipt(path, {"ok": True})
                self.assertEqual(opened.call_args.args[2], 0o600)
                self.assertEqual(chmod.call_args.args[1], 0o600)
                if os.name == "posix":
                    self.assertEqual(path.stat().st_mode & 0o777, 0o600)
                self.assertEqual(json.loads(path.read_text(encoding="utf-8")), {"ok": True})
                with self.assertRaises(FileExistsError):
                    candidate._write_private_receipt(path, {"ok": False})
            finally:
                os.umask(previous)

    def test_pinned_minimal_vendor_files_match_real_shipped_sources(self):
        root = Path(candidate.__file__).parent / "vendor/chatlog_keeper"
        for name, digest in candidate.SOURCES.items():
            self.assertEqual(hashlib.sha256((root / name).read_bytes()).hexdigest(), digest, name)

    def test_other_platform_does_not_read_bundle_or_create_copy(self):
        with patch.object(candidate.sys, "platform", "win32"), \
                patch.object(candidate.smoke, "_verified_bundle") as verify, \
                patch.object(candidate.runtime, "_prepare_shadow") as copy:
            result = candidate.prepare()
        self.assertFalse(result["ok"])
        self.assertFalse(result["appStarted"])
        self.assertFalse(result["appStopped"])
        verify.assert_not_called()
        copy.assert_not_called()

    def test_nonmatching_bundle_cannot_prepare_or_load_policy(self):
        with patch.object(candidate.sys, "platform", "darwin"), \
                patch.object(candidate.platform, "machine", return_value="arm64"), \
                patch.object(candidate.smoke, "_verified_bundle", return_value={}), \
                patch.object(candidate.probe, "probe_candidate", return_value={"matchesInspectedCandidate": False}), \
                patch.object(candidate, "_debug_module") as load, \
                patch.object(candidate.runtime, "_prepare_shadow") as copy:
            result = candidate.prepare()
        self.assertEqual(result["reason"], "candidate-public-binaries-not-matched")
        load.assert_not_called()
        copy.assert_not_called()

    def test_unexpected_error_is_sanitized(self):
        with patch.object(candidate.sys, "platform", "darwin"), \
                patch.object(candidate.platform, "machine", return_value="arm64"), \
                patch.object(candidate.smoke, "_verified_bundle", side_effect=RuntimeError("private-details")):
            result = candidate.prepare()
        self.assertNotIn("private-details", json.dumps(result))
        self.assertFalse(result["accountDataRead"])
        self.assertFalse(result["observerBuilt"])


if __name__ == "__main__":
    unittest.main()
