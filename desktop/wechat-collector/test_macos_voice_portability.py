"""Platform routing tests; native macOS codec/ASR still needs a Mac runner."""
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import local_voice_transcriber as voice


class MacOSVoicePortabilityTests(unittest.TestCase):
    def test_macos_uses_application_support_even_with_windows_environment(self):
        with patch.object(voice.sys, "platform", "darwin"), \
                patch.object(voice.Path, "home", return_value=Path("/Users/synthetic")), \
                patch.dict(os.environ, {"LOCALAPPDATA": "foreign-windows-appdata"}, clear=True):
            self.assertEqual(voice._storage_root(), Path("/Users/synthetic/Library/Application Support/ChengziWeChatCollector/voice"))

    def test_explicit_data_root_remains_authoritative_on_macos(self):
        with tempfile.TemporaryDirectory() as temporary, \
                patch.object(voice.sys, "platform", "darwin"), \
                patch.dict(os.environ, {"CHENGZI_VOICE_DATA_DIR": temporary}, clear=True):
            self.assertEqual(voice._storage_root(), Path(temporary).resolve())

    def test_windows_keeps_existing_model_and_cache_location(self):
        with patch.object(voice.sys, "platform", "win32"), \
                patch.dict(os.environ, {"LOCALAPPDATA": "unchanged-appdata"}, clear=True):
            self.assertEqual(voice._storage_root(), Path("unchanged-appdata/ChengziWeChatCollector/voice"))

    def test_non_macos_missing_appdata_keeps_existing_fallback(self):
        with patch.object(voice.sys, "platform", "linux"), \
                patch.object(voice.Path, "home", return_value=Path("/home/synthetic")), \
                patch.dict(os.environ, {}, clear=True):
            self.assertEqual(voice._storage_root(), Path("/home/synthetic/.local/share/ChengziWeChatCollector/voice"))


if __name__ == "__main__":
    unittest.main()
