import contextlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import database_runtime_self_test as smoke
import local_database_source as provider
import main


class DatabaseRuntimeSelfTest(unittest.TestCase):
    def test_synthetic_vfs_checks_never_open_live_provider_or_process_memory(self):
        with patch.object(provider, "open_authorized_source", side_effect=AssertionError("live source")), \
             patch.object(provider, "_running_processes", side_effect=AssertionError("processes")), \
             patch.object(provider, "_read_live_config", side_effect=AssertionError("process memory")):
            result = smoke.run_database_self_test()
        self.assertTrue(result["ok"], result)
        self.assertTrue(result["decryptionPassed"])
        self.assertTrue(result["readOnlyGuard"])
        self.assertTrue(result["compressionReady"])
        self.assertTrue(result["imageDecryptionPassed"])
        self.assertFalse(result["userDataUsed"])
        self.assertFalse(result["processMemoryRead"])
        self.assertEqual(result["syntheticPages"], 2)

    def test_cli_outputs_metadata_without_constructing_collector(self):
        metadata = {"ok": True, "mode": "local-database-runtime-self-test"}
        with tempfile.TemporaryDirectory() as temporary:
            output_path = Path(temporary) / "result.json"
            with patch("sys.argv", ["collector", "--database-self-test", "--probe-output", str(output_path)]), \
                 patch.object(smoke, "run_database_self_test", return_value=metadata), \
                 patch.object(main, "CollectorState") as state, \
                 contextlib.redirect_stdout(io.StringIO()) as stdout:
                main.main()
            state.assert_not_called()
            self.assertEqual(json.loads(stdout.getvalue()), metadata)
            self.assertEqual(json.loads(output_path.read_text("utf-8")), metadata)


if __name__ == "__main__":
    unittest.main()
