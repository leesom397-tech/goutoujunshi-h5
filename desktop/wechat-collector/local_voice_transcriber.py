"""On-device SILK decoding and SenseVoice ASR. Audio never leaves this process.

Only prepare_model/transcribe_silk may fetch the pinned public model. Health probes
do not download, open user audio, or load the inference runtime. Raw PCM stays in
memory; successful transcripts are cached by caller scope and audio SHA-256.
"""
from __future__ import annotations

import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import struct
import tarfile
import tempfile
import threading
import time
import urllib.error
import urllib.request

MODEL_ID = "sensevoice-int8-2024-07-17"
MODEL_PACKAGE = "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17"
MODEL_URL = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/" + MODEL_PACKAGE + ".tar.bz2"
MODEL_FALLBACK_BASE = ("https://huggingface.co/csukuangfj/"
                       "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/"
                       "2365baeacb507f821a0c8120fcee3d484dba7a07/")
ARCHIVE_BYTES = 163002883
ARCHIVE_SHA256 = "7d1efa2138a65b0b488df37f8b89e3d91a60676e416f515b952358d83dfd347e"
MODEL_FILES = {
    "model.int8.onnx": (239233841, "c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51"),
    "tokens.txt": (315894, "f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc"),
}
SAMPLE_RATE = 16000
MAX_AUDIO_BYTES = 2 * 1024 * 1024
MAX_SECONDS = 65
MAX_DOWNLOAD_SECONDS = 900
MAX_INFERENCE_BATCH = 4
MAX_PADDED_BATCH_SECONDS = 80
_lock = threading.RLock()
_model_root = None
_cache_root = None
_progress = None
_cancelled = None
_recognizer = None
_verified_directory = None


class TranscriptionError(RuntimeError):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def configure_transcriber(*, model_root=None, cache_root=None, progress=None, cancelled=None):
    """Worker-only settings. Paths are never accepted from bridge HTTP requests."""
    global _model_root, _cache_root, _progress, _cancelled, _recognizer, _verified_directory
    with _lock:
        new_root = Path(model_root).resolve() if model_root is not None else None
        if new_root != _model_root:
            _recognizer = None
            _verified_directory = None
        _model_root = new_root
        _cache_root = Path(cache_root).resolve() if cache_root is not None else None
        _progress, _cancelled = progress, cancelled


def _storage_root():
    override = os.environ.get("CHENGZI_VOICE_DATA_DIR")
    if override:
        return Path(override).resolve()
    base = os.environ.get("LOCALAPPDATA")
    return (Path(base) if base else Path.home() / ".local" / "share") / "ChengziWeChatCollector" / "voice"


def model_directory():
    return (_model_root or _storage_root() / "models") / MODEL_ID


def _private_dir(path):
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    if os.name != "nt":
        path.chmod(0o700)


def _check_cancelled(callback=None):
    fn = callback or _cancelled
    if fn and fn():
        raise TranscriptionError("cancelled", "已停止语音处理，已完成的文字会保留。")


def _notify(stage, *, progress=None, **extra):
    callback = progress or _progress
    if callback:
        callback({"stage": stage, "model": MODEL_ID, **extra})


def _files_present(directory):
    try:
        return all((directory / name).is_file() and (directory / name).stat().st_size == expected[0]
                   for name, expected in MODEL_FILES.items())
    except OSError:
        return False


def probe_transcriber():
    deps = all(importlib.util.find_spec(name) is not None for name in ("pysilk", "sherpa_onnx", "numpy"))
    model_ready = _files_present(model_directory())
    return {"ready": deps and model_ready, "modelReady": model_ready, "dependenciesReady": deps,
            "model": MODEL_ID, "downloadBytes": ARCHIVE_BYTES, "localOnly": True,
            "message": "本机语音模型已就绪" if model_ready and deps else
            "首次处理语音时自动准备本机模型" if deps else "请更新电脑助手以启用后台语音转写"}


def _file_hash(path, cancelled=None):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            _check_cancelled(cancelled)
            digest.update(chunk)
    return digest.hexdigest()


def _verify_files(directory, cancelled=None):
    return _files_present(directory) and all(_file_hash(directory / name, cancelled) == expected[1]
                                          for name, expected in MODEL_FILES.items())


