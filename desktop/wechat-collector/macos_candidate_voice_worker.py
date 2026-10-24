"""One inherited private socket, in-memory SILK/SenseVoice, aggregate-only reply."""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import socket
import sys
import time

PROTOCOL = "chengzi-private-selected-voice-v1"
TRANSCRIBER_SHA256 = "9cc27fed20622f0abe4a8d29ee81306e08588fbe088f052d6431c4bd1b7d40f9"
MAX_AUDIO_BYTES = 2 * 1024 * 1024
MAX_SECONDS = 60
FAILURES = frozenset(("invalid-audio", "decode-failed", "no-speech", "asr-failed", "asr-unavailable", "voice-duration-bound"))
WORKER_FAILURES = FAILURES | frozenset(("voice-worker-timeout", "voice-runtime-version-rejected",
    "transcriber-source-rejected", "model-root-rejected", "model-integrity-failed",
    "voice-private-request-rejected", "voice-byte-bound", "voice-count-bound", "voice-private-channel-closed"))


class VoiceWorkerError(RuntimeError):
    pass


def need(condition, code):
    if not condition:
        raise VoiceWorkerError(code)


def load_transcriber(path):
    path = Path(path)
    need(path.is_absolute() and not path.is_symlink() and path.is_file() and path.stat().st_size <= 65536,
         "transcriber-source-rejected")
    need(hashlib.sha256(path.read_bytes()).hexdigest() == TRANSCRIBER_SHA256, "transcriber-source-rejected")
    spec = importlib.util.spec_from_file_location("chengzi_private_voice_transcriber", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def infer_audio(blobs, model_root, voice, *, factory=None, deadline, clock=time.monotonic):
    """Production SILK decoder + identical recognizer configuration, no cache API."""
    need(isinstance(blobs, (list, tuple)) and 1 <= len(blobs) <= 2, "voice-count-bound")
    need(all(isinstance(blob, (bytes, bytearray)) and 12 <= len(blob) <= MAX_AUDIO_BYTES for blob in blobs), "voice-byte-bound")
    root = Path(model_root)
    need(root.is_absolute() and root.resolve() == root, "model-root-rejected")
    directory = root / voice.MODEL_ID
    need(clock() < deadline, "voice-worker-timeout")
    need(voice._verify_files(directory), "model-integrity-failed")
    need(clock() < deadline, "voice-worker-timeout")
    if factory is None:
        import importlib.metadata
        need(importlib.metadata.version("sherpa-onnx") == "1.13.8", "voice-runtime-version-rejected")
        import sherpa_onnx
        factory = sherpa_onnx.OfflineRecognizer.from_sense_voice
    recognizer = None
    results = []
    for index, blob in enumerate(blobs):
        samples = stream = None
        decoded = inferred = False
        began = clock()
        try:
            need(clock() < deadline, "voice-worker-timeout")
            framed_seconds = voice._validate_silk(bytes(blob))
            need(0 < framed_seconds <= MAX_SECONDS, "voice-duration-bound")
            samples = voice._decode_silk(bytes(blob))
            seconds = len(samples) / voice.SAMPLE_RATE
            need(0 < seconds <= MAX_SECONDS, "voice-duration-bound")
            decoded = True
            need(clock() < deadline, "voice-worker-timeout")
            if recognizer is None:
                recognizer = factory(model=str(directory / "model.int8.onnx"), tokens=str(directory / "tokens.txt"),
                    num_threads=min(4, max(1, (os.cpu_count() or 2) // 2)),
                    provider="cpu", language="auto", use_itn=True, debug=False)
            stream = recognizer.create_stream()
            stream.accept_waveform(voice.SAMPLE_RATE, samples)
            inference = clock()
            recognizer.decode_stream(stream)
            inferred = True
            need(clock() < deadline, "voice-worker-timeout")
            text = re.sub(r"<\|[^|]*\|>", "", stream.result.text).strip()
            need(0 < len(text) <= 4000, "no-speech")
            results.append({"index": index, "decoded": True, "inferred": True,
                "sampleCount": len(samples), "decodedSeconds": round(seconds, 3), "framedSeconds": round(framed_seconds, 3),
                "textLength": len(text), "inferenceMs": round((clock() - inference) * 1000),
                "elapsedMs": round((clock() - began) * 1000), "reason": ""})
            text = None
        except Exception as error:
            code = getattr(error, "code", str(error) if isinstance(error, VoiceWorkerError) else "asr-failed")
            if code == "voice-worker-timeout":
                raise
            code = code if code in FAILURES else "asr-failed"
            results.append({"index": index, "decoded": decoded, "inferred": inferred,
                "sampleCount": len(samples) if decoded else 0,
                "decodedSeconds": round(len(samples) / voice.SAMPLE_RATE, 3) if decoded else 0,
                "framedSeconds": 0, "textLength": 0, "inferenceMs": 0,
                "elapsedMs": round((clock() - began) * 1000), "reason": code})
        finally:
            if samples is not None and hasattr(samples, "fill"):
                samples.fill(0)
            samples = stream = None
    need(clock() < deadline, "voice-worker-timeout")
    return {"status": "voice-inference-probed", "modelVerified": True, "items": results,
            "contentIncluded": False, "audioSaved": False, "transcriptSaved": False, "networkUsed": False}


def _read_exact(channel, length):
    output = bytearray()
    while len(output) < length:
        part = channel.recv(min(65536, length - len(output)))
        need(bool(part), "voice-private-channel-closed")
        output.extend(part)
    return output


def serve(descriptor):
    import resource
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    channel = socket.socket(fileno=descriptor)
    channel.settimeout(130)
    nonce, blobs = "", []
    try:
        raw = bytearray()
        while True:
            byte = channel.recv(1)
            need(bool(byte) and len(raw) < 16384, "voice-private-request-rejected")
            if byte == b"\n":
                break
            raw.extend(byte)
        request = json.loads(raw)
        need(isinstance(request, dict) and set(request) == {"protocol", "nonce", "lengths", "modelRoot", "transcriberSource", "deadline"}
             and request["protocol"] == PROTOCOL and isinstance(request["nonce"], str)
             and re.fullmatch(r"[0-9a-f]{64}", request["nonce"]), "voice-private-request-rejected")
        nonce = request["nonce"]
        lengths = request["lengths"]
        need(isinstance(lengths, list) and 1 <= len(lengths) <= 2
             and all(type(value) is int and 12 <= value <= MAX_AUDIO_BYTES for value in lengths), "voice-byte-bound")
        need(type(request["deadline"]) in (int, float) and time.monotonic() < request["deadline"] <= time.monotonic() + 125,
             "voice-worker-timeout")
        for length in lengths:
            blobs.append(_read_exact(channel, length))
        voice = load_transcriber(request["transcriberSource"])
        result = infer_audio(blobs, request["modelRoot"], voice, deadline=request["deadline"])
        result.update(protocol=PROTOCOL, nonce=nonce)
    except Exception as error:
        code = str(error) if isinstance(error, VoiceWorkerError) and str(error) in WORKER_FAILURES else "asr-failed"
        result = {"protocol": PROTOCOL, "nonce": nonce, "status": "voice-worker-failed",
                  "reason": code, "contentIncluded": False, "audioSaved": False, "transcriptSaved": False, "networkUsed": False}
    finally:
        for blob in blobs:
            blob[:] = b"\0" * len(blob)
            blob.clear()
    try:
        channel.sendall(json.dumps(result, separators=(",", ":")).encode() + b"\n")
    finally:
        channel.close()


if __name__ == "__main__":
    try:
        need(len(sys.argv) == 3 and sys.argv[1] == "--private-fd" and sys.argv[2].isdigit(), "voice-arguments-rejected")
        serve(int(sys.argv[2]))
    except BaseException:
        raise SystemExit(1)
