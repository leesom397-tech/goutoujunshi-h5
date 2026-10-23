"""Synthetic authorization reuse checks: no WeChat, model download or GUI."""
from contextlib import ExitStack
from pathlib import Path
import sys
import threading
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from background_reader import BackgroundCaptureError
from local_voice_transcriber import TranscriptionError
import macos_key_provider as provider
import macos_setup_ui as setup


class ReaderAuthorizationReuseTest(unittest.TestCase):
    def setUp(self):
        self.proof = {"account": Path("synthetic-account"), "build": ("4.1.15", "270102"),
                      "pid": 10, "started": 100.0}
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.object(provider, "_require_supported_bundle", return_value=self.proof["build"]))
        self.key = self.stack.enter_context(patch.object(provider, "get_authorized_key", return_value=b"synthetic"))
        self.processes = self.stack.enter_context(patch.object(provider, "_processes", return_value=[]))
        self.current = self.stack.enter_context(patch.object(provider, "current_account_proof"))
        self.verify = self.stack.enter_context(patch.object(provider, "verify_account_proof"))

    def test_closed_client_reuses_only_the_existing_db_authenticated_authorization(self):
        self.assertTrue(setup._reader_authorization_is_current(self.proof))
        self.key.assert_called_once_with(self.proof["account"])
        self.current.assert_not_called()

    def test_reopened_client_must_be_the_same_account_and_build(self):
        self.processes.return_value = [(20, 200.0)]
        current = dict(self.proof, pid=20, started=200.0)
        self.current.return_value = current
        self.assertTrue(setup._reader_authorization_is_current(self.proof))
        self.verify.assert_called_once_with(current)

    def test_other_account_cannot_reuse_the_old_authorization(self):
        self.processes.return_value = [(20, 200.0)]
        self.current.return_value = dict(self.proof, account=Path("different-synthetic-account"))
        self.assertFalse(setup._reader_authorization_is_current(self.proof))
        self.verify.assert_not_called()

    def test_expired_or_changed_db_requires_fresh_authorization(self):
        for code in ("MAC_AUTHORIZATION_REQUIRED", "ACCOUNT_CHANGED"):
            with self.subTest(code=code):
                self.key.side_effect = BackgroundCaptureError(code, "synthetic invalid authorization")
                self.assertFalse(setup._reader_authorization_is_current(self.proof))

    def test_process_change_during_validation_is_not_accepted(self):
        self.processes.return_value = [(20, 200.0)]
        self.current.return_value = dict(self.proof, pid=20, started=200.0)
        self.verify.side_effect = BackgroundCaptureError("ACCOUNT_CHANGED", "synthetic switch")
        with self.assertRaises(BackgroundCaptureError):
            setup._reader_authorization_is_current(self.proof)

    def test_first_setup_does_not_probe_an_absent_cached_proof(self):
        self.assertFalse(setup._reader_authorization_is_current(None))
        self.key.assert_not_called()
        self.processes.assert_not_called()


class ModelRetryUiTest(unittest.TestCase):
    def test_failed_model_download_retries_without_repeating_reader_authorization(self):
        variables, buttons = [], []

        class Variable:
            def __init__(self, value=""):
                self.value = value
                variables.append(self)

            def set(self, value):
                self.value = value

        def button(*args, **options):
            widget = Mock()
            buttons.append((options, widget))
            return widget

        class ImmediateThread:
            def __init__(self, target, **kwargs):
                self.target = target

            def start(self):
                self.target()

        tk = SimpleNamespace(Frame=Mock(side_effect=lambda *a, **kw: Mock()),
                             Label=Mock(side_effect=lambda *a, **kw: Mock()),
                             StringVar=Variable, Button=button)
        module = ModuleType("tkinter")
        module.messagebox = SimpleNamespace(askokcancel=Mock(return_value=True))
        root = Mock()
        state = SimpleNamespace(lock=threading.RLock(), active=None, local_message="")
        proof = {"account": Path("synthetic-account"), "build": ("4.1.15", "270102")}
        with patch.dict(sys.modules, {"tkinter": module}), \
                patch.object(setup.threading, "Thread", ImmediateThread), \
                patch.object(setup, "_authorize_local_reader", return_value=proof) as authorize, \
                patch.object(setup, "_reader_authorization_is_current", side_effect=[False, True]) as reuse, \
                patch("local_voice_transcriber.prepare_model", side_effect=[
                    TranscriptionError("MODEL_DOWNLOAD_FAILED", "模型下载连接中断"), None]) as model:
            setup.install_setup_controls(tk, root, state)
            poll = root.after.call_args.args[1]
            prepare = buttons[0][0]["command"]
            prepare()
            poll()
            self.assertIn("读取已设置，语音模型未完成，可继续下载", variables[0].value)
            buttons[0][1].configure.assert_called_with(state="normal", text="继续下载语音模型")
            prepare()
            poll()
        authorize.assert_called_once()
        self.assertEqual(model.call_count, 2)
        self.assertEqual(reuse.call_args_list[1].args, (proof,))
        self.assertIn("语音模型已准备", state.local_message)
        self.assertIn("只继续准备语音模型", module.messagebox.askokcancel.call_args.args[1])


if __name__ == "__main__":
    unittest.main()
