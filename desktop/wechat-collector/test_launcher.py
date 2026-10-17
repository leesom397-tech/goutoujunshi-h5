"""Offline bootstrap checks; no browser, WeChat, or network request starts."""

import hashlib
from http.server import BaseHTTPRequestHandler, HTTPServer
import io
import json
from pathlib import Path
import queue
import tempfile
import threading
import unittest
from unittest.mock import patch
import zipfile

import launcher


def synthetic_package(entries=None):
    contents = {"ChengziWeChatCollector/ChengziWeChatCollector.exe": b"synthetic GUI executable"}
    if entries:
        contents.update(entries)
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, data in contents.items():
            archive.writestr(name, data)
    payload = stream.getvalue()
    version = "9.8.7"
    manifest = {
        "version": version,
        "bytes": len(payload),
        "sha256": hashlib.sha256(payload).hexdigest(),
        "exeSha256": hashlib.sha256(contents["ChengziWeChatCollector/ChengziWeChatCollector.exe"]).hexdigest(),
        "parts": [{
            "name": f"chengzi-wechat-collector-{version}.part01.bin",
            "bytes": len(payload),
            "sha256": hashlib.sha256(payload).hexdigest(),
        }],
    }
    return manifest, payload


class _Response(io.BytesIO):
    status = 200

    def __init__(self, url, payload):
        super().__init__(payload)
        self.url = url

    def geturl(self):
        return self.url


class _Opener:
    def __init__(self, payload):
        self.payload = payload
        self.urls = []

    def open(self, request, timeout):
        self.urls.append((request.full_url, request.get_header("User-agent")))
        return _Response(request.full_url, self.payload)


class LauncherTest(unittest.TestCase):
    def test_old_running_helper_requires_exit_before_upgrade(self):
        manifest, _ = synthetic_package()
        window = launcher.LauncherWindow.__new__(launcher.LauncherWindow)
        window.manifest = manifest
        window.messages = queue.Queue()
        with patch.object(launcher, "running_assistant", return_value=("assistant", "1.2.0")), \
                patch.object(launcher, "install") as install, \
                patch.object(launcher, "launch_assistant") as launch:
            window._work()
        self.assertEqual(window.messages.get_nowait(), ("outdated", "1.2.0"))
        install.assert_not_called()
        launch.assert_not_called()

    def test_running_assistant_is_identified_by_loopback_health(self):
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'{"version":"1.2.4","protocol":1}')

            def log_message(self, *_args):
                pass

        server = HTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.handle_request, daemon=True)
        thread.start()
        try:
            with patch.object(launcher, "ASSISTANT_PORT", server.server_port):
                self.assertEqual(launcher.running_assistant(), ("assistant", "1.2.4"))
        finally:
            thread.join(timeout=2)
            server.server_close()

    def test_manifest_allows_only_ordered_fixed_names_and_correct_sizes(self):
        manifest, _ = synthetic_package()
        self.assertEqual(launcher.validate_manifest(manifest), manifest)
        changed = json.loads(json.dumps(manifest))
        changed["parts"][0]["name"] = "../../untrusted.exe"
        with self.assertRaises(launcher.InstallError):
            launcher.validate_manifest(changed)
        changed = json.loads(json.dumps(manifest))
        changed["parts"][0]["bytes"] += 1
        with self.assertRaises(launcher.InstallError):
            launcher.validate_manifest(changed)

    def test_integrity_failure_never_installs_a_program(self):
        manifest, payload = synthetic_package()
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            opener = _Opener(payload[:-1] + b"x")
            with self.assertRaises(launcher.InstallError):
                launcher.install(manifest, lambda *_: None, base=base, opener=opener)
            self.assertEqual(opener.urls, [(
                launcher.DOWNLOAD_ROOT + manifest["parts"][0]["name"],
                launcher.DOWNLOAD_USER_AGENT,
            )])
            self.assertFalse((base / manifest["version"] / launcher.APP_NAME / launcher.EXE_NAME).exists())

    def test_install_reuses_verified_local_executable(self):
        manifest, payload = synthetic_package()
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            opener = _Opener(payload)
            exe = launcher.install(manifest, lambda *_: None, base=base, opener=opener)
            self.assertEqual(exe.read_bytes(), b"synthetic GUI executable")
            self.assertEqual(len(opener.urls), 1)
            second = launcher.install(manifest, lambda *_: None, base=base, opener=_Opener(b"wrong"))
            self.assertEqual(second, exe)

    def test_archive_traversal_and_links_are_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            manifest, payload = synthetic_package({"ChengziWeChatCollector/../outside.txt": b"bad"})
            archive = base / "bad.zip"
            archive.write_bytes(payload)
            with self.assertRaises(launcher.InstallError):
                launcher.extract_verified_archive(archive, base / "unpack")
            self.assertFalse((base / "outside.txt").exists())


if __name__ == "__main__":
    unittest.main()
