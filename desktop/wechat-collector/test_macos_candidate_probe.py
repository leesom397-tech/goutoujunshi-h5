"""Public synthetic binaries only; no account read, native call or app launch."""
import copy
import hashlib
from pathlib import Path
import plistlib
import struct
import tempfile
import unittest
from unittest.mock import patch

import macos_candidate_probe as probe


def binary(*, imports=1, ntype=1, value=0, entitlements=None, encrypted=False):
    code = b"\x1f\x20\x03\xd5"  # A synthetic NOP; never executed.
    strings = b"\0" + probe.KDF_SYMBOL + b"\0"
    ents = {"com.apple.security.app-sandbox": True} if entitlements is None else entitlements
    payload = plistlib.dumps(ents)
    blob = struct.pack(">II", 0xFADE7171, 8 + len(payload)) + payload
    signature = struct.pack(">III", 0xFADE0CC0, 20 + len(blob), 1) + struct.pack(">II", 5, 20) + blob
    command_bytes = 152 + 24 + 16 + 24
    offset = 32 + command_bytes
    symoff = offset + len(code)
    stroff = symoff + 16 * imports
    sigoff = stroff + len(strings)
    size = sigoff + len(signature)
    header = struct.pack("<8I", 0xFEEDFACF, probe.ARM64, 0, 2, 4, command_bytes, 0, 0)
    segment = struct.pack("<II16sQQQQIIII", 0x19, 152, b"__TEXT", 0, size, 0, size, 5, 5, 1, 0)
    section = struct.pack("<16s16sQQIIIIIIII", b"__text", b"__TEXT", offset, len(code), offset, 2, 0, 0, 0, 0, 0, 0)
    symtab = struct.pack("<6I", 2, 24, symoff, imports, stroff, len(strings))
    sigcmd = struct.pack("<4I", 0x1D, 16, sigoff, len(signature))
    crypt = struct.pack("<6I", 0x2C, 24, 0, 0, int(encrypted), 0)
    symbols = b"".join(struct.pack("<IBBHQ", 1, ntype, 0, 0, value) for _ in range(imports))
    return header + segment + section + symtab + sigcmd + crypt + code + symbols + strings + signature


