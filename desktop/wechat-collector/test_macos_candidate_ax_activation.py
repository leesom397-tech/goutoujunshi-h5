"""Synthetic CoreFoundation/AX tests; never launch apps or read user data."""
import ctypes as C
import json
import os
from pathlib import Path
import plistlib
import subprocess
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import macos_ax_probe_stdlib as base
import macos_candidate_ax_activation as probe
from test_macos_ax_probe_stdlib import NativeFixture, put


class Fixture(NativeFixture):
    def __init__(self):
        super().__init__()
        self.generation = (123456, 42)
        self.hit_element = None
        self.direct_reads = []
        self.paths[12] = b"/private/Candidate.app/Contents/MacOS/WeChat"
        ax, _, _, proc = self.libraries
        def info(pid, flavor, argument, out, size):
            self.assert_layout = (flavor, size)
            target = C.cast(out, C.POINTER(probe._ProcBSDInfo))[0]
            target.pid, target.uid = pid, os.getuid()
            target.start_sec, target.start_usec = self.generation
            return size
        def value(element, name, out):
            if self.cf.entry(name)[1] == "AXChildren":
                self.direct_reads.append("AXChildren")
                put(out, C.c_void_p, self.cf.array(self.children.get(element, [])))
                return 0
            return self.value(element, name, out)
        def hit(element, x, y, out):
            if self.hit_element:
                put(out, C.c_void_p, self.cf.retain(self.hit_element))
            return 0
        proc.proc_pidinfo = info
        ax.AXUIElementCopyAttributeValue = value
        ax.AXUIElementCopyElementAtPosition = hit

    def candidate_api(self, **kwargs):
        return probe.CandidateAX(self.paths[12], direct=True,
                                 clock=lambda: self.now, deadline=2.7, libraries=self.libraries, **kwargs)


class NativeTests(unittest.TestCase):
    def setUp(self):
        uid = patch.object(os, "getuid", return_value=501, create=True)
        uid.start()
        self.addCleanup(uid.stop)
        self.f = Fixture()
        self.api = self.f.candidate_api()
        self.app = self.api.application(12)

    def tearDown(self):
        self.api.release(self.app)
        self.api.close()
        self.assertEqual(self.f.cf.no_leaks(), [])

    def test_direct_children_bypasses_zero_count_and_retains_bounded_refs(self):
        children = [self.f.cf.make(1, {"pid": 12, "role": "AXGroup"}) for _ in range(3)]
        self.f.children[self.app] = children
        def zero_count(element, name, out):
            put(out, C.c_long, 0)
            return 0
        self.f.libraries[0].AXUIElementGetAttributeValueCount = zero_count
        result, count = self.api.elements(self.app, "AXChildren", 1)
        self.assertEqual((result, count), ([children[0]], 3))
        self.assertEqual(self.f.direct_reads, ["AXChildren"])
        self.api.release(result[0])
        for child in children:
            self.f.cf.release(child)

    def test_direct_array_malformed_or_foreign_releases_everything(self):
        child = self.f.cf.make(1, {"pid": 12, "role": "AXGroup"})
        foreign = self.f.cf.make(1, {"pid": 999, "role": "AXGroup"})
        self.f.children[self.app] = [child, foreign]
        with self.assertRaises(base.TargetChanged):
            self.api.elements(self.app, "AXChildren", 2)
        self.assertEqual(self.f.cf.entry(child)[2], 1)
        self.f.cf.release(child)
        self.f.cf.release(foreign)

    def test_pid_generation_change_stops_before_any_value_read(self):
        self.f.generation = (123456, 43)
        with self.assertRaises(base.TargetChanged):
            self.api.elements(self.app, "AXChildren", 1)
        self.assertEqual(self.f.direct_reads, [])

    def test_path_mismatch_rejected(self):
        self.f.paths[12] = base.EXECUTABLE
        with self.assertRaises(base.TargetChanged):
            self.api.role(self.app)

    def test_hit_is_owned_and_cross_process_hit_is_discarded(self):
        child = self.f.cf.make(1, {"pid": 12, "role": "AXGroup"})
        self.f.hit_element = child
        result = self.api.hit(self.app, 100.0, 120.0)
        self.assertEqual(self.api.role(result), "AXGroup")
        self.api.release(result)
        self.f.foreign.add(child)
        with self.assertRaises(base.TargetChanged):
            self.api.hit(self.app, 100.0, 120.0)
        self.assertEqual(self.f.cf.entry(child)[2], 1)
        self.f.cf.release(child)

    def test_sensitive_values_and_invalid_bounds_remain_rejected(self):
        for name in ("AXTitle", "AXValue", "AXIdentifier", "AXDescription"):
            with self.assertRaises(ValueError):
                self.api._value(self.app, name)
        for bound in (0, 25, True):
            with self.assertRaises(ValueError):
                self.api.elements(self.app, "AXChildren", bound)
        with self.assertRaises(ValueError):
            self.api.hit(self.app, float("nan"), 0)
        self.assertEqual(self.f.attr_reads, [])

    def test_expected_generation_cannot_attach_to_restarted_app(self):
        api = self.f.candidate_api(identity=(12, os.getuid(), 1, 2))
        try:
            with self.assertRaises(base.TargetChanged):
                api.application(12)
        finally:
            api.close()


