import hashlib
import io
import json
from pathlib import Path
import struct
import tarfile
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import local_voice_transcriber as voice


def framed_voice(byte=b"a"):
    return b"\x02#!SILK_V3" + (struct.pack("<h", 1) + byte) * 10


class FakeRecognizer:
    def __init__(self):
        self.calls = 0

    def create_stream(self):
        return SimpleNamespace(accept_waveform=lambda rate, data: None,
                               result=SimpleNamespace(text="<|zh|>测试语音。"))

    def decode_stream(self, stream):
        self.calls += 1


class LocalVoiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        voice.configure_transcriber(model_root=self.root / "models", cache_root=self.root / "cache")

    def tearDown(self):
        voice.configure_transcriber()
        self.temp.cleanup()

    def test_probe_does_not_download_or_decode(self):
        with patch.object(voice.urllib.request, "urlopen", side_effect=AssertionError("network")), \
             patch.object(voice, "_decode_silk", side_effect=AssertionError("audio")):
            status = voice.probe_transcriber()
        self.assertFalse(status["modelReady"])
        self.assertTrue(status["localOnly"])

    def test_invalid_truncated_and_oversized_audio_never_runs_asr(self):
        invalid = [b"", b"RIFF" + b"x" * 50, framed_voice()[:-1],
                   b"\x02#!SILK_V3" + struct.pack("<h", 32000) + b"a" * 20,
                   framed_voice() + b"x" * voice.MAX_AUDIO_BYTES]
        for data in invalid:
            with self.subTest(length=len(data)), patch.object(voice, "_get_recognizer", side_effect=AssertionError("asr")):
                with self.assertRaises(voice.TranscriptionError):
                    voice.transcribe_silk(data, "account:contact:message")

    def test_cache_idempotence_and_account_content_isolation(self):
        recognizer = FakeRecognizer()
        with patch.object(voice, "_decode_silk", return_value=[1]), patch.object(voice, "_get_recognizer", return_value=recognizer):
            first = voice.transcribe_silk(framed_voice(), "owner-a:friend:message")
            self.assertEqual(first, "测试语音。")
            self.assertEqual(first, voice.transcribe_silk(framed_voice(), "owner-a:friend:message"))
            self.assertEqual(recognizer.calls, 1)
            voice.transcribe_silk(framed_voice(), "owner-b:friend:message")
            voice.transcribe_silk(framed_voice(b"b"), "owner-a:friend:message")
            self.assertEqual(recognizer.calls, 3)
        files = list((self.root / "cache").rglob("*.json"))
        self.assertEqual(len(files), 3)
        self.assertTrue(all("owner-a" not in str(path) for path in files))
        self.assertFalse(list(self.root.rglob("*.pcm")))

    def test_corrupt_or_non_object_cache_is_recomputed(self):
        data = framed_voice()
        digest = hashlib.sha256(data).hexdigest()
        path = voice._cache_path("owner:friend:message", digest)
        path.parent.mkdir(parents=True)
        path.write_text("[]", encoding="utf-8")
        recognizer = FakeRecognizer()
        with patch.object(voice, "_decode_silk", return_value=[1]), patch.object(voice, "_get_recognizer", return_value=recognizer):
            self.assertEqual(voice.transcribe_silk(data, "owner:friend:message"), "测试语音。")
        self.assertEqual(recognizer.calls, 1)

    def test_cancel_before_work_no_network_or_cache(self):
        voice.configure_transcriber(model_root=self.root / "models", cache_root=self.root / "cache", cancelled=lambda: True)
        with patch.object(voice.urllib.request, "urlopen", side_effect=AssertionError("network")):
            with self.assertRaises(voice.TranscriptionError) as error:
                voice.transcribe_silk(framed_voice(), "owner:message")
        self.assertEqual(error.exception.code, "cancelled")
        self.assertFalse((self.root / "cache").exists())

    def test_cancel_after_asr_does_not_cache_incomplete_result(self):
        recognizer = FakeRecognizer()
        voice.configure_transcriber(model_root=self.root / "models", cache_root=self.root / "cache", cancelled=lambda: recognizer.calls > 0)
        with patch.object(voice, "_decode_silk", return_value=[1]), patch.object(voice, "_get_recognizer", return_value=recognizer):
            with self.assertRaises(voice.TranscriptionError) as error:
                voice.transcribe_silk(framed_voice(), "owner:message")
        self.assertEqual(error.exception.code, "cancelled")
        self.assertFalse((self.root / "cache").exists())

    def test_real_silk_codec_roundtrip_and_silence_rejection(self):
        try:
            import numpy as np
            import pysilk
        except ImportError:
            self.skipTest("optional codec is absent")
        wave = (np.sin(np.arange(16000) * 2 * np.pi * 440 / 16000) * 3000).astype("<i2")
        data = io.BytesIO()
        pysilk.encode(io.BytesIO(wave.tobytes()), data, 16000, 24000)
        decoded = voice._decode_silk(data.getvalue())
        self.assertEqual(len(decoded), 16000)
        silent = io.BytesIO()
        pysilk.encode(io.BytesIO(bytes(32000)), silent, 16000, 24000)
        with self.assertRaises(voice.TranscriptionError) as error:
            voice._decode_silk(silent.getvalue())
        self.assertEqual(error.exception.code, "no-speech")

    def test_archive_installs_only_fixed_files_and_verifies_hash(self):
        content = b"known model"
        digest = hashlib.sha256(content).hexdigest()
        archive = self.root / "model.tar.bz2"
        with tarfile.open(archive, "w:bz2") as target:
            member = tarfile.TarInfo(voice.MODEL_PACKAGE + "/model.int8.onnx")
            member.size = len(content)
            target.addfile(member, io.BytesIO(content))
            attack = tarfile.TarInfo("../../outside.txt")
            attack.size = 3
            target.addfile(attack, io.BytesIO(b"bad"))
        with patch.object(voice, "MODEL_FILES", {"model.int8.onnx": (len(content), digest)}):
            voice._install_archive(archive, self.root / "installed")
        self.assertEqual((self.root / "installed" / "model.int8.onnx").read_bytes(), content)
        self.assertFalse((self.root / "outside.txt").exists())

    def test_archive_symlink_is_rejected(self):
        archive = self.root / "model.tar.bz2"
        with tarfile.open(archive, "w:bz2") as target:
            member = tarfile.TarInfo(voice.MODEL_PACKAGE + "/model.int8.onnx")
            member.type, member.linkname = tarfile.SYMTYPE, "../../secret"
            target.addfile(member)
        with patch.object(voice, "MODEL_FILES", {"model.int8.onnx": (0, "irrelevant")}):
            with self.assertRaises(voice.TranscriptionError):
                voice._install_archive(archive, self.root / "installed")
        self.assertFalse((self.root / "installed").exists())

    def test_model_download_resumes_fixed_asset_and_checks_digest(self):
        content = b"fixed public model contents"
        partial = self.root / (voice.MODEL_PACKAGE + ".tar.bz2.part")
        partial.write_bytes(content[:7])
        response = io.BytesIO(content[7:])
        response.status = 206
        response.headers = {"Content-Range": f"bytes 7-{len(content)-1}/{len(content)}", "Content-Length": str(len(content)-7)}
        with patch.object(voice, "ARCHIVE_BYTES", len(content)), patch.object(voice, "ARCHIVE_SHA256", hashlib.sha256(content).hexdigest()), \
             patch.object(voice.urllib.request, "urlopen", return_value=response) as fetch:
            result = voice._download_archive(self.root)
        self.assertEqual(result.read_bytes(), content)
        request = fetch.call_args.args[0]
        self.assertEqual(request.full_url, voice.MODEL_URL)
        self.assertEqual(request.headers["Range"], "bytes=7-")

    def test_download_hash_mismatch_never_marks_model_ready(self):
        content = b"wrong"
        response = io.BytesIO(content)
        response.status, response.headers = 200, {"Content-Length": str(len(content))}
        with patch.object(voice, "ARCHIVE_BYTES", len(content)), \
             patch.object(voice.urllib.request, "urlopen", return_value=response):
            with self.assertRaises(voice.TranscriptionError) as error:
                voice._download_archive(self.root)
        self.assertEqual(error.exception.code, "model-integrity-failed")
        self.assertFalse(voice.probe_transcriber()["modelReady"])

    def test_primary_network_failure_uses_only_pinned_fallback(self):
        content = b"small known model"
        expected = {"model.int8.onnx": (len(content), hashlib.sha256(content).hexdigest())}
        def download(path, url, size, digest, *args):
            self.assertEqual(url, voice.MODEL_FALLBACK_BASE + "model.int8.onnx")
            self.assertEqual((size, digest), expected["model.int8.onnx"])
            path.write_bytes(content)
            return path
        with patch.object(voice, "MODEL_FILES", expected), \
             patch.object(voice, "_download_archive", side_effect=voice.TranscriptionError("model-download-failed", "offline")), \
             patch.object(voice, "_download_file", side_effect=download):
            directory = voice.prepare_model()
            self.assertTrue(voice._verify_files(directory))

    def test_integrity_error_or_cancel_never_bypasses_to_fallback(self):
        for code in ("model-integrity-failed", "cancelled"):
            with self.subTest(code=code), \
                 patch.object(voice, "_download_archive", side_effect=voice.TranscriptionError(code, "stopped")), \
                 patch.object(voice, "_install_direct_fallback", side_effect=AssertionError("fallback")):
                with self.assertRaises(voice.TranscriptionError) as error:
                    voice.prepare_model()
                self.assertEqual(error.exception.code, code)


if __name__ == "__main__":
    unittest.main()
