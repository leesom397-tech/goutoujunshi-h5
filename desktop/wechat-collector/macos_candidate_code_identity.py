"""Read public code identity at one receipt-bound Candidate; never read TCC/data."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import stat
import subprocess
import sys


class IdentityError(ValueError):
    pass


def need(condition, code):
    if not condition:
        raise IdentityError(code)


def file_hash(path, *, optional=False, maximum=1024 * 1024 * 1024):
    path=Path(path)
    try: before=path.lstat()
    except FileNotFoundError:
        need(optional,"code-file-missing")
        return None
    need(not path.is_symlink() and path.resolve()==path and stat.S_ISREG(before.st_mode)
         and 0<=before.st_size<=maximum,"code-file-rejected")
    identity=lambda info:(info.st_dev,info.st_ino,info.st_size,info.st_mtime_ns)
    fd=os.open(path,os.O_RDONLY|getattr(os,"O_NOFOLLOW",0)|getattr(os,"O_CLOEXEC",0)|getattr(os,"O_BINARY",0))
    try:
        need(identity(os.fstat(fd))==identity(before),"code-file-changed")
        digest=hashlib.sha256()
        while True:
            chunk=os.read(fd,1024*1024)
            if not chunk:break
            digest.update(chunk)
        need(identity(os.fstat(fd))==identity(before) and identity(path.lstat())==identity(before),"code-file-changed")
        return digest.hexdigest()
    finally:os.close(fd)


def signing_fields(raw):
    """Only whitelist public codesign fields; never return its path-bearing text."""
    need(isinstance(raw,str) and len(raw)<=65536,"codesign-output-rejected")
    match=re.search(r"^CDHash=([a-fA-F0-9]{40,64})\s*$",raw,re.M)
    need(match is not None,"code-cdhash-unavailable")
    team=re.search(r"^TeamIdentifier=([A-Z0-9]{1,32}|not set|\(not set\))\s*$",raw,re.M)
    need(team is not None,"code-team-unavailable")
    return {"cdHash":match.group(1).lower(),"teamIdentifier":"" if team.group(1) in ("not set","(not set)") else team.group(1),
            "signatureType":"adhoc" if re.search(r"^Signature=adhoc\s*$",raw,re.M)
            else "signed" if re.search(r"^Authority=",raw,re.M) else "unknown"}


def inspect_code_identity(receipt):
    need(sys.platform=="darwin","mac-required")
    import macos_candidate_device_runtime as device
    work,shadow,source_digest=device._load_receipt(receipt)
    info_path=shadow/"Contents/Info.plist"
    info=plistlib.loads(info_path.read_bytes())
    need(info.get("CFBundleIdentifier")=="com.tencent.xinWeChat" and info.get("CFBundleExecutable")=="WeChat",
         "candidate-code-bundle-rejected")
    verified=subprocess.run(["/usr/bin/codesign","--verify","--deep","--strict",str(shadow)],
                            capture_output=True,timeout=60,check=False)
    need(verified.returncode==0,"candidate-code-signature-rejected")
    details=subprocess.run(["/usr/bin/codesign","-d","--verbose=4",str(shadow)],
                           capture_output=True,text=True,timeout=15,check=False)
    need(details.returncode==0,"candidate-code-details-unavailable")
    signing=signing_fields(details.stderr)
    vendor=Path(__file__).resolve().parent/"vendor/chatlog_keeper"
    for relative,expected in device.EXTRA_SOURCES.items():
        need(file_hash(vendor/relative)==expected,"pinned-code-source-rejected")
    # Same pinned build-input formulas as the vendor modules. Do not import
    # them or create support directories: metadata can run before/after a live
    # CandidateSession in the same Python process without polluting its loader.
    helper_input=(vendor/"scripts/macos_memory_scan.c").read_bytes()
    helper_digest=hashlib.sha256(helper_input+b"\0chatlog-keeper-debugger-entitlements\0"
        +b"hardened-runtime-same-uid-bundle-generation-watch-v7"
        +plistlib.dumps({"com.apple.security.cs.debugger":True},fmt=plistlib.FMT_XML)).hexdigest()[:12]
    observer_digest=hashlib.sha256((vendor/"scripts/macos_wechat_key_capture.c").read_bytes()
        +b"\0chatlog-keeper-wechat-capture\0"+b"wechat-pbkdf2-startup-interpose-v6-status").hexdigest()[:12]
    support=work/"runtime-support/bin"
    legacy=shadow/"Contents/CodeResources"
    if legacy.is_symlink():
        need(legacy.resolve()==shadow/"Contents/_CodeSignature/CodeResources","code-resources-alias-rejected")
        legacy=legacy.resolve()
    return {"mode":"macos-270135-public-code-identity","ok":True,"receiptPathValidated":True,
        "sourceBundleDigest":source_digest.hex(),**signing,
        "mainExecutableSha256":file_hash(shadow/"Contents/MacOS/WeChat"),
        "infoPlistSha256":file_hash(info_path,maximum=1024*1024),
        "rootCodeResourcesSha256":file_hash(shadow/"Contents/_CodeSignature/CodeResources",maximum=16*1024*1024),
        "legacyCodeResourcesSha256":file_hash(legacy,optional=True,maximum=16*1024*1024),
        "watchdogSha256":file_hash(support/f"macos-memory-scan-{helper_digest}",optional=True,maximum=16*1024*1024),
        "observerSha256":file_hash(support/f"macos-wechat-key-capture-{observer_digest}.dylib",optional=True,maximum=16*1024*1024),
        "accountDataRead":False,"processesInspected":False,"appsStarted":False,"tccStateRead":False}


def compare_code_identity(before,after):
    fields=("sourceBundleDigest","cdHash","signatureType","teamIdentifier","mainExecutableSha256",
            "infoPlistSha256","rootCodeResourcesSha256","legacyCodeResourcesSha256")
    need(all(isinstance(value,dict) and value.get("ok") is True for value in (before,after)),"identity-comparison-rejected")
    return {"candidateCodeUnchanged":all(before.get(field)==after.get(field) for field in fields),
        "watchdogCodeUnchanged":None if before.get("watchdogSha256") is None else before.get("watchdogSha256")==after.get("watchdogSha256"),
        "observerCodeUnchanged":None if before.get("observerSha256") is None else before.get("observerSha256")==after.get("observerSha256"),
        "tccStateRead":False,"tccGrantPersistenceValidated":False}


class PrivateParser(argparse.ArgumentParser):
    def error(self,message):raise IdentityError("identity-arguments-rejected")


if __name__=="__main__":
    try:
        parser=PrivateParser(description=__doc__)
        parser.add_argument("--receipt",type=Path,required=True)
        output=inspect_code_identity(parser.parse_args().receipt)
    except IdentityError as error:output={"ok":False,"reason":str(error),"tccStateRead":False,"accountDataRead":False}
    except Exception:output={"ok":False,"reason":"public-code-identity-unavailable","tccStateRead":False,"accountDataRead":False}
    print(json.dumps(output,ensure_ascii=True,separators=(",",":")))
    raise SystemExit(0 if output.get("ok") else 1)
