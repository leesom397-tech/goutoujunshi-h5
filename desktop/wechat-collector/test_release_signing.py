"""Synthetic signing-order tests; no keys, trust-store changes or real EXE runs."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import release_signature
import package_release


ROOT = Path(__file__).resolve().parent


class SignatureMetadataTest(unittest.TestCase):
    def test_no_unverified_status_can_claim_signed(self):
        valid = {"status": "Valid", "publisher": "CN=Synthetic", "thumbprint": "A" * 40,
                 "timestampThumbprint": "B" * 40}
        for changed in (
            {"status": "NotSigned"}, {"status": "HashMismatch"}, {"status": "UnknownError"},
            {"status": "NotTrusted"}, {"timestampThumbprint": ""}, {"publisher": ""},
            {"thumbprint": ""},
        ):
            with self.subTest(changed=changed), patch.object(
                release_signature, "inspect_signature", return_value={**valid, **changed}
            ):
                self.assertNotEqual(release_signature.release_signature(Path("synthetic.exe"))["authenticode"], "signed")
                with self.assertRaisesRegex(SystemExit, "trusted, timestamped"):
                    release_signature.release_signature(Path("synthetic.exe"), require_signed=True)
        with patch.object(release_signature, "inspect_signature", return_value=valid):
            self.assertEqual(release_signature.release_signature(Path("synthetic.exe"), True),
                             {"authenticode": "signed", "signature": valid})

    @unittest.skipUnless(os.name == "nt", "Read-only Windows signature check")
    def test_real_unsigned_file_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "synthetic $().exe"
            path.write_bytes(b"MZ synthetic file, never run")
            self.assertNotEqual(release_signature.release_signature(path)["authenticode"], "signed")
            with self.assertRaises(SystemExit):
                release_signature.release_signature(path, True)

    def test_unsigned_production_package_stops_before_writing_release(self):
        with tempfile.TemporaryDirectory() as temporary:
            app = Path(temporary) / "ChengziWeChatCollector"
            app.mkdir()
            (app / "ChengziWeChatCollector.exe").write_bytes(b"synthetic unsigned executable")
            with patch("sys.argv", ["package_release.py", "--app", str(app), "--require-signed"]), \
                    patch.object(package_release, "validate_offline_ocr"), \
                    patch.object(package_release, "validate_local_voice_runtime"), \
                    patch.object(package_release, "validate_local_database_runtime"), \
                    patch.object(release_signature, "inspect_signature", return_value={"status": "NotSigned"}):
                with self.assertRaisesRegex(SystemExit, "trusted, timestamped"):
                    package_release.main()
            self.assertFalse((Path(temporary) / "release").exists())


@unittest.skipUnless(os.name == "nt", "PowerShell release orchestration")
class SigningOrderTest(unittest.TestCase):
    def invoke(self, temporary, scenario="ok"):
        root = Path(temporary)
        app = root / "ChengziWeChatCollector"
        app.mkdir()
        (app / "ChengziWeChatCollector.exe").write_bytes(b"synthetic collector")
        (root / "synthetic.pfx").write_text("not a certificate", encoding="ascii")
        if scenario == "existing":
            (root / "release").mkdir()
            (root / "release" / "ChengziWeChatCollector-Setup-9.9.9.exe").write_bytes(b"existing release")
        # Substitute external tools; the production script controls the gates.
        runner = root / "runner.ps1"
        runner.write_text(r"""