def _download_file(archive, url, expected_bytes, expected_hash, progress=None, cancelled=None, deadline=None):
    """Internal only: caller supplies hard-coded public assets, never request URLs."""
    deadline = deadline or time.monotonic() + MAX_DOWNLOAD_SECONDS
    attempts = 0
    while attempts < 3:
        _check_cancelled(cancelled)
        attempts += 1
        offset = archive.stat().st_size if archive.is_file() else 0
        if offset > expected_bytes:
            archive.unlink()
            offset = 0
        if offset == expected_bytes:
            if _file_hash(archive, cancelled) == expected_hash:
                return archive
            archive.unlink()
            offset = 0
        headers = {"User-Agent": "ChengziWeChatCollector/1.1.0", "Accept-Encoding": "identity"}
        if offset:
            headers["Range"] = f"bytes={offset}-"
        try:
            if time.monotonic() >= deadline:
                raise TranscriptionError("model-download-timeout", "模型下载超时，下次可从已下载的位置继续。")
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=25) as response:
                status = response.status
                if status == 206:
                    content_range = response.headers.get("Content-Range", "")
                    if not re.fullmatch(rf"bytes {offset}-\d+/{expected_bytes}", content_range):
                        raise TranscriptionError("model-download-failed", "语音模型续传校验失败，请重试。")
                    mode = "ab"
                elif status == 200:
                    offset, mode = 0, "wb"
                else:
                    raise TranscriptionError("model-download-failed", "暂时无法下载本机语音模型，请稍后重试。")
                expected_length = response.headers.get("Content-Length")
                if expected_length and (not expected_length.isdigit() or int(expected_length) != expected_bytes - offset):
                    raise TranscriptionError("model-download-failed", "语音模型下载大小不符，已停止。")
                received, last_notice = offset, 0.0
                with archive.open(mode) as output:
                    while True:
                        _check_cancelled(cancelled)
                        if time.monotonic() >= deadline:
                            raise TranscriptionError("model-download-timeout", "模型下载超时，下次可从已下载的位置继续。")
                        chunk = response.read(256 * 1024)
                        if not chunk:
                            break
                        received += len(chunk)
                        if received > expected_bytes:
                            raise TranscriptionError("model-download-failed", "语音模型下载大小不符，已停止。")
                        output.write(chunk)
                        now = time.monotonic()
                        if now - last_notice >= 1 or received == expected_bytes:
                            _notify("voice-model-download", progress=progress, receivedBytes=received,
                                    totalBytes=expected_bytes, percent=round(received * 100 / expected_bytes))
                            last_notice = now
            if received != expected_bytes:
                continue
            if _file_hash(archive, cancelled) != expected_hash:
                archive.unlink()
                raise TranscriptionError("model-integrity-failed", "语音模型完整性校验失败，未加载该文件。")
            return archive
        except (urllib.error.URLError, OSError, TimeoutError):
            if attempts >= 3 or time.monotonic() >= deadline:
                raise TranscriptionError("model-download-failed", "本机语音模型下载暂未完成，下次可以继续下载。") from None
    raise TranscriptionError("model-download-failed", "语音模型下载不完整，下次可以继续下载。")


def _download_archive(root, progress=None, cancelled=None, deadline=None):
    return _download_file(root / (MODEL_PACKAGE + ".tar.bz2.part"), MODEL_URL,
                          ARCHIVE_BYTES, ARCHIVE_SHA256, progress, cancelled, deadline)


def _install_direct_fallback(directory, progress=None, cancelled=None, deadline=None):
    downloaded = {}
    for name, (size, digest) in MODEL_FILES.items():
        downloaded[name] = _download_file(directory.parent / (MODEL_ID + "-" + name + ".part"),
                                           MODEL_FALLBACK_BASE + name, size, digest,
                                           progress, cancelled, deadline)
    _check_cancelled(cancelled)
    _private_dir(directory)
    for name, path in downloaded.items():
        os.replace(path, directory / name)


def _install_archive(archive, directory, progress=None, cancelled=None):
    """Extract two fixed regular members, never tar.extract or archive paths."""
    _notify("voice-model-install", progress=progress)
    _private_dir(directory.parent)
    with tempfile.TemporaryDirectory(prefix=".voice-model-", dir=directory.parent) as temporary:
        staging = Path(temporary)
        found = set()
        expected_members = {MODEL_PACKAGE + "/" + name: name for name in MODEL_FILES}
        # A stream avoids repeatedly decompressing the 163 MB archive to seek.
        with tarfile.open(archive, "r|bz2") as source:
            for member in source:
                _check_cancelled(cancelled)
                name = expected_members.get(member.name)
                if name is None:
                    continue
                if name in found:
                    raise TranscriptionError("model-integrity-failed", "模型压缩包包含重复文件。")
                size, digest = MODEL_FILES[name]
                if not member.isfile() or member.size != size:
                    raise TranscriptionError("model-integrity-failed", "模型压缩包内容不符。")
                entry = source.extractfile(member)
                if entry is None:
                    raise TranscriptionError("model-integrity-failed", "模型文件无法读取。")
                copied, actual_hash = 0, hashlib.sha256()
                with entry, (staging / name).open("wb") as output:
                    while chunk := entry.read(1024 * 1024):
                        _check_cancelled(cancelled)
                        copied += len(chunk)
                        if copied > size:
                            raise TranscriptionError("model-integrity-failed", "模型文件超出预期大小。")
                        actual_hash.update(chunk)
                        output.write(chunk)
                if copied != size or actual_hash.hexdigest() != digest:
                    raise TranscriptionError("model-integrity-failed", "语音模型文件校验失败。")
                found.add(name)
        if found != set(MODEL_FILES):
            raise TranscriptionError("model-integrity-failed", "模型压缩包缺少必要文件。")
        _private_dir(directory)
        for name in MODEL_FILES:
            os.replace(staging / name, directory / name)


