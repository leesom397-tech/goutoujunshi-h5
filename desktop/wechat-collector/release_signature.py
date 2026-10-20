"""Inspect Windows release signatures without importing keys or changing trust."""
from __future__ import annotations

import base64
import json
import os
from pathlib import Path
import subprocess


def inspect_signature(executable: Path) -> dict:
    if os.name != "nt":
        return {"status": "NotChecked", "publisher": "", "thumbprint": "", "timestampThumbprint": ""}
    # The path is data in an environment variable, never PowerShell source.
    script = r"""
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$s = Get-AuthenticodeSignature -LiteralPath $env:CHENGZI_RELEASE_SIGNATURE_FILE
[ordered]@{
  status = [string]$s.Status
  publisher = if ($s.SignerCertificate) { [string]$s.SignerCertificate.Subject } else { '' }
  thumbprint = if ($s.SignerCertificate) { [string]$s.SignerCertificate.Thumbprint } else { '' }
  timestampThumbprint = if ($s.TimeStamperCertificate) { [string]$s.TimeStamperCertificate.Thumbprint } else { '' }
} | ConvertTo-Json -Compress
"""
    environment = dict(os.environ, CHENGZI_RELEASE_SIGNATURE_FILE=str(executable.resolve()))
    # Python may inherit PowerShell 7's module path. Windows PowerShell 5.1
    # cannot load those Security modules; let it restore its own default path.
    environment = {key: value for key, value in environment.items() if key.upper() != "PSMODULEPATH"}
    result = subprocess.run(
        ["powershell.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand",
         base64.b64encode(script.encode("utf-16le")).decode("ascii")],
        env=environment, capture_output=True, check=True, timeout=60,
    )
    return json.loads(result.stdout.decode("utf-8-sig"))


def release_signature(executable: Path, require_signed: bool = False) -> dict:
    signature = inspect_signature(executable)
    trusted = bool(
        signature.get("status") == "Valid"
        and signature.get("publisher")
        and signature.get("thumbprint")
        and signature.get("timestampThumbprint")
    )
    if require_signed and not trusted:
        raise SystemExit(
            f"Release requires a trusted, timestamped Authenticode signature: "
            f"{executable.name} ({signature.get('status', 'unknown')})."
        )
    return {
        "authenticode": "signed" if trusted else "unsigned-build-sign-with-sign_release.ps1-before-publishing",
        "signature": signature,
    }
