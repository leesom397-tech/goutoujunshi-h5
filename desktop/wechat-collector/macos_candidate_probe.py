"""Read-only comparison of public WeChat binaries, never a capture permit.

Runs on extracted official bundles on Windows or on a Mac. It does not launch
WeChat, read account data, extract a key, patch code or change signing policy.
The provider uses a system PBKDF import, not a version-specific opcode offset.
Static ABI evidence therefore guides the next runtime check; it cannot replace
login-time call-shape and private-copy lifecycle validation.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import mmap
import os
from pathlib import Path
import plistlib
import struct


ARM64 = 0x0100000C
KDF_SYMBOL = b"_CCKeyDerivationPBKDF"
MAX_BINARY = 1024 * 1024 * 1024
BASELINE = ("4.1.15", "270102")
CANDIDATE = ("4.1.15", "270135")
PUBLIC_BINARIES = (
    "Contents/MacOS/WeChat",
    "Contents/Resources/wechat.dylib",
    "Contents/Resources/libxplayer.dylib",
    "Contents/Frameworks/libxplayer.dylib",
    "Contents/MacOS/XPlayer.app/Contents/MacOS/XPlayer",
    "Contents/MacOS/XPlayer.app/Contents/Resources/libxplayercore.dylib",
    "Contents/MacOS/XPlayer.app/Contents/Frameworks/libxplayercore.dylib",
)
# Read from Tencent's official 270135 DMG, whose complete SHA-256 was checked
# against the official-download receipt and independently against Homebrew.
# These hashes identify a candidate; they do not allow launching an initializer.
CANDIDATE_DMG_SHA256 = "ceea355d5c93419658f777fdd1010f9b19d14fab6dc552af9c208cddad7f248f"
CANDIDATE_BINARY_SHA256 = dict(zip(PUBLIC_BINARIES, (
    "c74cdb70a5e261bf264e71e38a646f1f936469c1d7d31c7c490588166e892c53",
    "5f5a81c4d8b000dec1c7203738fc4dba75ce752b55874fc1b6b5869f9dfb1027",
    "578ed074776d4b4e67defda35cc91dea92c86fb9a6c8244d0f4a2050dd3f9637",
    "93f0b7e48be2097a7614913d54a2688b186e62a85c6f219718616ce7583d6a46",
    "ea15b539c327d67d0204ec072bf62b1b3a26020b8a2e36467b47e5d7388c8236",
    "27ba589224efbe2696c78151556f6e924aa99e936412ec2c7561fab2d72c4443",
    "3a6a6c18a7c9ba3bf70c136336ce0631c4d5ee9b6f8245c5d38fdf98b250cce6",
)))


class ProbeError(ValueError):
    """Fixed codes only: never expose account paths or raw binary content."""


def _range(offset, size, limit):
    if offset < 0 or size < 0 or offset > limit or size > limit - offset:
        raise ProbeError("macho-range-invalid")


def _slice(data):
    if len(data) < 32:
        raise ProbeError("macho-header-truncated")
    fat = {b"\xca\xfe\xba\xbe": (">", False), b"\xbe\xba\xfe\xca": ("<", False),
           b"\xca\xfe\xba\xbf": (">", True), b"\xbf\xba\xfe\xca": ("<", True)}.get(bytes(data[:4]))
    if fat is None:
        return 0, len(data)
    endian, wide = fat
    count = struct.unpack_from(endian + "I", data, 4)[0]
    stride = 32 if wide else 20
    if not 0 < count <= 16:
        raise ProbeError("macho-fat-count-invalid")
    _range(8, count * stride, len(data))
    found, ranges = [], []
    for i in range(count):
        values = struct.unpack_from(endian + ("IIQQII" if wide else "IIIII"), data, 8 + i * stride)
        cpu, subtype, offset, size = values[:4]
        _range(offset, size, len(data))
        if offset < 8 + count * stride or size < 32:
            raise ProbeError("macho-fat-range-invalid")
        if any(offset < end and start < offset + size for start, end in ranges):
            raise ProbeError("macho-fat-overlap")
        ranges.append((offset, offset + size))
        if cpu == ARM64 and (subtype & 0xFFFFFF) == 0:
            found.append((offset, size))
    if len(found) != 1:
        raise ProbeError("macho-arm64-slice-not-unique")
    return found[0]


def _entitlements(data):
    if len(data) < 12:
        raise ProbeError("signature-blob-truncated")
    magic, size, count = struct.unpack_from(">III", data)
    if magic != 0xFADE0CC0 or size > len(data) or size < 12 or count > 128:
        raise ProbeError("signature-blob-invalid")
    _range(12, count * 8, size)
    values = []
    for i in range(count):
        kind, offset = struct.unpack_from(">II", data, 12 + i * 8)
        _range(offset, 8, size)
        blob_magic, blob_size = struct.unpack_from(">II", data, offset)
        _range(offset, blob_size, size)
        if blob_size < 8 or offset < 12 + count * 8:
            raise ProbeError("signature-entry-invalid")
        if kind == 5:
            if blob_magic != 0xFADE7171 or blob_size > 1024 * 1024:
                raise ProbeError("signature-entitlements-invalid")
            try:
                value = plistlib.loads(data[offset + 8:offset + blob_size])
            except (ValueError, plistlib.InvalidFileException):
                raise ProbeError("signature-entitlements-invalid") from None
            if not isinstance(value, dict):
                raise ProbeError("signature-entitlements-invalid")
            values.append(value)
    if len(values) > 1:
        raise ProbeError("signature-entitlements-not-unique")
    return values[0] if values else None


def inspect_macho(data):
    """Parse bounded arm64 metadata. Embedded signatures are NOT authenticated."""
    base, length = _slice(data)
    header = struct.unpack_from("<8I", data, base)
    magic, cpu, subtype, _, count, command_bytes, _, _ = header
    if magic != 0xFEEDFACF or cpu != ARM64 or (subtype & 0xFFFFFF) != 0:
        raise ProbeError("macho-arm64-header-invalid")
    if count > 4096 or command_bytes > 4 * 1024 * 1024:
        raise ProbeError("macho-load-commands-unbounded")
    _range(32, command_bytes, length)
    cursor, text, symtabs, signatures = 32, [], [], []
    encrypted = False
    for _ in range(count):
        _range(cursor, 8, 32 + command_bytes)
        kind, size = struct.unpack_from("<II", data, base + cursor)
        if size < 8 or size % 4:
            raise ProbeError("macho-command-size-invalid")
        _range(cursor, size, 32 + command_bytes)
        at = base + cursor
        if kind == 0x19:  # LC_SEGMENT_64
            if size < 72:
                raise ProbeError("macho-segment-truncated")
            nsects = struct.unpack_from("<I", data, at + 64)[0]
            if 72 + nsects * 80 != size:
                raise ProbeError("macho-sections-invalid")
            for i in range(nsects):
                section = at + 72 + i * 80
                name = data[section:section + 16].rstrip(b"\0")
                segment = data[section + 16:section + 32].rstrip(b"\0")
                if name == b"__text" and segment == b"__TEXT":
                    amount, offset = struct.unpack_from("<QI", data, section + 40)
                    _range(offset, amount, length)
                    if amount == 0 or offset < 32 + command_bytes:
                        raise ProbeError("macho-text-invalid")
                    text.append((offset, amount))
        elif kind == 2:  # LC_SYMTAB; imports must be N_UNDF | N_EXT, not strings.
            if size != 24:
                raise ProbeError("macho-symtab-command-invalid")
            symtabs.append(struct.unpack_from("<4I", data, at + 8))
        elif kind == 0x1D:  # LC_CODE_SIGNATURE
            if size != 16:
                raise ProbeError("macho-signature-command-invalid")
            signatures.append(struct.unpack_from("<II", data, at + 8))
        elif kind in (0x21, 0x2C):  # LC_ENCRYPTION_INFO[_64]
            if size < 20:
                raise ProbeError("macho-encryption-command-invalid")
            encrypted |= struct.unpack_from("<I", data, at + 16)[0] != 0
        cursor += size
    if cursor != 32 + command_bytes or len(text) != 1 or len(symtabs) > 1 or len(signatures) > 1:
        raise ProbeError("macho-layout-ambiguous")
    imports = 0
    for symoff, nsyms, stroff, strsize in symtabs:
        if nsyms > 5_000_000 or strsize > 128 * 1024 * 1024:
            raise ProbeError("macho-symbols-unbounded")
        _range(symoff, nsyms * 16, length)
        _range(stroff, strsize, length)
        for i in range(nsyms):
            index, ntype, _, _, value = struct.unpack_from("<IBBHQ", data, base + symoff + i * 16)
            if ntype != 1 or value != 0:
                continue
            if index >= strsize:
                raise ProbeError("macho-symbol-name-out-of-bounds")
            start = base + stroff + index
            end = start + len(KDF_SYMBOL) + 1
            if end <= base + stroff + strsize and data[start:end] == KDF_SYMBOL + b"\0":
                imports += 1
    entitlements = None
    for offset, size in signatures:
        _range(offset, size, length)
        if size > 16 * 1024 * 1024:
            raise ProbeError("macho-signature-unbounded")
        entitlements = _entitlements(data[base + offset:base + offset + size])
    offset, size = text[0]
    return {"arm64TextSha256": hashlib.sha256(data[base + offset:base + offset + size]).hexdigest(),
            "kdfUndefinedImportCount": imports, "symbolTablePresent": bool(symtabs),
            "encryptedCode": encrypted, "embeddedEntitlements": entitlements,
            "signatureVerified": False}


def inspect_file(path):
    path = Path(path)
    if path.is_symlink():
        raise ProbeError("binary-link-rejected")
    with path.open("rb") as handle:
        before = os.fstat(handle.fileno())
        if not 32 <= before.st_size <= MAX_BINARY:
            raise ProbeError("binary-size-invalid")
        with mmap.mmap(handle.fileno(), 0, access=mmap.ACCESS_READ) as data:
            result = inspect_macho(data)
            result["binarySha256"] = hashlib.sha256(data).hexdigest()
        after = os.fstat(handle.fileno())
        entry = path.lstat()
        identity = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns)
        if path.is_symlink() or identity(before) != identity(after) or identity(before) != identity(entry):
            raise ProbeError("binary-changed-during-probe")
    return result


def _bundle_file(bundle, relative):
    bundle = Path(bundle)
    if bundle.is_symlink():
        raise ProbeError("bundle-link-rejected")
    path = bundle
    for part in Path(relative).parts:
        path /= part
        if path.is_symlink():
            raise ProbeError("bundle-entry-link-rejected")
    if not path.resolve(strict=True).is_relative_to(bundle.resolve(strict=True)):
        raise ProbeError("bundle-entry-escaped")
    return path


def inspect_bundle(bundle):
    info = plistlib.loads(_bundle_file(bundle, "Contents/Info.plist").read_bytes())
    if info.get("CFBundleIdentifier") != "com.tencent.xinWeChat" or info.get("CFBundleExecutable") != "WeChat":
        raise ProbeError("bundle-identity-invalid")
    return {"version": str(info.get("CFBundleShortVersionString", "")),
            "build": str(info.get("CFBundleVersion", "")),
            "binaries": {p: inspect_file(_bundle_file(bundle, p)) for p in PUBLIC_BINARIES}}


def compare_bundles(baseline, candidate):
    left, right = inspect_bundle(baseline), inspect_bundle(candidate)
    if (left["version"], left["build"]) != BASELINE or (right["version"], right["build"]) != CANDIDATE:
        raise ProbeError("comparison-build-pair-invalid")
    rows = []
    for path in PUBLIC_BINARIES:
        a, b = left["binaries"][path], right["binaries"][path]
        rows.append({"binary": path, "baselineBinarySha256": a["binarySha256"],
                     "candidateBinarySha256": b["binarySha256"],
                     "baselineArm64TextSha256": a["arm64TextSha256"],
                     "candidateArm64TextSha256": b["arm64TextSha256"],
                     "sameArm64Text": a["arm64TextSha256"] == b["arm64TextSha256"],
                     "baselineKdfUndefinedImportCount": a["kdfUndefinedImportCount"],
                     "candidateKdfUndefinedImportCount": b["kdfUndefinedImportCount"],
                     "candidateEncryptedCode": b["encryptedCode"]})
    main = "Contents/MacOS/WeChat"
    old_ent, new_ent = left["binaries"][main]["embeddedEntitlements"], right["binaries"][main]["embeddedEntitlements"]
    same_entitlements = old_ent is not None and new_ent is not None and old_ent == new_ent
    old_key = left["binaries"]["Contents/Resources/wechat.dylib"]
    key = right["binaries"]["Contents/Resources/wechat.dylib"]
    abi_candidate = (old_key["kdfUndefinedImportCount"] == key["kdfUndefinedImportCount"] == 1
                     and not old_key["encryptedCode"] and not key["encryptedCode"] and same_entitlements)
    return {"mode": "macos-public-binary-comparison", "baselineBuild": "4.1.15/270102",
            "candidateBuild": "4.1.15/270135", "staticAbiCandidate": abi_candidate,
            "captureCompatible": False, "captureValidated": False, "allowlistChanged": False,
            "accountDataRead": False, "processMemoryRead": False, "signatureVerified": False,
            "sameEmbeddedEntitlements": same_entitlements,
            "candidateEntitlementKeys": sorted(new_ent or {}),
            "binaries": rows,
            "requiredRuntimeChecks": ["official-signature-and-installed-file-digests",
                                      "normal-sip-and-user-granted-permissions",
                                      "temporary-copy-launch-and-xplayer-registration",
                                      "login-time-kdf-shape-and-selected-database-validation",
                                      "temporary-copy-cleanup-and-original-client-recovery"],
            "decision": "runtime-validation-required" if abi_candidate else "static-difference-review-required"}


def probe_candidate(bundle):
    """Small installed-bundle check: no baseline download or third-party libs."""
    evidence = inspect_bundle(bundle)
    same_build = (evidence["version"], evidence["build"]) == CANDIDATE
    hashes = {path: evidence["binaries"][path]["binarySha256"] == digest
              for path, digest in CANDIDATE_BINARY_SHA256.items()}
    key = evidence["binaries"]["Contents/Resources/wechat.dylib"]
    matches = same_build and all(hashes.values()) and key["kdfUndefinedImportCount"] == 1 and not key["encryptedCode"]
    return {"mode": "macos-installed-candidate-static-probe", "version": evidence["version"],
            "build": evidence["build"], "expectedOfficialDmgSha256": CANDIDATE_DMG_SHA256,
            "matchesInspectedCandidate": matches, "binaryMatches": hashes,
            "kdfUndefinedImportCount": key["kdfUndefinedImportCount"],
            "captureCompatible": False, "captureValidated": False, "allowlistChanged": False,
            "signatureVerified": False, "accountDataRead": False, "processMemoryRead": False,
            "decision": "runtime-validation-required" if matches else "candidate-binary-mismatch"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline-bundle")
    parser.add_argument("--candidate-bundle", required=True)
    parser.add_argument("--output")
    args = parser.parse_args()
    try:
        result = (compare_bundles(args.baseline_bundle, args.candidate_bundle) if args.baseline_bundle
                  else probe_candidate(args.candidate_bundle))
    except (OSError, ValueError, plistlib.InvalidFileException) as exc:
        result = {"captureCompatible": False, "error": str(exc) if isinstance(exc, ProbeError) else "public-bundle-unreadable"}
    output = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        with Path(args.output).open("x", encoding="utf-8") as handle:
            handle.write(output)
    else:
        print(output, end="")
    return 2 if "error" in result else 0


if __name__ == "__main__":
    raise SystemExit(main())
