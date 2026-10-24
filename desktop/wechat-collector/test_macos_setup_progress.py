"""Pure setup-state sequences; no WeChat, native API, account or permission I/O."""
import json
import unittest
from unittest.mock import Mock

from macos_setup_progress import SetupProgressAdapter, SetupStateError


class SetupProgressTests(unittest.TestCase):
    def setUp(self):
        self.now = 0
        self.published = []
        self.adapter = SetupProgressAdapter(clock=lambda: self.now, on_change=self.published.append)
        self.attempt = self.adapter.begin()["attempt"]

    def observe(self, **facts):
        return self.adapter.observe(self.attempt, facts)

    def running(self):
        return self.observe(launchRequested=True, watchdogAlive=True, processCount=1,
                            processVerified=True, accountStatus="not-ready", observerEvents={"constructor": 1, "load": 1})

    def wait_for_user(self):
        self.running()
        self.now = 5
        return self.observe(accountStatus="not-ready")

    def authenticated(self):
        self.running()
        return self.observe(accountStatus="verified", candidateAuthenticated=True)

    def finish(self, **result):
        return self.adapter.finish(self.attempt, {"ok": False, "runtimeCleanupComplete": True,
            "originalRestored": True, "candidateAuthenticated": False, **result})

    def test_phase_sequence_shows_start_user_wait_account_read_cleanup_and_complete(self):
        self.assertEqual(self.adapter.snapshot()["phase"], "waiting-for-app-start")
        self.assertEqual(self.running()["phase"], "checking-account")
        self.now = 5
        waiting = self.observe(accountStatus="not-ready")
        self.assertEqual(waiting["phase"], "waiting-for-user")
        self.assertIn("微信或系统窗口完成首次设置", waiting["message"])
        self.assertTrue(waiting["can_continue"])
        self.assertEqual(waiting["pending_cause"], "undetermined")
        checking = self.observe(accountStatus="verified", candidateAuthenticated=True)
        self.assertEqual(checking["phase"], "checking-account")
        self.assertEqual(self.observe(selectedReadStarted=True)["phase"], "reading-selected")
        self.assertEqual(self.observe(cleanupStarted=True)["phase"], "cleanup")
        done = self.finish(ok=True, candidateAuthenticated=True)
        self.assertEqual(done["phase"], "completed")
        self.assertFalse(done["active"] or done["authorization_granted"] or done["capture_compatibility_validated"])

    def test_observer_loaded_or_key_frame_events_never_authorize_reading(self):
        view = self.observe(watchdogAlive=True, processCount=0,
                            observerEvents={"constructor": 1, "load": 1, "call": 3, "match": 3, "write_ok": 3})
        self.assertEqual(view["phase"], "waiting-for-app-start")
        self.assertFalse(view["can_continue"])
        with self.assertRaisesRegex(SetupStateError, "setup-selected-read-unverified"):
            self.observe(selectedReadStarted=True)
        self.assertFalse(self.adapter.snapshot()["authorization_granted"])

    def test_short_account_startup_is_not_immediately_a_user_wait(self):
        self.assertEqual(self.running()["phase"], "checking-account")
        self.now = 3
        self.assertEqual(self.observe(accountStatus="not-ready")["phase"], "checking-account")
        self.now = 4
        self.assertEqual(self.observe(accountStatus="not-ready")["phase"], "waiting-for-user")

    def test_existing_account_not_ready_code_becomes_wait_without_error_or_ui_text_scan(self):
        self.running()
        self.now = 5
        view = self.observe(reason="active-account-not-ready")
        self.assertEqual(view["phase"], "waiting-for-user")
        self.assertEqual(view["error_code"], "")
        self.assertEqual(self.observe(reason="contact-database-not-ready")["phase"], "checking-account")

    def test_current_continue_requests_recheck_without_renewing_or_granting(self):
        self.wait_for_user()
        result = self.adapter.continue_setup(self.attempt)
        self.assertEqual(result["action"], "recheck-current-attempt")
        self.assertTrue(result["requires_fresh_proof"])
        self.assertFalse(result["renews_deadline"] or result["authorization_granted"])
        self.assertFalse(self.adapter.snapshot()["can_continue"])
        with self.assertRaisesRegex(SetupStateError, "setup-continuation-unavailable"):
            self.adapter.continue_setup(self.attempt)

    def test_timeout_after_clean_restore_is_a_user_pending_state_with_fresh_attempt_action(self):
        self.wait_for_user()
        pending = self.finish(reason="candidate-source-authentication-timeout")
        self.assertEqual(pending["phase"], "waiting-for-user")
        self.assertFalse(pending["active"])
        self.assertEqual(pending["error_code"], "SETUP_PENDING")
        self.assertEqual(self.adapter.continue_setup(self.attempt)["action"], "start-fresh-attempt")
        next_view = self.adapter.begin()
        self.assertGreater(next_view["attempt"], self.attempt)
        self.assertEqual(next_view["phase"], "waiting-for-app-start")

    def test_raw_real_shape_aggregate_does_not_infer_specific_permission_or_login(self):
        result = self.finish(reason="candidate-source-authentication-timeout", consumedPageCount=0,
                             operatorObservedPermissionPrompt="PRIVATE_PROMPT_TEXT", private_path="/private/account")
        self.assertEqual(result["phase"], "waiting-for-user")
        text = json.dumps(result, ensure_ascii=False)
        for private in ("PRIVATE_PROMPT_TEXT", "/private/account", "登录失败", "权限被拒绝", "TCC"):
            self.assertNotIn(private, text)
        self.assertEqual(result["pending_cause"], "undetermined")

    def test_failed_cleanup_or_restore_never_enables_retry_or_new_attempt(self):
        for cleanup, restore in ((False, True), (True, False)):
            adapter = SetupProgressAdapter()
            attempt = adapter.begin()["attempt"]
            adapter.observe(attempt, {"launchRequested": True})
            result = adapter.finish(attempt, {"ok": False, "reason": "candidate-source-authentication-timeout",
                "runtimeCleanupComplete": cleanup, "originalRestored": restore, "candidateAuthenticated": False})
            self.assertEqual(result["error_code"], "CLEANUP_INCOMPLETE")
            self.assertFalse(result["can_continue"])
            with self.assertRaises(SetupStateError):
                adapter.continue_setup(attempt)
            with self.assertRaisesRegex(SetupStateError, "setup-attempt-busy"):
                adapter.begin()

    def test_identity_failure_cannot_be_replaced_by_later_timeout(self):
        self.running()
        self.assertEqual(self.observe(reason="active-account-changed")["error_code"], "PROCESS_CHANGED")
        result = self.finish(reason="candidate-source-authentication-timeout")
        self.assertEqual(result["phase"], "failed")
        self.assertEqual(result["error_code"], "PROCESS_CHANGED")
        self.assertFalse(result["can_continue"])

    def test_observed_timeout_or_cancel_cannot_overwrite_established_hard_failure(self):
        for failure, code in (("active-account-changed", "PROCESS_CHANGED"),
                              ("observer-forwarding-failed", "OBSERVER_UNAVAILABLE"),
                              ("candidate-watchdog-exited", "WATCHDOG_EXITED")):
            for later in ("candidate-source-authentication-timeout", "source-cancelled", "active-account-not-ready"):
                adapter = SetupProgressAdapter()
                attempt = adapter.begin()["attempt"]
                adapter.observe(attempt, {"watchdogAlive": True, "processCount": 1, "processVerified": True})
                adapter.observe(attempt, {"reason": failure})
                adapter.observe(attempt, {"reason": later})
                result = adapter.finish(attempt, {"ok": False, "reason": "candidate-source-authentication-timeout",
                    "runtimeCleanupComplete": True, "originalRestored": True, "candidateAuthenticated": False})
                self.assertEqual(result["phase"], "failed")
                self.assertEqual(result["error_code"], code)
                self.assertFalse(result["can_continue"])

    def test_same_attempt_process_loss_or_ambiguity_is_failed_not_user_wait(self):
        for facts in ({"processCount": 0}, {"processCount": 2}, {"processVerified": False}):
            adapter = SetupProgressAdapter()
            attempt = adapter.begin()["attempt"]
            adapter.observe(attempt, {"watchdogAlive": True, "processCount": 1, "processVerified": True})
            result = adapter.observe(attempt, facts)
            self.assertEqual(result["phase"], "failed")
            self.assertFalse(result["can_continue"])

    def test_account_or_authentication_loss_does_not_keep_reading_state(self):
        for facts in ({"candidateAuthenticated": False}, {"accountStatus": "not-ready"}):
            adapter = SetupProgressAdapter()
            attempt = adapter.begin()["attempt"]
            adapter.observe(attempt, {"watchdogAlive": True, "processCount": 1, "processVerified": True,
                                      "accountStatus": "verified", "candidateAuthenticated": True, "selectedReadStarted": True})
            self.assertEqual(adapter.observe(attempt, facts)["phase"], "failed")

    def test_stale_callbacks_finish_and_continue_cannot_affect_new_attempt(self):
        old_callback = self.adapter.callback(self.attempt)
        self.finish(reason="candidate-source-authentication-timeout")
        next_attempt = self.adapter.begin()["attempt"]
        before = self.adapter.snapshot()
        old_callback(reason="active-account-changed")
        self.finish(ok=True, candidateAuthenticated=True)
        self.assertEqual(self.adapter.snapshot(), before)
        self.assertEqual(before["attempt"], next_attempt)
        with self.assertRaisesRegex(SetupStateError, "setup-attempt-stale"):
            self.adapter.continue_setup(self.attempt)

    def test_unknown_private_fields_are_rejected_and_reason_text_is_sanitized(self):
        with self.assertRaisesRegex(SetupStateError, "setup-signals-invalid"):
            self.observe(account="private account", key="private key")
        result = self.observe(reason="private exception /private/account/key")
        self.assertEqual(result["error_code"], "SETUP_FAILED")
        self.assertNotIn("/private/account", json.dumps(result))

    def test_invalid_semantic_signal_does_not_poison_following_valid_state(self):
        self.running()
        with self.assertRaisesRegex(SetupStateError, "setup-selected-read-unverified"):
            self.observe(selectedReadStarted=True)
        view = self.observe(accountStatus="verified", candidateAuthenticated=True)
        self.assertEqual(view["phase"], "checking-account")

    def test_duplicate_progress_is_not_republished_and_ui_callback_failure_is_isolated(self):
        self.running()
        count = len(self.published)
        self.observe(accountStatus="not-ready")
        self.assertEqual(len(self.published), count)
        adapter = SetupProgressAdapter(on_change=Mock(side_effect=RuntimeError("private UI error")))
        view = adapter.begin()
        self.assertTrue(adapter.notification_failed)
        self.assertEqual(view["phase"], "waiting-for-app-start")
        self.assertNotIn("private UI error", json.dumps(view))

    def test_success_without_authentication_or_original_restoration_is_rejected(self):
        result = self.finish(ok=True)
        self.assertEqual(result["error_code"], "AUTHORIZATION_NOT_VERIFIED")
        adapter = SetupProgressAdapter()
        attempt = adapter.begin()["attempt"]
        result = adapter.finish(attempt, {"ok": True, "runtimeCleanupComplete": True,
            "originalRestored": False, "candidateAuthenticated": True})
        self.assertEqual(result["error_code"], "CLEANUP_INCOMPLETE")


if __name__ == "__main__":
    unittest.main()
