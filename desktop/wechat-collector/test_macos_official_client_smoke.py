"""Synthetic smoke guard tests; no downloads, native commands or WeChat launch."""
import contextlib
import hashlib
import json
import os
from pathlib import Path
import plistlib
import struct
import tempfile
import unittest
from unittest.mock import Mock, patch

import macos_official_client_smoke as smoke


class OfficialClientSmokeTests(unittest.TestCase):
    def test_only_fixed_official_https_download_locations_are_accepted(self):
        self.assertEqual(smoke._official_url(smoke.OFFICIAL_DMG), smoke.OFFICIAL_DMG)
        for url in ("http://dldir1v6.qq.com/weixin/Universal/Mac/WeChatMac_4.1.15.dmg",
                    "https://dldir1v6.qq.com.evil.test/weixin/Universal/Mac/WeChatMac_4.1.15.dmg",
                    "https://user:secret@dldir1v6.qq.com/weixin/Universal/Mac/WeChatMac_4.1.15.dmg",
                    smoke.OFFICIAL_DMG + "?token=secret", smoke.OFFICIAL_DMG + "#secret",
                    "https://dldir1v6.qq.com/unrelated.dmg"):
            with self.subTest(url=url), self.assertRaises(smoke.SmokeError):
                smoke._official_url(url)

    def test_local_or_self_hosted_run_cannot_download_or_install(self):
        with patch.dict(os.environ, {"GITHUB_ACTIONS": "true", "RUNNER_ENVIRONMENT": "self-hosted"}, clear=True), \
                patch.object(smoke.sys, "platform", "darwin"), \
                patch.object(smoke.platform, "machine", return_value="arm64"), \
                patch.object(smoke, "_download") as download, patch.object(smoke, "_install_new_client") as install:
            result = smoke.run_smoke(install_for_ci=True)
        self.assertFalse(result["ok"])
        self.assertEqual(result["reason"], "fresh-github-hosted-macos-arm64-required")
        download.assert_not_called()
        install.assert_not_called()

    def test_existing_account_container_is_rejected_without_reading_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            home = Path(temporary)
            container = home / "Library/Containers/com.tencent.xinWeChat"
            container.mkdir(parents=True)
            with self.assertRaisesRegex(smoke.SmokeError, "existing-wechat-profile-rejected"):
                smoke._ensure_clean_profile(home)

    def test_existing_installation_is_not_overwritten(self):
        with tempfile.TemporaryDirectory() as temporary:
            app = Path(temporary) / "WeChat.app"
            app.mkdir()
            marker = app / "untouched"
            marker.write_text("synthetic existing app", encoding="utf-8")
            with patch.object(smoke, "_run") as run, self.assertRaises(smoke.SmokeError):
                smoke._install_new_client(Path(temporary) / "source.app", app)
            self.assertEqual(marker.read_text(encoding="utf-8"), "synthetic existing app")
            run.assert_not_called()

    def test_signature_and_team_are_required_without_modifying_signatures(self):
        with tempfile.TemporaryDirectory() as temporary:
            app = Path(temporary) / "WeChat.app"
            (app / "Contents").mkdir(parents=True)
            (app / "Contents/Info.plist").write_bytes(plistlib.dumps({
                "CFBundleIdentifier": smoke.BUNDLE_ID, "CFBundleExecutable": "WeChat",
                "CFBundleShortVersionString": "4.1.15", "CFBundleVersion": "270102"}))
            signature = ("TeamIdentifier=" + smoke.OFFICIAL_TEAM + "\nIdentifier=" + smoke.BUNDLE_ID + "\n").encode()
            with patch.object(smoke, "_run", side_effect=[(b"", b""), (b"", signature)]) as run:
                result = smoke._verified_bundle(app)
                self.assertEqual(result["wechatBuild"], "270102")
                self.assertTrue(result["signatureVerified"])
                self.assertFalse(any("--sign" in call.args[0] for call in run.call_args_list))
            with patch.object(smoke, "_run", side_effect=[(b"", b""), (b"", b"TeamIdentifier=OTHER\n")]), \
                    self.assertRaisesRegex(smoke.SmokeError, "official-signing-team-invalid"):
                smoke._verified_bundle(app)

    def test_generic_failure_receipt_never_exposes_exception_text(self):
        with patch.object(smoke, "_ci_root", side_effect=RuntimeError("private-path-and-secret")):
            result = smoke.run_smoke()
        self.assertNotIn("private-path-and-secret", json.dumps(result))
        self.assertFalse(result["loginAttempted"])
        self.assertFalse(result["qrRead"])
        self.assertFalse(result["processMemoryRead"])

    def test_window_probe_never_requests_titles_values_or_pixels(self):
        quartz = Mock(kCGWindowListOptionOnScreenOnly=1, kCGNullWindowID=0,
                      kCGWindowOwnerPID="pid", kCGWindowLayer="layer")
        quartz.CGWindowListCopyWindowInfo.return_value = [
            {"pid": 123, "layer": 0, "title": "never accessed"}, {"pid": 99, "layer": 0}]
        ax = Mock()
        ax.AXUIElementCopyAttributeValue.side_effect = [(0, ["window"]), (0, "AXWindow")]
        with patch.dict("sys.modules", {"Quartz": quartz, "ApplicationServices": ax}):
            result = smoke._window_metadata(123, True)
        self.assertEqual(result["visibleWindowCount"], 1)
        self.assertEqual(result["windowRoles"], ["AXWindow"])
        self.assertEqual([call.args[1] for call in ax.AXUIElementCopyAttributeValue.call_args_list],
                         ["AXWindows", "AXRole"])
        self.assertNotIn("never accessed", json.dumps(result))

    def _synthetic_flow(self, root, install, *, known=True):
        install_path = root / "Applications/WeChat.app"
        install_path.parent.mkdir()
        def command(arguments, **kwargs):
            if arguments[:2] == ["/usr/bin/hdiutil", "attach"]:
                mount = Path(arguments[arguments.index("-mountpoint") + 1])
                (mount / "WeChat.app").mkdir()
            elif arguments[0] == "/usr/bin/ditto":
                Path(arguments[2]).mkdir(exist_ok=True)
            return b"", b""
        def download(url, destination):
            destination.write_bytes(b"public synthetic image")
            return {"downloadedBytes": 22, "downloadSha256": "synthetic"}
        with contextlib.ExitStack() as stack:
            stack.enter_context(patch.object(smoke, "_ci_root", return_value=root))
            stack.enter_context(patch.object(smoke, "_ensure_clean_profile"))
            stack.enter_context(patch.object(smoke, "INSTALL_PATH", install_path))
            stack.enter_context(patch.object(smoke, "_download", side_effect=download))
            stack.enter_context(patch.object(smoke, "_run", side_effect=command))
            stack.enter_context(patch.object(smoke, "_verified_bundle", return_value={
                "wechatVersion": "4.1.15" if known else "9.9.99", "wechatBuild": "270102",
                "signatureVerified": True, "teamIdentifier": smoke.OFFICIAL_TEAM}))
            stack.enter_context(patch.object(smoke, "_permission_metadata", return_value={"accessibilityGranted": False, "sip": "disabled"}))
            stack.enter_context(patch.object(smoke, "_static_compatibility", return_value={"staticEvidenceOnly": True}))
            stack.enter_context(patch.object(smoke, "_launch", return_value=(
                (123, 456, "synthetic"), {"launchObserved": True, "visibleWindowCount": 1, "windowRoles": []})))
            stop = stack.enter_context(patch.object(smoke, "_stop_launched"))
            import macos_key_provider as provider
            before = provider.SUPPORTED_BUILDS.copy()
            stack.enter_context(patch.object(provider, "probe_setup", return_value={
                "ready": False, "status": "authorization-required" if known else "MAC_WECHAT_VERSION_UNSUPPORTED"}))
            result = smoke.run_smoke(install_for_ci=install)
            self.assertEqual(provider.SUPPORTED_BUILDS, before)
            self.assertEqual(stop.call_count, 0 if install else 1)
        self.assertEqual(list(root.glob("chengzi-official-smoke-*")), [])
        self.assertEqual(install_path.exists(), install)
        return result

    def test_default_flow_removes_only_temporary_client_and_stops_it(self):
        with tempfile.TemporaryDirectory() as temporary:
            result = self._synthetic_flow(Path(temporary).resolve(), False)
        self.assertTrue(result["ok"])
        self.assertFalse(result["officialClientLeftRunning"])

    def test_ci_install_flow_retains_verified_client_for_following_gui_step(self):
        with tempfile.TemporaryDirectory() as temporary:
            result = self._synthetic_flow(Path(temporary).resolve(), True)
        self.assertTrue(result["ok"])
        self.assertTrue(result["installedNewOfficialClient"])
        self.assertTrue(result["officialClientLeftRunning"])

    def test_unknown_build_is_reported_and_never_added_to_allowlist(self):
        with tempfile.TemporaryDirectory() as temporary:
            result = self._synthetic_flow(Path(temporary).resolve(), True, known=False)
        self.assertTrue(result["ok"])  # Correctly refusing a new build is a successful probe.
        self.assertFalse(result["collectorBuildSupported"])
        self.assertFalse(result["captureCompatible"])
        self.assertFalse(result["captureValidated"])
        self.assertEqual(result["captureCompatibilityStatus"], "blocked-unsupported-build")
        self.assertEqual(result["providerStatus"], "MAC_WECHAT_VERSION_UNSUPPORTED")
        self.assertFalse(result["sipOnCaptureValidated"])
        self.assertIn("cannot-validate-sip-on", result["sipAcceptance"])

    @staticmethod
    def _thin_arm64():
        code = b"\x1f\x20\x03\xd5"  # Synthetic arm64 NOP, never executed.
        header = struct.pack("<8I", 0xFEEDFACF, 0x0100000C, 0, 2, 1, 152, 0, 0)
        segment = struct.pack("<II16sQQQQIIII", 0x19, 152, b"__TEXT", 0, 188, 0, 188, 5, 5, 1, 0)
        section = struct.pack("<16s16sQQIIIIIIII", b"__text", b"__TEXT", 184, len(code), 184, 2, 0, 0, 0, 0, 0, 0)
        return header + segment + section + code, code

    def test_instruction_fingerprint_reads_thin_and_fat_without_changing_code(self):
        thin, code = self._thin_arm64()
        fat = struct.pack(">II", 0xCAFEBABE, 1) + struct.pack(">IIIII", 0x0100000C, 0, 32, len(thin), 0) + b"\0" * 4 + thin
        with tempfile.TemporaryDirectory() as temporary:
            binary = Path(temporary) / "public-synthetic.dylib"
            for data in (thin, fat):
                binary.write_bytes(data)
                self.assertEqual(smoke._arm64_text_digest(binary), hashlib.sha256(code).hexdigest())
                self.assertEqual(binary.read_bytes(), data)
            binary.write_bytes(thin[:40])
            self.assertIsNone(smoke._arm64_text_digest(binary))

    def test_static_probe_checks_actual_entitlements_and_imports_without_capture(self):
        import macos_key_provider as provider
        entitlements = {"com.apple.application-identifier": "5A4RE8SF68.com.tencent.xinWeChat",
                        "com.apple.security.app-sandbox": True,
                        "com.apple.security.application-groups": ["5A4RE8SF68.com.tencent.xinWeChat"],
                        "com.apple.security.cs.allow-jit": True}
        with tempfile.TemporaryDirectory() as temporary:
            app = Path(temporary) / "WeChat.app"
            binary = app / "Contents/MacOS/WeChat"
            binary.parent.mkdir(parents=True)
            binary.write_bytes(self._thin_arm64()[0])
            def command(arguments, **kwargs):
                if arguments[0] == "/usr/bin/codesign":
                    return plistlib.dumps(entitlements), b""
                if arguments[0] == "/usr/bin/lipo":
                    return b"arm64 x86_64\n", b""
                if arguments[0] == "/usr/bin/nm":
                    return b"_CCKeyDerivationPBKDF\n", b""
                raise AssertionError("unexpected native command")
            before = provider.SUPPORTED_BUILDS.copy()
            with patch.object(smoke, "_run", side_effect=command) as run, \
                    patch.object(provider, "initialize_authorized_access") as capture:
                result = smoke._static_compatibility(app)
                self.assertTrue(result["baselineEntitlementPolicyMatches"])
                self.assertTrue(result["kdfImportObserved"])
                self.assertFalse(result["loginTimeKdfShapeValidated"])
                self.assertFalse(result["allowlistChanged"])
                self.assertEqual(result["kdfImportBinaries"], ["Contents/MacOS/WeChat"])
                entitlements["com.apple.developer.unreviewed-identity"] = True
                self.assertFalse(smoke._static_compatibility(app)["baselineEntitlementPolicyMatches"])
                capture.assert_not_called()
                self.assertTrue(all("--sign" not in call.args[0] for call in run.call_args_list))
            self.assertEqual(provider.SUPPORTED_BUILDS, before)


if __name__ == "__main__":
    unittest.main()