def prepare_model(progress=None, cancelled=None):
    global _verified_directory
    with _lock:
        _check_cancelled(cancelled)
        directory = model_directory()
        if _verified_directory == directory and _files_present(directory):
            return directory
        if not _verify_files(directory, cancelled):
            _private_dir(directory.parent)
            deadline = time.monotonic() + MAX_DOWNLOAD_SECONDS
            try:
                archive = _download_archive(directory.parent, progress, cancelled, deadline)
            except TranscriptionError as error:
                if error.code != "model-download-failed":
                    raise
                _notify("voice-model-download-retry", progress=progress)
                _install_direct_fallback(directory, progress, cancelled, deadline)
            else:
                _install_archive(archive, directory, progress, cancelled)
                # Only remove the resumable archive after complete installation.
                archive.unlink(missing_ok=True)
        _verified_directory = directory
        _notify("voice-model-ready", progress=progress)
        return directory


def _validate_silk(blob):
    if not isinstance(blob, bytes) or not 12 <= len(blob) <= MAX_AUDIO_BYTES:
        raise TranscriptionError("invalid-audio", "这条语音文件为空或大小异常。")
    if blob.startswith(b"\x02#!SILK_V3"):
        index = 10
    elif blob.startswith(b"#!SILK_V3"):
        index = 9
        if blob[index:index + 1] == b"\n":
            index += 1
    else:
        raise TranscriptionError("invalid-audio", "这条语音不是支持的 SILK 音频。")
    frames = 0
    while index < len(blob):
        if index + 2 > len(blob):
            raise TranscriptionError("invalid-audio", "语音文件尚未同步完整。")
        size = struct.unpack_from("<h", blob, index)[0]
        index += 2
        if size == -1 and index == len(blob):
            break
        if size < 0 or size > 1250 or index + size > len(blob):
            raise TranscriptionError("invalid-audio", "语音文件尚未同步完整。")
        index += size
        frames += 1
        if frames > MAX_SECONDS * 50:
            raise TranscriptionError("invalid-audio", "这条语音超出了单条微信语音的长度范围。")
    if frames < 5:
        raise TranscriptionError("invalid-audio", "这条语音太短，无法可靠转写。")
    return frames * 0.02


def _decode_silk(blob):
    _validate_silk(blob)
    try:
        import numpy as np
        import pysilk
        pcm = io.BytesIO()
        pysilk.decode(io.BytesIO(blob), pcm, SAMPLE_RATE)
        raw = pcm.getbuffer()
        if len(raw) % 2 or not int(SAMPLE_RATE * 0.1) * 2 <= len(raw) <= SAMPLE_RATE * MAX_SECONDS * 2:
            raise TranscriptionError("decode-failed", "语音长度异常，未写入转写结果。")
        samples = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
        if not np.isfinite(samples).all() or float(np.sqrt(np.mean(samples * samples))) < 0.0001:
            raise TranscriptionError("no-speech", "这条语音没有可识别的声音。")
        return samples
    except TranscriptionError:
        raise
    except ImportError:
        raise TranscriptionError("asr-unavailable", "请更新电脑助手后再处理语音。") from None
    except Exception:
        raise TranscriptionError("decode-failed", "这条语音无法解码，请先确认已同步到电脑。") from None


