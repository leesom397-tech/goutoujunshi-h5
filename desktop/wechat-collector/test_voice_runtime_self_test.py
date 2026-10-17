import contextlib
import io
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import local_voice_transcriber as voice
import main
import voice_runtime_self_test as smoke


class VoiceRuntimeSelfTest(unittest.TestCase):
    def test_cli_only_outputs_metadata_and_never_starts_collector(self):
        receipt = {"ok": True, "userAudioUsed": False, "networkUsed": False}
        with tempfile.TemporaryDirectory() as temporary:
            destination = Path(temporary) / "voice-health.json"
            with patch("sys.argv", ["collector", "--voice-self-test", "--probe-output", str(destination)]), \
                 patch.object(smoke, "run_voice_self_test", return_value=receipt), \
                 patch.object(main, "CollectorState") as state, patch.object(main, "server_for") as server, \
                 contextlib.redirect_stdout(io.StringIO()) as output:
                main.main()
                self.assertEqual(json.loads(destination.read_text("utf-8")), receipt)
                self.assertEqual(json.loads(output.getvalue()), receipt)
                state.assert_not_called()
                server.assert_not_called()

    def test_missing_runtime_cli_fails_with_metadata(self):
        receipt = {"ok": False, "reason": "model-not-ready"}
        with patch("sys.argv", ["collector", "--voice-self-test"]), \
             patch.object(smoke, "run_voice_self_test", return_value=receipt), \
             patch.object(main, "CollectorState") as state, contextlib.redirect_stdout(io.StringIO()) as output:
            with self.assertRaises(SystemExit) as error:
                main.main()
            self.assertEqual(error.exception.code, 1)
            self.assertEqual(json.loads(output.getvalue()), receipt)
            state.assert_not_called()

    def test_mutually_exclusive_with_wechat_probe(self):
        with patch("sys.argv", ["collector", "--voice-self-test", "--probe"]), \
             patch.object(main, "CollectorState") as state, contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as error:
                main.main()
            self.assertEqual(error.exception.code, 2)
            state.assert_not_called()

    def test_real_codec_missing_model_does_not_download(self):
        with patch.object(voice, "probe_transcriber", return_value={"modelReady": False}), \
             patch.object(voice.urllib.request, "urlopen", side_effect=AssertionError("network")), \
             patch.object(voice, "_get_recognizer", side_effect=AssertionError("model load")):
            result = smoke.run_voice_self_test()
        self.assertFalse(result["ok"])
        self.assertTrue(result["codecReady"])
        self.assertFalse(result["networkUsed"])
        self.assertEqual(result["reason"], "model-not-ready")

    def test_inference_returns_no_text_or_audio_and_restores_download_handlers(self):
        original = (voice._download_archive, voice._install_direct_fallback)
        stream = SimpleNamespace(accept_waveform=lambda rate, samples: None,
                                 result=SimpleNamespace(text="must never be in output"))
        recognizer = SimpleNamespace(create_stream=lambda: stream, decode_stream=lambda item: None)
        def get_recognizer():
            with self.assertRaises(voice.TranscriptionError) as error:
                voice._download_archive(None)
            self.assertEqual(error.exception.code, "self-test-download-disabled")
            return recognizer
        with patch.object(voice, "probe_transcriber", return_value={"modelReady": True}), \
             patch.object(voice, "_get_recognizer", side_effect=get_recognizer):
            result = smoke.run_voice_self_test()
        self.assertTrue(result["ok"])
        self.assertTrue(result["inferenceCompleted"])
        self.assertNotIn(stream.result.text, json.dumps(result))
        self.assertEqual((voice._download_archive, voice._install_direct_fallback), original)


if __name__ == "__main__":
    unittest.main()
