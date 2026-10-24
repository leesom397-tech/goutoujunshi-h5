"""Bounded selected-contact real voice probe inside an existing CandidateSession.

Production message/audio readers and SILK decoder are reused. No transcript or
audio is written, returned, printed, sent to a network, or used to grant access.
The voice subprocess returns only aggregate measurements over anonymous IPC.
"""
from __future__ import annotations

from dataclasses import dataclass
import json
import math
import os
from pathlib import Path
import re
import secrets
import socket
import subprocess
import time

from background_reader import _read_voice_page, _read_audio, _voice_duration
from macos_candidate_source import selected_request
from macos_candidate_voice_worker import PROTOCOL, MAX_AUDIO_BYTES, FAILURES, WORKER_FAILURES
from macos_album_snapshot import _finish_private_helper

MAX_CLIPS = 2
MAX_PACKET = 16384


class VoiceProbeError(RuntimeError):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def _need(condition, code):
    if not condition:
        raise VoiceProbeError(code)


@dataclass(frozen=True, repr=False)
class VoiceReference:
    account_id: str
    contact_id: str
    message_shard: str
    message_id: str
    local_id: str
    duration: float | None

    def reader_ref(self):
        return {"messageShard": self.message_shard, "messageId": self.message_id, "localId": self.local_id}


class VoiceReferenceCollector:
    """Private on_batch callback for capture_selected_history; keeps two refs."""
    def __init__(self):
        self._references = []

    @property
    def references(self):
        return tuple(self._references)

    def __call__(self, batch):
        _need(isinstance(batch, dict) and isinstance(batch.get("records"), list), "voice-history-invalid")
        for row in reversed(batch["records"]):
            if len(self._references) >= MAX_CLIPS:
                break
            source = row.get("source", {})
            if source.get("mediaKind") != "voice" or row.get("senderRole") != "other":
                continue
            duration = source.get("durationSeconds")
            if duration is not None and (type(duration) not in (int, float) or not math.isfinite(duration) or not 0 < duration <= 60):
                continue
            values = [source.get(name) for name in ("accountId", "sessionId", "messageShard", "messageId", "localId")]
            if not all(isinstance(value, str) and 0 < len(value) <= 200 and not any(ord(c) < 32 for c in value) for value in values):
                continue
            if (source.get("method") != "wechat-local-db" or source.get("senderVerified") is not True
                    or re.fullmatch(r"(?:message/)?message_\d+\.db", values[2]) is None
                    or re.fullmatch(r"[0-9]{1,20}", values[3]) is None or re.fullmatch(r"[0-9]{1,20}", values[4]) is None):
                continue
            reference = VoiceReference(*values, float(duration) if duration is not None else None)
            if reference not in self._references:
                self._references.append(reference)


class _AudioConnection:
    """Cap the production reader's existing CASE/BLOB bound before copying."""
    def __init__(self, connection, omitted=None):
        self._connection = connection
        self.omitted = set() if omitted is None else omitted

    def execute(self, sql, parameters=()):
        if "FROM Name2Id WHERE user_name=?" in sql:
            sql = sql.replace("user_name=?", "user_name COLLATE BINARY=?", 1)
        voice_query = "voice_data" in sql and "FROM VoiceInfo" in sql
        if voice_query:
            _need("CASE WHEN length(voice_data)<=? THEN voice_data ELSE NULL END" in sql
                  and "WHERE chat_name_id IN (" in sql and "svr_id IN (" in sql
                  and parameters and type(parameters[0]) is int, "voice-query-shape-rejected")
            parameters = (min(MAX_AUDIO_BYTES, parameters[0]), *parameters[1:])
        cursor = self._connection.execute(sql, parameters)
        if not voice_query:
            return cursor
        def rows():
            for row in cursor:
                if len(row) == 4 and type(row[2]) is int and row[2] > MAX_AUDIO_BYTES:
                    self.omitted.add(str(row[1]))
                yield row
        return rows()


class _AudioSource:
    def __init__(self, source):
        self._source = source
        self.omitted = set()

    def media_shards(self):
        for name, connection in self._source.media_shards():
            yield name, _AudioConnection(connection, self.omitted)