def _get_recognizer():
    global _recognizer
    if _recognizer is None:
        directory = prepare_model()
        try:
            import sherpa_onnx
            _recognizer = sherpa_onnx.OfflineRecognizer.from_sense_voice(
                model=str(directory / "model.int8.onnx"), tokens=str(directory / "tokens.txt"),
                num_threads=min(4, max(1, (os.cpu_count() or 2) // 2)),
                provider="cpu", language="auto", use_itn=True, debug=False)
        except Exception:
            raise TranscriptionError("asr-unavailable", "本机语音模型加载失败，请更新助手或重试。") from None
    return _recognizer


def _cache_path(cache_key, audio_hash):
    if not isinstance(cache_key, str) or not cache_key.strip() or len(cache_key) > 4096:
        raise TranscriptionError("invalid-scope", "缺少语音所属账号与消息标识。")
    scope = hashlib.sha256(cache_key.encode("utf-8")).hexdigest()
    root = _cache_root or _storage_root() / "transcripts"
    return root / scope[:2] / scope / (MODEL_ID + "-" + audio_hash + ".json")


def _read_cache(path, audio_hash):
    try:
        if not path.is_file() or path.stat().st_size > 16384:
            return None
        data = json.loads(path.read_text("utf-8"))
        if not isinstance(data, dict):
            return None
        text = data.get("text")
        if data.get("model") == MODEL_ID and data.get("audioSha256") == audio_hash and isinstance(text, str) and 0 < len(text.strip()) <= 4000:
            return text
    except (OSError, ValueError, TypeError):
        pass
    return None


def _write_cache(path, audio_hash, text):
    _private_dir(path.parent)
    data = json.dumps({"model": MODEL_ID, "audioSha256": audio_hash, "text": text}, ensure_ascii=False)
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, prefix=".transcript-", delete=False) as output:
        temporary = Path(output.name)
        try:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        except BaseException:
            output.close()
            temporary.unlink(missing_ok=True)
            raise
    try:
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def transcribe_silk_batches(items):
    """Yield bounded completed groups, identified by their original input index.

    Read every scoped/content-addressed cache before loading the model. A model
    preparation failure applies to this request once, not once per voice. Only
    four similar-length streams at most are decoded together; PCM is discarded
    before the next group. No raw audio is written to disk.
    """
    pending, ready = [], []
    for index, (blob, cache_key) in enumerate(items):
        _check_cancelled()
        try:
            duration = _validate_silk(blob)
            digest = hashlib.sha256(blob).hexdigest()
            path = _cache_path(cache_key, digest)
            cached = _read_cache(path, digest)
            if cached is not None:
                ready.append({"index": index, "text": cached, "cached": True})
            else:
                pending.append((duration, index, blob, digest, path))
        except TranscriptionError as error:
            if error.code == "cancelled":
                raise
            ready.append({"index": index, "error": error})
    if ready:
        _check_cancelled()
        yield ready
    if not pending:
        return

    # Sort by length to avoid padding a short clip to a sixty-second neighbour.
    pending.sort(key=lambda item: (item[0], item[1]))
    recognizer, model_error = None, None
    while pending:
        group = [pending.pop(0)]
        while pending and len(group) < MAX_INFERENCE_BATCH:
            longest = pending[0][0]
            if longest > max(1.0, group[0][0] * 2) or longest * (len(group) + 1) > MAX_PADDED_BATCH_SECONDS:
                break
            group.append(pending.pop(0))
        completed, streams = [], []
        with _lock:
            _check_cancelled()
            for _, index, blob, digest, path in group:
                if model_error is not None:
                    completed.append({"index": index, "error": model_error})
                    continue
                try:
                    samples = _decode_silk(blob)
                    _check_cancelled()
                    if recognizer is None:
                        try:
                            recognizer = _get_recognizer()
                        except TranscriptionError as error:
                            if error.code == "cancelled":
                                raise
                            model_error = error
                            raise
                    stream = recognizer.create_stream()
                    stream.accept_waveform(SAMPLE_RATE, samples)
                    streams.append((index, stream, digest, path))
                    del samples
                except TranscriptionError as error:
                    if error.code == "cancelled":
                        raise
                    completed.append({"index": index, "error": error})
                except Exception:
                    completed.append({"index": index, "error": TranscriptionError("asr-failed", "这条语音暂时无法转写，可稍后重试。")})
            _check_cancelled()
            if streams:
                inference_error = None
                try:
                    if len(streams) == 1:
                        recognizer.decode_stream(streams[0][1])
                    else:
                        recognizer.decode_streams([item[1] for item in streams])
                except Exception:
                    inference_error = TranscriptionError("asr-failed", "这组语音暂时无法转写，可稍后重试。")
                _check_cancelled()
                for index, stream, digest, path in streams:
                    text = "" if inference_error else re.sub(r"<\|[^|]*\|>", "", stream.result.text).strip()
                    error = inference_error or (None if text and len(text) <= 4000 else
                        TranscriptionError("no-speech", "这条语音没有识别出可靠文字，未自动补写。"))
                    if error:
                        completed.append({"index": index, "error": error})
                    else:
                        try:
                            _write_cache(path, digest, text)
                        except OSError:
                            pass  # A full cache disk must not discard a completed transcript.
                        completed.append({"index": index, "text": text, "cached": False})
        _check_cancelled()
        yield completed


def transcribe_silk(blob: bytes, cache_key: str) -> str:
    """Transcribe one selected voice with the same scoped cache and validation."""
    for completed in transcribe_silk_batches([(blob, cache_key)]):
        result = completed[0]
        if result.get("error") is not None:
            raise result["error"]
        return result["text"]
    raise TranscriptionError("asr-failed", "这条语音暂时无法转写，可稍后重试。")
