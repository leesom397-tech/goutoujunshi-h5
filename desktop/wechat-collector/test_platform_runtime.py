"""Synthetic platform and private IPC checks; no account, UI or key extraction."""
import json
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

import platform_runtime
from background_reader import BackgroundCaptureError
from bridge import BridgeError, CollectorState, _capture_process, _voice_worker_process


class PlatformRuntimeTests(unittest.TestCase):
    def test_mac_expired_authorization_returns_actionable_error_before_creating_worker(self):
        state = CollectorState(health_provider=lambda: {"capabilities": {"backgroundChat": True}})
        with patch.object(sys, "platform", "darwin"), \
                patch("bridge.mp.get_context") as context, \
                patch.object(platform_runtime, "export_worker_authorization",
                             side_effect=BackgroundCaptureError("ACCOUNT_CHANGED", "请重新授权当前微信账号")):
            with self.assertRaises(BridgeError) as caught:
                state.start({"kind": "chat", "mode": "background", "friend": "虚构联系人", "limit": 1})
        self.assertEqual(caught.exception.status, 409)
        self.assertEqual(caught.exception.code, "ACCOUNT_CHANGED")
        self.assertEqual(state.jobs, {})
        self.assertIsNone(state.active)
        context.return_value.Pipe.assert_not_called()

    def test_platform_selects_only_its_provider(self):
        for platform, module in (("darwin", "macos_database_source"), ("win32", "local_database_source")):
            with self.subTest(platform=platform), patch.object(sys, "platform", platform), \
                    patch.object(platform_runtime.importlib, "import_module") as load:
                platform_runtime.source_provider()
                load.assert_called_once_with(module)

    def test_mac_moments_dispatch_never_imports_windows_capture(self):
        capture = Mock()
        with patch.object(sys, "platform", "darwin"), \
                patch.dict(sys.modules, {"macos_moments": SimpleNamespace(capture_moments=capture)}):
            self.assertIs(platform_runtime.capture_function({"kind": "moments"}), capture)
            with self.assertRaises(BackgroundCaptureError) as caught:
                platform_runtime.capture_function({"kind": "chat"})
            self.assertEqual(caught.exception.code, "MAC_BACKGROUND_REQUIRED")

    def test_mac_never_advertises_complete_moments_or_images(self):
        with patch.object(sys, "platform", "darwin"), \
                patch.object(platform_runtime, "contact_cache", return_value=Mock()):
            state = CollectorState(health_provider=lambda: {"ready": True, "capabilities": {"momentsAllVisible": True}})
            health = state.health()
            self.assertEqual(health["platform"], "darwin")
            self.assertFalse(health["capabilities"]["momentsAllVisible"])
            self.assertFalse(health["capabilities"]["personBundle"])
            self.assertFalse(health["capabilities"]["backgroundImagesById"])
            self.assertTrue(health["capabilities"]["momentsCached"])

    def test_worker_authentication_is_private_and_cleared_on_success_or_error(self):
        for fails in (False, True):
            with self.subTest(fails=fails):
                output = []
                pipe = SimpleNamespace(send=output.append, close=Mock())
                authorization = object()
                def capture(request, progress, on_partial):
                    if fails:
                        raise BackgroundCaptureError("ACCOUNT_CHANGED", "账号已变化")
                    progress(100, "完成")
                    return {"records": [], "kind": "chat"}
                with patch.object(sys, "platform", "darwin"), \
                        patch.object(platform_runtime, "import_worker_authorization") as restore, \
                        patch.object(platform_runtime, "clear_worker_authorization") as clear, \
                        patch.object(platform_runtime, "capture_function", return_value=capture):
                    _capture_process(pipe, {"mode": "background", "kind": "chat"}, authorization)
                restore.assert_called_once_with(authorization)
                clear.assert_called_once()
                pipe.close.assert_called_once()
                self.assertNotIn("authorization", json.dumps(output))
                self.assertEqual(output[-1]["type"], "error" if fails else "result")

    def test_warm_worker_receives_new_authorization_for_each_job(self):
        request = {"kind": "chat", "mode": "background", "voiceOnly": True, "includeVoice": True,
                   "accountKey": "test-account", "contactId": "test-contact", "friend": "虚构联系人"}
        authorizations = [object(), object()]
        commands = [{"jobId": str(i), "request": dict(request), "authorization": value}
                    for i, value in enumerate(authorizations)]
        outputs, received = [], []
        class Pipe:
            def poll(self, _): return bool(commands)
            def recv(self): return commands.pop(0)
            def send(self, value): outputs.append(value)
            def close(self): pass
        def capture(connection, payload, worker_authorization=None):
            received.append(worker_authorization)
            self.assertNotIn("authorization", payload)
            connection.send({"type": "result", "result": {"records": []}})
        with patch("local_voice_transcriber.configure_transcriber"):
            _voice_worker_process(Pipe(), capture, ("test-account", "test-contact", "虚构联系人"))
        self.assertEqual(received, authorizations)
        self.assertEqual(len(outputs), 2)
        self.assertNotIn("authorization", json.dumps(outputs))


if __name__ == "__main__":
    unittest.main()