class ScopeTests(unittest.TestCase):
    def test_official_signature_and_version_are_checked_without_data_paths(self):
        with tempfile.TemporaryDirectory() as temp:
            app = Path(temp) / "WeChat.app"
            (app / "Contents/MacOS").mkdir(parents=True)
            info = {"CFBundleIdentifier": "com.tencent.xinWeChat", "CFBundleExecutable": "WeChat",
                    "CFBundleVersion": "270135", "CFBundleShortVersionString": "4.1.15"}
            (app / "Contents/Info.plist").write_bytes(plistlib.dumps(info))
            detail = b"TeamIdentifier=5A4RE8SF68\nIdentifier=com.tencent.xinWeChat\n"
            calls = []
            def run(args, **kwargs):
                calls.append(args)
                return SimpleNamespace(returncode=0, stderr=detail)
            with patch.object(probe, "OFFICIAL_APP", app), patch.object(probe.subprocess, "run", run):
                self.assertEqual(probe._official_executable(), app / "Contents/MacOS/WeChat")
                self.assertEqual(len(calls), 2)
                self.assertTrue(all(command[0] == "/usr/bin/codesign" for command in calls))
                info["CFBundleVersion"] = "999999"
                (app / "Contents/Info.plist").write_bytes(plistlib.dumps(info))
                with self.assertRaises(ValueError): probe._official_executable()
                self.assertEqual(len(calls), 2)

    def test_signature_team_rejection(self):
        with tempfile.TemporaryDirectory() as temp:
            app = Path(temp)
            (app / "Contents").mkdir()
            (app / "Contents/Info.plist").write_bytes(plistlib.dumps({
                "CFBundleIdentifier": "com.tencent.xinWeChat", "CFBundleExecutable": "WeChat",
                "CFBundleVersion": "270135", "CFBundleShortVersionString": "4.1.15"}))
            with patch.object(probe, "OFFICIAL_APP", app), patch.object(probe.subprocess, "run",
                    return_value=SimpleNamespace(returncode=0, stderr=b"TeamIdentifier=OTHER\nIdentifier=com.tencent.xinWeChat\n")):
                with self.assertRaises(ValueError): probe._official_executable()

    def test_summary_has_only_aggregate_roles_not_attribute_values(self):
        result = probe._summary({"status": "ready", "nodes": [{"role": "AXGroup", "title": "private"}], "windowCount": 1})
        self.assertEqual(result["roles"], {"AXGroup": 1})
        self.assertNotIn("private", json.dumps(result))

    def test_timeout_kills_only_worker_and_does_not_restore_apps(self):
        child = SimpleNamespace(returncode=None)
        child.communicate = unittest.mock.Mock(side_effect=[subprocess.TimeoutExpired("worker", 28), (b"", b"")])
        child.kill = unittest.mock.Mock()
        with patch.object(probe.sys, "platform", "darwin"):
            result = probe.probe(official=True, popen=lambda *a, **kw: child)
        self.assertEqual(result["status"], "watchdog-timeout")
        child.kill.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()