def _worker_result(value, *, nonce, count):
    _need(isinstance(value, dict) and value.get("protocol") == PROTOCOL and value.get("nonce") == nonce,
          "voice-private-result-rejected")
    if value.get("status") == "voice-worker-failed":
        _need(set(value) == {"protocol", "nonce", "status", "reason", "contentIncluded", "audioSaved", "transcriptSaved", "networkUsed"}
              and value["reason"] in WORKER_FAILURES
              and all(value[name] is False for name in ("contentIncluded", "audioSaved", "transcriptSaved", "networkUsed")),
              "voice-private-result-rejected")
        _need(False, value["reason"])
    expected = {"protocol", "nonce", "status", "modelVerified", "items", "contentIncluded", "audioSaved", "transcriptSaved", "networkUsed"}
    _need(set(value) == expected and value["status"] == "voice-inference-probed" and value["modelVerified"] is True
          and all(value[name] is False for name in ("contentIncluded", "audioSaved", "transcriptSaved", "networkUsed"))
          and isinstance(value["items"], list) and len(value["items"]) == count, "voice-private-result-rejected")
    keys = {"index", "decoded", "inferred", "sampleCount", "decodedSeconds", "framedSeconds", "textLength", "inferenceMs", "elapsedMs", "reason"}
    for index, item in enumerate(value["items"]):
        _need(isinstance(item, dict) and set(item) == keys and type(item["index"]) is int and item["index"] == index
              and type(item["decoded"]) is bool and type(item["inferred"]) is bool
              and all(type(item[key]) is int and 0 <= item[key] <= maximum for key, maximum in
                      (("sampleCount", 960000), ("textLength", 4000), ("inferenceMs", 120000), ("elapsedMs", 120000)))
              and all(type(item[key]) in (int, float) and math.isfinite(item[key]) and 0 <= item[key] <= 60
                      for key in ("decodedSeconds", "framedSeconds"))
              and item["reason"] in FAILURES | {""}, "voice-private-result-rejected")
        _need(not item["inferred"] or item["decoded"], "voice-private-result-rejected")
    return value


def run_voice_worker(blobs, *, voice_python, model_root, transcriber_source, deadline,
                     verify_scope, cancelled=lambda: False, popen=subprocess.Popen):
    _need(1 <= len(blobs) <= MAX_CLIPS and all(isinstance(blob, bytes) and 12 <= len(blob) <= MAX_AUDIO_BYTES for blob in blobs),
          "voice-byte-bound")
    executable, source = Path(voice_python), Path(transcriber_source)
    script = Path(__file__).resolve().with_name("macos_candidate_voice_worker.py")
    _need(executable.is_absolute() and executable.is_file() and source.is_absolute() and source.is_file()
          and not script.is_symlink() and script.is_file(), "voice-runtime-path-rejected")
    _need(0 < deadline - time.monotonic() <= 120, "voice-worker-timeout")
    parent, child_channel = socket.socketpair()
    child = None
    nonce = secrets.token_hex(32)
    try:
        descriptor = child_channel.fileno()
        child = popen([str(executable), "-I", "-B", str(script), "--private-fd", str(descriptor)],
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            pass_fds=(descriptor,), close_fds=True, start_new_session=True)
        child_channel.close()
        request = {"protocol": PROTOCOL, "nonce": nonce, "lengths": [len(blob) for blob in blobs],
            "modelRoot": str(model_root), "transcriberSource": str(source), "deadline": deadline}
        parent.settimeout(min(5, max(.1, deadline - time.monotonic())))
        parent.sendall(json.dumps(request, separators=(",", ":")).encode() + b"\n")
        for blob in blobs:
            parent.sendall(blob)
        parent.settimeout(.05)
        raw, last_check = bytearray(), 0
        while True:
            _need(not cancelled(), "voice-probe-cancelled")
            _need(time.monotonic() < deadline, "voice-worker-timeout")
            if time.monotonic() - last_check >= 2:
                verify_scope()
                last_check = time.monotonic()
            try:
                part = parent.recv(MAX_PACKET + 1 - len(raw))
            except socket.timeout:
                continue
            _need(bool(part), "voice-private-channel-closed")
            raw.extend(part)
            _need(len(raw) <= MAX_PACKET, "voice-private-result-rejected")
            if b"\n" in raw:
                _need(raw.endswith(b"\n") and b"\n" not in raw[:-1], "voice-private-result-rejected")
                result = _worker_result(json.loads(raw), nonce=nonce, count=len(blobs))
                verify_scope()
                _need(time.monotonic() < deadline and not cancelled(), "voice-worker-timeout")
                return result
    finally:
        parent.close()
        child_channel.close()
        if child is not None:
            _finish_private_helper(child, True, os.killpg if hasattr(os, "killpg") else None)