$ErrorActionPreference = 'Stop'
$global:events = [System.Collections.Generic.List[string]]::new()
function global:signtool.exe {
    $operation = $args[0]
    $target = $args[-1]
    $kind = if ($target -like '*-Setup-*') { 'launcher' } else { 'collector' }
    $global:events.Add("$operation-$kind")
    $global:LASTEXITCODE = 0
    if ($operation -eq 'sign') {
        if ($env:TEST_SIGN_SCENARIO -eq 'fail-outer' -and $kind -eq 'launcher') {
            $global:LASTEXITCODE = 1
            return
        }
        [IO.File]::AppendAllText($target, '-signed')
    }
}
function global:Get-AuthenticodeSignature {
    param([string]$LiteralPath)
    $timestamp = [PSCustomObject]@{ Thumbprint = ('B' * 40) }
    if ($env:TEST_SIGN_SCENARIO -eq 'missing-timestamp') { $timestamp = $null }
    $thumb = 'A' * 40
    if ($env:TEST_SIGN_SCENARIO -eq 'different-cert' -and $LiteralPath -like '*-Setup-*') { $thumb = 'C' * 40 }
    return [PSCustomObject]@{
        Status = 'Valid'
        SignerCertificate = [PSCustomObject]@{ Subject = 'CN=Synthetic Test Only'; Thumbprint = $thumb }
        TimeStamperCertificate = $timestamp
    }
}
function global:synthetic-python.exe {
    $script = [IO.Path]::GetFileName($args[0])
    $release = Join-Path $env:TEST_SIGN_ROOT 'release'
    $collector = Join-Path $env:TEST_SIGN_ROOT 'ChengziWeChatCollector\ChengziWeChatCollector.exe'
    $global:LASTEXITCODE = 0
    if ($script -eq 'package_release.py') {
        $global:events.Add('package')
        if ($args[-1] -ne '--require-signed') { throw 'Package must require signed input.' }
        if (-not ([IO.File]::ReadAllText($collector)).EndsWith('-signed')) { throw 'Unsigned payload packaged.' }
        $manifest = @{
            version = '9.9.9'
            authenticode = if ($env:TEST_SIGN_SCENARIO -eq 'unverified-package') { 'unsigned' } else { 'signed' }
            exeSha256 = (Get-FileHash -LiteralPath $collector -Algorithm SHA256).Hash.ToLowerInvariant()
        }
        $manifest | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $release 'manifest.json') -Encoding UTF8
    } elseif ($script -eq 'build_launcher.py') {
        $global:events.Add('build-launcher')
        [IO.File]::WriteAllText((Join-Path $release 'ChengziWeChatCollector-Setup-9.9.9.exe'), 'synthetic launcher')
        [IO.File]::WriteAllText((Join-Path $release 'ChengziWeChatCollector-Setup-9.9.9.sha256.txt'), 'stale unsigned checksum')
    } else { throw 'Unexpected build command.' }
}
try {
    & $env:TEST_SIGN_SCRIPT -ReleaseDir (Join-Path $env:TEST_SIGN_ROOT 'release') `
      -PythonPath synthetic-python.exe -PfxPath (Join-Path $env:TEST_SIGN_ROOT 'synthetic.pfx') `
      -PfxPassword (ConvertTo-SecureString 'synthetic-no-real-secret' -AsPlainText -Force)
    $passed = $true
} catch {
    $passed = $false
    $message = $_.Exception.Message
}
@{ success=$passed; message=$message; events=@($global:events) } | ConvertTo-Json -Depth 4 |
    Set-Content -LiteralPath (Join-Path $env:TEST_SIGN_ROOT 'result.json') -Encoding UTF8
""", encoding="utf-8-sig")
        env = dict(os.environ, TEST_SIGN_ROOT=str(root), TEST_SIGN_SCENARIO=scenario,
                   TEST_SIGN_SCRIPT=str(ROOT / "sign_release.ps1"))
        env = {key: value for key, value in env.items() if key.upper() != "PSMODULEPATH"}
        outcome = subprocess.run(
            ["powershell.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-File", str(runner)],
            env=env, capture_output=True, timeout=30,
        )
        self.assertEqual(outcome.returncode, 0, outcome.stderr.decode(errors="replace"))
        return json.loads((root / "result.json").read_text(encoding="utf-8-sig"))

    def test_signs_payload_before_packaging_and_launcher_last(self):
        with tempfile.TemporaryDirectory() as temporary:
            outcome = self.invoke(temporary)
            self.assertTrue(outcome["success"], outcome)
            events = outcome["events"]
            self.assertLess(events.index("sign-collector"), events.index("package"))
            self.assertLess(events.index("package"), events.index("build-launcher"))
            self.assertLess(events.index("build-launcher"), events.index("sign-launcher"))
            self.assertEqual(events.count("build-launcher"), 1)
            release = Path(temporary) / "release"
            launcher = release / "ChengziWeChatCollector-Setup-9.9.9.exe"
            digest = hashlib.sha256(launcher.read_bytes()).hexdigest()
            self.assertEqual((release / "ChengziWeChatCollector-Setup-9.9.9.sha256.txt").read_text(),
                             f"{digest}  {launcher.name}\n")
            proof = json.loads((release / "signature.json").read_text())
            self.assertEqual(proof["installerSha256"], digest)
            self.assertEqual(proof["collectorSha256"], hashlib.sha256(
                (Path(temporary) / "ChengziWeChatCollector" / "ChengziWeChatCollector.exe").read_bytes()).hexdigest())

    def test_invalid_or_failed_signing_cannot_produce_release_proof(self):
        for scenario in ("fail-outer", "missing-timestamp", "different-cert", "unverified-package", "existing"):
            with self.subTest(scenario=scenario), tempfile.TemporaryDirectory() as temporary:
                outcome = self.invoke(temporary, scenario)
                self.assertFalse(outcome["success"], outcome)
                release = Path(temporary) / "release"
                self.assertFalse((release / "signature.json").exists())
                self.assertFalse((release / "ChengziWeChatCollector-Setup-9.9.9.sha256.txt").exists())
                if scenario == "existing":
                    self.assertEqual(outcome["events"], [])
                    self.assertEqual((release / "ChengziWeChatCollector-Setup-9.9.9.exe").read_bytes(), b"existing release")
                if scenario in ("missing-timestamp", "unverified-package"):
                    self.assertNotIn("build-launcher", outcome["events"])
                expected = {
                    "fail-outer": "Signing failed",
                    "missing-timestamp": "trusted, timestamped",
                    "different-cert": "different certificates",
                    "unverified-package": "signature was not verified",
                    "existing": "already contains a launcher",
                }
                self.assertIn(expected[scenario], outcome["message"])


if __name__ == "__main__":
    unittest.main()
