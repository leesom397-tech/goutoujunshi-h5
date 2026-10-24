"""Six private candidate stages; selectors/config arrive only in runtime memory."""
import hashlib
import importlib
import json
from pathlib import Path
import re
import sys
import time

from background_reader import BackgroundCaptureError
from macos_candidate_database_probe import Rejected,need
from macos_candidate_contact_selection import diagnose_and_select
from macos_candidate_source import CandidateSession,capture_selected_history,selected_request
from macos_sns_inspection import inspect_selected_sns
from macos_moments import capture_moments_from_source

STAGES=("contactDiagnostic","contactSelection","history","snsInspection","momentsProduction","voice")
VOICE_FILES={"macos_candidate_voice_probe.py":"e10a273bfde3519e09174f59097412d2550cb1ec2854392865dc9252cd626af1",
             "macos_candidate_voice_worker.py":"f6f5deba90ae1f5092b61719f879cffad4814ce6ab506d1385de517961d7272b"}


def _reason(error):
    if isinstance(error,BackgroundCaptureError) and re.fullmatch(r"[A-Z_]{1,80}",error.code):return error.code
    if isinstance(error,Rejected) and str(error) in {"selected-visible-identifier-unverified","selected-visible-identifier-collision",
            "selected-contact-rejected","selected-contact-unverified","selected-username-storage-unsupported",
            "source-grant-expired","active-account-changed","candidate-generation-changed"}:return str(error)
    return "stage-rejected" if isinstance(error,Rejected) else "stage-failed"


def _moments(session,internal):
    source=session.open_source()
    try:
        chosen=selected_request(source,internal,by_alias=False)
        request={"kind":"moments","friend":chosen["friend"],"contactId":chosen["contactId"],
                 "accountKey":chosen["accountKey"],"limit":1000,"allVisible":False}
        batch=capture_moments_from_source(request,lambda *_args:None,None,source)
    finally:source.close()
    session.verify_scope()
    rows=batch["records"];coverage=batch.get("coverage",{})
    number=lambda value:value if type(value)is int and 0<=value<=1_000_000 else 0
    result={"recordCount":len(rows),"captionCount":sum(bool(row.get("text")) for row in rows),
        "timestampCount":sum(bool(row.get("at")) for row in rows),
        "sourceIdCount":sum(bool(row.get("source",{}).get("sourceRecordId")) for row in rows),
        "stablePostIdCount":sum(str(row.get("id","")).startswith("mac-sns:") for row in rows),
        "pinnedCount":sum(row.get("source",{}).get("pinned") is True for row in rows),
        "cachedMediaCount":sum(number(row.get("source",{}).get("cachedMediaCount")) for row in rows),
        "imageReadCount":sum(len(row.get("images",[])) for row in rows),
        "coverage":{"scope":"local-cache" if coverage.get("scope")=="local-cache" else "unknown",
            "complete":coverage.get("complete") is True,"stopReason":"cache-only" if coverage.get("stopReason")=="cache-only" else "unknown",
            "cacheComplete":coverage.get("cacheComplete") is True,"imageOmittedCount":number(coverage.get("imageOmittedCount")),
            "unreadableCount":number(coverage.get("unreadableCount"))},"contentIncluded":False}
    batch.clear()
    return result


def run_selected_pipeline(session,selector,*,display=None,pages=2,page_size=100,voice_module=None,
                          voice_options=None,on_stage=None,on_diagnostics=None):
    """Resolve visible ID once; subsequent readers use only its internal username.

    A failed data stage does not suppress later evidence while the same live
    account proof remains valid. Scope failure stops all following stages.
    """
    need(on_stage is None or callable(on_stage),"pipeline-callback-rejected")
    started=time.monotonic();results={};scope_valid=True
    def emit(stage,status,elapsed,result=None,reason=None):
        value={"stage":stage,"status":status,"stageSeconds":round(elapsed,2),"elapsedSeconds":round(time.monotonic()-started,2)}
        if result is not None:value["result"]=result
        if reason is not None:value["reason"]=reason
        if on_stage is not None:on_stage(value)
    def guard():
        nonlocal scope_valid
        try:session.verify_scope();return True
        except Exception:scope_valid=False;return False
    def record(stage,work):
        tick=time.monotonic()
        if not scope_valid or not guard():
            results[stage]={"status":"skipped","reason":"source-scope-unavailable"};emit(stage,"skipped",0,reason="source-scope-unavailable");return
        try:
            value=work()
            need(guard(),"active-account-changed")
            results[stage]={"status":"completed","result":value};emit(stage,"completed",time.monotonic()-tick,result=value)
        except Exception as error:
            results[stage]={"status":"failed","reason":_reason(error)};emit(stage,"failed",time.monotonic()-tick,reason=_reason(error))
            guard()
    def diagnostic(value):
        results["contactDiagnostic"]={"status":"completed","result":value}
        emit("contactDiagnostic","completed",time.monotonic()-selection_start,result=value)
        if on_diagnostics is not None:on_diagnostics(value)
    selection_start=time.monotonic()
    try:
        selected=diagnose_and_select(session,selector,display=display,on_diagnostics=diagnostic,
            on_stage=lambda event:on_stage({"stage":event["stage"],"status":"progress",**{key:value for key,value in event.items() if key!="stage"}}) if on_stage is not None else None)
        internal=selected.contact_id
        results["contactSelection"]={"status":"completed","result":selected.public()}
        emit("contactSelection","completed",time.monotonic()-selection_start,result=selected.public())
    except Exception as error:
        results.setdefault("contactDiagnostic",{"status":"failed","reason":_reason(error)})
        results["contactSelection"]={"status":"failed","reason":_reason(error)}
        emit("contactSelection","failed",time.monotonic()-selection_start,reason=_reason(error))
        for stage in STAGES[2:]:results[stage]={"status":"skipped","reason":"contact-not-verified"}
        return {"stages":results,"scopeValid":guard(),"captureCompatibilityValidated":False,"contentIncluded":False}
    collector=voice_module.VoiceReferenceCollector() if voice_module is not None else None
    record("history",lambda:capture_selected_history(session,internal,by_alias=False,pages=pages,page_size=page_size,on_batch=collector))
    record("snsInspection",lambda:inspect_selected_sns(session,internal,by_alias=False))
    record("momentsProduction",lambda:_moments(session,internal))
    if voice_module is None or voice_options is None:
        results["voice"]={"status":"skipped","reason":"voice-runtime-not-configured"};emit("voice","skipped",0,reason="voice-runtime-not-configured")
    elif not collector.references:
        results["voice"]={"status":"skipped","reason":"no-eligible-voice-reference"};emit("voice","skipped",0,reason="no-eligible-voice-reference")
    else:record("voice",lambda:voice_module.probe_selected_voice(session,internal,by_alias=False,references=collector.references,**voice_options))
    return {"stages":results,"scopeValid":guard(),"captureCompatibilityValidated":False,"contentIncluded":False}


