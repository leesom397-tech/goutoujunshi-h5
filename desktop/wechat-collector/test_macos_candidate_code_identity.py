"""Public metadata with generated code files; never inspects a real Mac/app."""
import hashlib
import json
from pathlib import Path
import plistlib
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import macos_candidate_code_identity as identity
import macos_candidate_device_runtime as device

DETAILS="Executable=/PRIVATE/PATH/Candidate.app\nSignature=adhoc\nTeamIdentifier=(not set)\nCDHash="+"a"*40+"\n"


class CodeIdentityTests(unittest.TestCase):
    def test_codesign_fields_never_echo_paths_or_unrecognized_output(self):
        value=identity.signing_fields(DETAILS)
        self.assertEqual(value,{"cdHash":"a"*40,"teamIdentifier":"","signatureType":"adhoc"})
        self.assertEqual(identity.signing_fields(DETAILS.replace("(not set)","not set")),value)
        self.assertNotIn("PRIVATE",json.dumps(value))
        with self.assertRaisesRegex(identity.IdentityError,"code-cdhash-unavailable"):
            identity.signing_fields("private error /private/account")

    def test_hashing_and_comparison_detect_code_change_without_tcc_claim(self):
        with tempfile.TemporaryDirectory(prefix="chengzi-code-synthetic-") as temp:
            path=Path(temp).resolve()/"executable"
            path.write_bytes(b"synthetic public code\r\n")
            before={"ok":True,"mainExecutableSha256":identity.file_hash(path),"cdHash":"a"*40,
                    "watchdogSha256":"b"*64,"observerSha256":"c"*64}
            self.assertEqual(before["mainExecutableSha256"],hashlib.sha256(path.read_bytes()).hexdigest())
            self.assertTrue(identity.compare_code_identity(before,dict(before))["candidateCodeUnchanged"])
            after={**before,"mainExecutableSha256":"d"*64,"watchdogSha256":"e"*64}
            result=identity.compare_code_identity(before,after)
            self.assertFalse(result["candidateCodeUnchanged"] or result["watchdogCodeUnchanged"])
            self.assertTrue(result["observerCodeUnchanged"])
            self.assertFalse(result["tccStateRead"] or result["tccGrantPersistenceValidated"])

    def test_receipt_bound_metadata_only_uses_codesign_and_fixed_public_code_files(self):
        with tempfile.TemporaryDirectory(prefix="chengzi-code-synthetic-") as temp:
            work=Path(temp).resolve()
            shadow=work/"Candidate.app"
            (shadow/"Contents/MacOS").mkdir(parents=True)
            (shadow/"Contents/_CodeSignature").mkdir()
            (shadow/"Contents/Info.plist").write_bytes(plistlib.dumps({"CFBundleIdentifier":"com.tencent.xinWeChat","CFBundleExecutable":"WeChat"}))
            (shadow/"Contents/MacOS/WeChat").write_bytes(b"synthetic public executable")
            (shadow/"Contents/_CodeSignature/CodeResources").write_bytes(b"synthetic public seal")
            with patch.object(identity.sys,"platform","darwin"), \
                    patch.object(device,"_load_receipt",return_value=(work,shadow,b"d"*32)), \
                    patch.object(identity.subprocess,"run",side_effect=[SimpleNamespace(returncode=0),SimpleNamespace(returncode=0,stderr=DETAILS)]) as run:
                result=identity.inspect_code_identity(work/"prepare-receipt.json")
            self.assertTrue(result["ok"] and result["receiptPathValidated"])
            self.assertFalse(result["accountDataRead"] or result["processesInspected"] or result["appsStarted"] or result["tccStateRead"])
            self.assertIsNone(result["watchdogSha256"])
            self.assertEqual(len(run.call_args_list),2)
            self.assertTrue(all(call.args[0][0]=="/usr/bin/codesign" for call in run.call_args_list))
            self.assertNotIn(str(work),json.dumps(result))
            self.assertNotIn("PRIVATE",json.dumps(result))


if __name__=="__main__":unittest.main()