class MacCandidateProbeTests(unittest.TestCase):
    def test_reads_exact_undefined_import_and_entitlements_without_authenticating_signature(self):
        original = binary()
        result = probe.inspect_macho(original)
        self.assertEqual(result["kdfUndefinedImportCount"], 1)
        self.assertEqual(result["arm64TextSha256"], hashlib.sha256(b"\x1f\x20\x03\xd5").hexdigest())
        self.assertEqual(result["embeddedEntitlements"], {"com.apple.security.app-sandbox": True})
        self.assertFalse(result["signatureVerified"])
        self.assertEqual(original, binary())

    def test_string_or_defined_symbol_is_not_an_import(self):
        for kwargs in ({"imports": 0}, {"ntype": 0xF}, {"ntype": 0xE1}, {"value": 16}):
            with self.subTest(kwargs=kwargs):
                self.assertEqual(probe.inspect_macho(binary(**kwargs))["kdfUndefinedImportCount"], 0)

    def test_duplicate_imports_remain_visible_and_encryption_is_explicit(self):
        result = probe.inspect_macho(binary(imports=2, encrypted=True))
        self.assertEqual(result["kdfUndefinedImportCount"], 2)
        self.assertTrue(result["encryptedCode"])

    def test_fat_slice_must_be_unique_and_nonoverlapping(self):
        thin = binary()
        fat = struct.pack(">II", 0xCAFEBABE, 1) + struct.pack(">5I", probe.ARM64, 0, 32, len(thin), 0) + b"\0" * 4 + thin
        self.assertEqual(probe.inspect_macho(fat)["kdfUndefinedImportCount"], 1)
        duplicate = (struct.pack(">II", 0xCAFEBABE, 2)
                     + struct.pack(">5I", probe.ARM64, 0, 48, len(thin), 0) * 2 + thin)
        with self.assertRaisesRegex(probe.ProbeError, "overlap"):
            probe.inspect_macho(duplicate)

    def test_malformed_ranges_and_commands_fail_closed(self):
        complete = binary()
        for length in (0, 12, 31, 33, 150, len(complete) - 1):
            with self.subTest(length=length), self.assertRaises(probe.ProbeError):
                probe.inspect_macho(complete[:length])
        invalid = bytearray(complete)
        struct.pack_into("<I", invalid, 36, 7)  # segment cmdsize
        with self.assertRaises(probe.ProbeError):
            probe.inspect_macho(invalid)
        invalid = bytearray(complete)
        struct.pack_into("<I", invalid, 192, 0xFFFFFFFF)  # symbol table file offset
        with self.assertRaises(probe.ProbeError):
            probe.inspect_macho(invalid)

    def test_file_probe_keeps_bytes_unchanged_and_rejects_replacement(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "public-binary"
            original = binary()
            path.write_bytes(original)
            result = probe.inspect_file(path)
            self.assertEqual(result["binarySha256"], hashlib.sha256(original).hexdigest())
            self.assertEqual(path.read_bytes(), original)
            with patch.object(probe.os, "fstat", side_effect=[path.stat(), type("Changed", (), {
                    "st_dev": 0, "st_ino": 0, "st_size": 32, "st_mtime_ns": 0})()]):
                with self.assertRaisesRegex(probe.ProbeError, "changed"):
                    probe.inspect_file(path)

    @staticmethod
    def bundles():
        evidence = {"binarySha256": "0" * 64, "arm64TextSha256": "1" * 64,
                    "kdfUndefinedImportCount": 0, "encryptedCode": False,
                    "embeddedEntitlements": {"com.apple.security.app-sandbox": True}}
        baseline = {"version": "4.1.15", "build": "270102",
                    "binaries": {p: copy.deepcopy(evidence) for p in probe.PUBLIC_BINARIES}}
        baseline["binaries"]["Contents/Resources/wechat.dylib"]["kdfUndefinedImportCount"] = 1
        candidate = copy.deepcopy(baseline)
        candidate["build"] = "270135"
        return baseline, candidate

    def test_positive_static_evidence_never_grants_capture(self):
        import macos_key_provider as provider
        before = provider.SUPPORTED_BUILDS.copy()
        with patch.object(probe, "inspect_bundle", side_effect=self.bundles()), \
                patch.object(provider, "initialize_authorized_access") as initialize:
            result = probe.compare_bundles("baseline", "candidate")
        self.assertTrue(result["staticAbiCandidate"])
        for flag in ("captureCompatible", "captureValidated", "allowlistChanged", "accountDataRead", "processMemoryRead", "signatureVerified"):
            self.assertFalse(result[flag])
        self.assertEqual(result["decision"], "runtime-validation-required")
        self.assertEqual(provider.SUPPORTED_BUILDS, before)
        initialize.assert_not_called()

    def test_changed_entitlements_missing_import_or_encryption_require_review(self):
        for issue in ("entitlements", "missing", "duplicate", "encrypted", "wrong-baseline"):
            baseline, candidate = self.bundles()
            key = candidate["binaries"]["Contents/Resources/wechat.dylib"]
            if issue == "entitlements":
                candidate["binaries"]["Contents/MacOS/WeChat"]["embeddedEntitlements"]["new"] = True
            elif issue == "encrypted":
                key["encryptedCode"] = True
            elif issue == "wrong-baseline":
                baseline["binaries"]["Contents/Resources/wechat.dylib"]["kdfUndefinedImportCount"] = 0
            else:
                key["kdfUndefinedImportCount"] = 0 if issue == "missing" else 2
            with self.subTest(issue=issue), patch.object(probe, "inspect_bundle", side_effect=[baseline, candidate]):
                result = probe.compare_bundles("baseline", "candidate")
                self.assertFalse(result["staticAbiCandidate"])
                self.assertEqual(result["decision"], "static-difference-review-required")

    def test_unknown_build_is_not_a_candidate(self):
        baseline, candidate = self.bundles()
        candidate["build"] = "270136"
        with patch.object(probe, "inspect_bundle", side_effect=[baseline, candidate]), \
                self.assertRaisesRegex(probe.ProbeError, "build-pair"):
            probe.compare_bundles("baseline", "candidate")

    def test_installed_candidate_requires_every_inspected_public_binary(self):
        _, evidence = self.bundles()
        for path, digest in probe.CANDIDATE_BINARY_SHA256.items():
            evidence["binaries"][path]["binarySha256"] = digest
        with patch.object(probe, "inspect_bundle", return_value=evidence):
            result = probe.probe_candidate("unused")
        self.assertTrue(result["matchesInspectedCandidate"])
        self.assertFalse(result["captureCompatible"])
        self.assertFalse(result["signatureVerified"])
        evidence["binaries"]["Contents/Resources/libxplayer.dylib"]["binarySha256"] = "f" * 64
        with patch.object(probe, "inspect_bundle", return_value=evidence):
            result = probe.probe_candidate("unused")
        self.assertFalse(result["matchesInspectedCandidate"])
        self.assertEqual(result["decision"], "candidate-binary-mismatch")


if __name__ == "__main__":
    unittest.main()