def _voice_from_directory(directory):
    root=Path(directory).absolute()
    need(root.resolve()==root and root.is_dir(),"voice-probe-directory-rejected")
    for name,digest in VOICE_FILES.items():
        path=root/name
        need(not path.is_symlink() and hashlib.sha256(path.read_bytes()).hexdigest()==digest,"voice-probe-code-rejected")
    sys.path.insert(0,str(root))
    module=importlib.import_module("macos_candidate_voice_probe")
    need(Path(module.__file__).resolve()==root/"macos_candidate_voice_probe.py","voice-probe-code-rejected")
    return module


def main():
    """One bounded JSON stdin config; never save/echo selectors or private paths."""
    raw=sys.stdin.readline(16385)
    need(0<len(raw)<=16384,"pipeline-config-rejected")
    config=json.loads(raw)
    allowed={"receipt","visibleId","display","pages","pageSize","voiceProbeDirectory","voicePython","modelRoot","transcriberSource"}
    need(isinstance(config,dict) and not set(config)-allowed and {"receipt","visibleId"}<=set(config),"pipeline-config-rejected")
    from macos_candidate_source_preflight import check_dependencies,verify_manifest
    need(verify_manifest(Path(__file__).resolve().parent/"manifest.json"),"package-integrity-rejected")
    preflight=check_dependencies()
    if not preflight["ok"]:return preflight
    voice_module=voice_options=None
    if "voiceProbeDirectory" in config:
        need({"voicePython","modelRoot"}<=set(config),"pipeline-voice-config-rejected")
        voice_module=_voice_from_directory(config["voiceProbeDirectory"])
        voice_options={"voice_python":Path(config["voicePython"]),"model_root":Path(config["modelRoot"])}
        if "transcriberSource" in config:voice_options["transcriber_source"]=Path(config["transcriberSource"])
    def emit(value):print(json.dumps(value,ensure_ascii=True,separators=(",",":")),flush=True)
    from macos_candidate_code_identity import inspect_code_identity,compare_code_identity
    before=inspect_code_identity(config["receipt"])
    session=CandidateSession(config["receipt"],seconds=600,authentication_seconds=600,human_setup=True,
                             progress=lambda view:emit({"event":"setup-progress","setup":view}))
    result={"mode":"macos-270135-six-stage-private-test","ok":False,"contentIncluded":False,"captureCompatibilityValidated":False}
    try:
        with session:
            result.update(run_selected_pipeline(session,config["visibleId"],display=config.get("display"),
                pages=config.get("pages",2),page_size=config.get("pageSize",100),voice_module=voice_module,
                voice_options=voice_options,on_stage=emit))
        result["ok"]=bool(result.get("scopeValid") and result.get("stages",{}).get("contactSelection",{}).get("status")=="completed"
                          and not any(stage.get("status")=="failed" for stage in result.get("stages",{}).values()))
    except KeyboardInterrupt:result["reason"]="source-cancelled"
    except Exception as error:result["reason"]=_reason(error)
    finally:
        session.close();result.update(session.status)
        try:
            after=inspect_code_identity(config["receipt"])
            result["codeIdentity"]={"before":before,"after":after,"comparison":compare_code_identity(before,after)}
        except Exception:
            result["codeIdentity"]={"before":before,"after":{"ok":False,"reason":"public-code-identity-unavailable"}}
            result["ok"]=False
    return result


if __name__=="__main__":
    try:output=main()
    except Exception:output={"ok":False,"reason":"private-pipeline-rejected","contentIncluded":False}
    print(json.dumps(output,ensure_ascii=True,separators=(",",":")))
    raise SystemExit(0 if output.get("ok") else 1)
