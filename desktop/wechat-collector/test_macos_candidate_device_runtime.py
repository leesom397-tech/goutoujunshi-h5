"""Synthetic stream/lifecycle checks, no real user data or native launch."""
import hashlib
import json
import os
from pathlib import Path
import struct
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import macos_candidate_device_runtime as device


def status(code, detail=0):
    return b"WXS1" + bytes([code]) + struct.pack("<I", detail) + b"\0" * 7


class DeviceCandidateTests(unittest.TestCase):
    def test_minimal_runtime_sources_are_pinned_to_shipped_bytes(self):
        package = Path(device.__file__).parent / "vendor/chatlog_keeper"
        for name, digest in device.EXTRA_SOURCES.items():
            self.assertEqual(hashlib.sha256((package / name).read_bytes()).hexdigest(), digest, name)

    def test_split_candidate_frame_is_discarded_without_returning_content(self):
        reader = device.StatusOnlyReader()
        payload = b"very-private-candidate".ljust(32, b"!")
        raw = status(1) + b"WXK1" + payload + status(2, 1) + status(7)
        for byte in raw:
            reader.feed(bytes([byte]))
        receipt = reader.snapshot()
        self.assertEqual(receipt["candidateFramesDiscarded"], 1)
        self.assertEqual(receipt["counts"], {"constructor": 1, "load": 1, "match": 1})
        self.assertEqual(reader.buffer, bytearray())
        self.assertNotIn("private", json.dumps(receipt))
        self.assertFalse(receipt["candidateBytesRetained"])

    def test_invalid_or_overflow_stream_is_wiped_and_refused(self):
        for raw in (b"WRONG-private", status(99), b"WXK1" + b"x" * 65537,
                    b"WXS1" + b"\x01" + b"\0" * 4 + b"notzero"):
            reader = device.StatusOnlyReader()
            with self.assertRaises(device.runtime.DiagnosticError):
                reader.feed(raw)
            self.assertEqual(reader.buffer, bytearray())

    def test_partial_candidate_is_wiped_on_close(self):
        reader = device.StatusOnlyReader()
        reader.feed(b"WXK1partial-private-value")
        reader.clear()
        self.assertEqual(reader.buffer, bytearray())
        self.assertNotIn("private", json.dumps(reader.snapshot()))

    def test_running_original_or_xplayer_is_never_quit_by_diagnostic(self):
        for results in (([12],), ([], [20]), (None,)):
            debug = SimpleNamespace(_exact_process_pids=Mock(side_effect=results))
            with self.assertRaises(device.runtime.DiagnosticError):
                device._original_is_closed(debug)
        debug = SimpleNamespace(_exact_process_pids=Mock(return_value=[]))
        device._original_is_closed(debug)
        self.assertEqual(debug._exact_process_pids.call_count, 2)

    def test_other_platform_or_sip_disabled_never_builds_or_launches(self):
        with patch.object(device.sys, "platform", "win32"), patch.object(device, "_load_modules") as load:
            result = device.run("unused", start=True)
        self.assertFalse(result["ok"])
        load.assert_not_called()
        with patch.object(device.sys, "platform", "darwin"), \
                patch.object(device.platform, "machine", return_value="arm64"), \
                patch.object(device, "_sip_state", return_value="disabled"), patch.object(device, "_load_modules") as load:
            result = device.run("unused", start=True)
        self.assertEqual(result["reason"], "device-normal-sip-required")
        load.assert_not_called()

    def test_unknown_exception_does_not_expose_native_output(self):
        with patch.object(device.sys, "platform", "darwin"), \
                patch.object(device.platform, "machine", return_value="arm64"), \
                patch.object(device, "_sip_state", side_effect=RuntimeError("user-private-secret")):
            result = device.run("unused")
        self.assertNotIn("private-secret", json.dumps(result))

    def test_wrong_receipt_path_is_refused_before_reading(self):
        with self.assertRaisesRegex(device.runtime.DiagnosticError, "receipt-location-rejected"), \
                patch.object(Path, "read_text") as read:
            device._load_receipt("/tmp/arbitrary.json")
        read.assert_not_called()

    def test_process_generation_change_is_a_failure(self):
        clock = [0.0]
        def advance(amount):
            clock[0] += amount
        debug = SimpleNamespace(_exact_process_pids=Mock(return_value=(4,)))
        executable = Path("/fake/Candidate.app/Contents/MacOS/WeChat")
        key = SimpleNamespace(process_identity=Mock(side_effect=[(os.fsencode(executable.resolve()), 1, 0),
                                                                  (os.fsencode(executable.resolve()), 2, 0)]))
        watcher = Mock()
        watcher.poll.return_value = None
        reader = Mock()
        reader.drain.return_value = {}
        with patch.object(device.time, "monotonic", side_effect=lambda: clock[0]), \
                patch.object(device.time, "sleep", side_effect=advance), \
                patch.object(device, "_window_count", return_value=1):
            with self.assertRaisesRegex(device.runtime.DiagnosticError, "generation-changed"):
                device._observe(Path("/fake/Candidate.app"), debug, key, watcher, Mock(), reader, {}, 60)

    def test_runtime_prepare_creates_and_closes_channel_without_launch_or_original_stop(self):
        with tempfile.TemporaryDirectory() as temporary:
            work = Path(temporary)
            debug = SimpleNamespace(_acquire_launch_lock=Mock(return_value=object()), _release_launch_lock=Mock())
            capture = SimpleNamespace(ensure_capture_library=Mock(return_value=work / "observer"),
                                      validate_capture_fifo=Mock(return_value=True))
            key = SimpleNamespace(ensure_helper=Mock(return_value=work / "helper"),
                                  debug_copy_bundle_is_running=Mock(return_value=False),
                                  launch_debug_copy_watchdog=Mock())
            channel = Mock(path=work / "fifo", identity=(1, 2), read_fd=123)
            channel.close.return_value = True
            with patch.object(device.sys, "platform", "darwin"), \
                    patch.object(device.platform, "machine", return_value="arm64"), \
                    patch.object(device, "_sip_state", return_value="enabled"), \
                    patch.object(device, "_load_receipt", return_value=(work, work / "Candidate.app", b"digest")), \
                    patch.object(device, "_load_modules", return_value=(debug, capture, key)), \
                    patch.object(device, "_verify", return_value={}), \
                    patch.object(device.runtime, "_new_channel", return_value=channel), \
                    patch.object(device.StatusOnlyReader, "drain", return_value={"counts": {}}), \
                    patch.object(device.os, "O_NOFOLLOW", 0, create=True), \
                    patch.object(device, "_original_is_closed") as closed:
                result = device.run("unused", start=False)
            self.assertTrue(result["ok"])
            self.assertTrue(result["runtimeCleanupComplete"])
            channel.close.assert_called_once()
            key.launch_debug_copy_watchdog.assert_not_called()
            closed.assert_not_called()
            self.assertFalse(result["originalStoppedByDiagnostic"])

    def test_failed_start_cleans_own_copy_before_optional_original_restore(self):
        for cleanup_ok in (True, False):
            with self.subTest(cleanup=cleanup_ok), tempfile.TemporaryDirectory() as temporary:
                work, order = Path(temporary), []
                debug = SimpleNamespace(_acquire_launch_lock=Mock(return_value=object()), _release_launch_lock=Mock())
                capture = SimpleNamespace(ensure_capture_library=Mock(return_value=work / "observer"),
                                          validate_capture_fifo=Mock(return_value=True))
                watcher = Mock()
                def watcher_cleanup(*args):
                    order.append("watcher-cleanup")
                    return cleanup_ok
                def bundle_cleanup(*args):
                    order.append("bundle-cleanup")
                    return True
                def restore(*args):
                    order.append("restore-original")
                    return True
                key = SimpleNamespace(ensure_helper=Mock(return_value=work / "helper"),
                    debug_copy_bundle_is_running=Mock(return_value=False),
                    launch_debug_copy_watchdog=Mock(return_value=watcher),
                    request_debug_copy_watchdog_cleanup=watcher_cleanup, cleanup_debug_copy_bundle=bundle_cleanup)
                channel = Mock(path=work / "fifo", identity=(1, 2), read_fd=123)
                channel.close.side_effect = lambda: order.append("fifo-close") or True
                with patch.object(device.sys, "platform", "darwin"), \
                        patch.object(device.platform, "machine", return_value="arm64"), \
                        patch.object(device, "_sip_state", return_value="enabled"), \
                        patch.object(device, "_load_receipt", return_value=(work, work / "Candidate.app", b"digest")), \
                        patch.object(device, "_load_modules", return_value=(debug, capture, key)), \
                        patch.object(device, "_verify", return_value={}), \
                        patch.object(device.runtime, "_new_channel", return_value=channel), \
                        patch.object(device.StatusOnlyReader, "drain", return_value={"counts": {}}), \
                        patch.object(device.os, "O_NOFOLLOW", 0, create=True), \
                        patch.object(device, "_original_is_closed"), \
                        patch.object(device, "_observe", side_effect=device.runtime.DiagnosticError("device-observer-load-or-forwarding-failed")), \
                        patch.object(device, "_restore_original", side_effect=restore):
                    result = device.run("unused", start=True, restore_original=True)
                self.assertFalse(result["ok"])
                self.assertEqual(order[:3], ["watcher-cleanup", "bundle-cleanup", "fifo-close"])
                self.assertEqual(result["originalRestored"], cleanup_ok)
                self.assertEqual("restore-original" in order, cleanup_ok)


if __name__ == "__main__":
    unittest.main()
