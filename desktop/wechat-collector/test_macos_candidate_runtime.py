"""Synthetic safety/decision regressions; never download or launch WeChat."""
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import macos_candidate_runtime as runtime


class CandidateRuntimeTests(unittest.TestCase):
    def test_download_is_exact_public_candidate_only(self):
        self.assertEqual(runtime._official_url(runtime.URL), runtime.URL)
        for url in (runtime.URL.replace("https:", "http:"), runtime.URL + "?token=secret",
                    runtime.URL.replace("270135", "270102"), runtime.URL.replace("qq.com", "qq.com.evil.test")):
            with self.subTest(url=url), self.assertRaises(runtime.DiagnosticError):
                runtime._official_url(url)

    def test_local_self_hosted_or_non_arm64_never_loads_observer_or_downloads(self):
        for environment in ({}, {"GITHUB_ACTIONS": "true", "RUNNER_ENVIRONMENT": "self-hosted"},
                            {"GITHUB_ACTIONS": "true", "RUNNER_ENVIRONMENT": "github-hosted", "RUNNER_OS": "Linux"}):
            with self.subTest(environment=environment), patch.dict(os.environ, environment, clear=True), \
                    patch.object(runtime, "_download") as download, patch.object(runtime, "_pinned_modules") as load:
                result = runtime.run_diagnostic()
            self.assertFalse(result["ok"])
            self.assertFalse(result["captureValidated"])
            self.assertFalse(result["ordinaryMacAcceptance"])
            download.assert_not_called()
            load.assert_not_called()

    def test_existing_account_guard_stops_before_download(self):
        with patch.object(runtime.smoke, "_ci_root", return_value=Path("/fake-runner")), \
                patch.object(runtime.smoke, "_ensure_clean_profile", side_effect=runtime.smoke.SmokeError("existing-wechat-profile-rejected")), \
                patch.object(runtime, "_download") as download:
            result = runtime.run_diagnostic()
        self.assertEqual(result["reason"], "existing-wechat-profile-rejected")
        download.assert_not_called()

    def test_unknown_exceptions_do_not_leak_messages_paths_or_credentials(self):
        with patch.object(runtime.smoke, "_ci_root", side_effect=RuntimeError("sensitive-private-path-token")):
            result = runtime.run_diagnostic()
        self.assertNotIn("sensitive", json.dumps(result))
        self.assertEqual(result["reason"], "candidate-diagnostic-failed")

    def test_candidate_bytes_are_never_serialized_and_abort_immediately(self):
        values = [b"private-candidate-do-not-serialize"]
        channel = Mock(invalid=False)
        channel.read_candidates.return_value = values
        with self.assertRaisesRegex(runtime.DiagnosticError, "unexpected-candidate-frame-empty-profile") as error:
            runtime._drain_status(channel)
        self.assertEqual(values, [])
        self.assertNotIn("private", str(error.exception))
        channel.diagnostic_snapshot.assert_not_called()

    def test_invalid_channel_and_failed_resolution_cannot_pass(self):
        channel = Mock(invalid=True)
        channel.read_candidates.return_value = []
        with self.assertRaisesRegex(runtime.DiagnosticError, "channel-invalid"):
            runtime._drain_status(channel)
        result = self.good_result()
        result["candidate"]["observer"]["counts"]["resolve_failed"] = 1
        self.assertFalse(runtime._assessment(result)["startupChecksPassed"])

    def test_policy_experiment_requires_exact_candidate_and_retains_sandbox(self):
        expected = {"com.apple.security.app-sandbox": True,
                    "com.apple.security.temporary-exception.mach-register.global-name": [
                        "5A4RE8SF68.com.tencent.xinWeChat.MachPortRendezvousServer.*",
                        "5A4RE8SF68.com.tencent.xinWeChat.MMMojo.MachPortRendezvousServer.*",
                        runtime.SERVICE_PREFIX + "*"]}
        module = SimpleNamespace(_debug_copy_entitlements=Mock(return_value=expected))
        with self.assertRaises(runtime.DiagnosticError):
            runtime._candidate_entitlements(module, {}, {"matchesInspectedCandidate": False})
        module._debug_copy_entitlements.assert_not_called()
        self.assertEqual(runtime._candidate_entitlements(module, {}, {"matchesInspectedCandidate": True}), expected)
        self.assertEqual(module._debug_copy_entitlements.call_args.kwargs["client_version"], ("4.1.15", "270102"))
        expected["com.apple.security.app-sandbox"] = False
        with self.assertRaises(runtime.DiagnosticError):
            runtime._candidate_entitlements(module, {}, {"matchesInspectedCandidate": True})

    @staticmethod
    def good_result():
        return {"official": {"stableWindowObserved": True}, "copyIntegrityVerified": True,
                "candidate": {"stableWindowObserved": True, "xplayerRegistrationObserved": False,
                              "observer": {"counts": {"constructor": 1, "load": 1}}}}

    def test_stable_window_without_observer_is_not_a_pass(self):
        result = self.good_result()
        result["candidate"]["observer"] = {"counts": {}}
        self.assertFalse(runtime._assessment(result)["startupChecksPassed"])

    def test_sip_disabled_and_xplayer_not_triggered_are_explicit_partial_coverage(self):
        result = self.good_result()
        result["sip"] = "disabled"
        verdict = runtime._assessment(result)
        self.assertTrue(verdict["startupChecksPassed"])
        self.assertFalse(verdict["xplayerRegistrationValidated"])
        self.assertFalse(verdict["ordinaryMacAcceptance"])
        self.assertFalse(verdict["captureCompatible"])
        self.assertIn("not-triggered-or-not-visible", verdict["decision"])
        result["candidate"]["xplayerRegistrationObserved"] = True
        verdict = runtime._assessment(result)
        self.assertTrue(verdict["xplayerRegistrationValidated"])
        self.assertFalse(verdict["loginTimeKdfShapeValidated"])
        self.assertFalse(verdict["captureValidated"])

    def test_process_restart_is_not_hidden_by_rebinding(self):
        clock = [0.0]
        def advance(value):
            clock[0] += value
        output = {}
        with patch.object(runtime.time, "monotonic", side_effect=lambda: clock[0]), \
                patch.object(runtime.time, "sleep", side_effect=advance), \
                patch.object(runtime, "_find_process", side_effect=[(10, 1, "/fake/WeChat"), (10, 2, "/fake/WeChat")]), \
                patch.object(runtime.smoke, "_window_metadata", return_value={"visibleWindowCount": 1, "windowRoles": ["AXWindow"]}), \
                patch.object(runtime, "_xplayer_service", return_value=(False, 1102)):
            with self.assertRaisesRegex(runtime.DiagnosticError, "exited-or-restarted"):
                runtime._observe(Path("/fake"), False, seconds=1, output=output)
        self.assertFalse(output["stableWindowObserved"])
        self.assertEqual(output["visibleWindowCount"], 1)

    def test_window_must_be_continuously_visible_for_the_stability_interval(self):
        clock = [0.0]
        def advance(value):
            clock[0] += value
        def window(*args):
            return {"visibleWindowCount": 0 if clock[0] == 0.5 else 1, "windowRoles": []}
        with patch.object(runtime.time, "monotonic", side_effect=lambda: clock[0]), \
                patch.object(runtime.time, "sleep", side_effect=advance), \
                patch.object(runtime, "_find_process", return_value=(10, 1, "/fake/WeChat")), \
                patch.object(runtime.smoke, "_window_metadata", side_effect=window), \
                patch.object(runtime, "_xplayer_service", return_value=(True, 0)):
            result = runtime._observe(Path("/fake"), False, seconds=1)
        self.assertEqual(clock[0], 1.75)
        self.assertTrue(result["stableWindowObserved"])
        self.assertTrue(result["xplayerRegistrationObserved"])
        self.assertFalse(result["loginWindowContentVerified"])

    def test_cleanup_failure_cannot_leave_a_success_receipt_or_delete_live_code(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            provider = SimpleNamespace(SUPPORTED_BUILDS=frozenset({runtime.probe.BASELINE}))
            debug = SimpleNamespace(_WECHAT_AD_HOC_POLICIES={runtime.probe.BASELINE: True},
                                    _entitlements=Mock(return_value={}), _bundle_source_digest=Mock(return_value=b"digest"))
            watcher = Mock()
            key = SimpleNamespace(launch_debug_copy_watchdog=Mock(return_value=watcher),
                                  request_debug_copy_watchdog_cleanup=Mock(return_value=False),
                                  cleanup_debug_copy_bundle=Mock(return_value=True))
            capture = SimpleNamespace(ensure_capture_library=Mock(return_value=root / "helper.dylib"))
            channel = Mock(invalid=False)
            channel.read_candidates.return_value = []
            channel.diagnostic_snapshot.return_value = {"counts": {"constructor": 1, "load": 1}, "invalid": False}
            channel.close.return_value = True
            def command(args, **kwargs):
                if args[0] == "/usr/bin/ditto":
                    Path(args[-1]).mkdir()
                return b"", b""
            def shadow(original, work, *args):
                path = work / "Candidate.app"
                path.mkdir()
                return path, b"digest"
            def observe(app, trusted, *, output, **kwargs):
                output.update(stableWindowObserved=True, xplayerRegistrationObserved=True,
                              observer={"counts": {"constructor": 1, "load": 1}})
            with patch.object(runtime.smoke, "_ci_root", return_value=root), \
                    patch.object(runtime.smoke, "_ensure_clean_profile"), \
                    patch.object(runtime.smoke, "INSTALL_PATH", root / "not-installed.app"), \
                    patch.object(runtime.smoke, "_permission_metadata", return_value={"sip": "disabled", "accessibilityGranted": False}), \
                    patch.object(runtime, "_pinned_modules", return_value=(provider, debug, capture, key)), \
                    patch.object(runtime, "_download", return_value={"dmgSha256": "public-test-digest"}), \
                    patch.object(runtime.smoke, "_run", side_effect=command), \
                    patch.object(runtime.smoke, "_verified_bundle", return_value={"signatureVerified": True}), \
                    patch.object(runtime.probe, "probe_candidate", return_value={"matchesInspectedCandidate": True}), \
                    patch.object(runtime, "_candidate_entitlements", return_value={}), \
                    patch.object(runtime, "_prepare_shadow", side_effect=shadow), \
                    patch.object(runtime.smoke, "_launch", return_value=((10, 1, "/test"), {})), \
                    patch.object(runtime.smoke, "_stop_launched"), \
                    patch.object(runtime, "_observe", side_effect=observe), \
                    patch.object(runtime, "_new_channel", return_value=channel):
                result = runtime.run_diagnostic()
            self.assertFalse(result["ok"])
            self.assertFalse(result["temporaryCleanupComplete"])
            self.assertTrue(result["productionPoliciesUnchangedVerified"])
            self.assertTrue(result["originalUnchangedVerified"])
            self.assertEqual(len(list(root.glob("chengzi-candidate-270135-*"))), 1)
            channel.close.assert_called_once()
            self.assertEqual(key.cleanup_debug_copy_bundle.call_count, 3)


if __name__ == "__main__":
    unittest.main()