def probe_selected_voice(session, selector, *, references, voice_python, model_root,
                         transcriber_source=None, by_alias=False, worker=run_voice_worker,
                         cancelled=lambda: False, seconds=90):
    _need(isinstance(references, (list, tuple)) and len(references) <= MAX_CLIPS
          and all(isinstance(ref, VoiceReference) for ref in references), "voice-references-rejected")
    _need(type(seconds) in (int, float) and math.isfinite(seconds) and 1 <= seconds <= 120, "voice-duration-bound")
    _need(not cancelled(), "voice-probe-cancelled")
    source, audio, blobs = session.open_source(), {}, []
    result = {"status": "selected-voice-no-eligible-reference", "voiceCandidateCount": len(references),
        "voiceReadCount": 0, "audioBytes": 0, "missingAudioCount": 0, "oversizedAudioCount": 0,
        "decodedCount": 0, "inferenceCount": 0, "transcriptCharacters": 0, "decodedSeconds": 0,
        "inferenceMs": 0, "clipResults": [], "contentIncluded": False, "audioSaved": False,
        "transcriptSaved": False, "networkUsed": False, "captureCompatibilityValidated": False}
    try:
        request = selected_request(source, selector, by_alias=by_alias)
        target, account = request["contactId"], source.account_id
        _need(all(ref.account_id == account and ref.contact_id == target for ref in references), "voice-selected-contact-changed")
        if references:
            rows, _ = _read_voice_page(source, target, {"direction": "backward"}, [ref.reader_ref() for ref in references])
            for row in rows:
                duration = _voice_duration(row["content"])
                _need(row["type"] == 34 and row["sender"] == target and (duration is None or 0 < duration <= 60)
                      and row["serverId"] not in (None, 0, "", "0"), "voice-message-unverified")
            bounded = _AudioSource(source)
            audio = _read_audio(bounded, target, [row["serverId"] for row in rows], load_audio=True, cache_writes=None)
            for row in rows:
                identifier = str(row["serverId"])
                data = audio.get(identifier)
                if data is None:
                    result["oversizedAudioCount" if identifier in audio or identifier in bounded.omitted else "missingAudioCount"] += 1
                elif isinstance(data, bytes) and 12 <= len(data) <= MAX_AUDIO_BYTES:
                    _need(identifier not in bounded.omitted, "voice-identity-ambiguous")
                    blobs.append(data)
                else:
                    _need(False, "voice-byte-bound")
            source.assert_unchanged()
    finally:
        source.close()
    session.verify_scope()
    try:
        if blobs:
            _need(not cancelled(), "voice-probe-cancelled")
            deadline = min(session.deadline, time.monotonic() + seconds)
            measured = worker(blobs, voice_python=voice_python, model_root=model_root,
                transcriber_source=transcriber_source or Path(__file__).with_name("local_voice_transcriber.py"),
                deadline=deadline, verify_scope=session.verify_scope, cancelled=cancelled)
            result.update(status="selected-voice-probed", voiceReadCount=len(blobs), audioBytes=sum(map(len, blobs)),
                decodedCount=sum(item["decoded"] for item in measured["items"]),
                inferenceCount=sum(item["inferred"] for item in measured["items"]),
                transcriptCharacters=sum(item["textLength"] for item in measured["items"]),
                decodedSeconds=round(sum(item["decodedSeconds"] for item in measured["items"]), 3),
                inferenceMs=sum(item["inferenceMs"] for item in measured["items"]), clipResults=measured["items"])
        elif references:
            result["status"] = "selected-voice-local-audio-unavailable"
        fresh = session.open_source()
        try:
            current = selected_request(fresh, selector, by_alias=by_alias)
            _need(fresh.account_id == account and current["contactId"] == target, "voice-selected-contact-changed")
            fresh.assert_unchanged()
        finally:
            fresh.close()
        session.verify_scope()
        _need(not cancelled(), "voice-probe-cancelled")
        return result
    finally:
        audio.clear()
        blobs.clear()
