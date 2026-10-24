"""Prepare an integrity-checked 270135 candidate without touching live WeChat.

Standard library only. Does not start/stop apps, inspect processes, read account
containers, build/load an observer, or alter production support. The temporary
copy is retained for a separately authorized, state-aware runtime test.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import platform
import shutil
import stat
import sys
import tempfile

import macos_candidate_probe as probe
import macos_candidate_runtime as runtime
import macos_official_client_smoke as smoke


SOURCES = {
    "__init__.py": "070e46bc11cb891cea434c7d1bd54f56fc731d3997a8b2211f93786989dc1966",
    "core/__init__.py": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "core/_path_resolver.py": "78d635c80a1e2209403c0b35c5ee02e92e47df9a9ab00d6863663f5fc6e14ceb",
    "macos_debug_app.py": "866a5395166700493d1b3606f417b8f2082acd10949ca3e161ef7c345a1d3816",
}


def _write_private_receipt(path, result):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            descriptor = None
            json.dump(result, output, ensure_ascii=False, indent=2)
    finally:
        if descriptor is not None:
            os.close(descriptor)


def _debug_module():
    from macos_candidate_components import load_debug_module
    return load_debug_module(SOURCES)


def prepare():
    result = {"mode": "macos-270135-prepare-only", "ok": False, "appStarted": False,
              "appStopped": False, "accountDataRead": False, "observerBuilt": False,
              "permissionsChanged": False, "originalSignatureChanged": False,
              "captureCompatible": False, "captureValidated": False, "allowlistChanged": False}
    work, root = None, None
    try:
        if sys.platform != "darwin" or platform.machine() != "arm64":
            raise runtime.DiagnosticError("apple-silicon-mac-required")
        app = Path("/Applications/WeChat.app")
        result["officialSignature"] = smoke._verified_bundle(app)
        result["staticCandidate"] = probe.probe_candidate(app)
        if not result["staticCandidate"]["matchesInspectedCandidate"]:
            raise runtime.DiagnosticError("candidate-public-binaries-not-matched")
        debug = _debug_module()
        policy_before = dict(debug._WECHAT_AD_HOC_POLICIES)
        if probe.CANDIDATE in policy_before:
            raise runtime.DiagnosticError("candidate-production-policy-review-required")
        expected = runtime._candidate_entitlements(debug, debug._entitlements(app), result["staticCandidate"])
        root = Path.home() / "Library/Caches/ChengziCandidateDiagnostics"
        root.mkdir(mode=0o700, exist_ok=True)
        identity = root.lstat()
        if root.is_symlink() or identity.st_uid != os.getuid() or stat.S_IMODE(identity.st_mode) != 0o700:
            raise runtime.DiagnosticError("candidate-private-directory-rejected")
        root = root.resolve(strict=True)
        if shutil.disk_usage(root).free < 4 * 1024 ** 3:
            raise runtime.DiagnosticError("candidate-four-gib-free-space-required")
        work = Path(tempfile.mkdtemp(prefix="prepare-270135-", dir=root)).resolve()
        work.chmod(0o700)
        shadow, digest = runtime._prepare_shadow(app, work, debug, expected)
        smoke._verified_bundle(app)
        if debug._bundle_source_digest(app) != digest or debug._WECHAT_AD_HOC_POLICIES != policy_before:
            raise runtime.DiagnosticError("candidate-original-or-policy-changed")
        result.update(ok=True, copyIntegrityVerified=True, originalUnchangedVerified=True,
                      productionPolicyUnchangedVerified=True, sourceBundleDigest=digest.hex(),
                      candidatePath=str(shadow), workDirectory=str(work),
                      nextStep="runtime-launch-requires-live-state-check")
        _write_private_receipt(work / "prepare-receipt.json", result)
    except Exception as error:
        result["reason"] = (str(error) if type(error) in (runtime.DiagnosticError, smoke.SmokeError)
                            else "candidate-preparation-failed")
        result["errorType"] = type(error).__name__
        if work is not None and root is not None:
            try:
                if work.is_symlink() or work.parent != root or not work.name.startswith("prepare-270135-"):
                    raise runtime.DiagnosticError("candidate-cleanup-path-rejected")
                shutil.rmtree(work)
            except Exception:
                result["temporaryCleanupComplete"] = False
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.parse_args()
    result = prepare()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
