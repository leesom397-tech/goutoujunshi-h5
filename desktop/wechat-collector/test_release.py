"""Synthetic release/probe checks. No real WeChat, server or executable starts."""
import contextlib
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import zipfile

import main
import package_release
from normalize import VERSION


class ReleaseTest(unittest.TestCase):
    @unittest.skipUnless(os.name == "nt", "Windows launcher smoke test")
    def test_extracted_launcher_finds_internal_installer(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive = package_release.write_bootstrap(root, {"version": VERSION})
            with zipfile.ZipFile(archive) as bootstrap:
                bootstrap.extractall(root / "unpacked")
            extracted = root / "unpacked"
            marker = extracted / "_internal" / "smoke.ok"
            (extracted / "_internal" / "install.ps1").write_text(
                'Set-Content -LiteralPath (Join-Path $PSScriptRoot "smoke.ok") -Value "ok"',
                encoding="utf-8-sig",
            )
            result = subprocess.run(
                ["cmd.exe", "/d", "/c", str(extracted / "01-双击启动成子助手.cmd")],
                cwd=extracted, input=b"\n", capture_output=True, timeout=20, check=False,
            )
            self.assertEqual(result.returncode, 0, result.stdout.decode("utf-8", errors="replace"))
            self.assertEqual(marker.read_text(encoding="utf-8-sig").strip(), "ok")

    @unittest.skipUnless(os.name == "nt", "Windows single-file launcher test")
    def test_launcher_bootstraps_when_only_cmd_file_is_available(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            marker = root / "embedded.ok"
            launcher = root / "01-双击启动成子助手.cmd"
            launcher.write_bytes(package_release.bootstrap_command(
                {"version": VERSION},
                installer_source='Set-Content -LiteralPath $env:CHENGZI_SMOKE_TARGET -Value "ok" -Encoding utf8',
            ).encode("utf-8"))
            environment = os.environ.copy()
            environment["CHENGZI_SMOKE_TARGET"] = str(marker)
            result = subprocess.run(
                ["cmd.exe", "/d", "/c", str(launcher)],
                cwd=root, input=b"\n", capture_output=True, timeout=30, check=False, env=environment,
            )
            self.assertEqual(result.returncode, 0, result.stdout.decode("utf-8", errors="replace"))
            self.assertEqual(marker.read_text(encoding="utf-8-sig").strip(), "ok")

    def test_embedded_installer_is_rendered_to_current_version(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            command = package_release.bootstrap_command({"version": VERSION})
            marker = 'set "CHENGZI_INSTALLER_B64='
            encoded = command.split(marker, 1)[1].split('"', 1)[0]
            installer = base64.b64decode(encoded).decode("utf-8-sig")
            self.assertNotIn("{{VERSION}}", installer)
            self.assertNotIn("{{VERSION_REGEX}}", installer)
            self.assertIn("'" + VERSION + "'", installer)
            self.assertIn(VERSION.replace(".", r"\."), installer)

    @unittest.skipUnless(os.name == "nt", "Windows launcher failure-path test")
    def test_launcher_keeps_the_real_installer_error_visible(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "_internal").mkdir()
            (root / "_internal" / "install.ps1").write_text(
                "Write-Host 'SYNTHETIC DISK ERROR'; exit 1", encoding="utf-8-sig"
            )
            launcher = root / "01-双击启动成子助手.cmd"
            launcher.write_bytes(package_release.bootstrap_command().encode("utf-8"))
            result = subprocess.run(
                ["cmd.exe", "/d", "/c", str(launcher)],
                cwd=root, input=b"\n", capture_output=True, timeout=30, check=False,
            )
            output = result.stdout.decode("utf-8", errors="replace")
            self.assertEqual(result.returncode, 1, output)
            self.assertIn("SYNTHETIC DISK ERROR", output)
            self.assertIn("安装未完成", output)
            self.assertNotIn("not recognized", output)

    def test_probe_output_is_explicit_and_never_starts_bridge(self):
        health = {"version": VERSION, "ready": False, "message": "synthetic compatibility only"}
        with tempfile.TemporaryDirectory() as temporary:
            destination = Path(temporary) / "health.json"
            with patch("sys.argv", ["collector", "--probe", "--probe-output", str(destination)]), patch.object(main, "CollectorState") as state, patch.object(main, "server_for") as server, contextlib.redirect_stdout(io.StringIO()) as output:
                state.return_value.health.return_value = health
                main.main()
                self.assertEqual(json.loads(destination.read_text(encoding="utf-8")), health)
                self.assertEqual(json.loads(output.getvalue()), health)
                server.assert_not_called()
            destination.unlink()
            with patch("sys.argv", ["collector", "--probe-output", str(destination)]), patch.object(main, "CollectorState") as state, contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit) as error:
                    main.main()
                self.assertEqual(error.exception.code, 2)
                state.assert_not_called()
                self.assertFalse(destination.exists(), "output flag outside probe must have no file or GUI side effects")
            with patch("sys.argv", ["collector", "--probe"]), patch.object(main, "CollectorState") as state, patch.object(main, "server_for") as server, contextlib.redirect_stdout(io.StringIO()):
                state.return_value.health.return_value = health
                main.main()
                self.assertEqual(list(Path(temporary).iterdir()), [])
                server.assert_not_called()

    def test_explicit_app_packages_beside_it_without_overwriting_default(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for filename in package_release.SOURCE_FILES:
                source_file = root / filename
                source_file.parent.mkdir(parents=True, exist_ok=True)
                source_file.write_text("synthetic source only", encoding="utf-8")
            (root / "install.ps1").write_text(Path(__file__).with_name("install.ps1").read_text(encoding="utf-8"), encoding="utf-8")
            upstream = root / ".venv" / "Lib" / "site-packages"
            for name in ("pyweixin", "pywechat"):
                (upstream / name).mkdir(parents=True)
                (upstream / name / "__init__.py").write_text("# synthetic upstream source", encoding="utf-8")
            default = root / "dist" / "ChengziWeChatCollector"
            default.mkdir(parents=True)
            sentinel = default / "keep-old-version.txt"
            sentinel.write_text("old running build", encoding="utf-8")
            app = root / "dist" / VERSION / "ChengziWeChatCollector"
            app.mkdir(parents=True)
            exe = app / "ChengziWeChatCollector.exe"
            exe.write_bytes(b"synthetic executable bytes, never executed")
            for name in (package_release.OFFLINE_OCR_ASSETS + package_release.LOCAL_VOICE_RUNTIME_ASSETS
                         + package_release.LOCAL_DATABASE_RUNTIME_ASSETS):
                asset = app / '_internal' / name
                asset.parent.mkdir(parents=True, exist_ok=True)
                asset.write_bytes(b'synthetic model or library, never executed')
            with patch.object(package_release, "ROOT", root), patch.object(package_release, "APP", default), patch("sys.argv", ["package_release", "--app", str(app)]), contextlib.redirect_stdout(io.StringIO()):
                package_release.main()
            release = app.parent / "release"
            manifest = json.loads((release / "manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["version"], VERSION)
            self.assertEqual(manifest["exeSha256"], hashlib.sha256(exe.read_bytes()).hexdigest())
            merged = b"".join((release / part["name"]).read_bytes() for part in manifest["parts"])
            self.assertEqual(len(merged), manifest["bytes"])
            self.assertEqual(hashlib.sha256(merged).hexdigest(), manifest["sha256"])
            for part in manifest["parts"]:
                self.assertLessEqual(part["bytes"], 12 * 1024 * 1024)
                self.assertEqual(hashlib.sha256((release / part["name"]).read_bytes()).hexdigest(), part["sha256"])
            with zipfile.ZipFile(io.BytesIO(merged)) as full:
                for name in ("voice_ui.py", "voice_transcript.py", "local_ocr.py", "local_ocr.ps1", "test_voice_ui.py", "test_local_ocr.py", "local_vision.py", "test_local_vision.py", "ChengziWeChatCollector.spec"):
                    self.assertIn("ChengziWeChatCollector/source/" + name, full.namelist())
                for name in ("local_database_source.py", "vendor/wechat_db_primitives.py",
                             "vendor/LICENSE.wechatauto-replica.txt", "vendor/NOTICE.md", "LICENSE-voice-dependencies.txt",
                             "pairing.py", "test_pairing.py", "test_history_paging.py"):
                    self.assertIn("ChengziWeChatCollector/source/" + name, full.namelist())
                for name in (package_release.OFFLINE_OCR_ASSETS + package_release.LOCAL_VOICE_RUNTIME_ASSETS
                             + package_release.LOCAL_DATABASE_RUNTIME_ASSETS):
                    self.assertIn('ChengziWeChatCollector/_internal/' + name, full.namelist())
            with zipfile.ZipFile(release / "chengzi-wechat-collector-windows.zip") as bootstrap:
                self.assertEqual(json.loads(bootstrap.read("_internal/manifest.json")), manifest)
                installer = bootstrap.read("_internal/install.ps1").decode("utf-8-sig")
                self.assertIn("'" + VERSION + "'", installer)
                self.assertIn(VERSION.replace(".", "\\."), installer)
                self.assertIn("CHENGZI_INSTALLER_B64", bootstrap.read("01-双击启动成子助手.cmd").decode("utf-8"))
            self.assertEqual(sentinel.read_text(encoding="utf-8"), "old running build")
            self.assertEqual([path.name for path in default.iterdir()], [sentinel.name])
            self.assertFalse((root / "dist" / "release").exists())

    def test_missing_or_empty_offline_model_prevents_packaging(self):
        with tempfile.TemporaryDirectory() as temporary:
            app = Path(temporary) / 'ChengziWeChatCollector'
            app.mkdir()
            (app / 'ChengziWeChatCollector.exe').write_bytes(b'synthetic executable, never executed')
            with patch('sys.argv', ['package_release', '--app', str(app)]):
                with self.assertRaisesRegex(SystemExit, 'Offline OCR assets missing'):
                    package_release.main()
            self.assertFalse((app.parent / 'release').exists())
            self.assertFalse((app / 'source').exists())
            for name in package_release.OFFLINE_OCR_ASSETS:
                asset = app / '_internal' / name
                asset.parent.mkdir(parents=True, exist_ok=True)
                asset.write_bytes(b'synthetic resource')
            (app / '_internal' / package_release.OFFLINE_OCR_ASSETS[1]).write_bytes(b'')
            with self.assertRaisesRegex(SystemExit, 'ch_PP-OCRv4_det_infer.onnx'):
                package_release.validate_offline_ocr(app)

    def test_missing_voice_runtime_stops_before_release_side_effects(self):
        with tempfile.TemporaryDirectory() as temporary:
            app = Path(temporary) / 'ChengziWeChatCollector'
            app.mkdir()
            (app / 'ChengziWeChatCollector.exe').write_bytes(b'synthetic executable, never executed')
            for name in package_release.OFFLINE_OCR_ASSETS:
                asset = app / '_internal' / name
                asset.parent.mkdir(parents=True, exist_ok=True)
                asset.write_bytes(b'synthetic resource')
            with patch('sys.argv', ['package_release', '--app', str(app)]):
                with self.assertRaisesRegex(SystemExit, 'Local voice runtime assets missing'):
                    package_release.main()
            self.assertFalse((app.parent / 'release').exists())
            self.assertFalse((app / 'source').exists())

    def test_every_pinned_voice_extension_and_dll_must_be_nonempty(self):
        with tempfile.TemporaryDirectory() as temporary:
            app = Path(temporary)
            for name in package_release.LOCAL_VOICE_RUNTIME_ASSETS:
                asset = app / '_internal' / name
                asset.parent.mkdir(parents=True, exist_ok=True)
                asset.write_bytes(b'synthetic native runtime')
            package_release.validate_local_voice_runtime(app)
            for name in package_release.LOCAL_VOICE_RUNTIME_ASSETS:
                with self.subTest(asset=name):
                    asset = app / '_internal' / name
                    asset.write_bytes(b'')
                    with self.assertRaises(SystemExit) as error:
                        package_release.validate_local_voice_runtime(app)
                    self.assertIn(name, str(error.exception))
                    asset.write_bytes(b'synthetic native runtime')

    def test_missing_database_runtime_stops_before_release_side_effects(self):
        with tempfile.TemporaryDirectory() as temporary:
            app = Path(temporary) / 'ChengziWeChatCollector'
            app.mkdir()
            (app / 'ChengziWeChatCollector.exe').write_bytes(b'synthetic executable, never executed')
            for name in package_release.OFFLINE_OCR_ASSETS + package_release.LOCAL_VOICE_RUNTIME_ASSETS:
                asset = app / '_internal' / name
                asset.parent.mkdir(parents=True, exist_ok=True)
                asset.write_bytes(b'synthetic resource')
            with patch('sys.argv', ['package_release', '--app', str(app)]):
                with self.assertRaisesRegex(SystemExit, 'Local database runtime assets missing'):
                    package_release.main()
            self.assertFalse((app.parent / 'release').exists())
            self.assertFalse((app / 'source').exists())
            for name in package_release.LOCAL_DATABASE_RUNTIME_ASSETS:
                asset = app / '_internal' / name
                asset.parent.mkdir(parents=True, exist_ok=True)
                asset.write_bytes(b'synthetic native runtime')
            package_release.validate_local_database_runtime(app)
            for name in package_release.LOCAL_DATABASE_RUNTIME_ASSETS:
                with self.subTest(asset=name):
                    asset = app / '_internal' / name
                    asset.write_bytes(b'')
                    with self.assertRaises(SystemExit) as error:
                        package_release.validate_local_database_runtime(app)
                    self.assertIn(name, str(error.exception))
                    asset.write_bytes(b'synthetic native runtime')


if __name__ == "__main__":
    unittest.main()
