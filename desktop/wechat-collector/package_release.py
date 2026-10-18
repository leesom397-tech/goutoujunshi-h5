"""Produce a tiny bootstrap ZIP and hash-verified static parts, never user data."""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import shutil
import zipfile
from normalize import VERSION

ROOT = Path(__file__).resolve().parent
APP = ROOT / "dist" / "ChengziWeChatCollector"
SOURCE_FILES = ("main.py", "bridge.py", "adapter.py", "voice_transcript.py", "voice_ui.py", "voice_ocr.py", "voice_menu_ui.py", "local_ocr.py", "local_ocr.ps1", "compatibility.py", "normalize.py", "requirements.txt", "requirements-lock.txt", "README.md", "使用说明.html", "使用说明.txt", "LICENSE-pywechat.txt", "test_collector.py", "test_voice_transcript.py", "test_voice_ui.py", "test_voice_ocr.py", "test_local_ocr.py", "test_release.py", "ChengziWeChatCollector.spec", "package_release.py", "install.ps1")
SOURCE_FILES += ('voice_context.py','voice_candidates.py','visual_voice_enrichment.py','native_transcript.py',
                 'test_voice_context.py','test_voice_menu_ui.py','test_native_transcript.py',
                 'local_vision.py','test_local_vision.py','voice_frame_identity.py','test_voice_frame_identity.py')
SOURCE_FILES += ('background_reader.py', 'test_background_reader.py', 'local_voice_transcriber.py',
                 'test_local_voice_transcriber.py', 'test_background_bridge.py',
                 'voice_runtime_self_test.py', 'test_voice_runtime_self_test.py')
SOURCE_FILES += ('local_database_source.py', 'test_local_database_source.py',
                 'vendor/__init__.py', 'vendor/wechat_db_primitives.py',
                 'vendor/LICENSE.wechatauto-replica.txt', 'vendor/NOTICE.md',
                 'LICENSE-voice-dependencies.txt', 'database_runtime_self_test.py',
                 'test_database_runtime_self_test.py')
SOURCE_FILES += ('pairing.py', 'test_pairing.py', 'test_history_paging.py')
SOURCE_FILES += ('test_moments_capture.py', 'test_contact_search.py')
SOURCE_FILES += ('compatibility_ui.py', 'test_compatibility.py')
SOURCE_FILES += ('local_chat_images.py', 'test_local_chat_images.py')
SOURCE_FILES += ('launcher.py', 'build_launcher.py', 'test_launcher.py', 'launcher.ico',
                 'windows_version_info.py', 'test_windows_version_info.py', 'sign_release.ps1')

# PyInstaller 6's default onedir layout. Stop before publishing an installer
# whose offline OCR would otherwise fail only on the user's computer.
OFFLINE_OCR_ASSETS = (
    'rapidocr_onnxruntime/config.yaml',
    'rapidocr_onnxruntime/models/ch_PP-OCRv4_det_infer.onnx',
    'rapidocr_onnxruntime/models/ch_ppocr_mobile_v2.0_cls_infer.onnx',
    'rapidocr_onnxruntime/models/ch_PP-OCRv4_rec_infer.onnx',
    'onnxruntime/capi/onnxruntime.dll',
    'onnxruntime/capi/onnxruntime_providers_shared.dll',
    'onnxruntime/capi/onnxruntime_pybind11_state.pyd',
)

# Pinned CPython 3.12 / Windows x64 wheels. Their extensions are imported lazily,
# so a successful GUI launch alone cannot prove voice processing is packaged.
LOCAL_VOICE_RUNTIME_ASSETS = (
    'pysilk/backends/cython/_silk.pyd',
    'sherpa_onnx/lib/_sherpa_onnx.cp312-win_amd64.pyd',
    'sherpa_onnx/lib/onnxruntime.dll',
    'sherpa_onnx/lib/sherpa-onnx-c-api.dll',
    'sherpa_onnx/lib/sherpa-onnx-cxx-api.dll',
)

# The background reader imports these only when capture starts. Validate the
# frozen build before making a download, alongside the synthetic database test.
LOCAL_DATABASE_RUNTIME_ASSETS = (
    'apsw/__init__.cp312-win_amd64.pyd',
    'cryptography/hazmat/bindings/_rust.pyd',
    'zstandard/backend_c.cp312-win_amd64.pyd',
)


def validate_offline_ocr(app):
    missing = [name for name in OFFLINE_OCR_ASSETS
               if not (app / '_internal' / name).is_file()
               or (app / '_internal' / name).stat().st_size == 0]
    if missing:
        raise SystemExit('Offline OCR assets missing from build: ' + ', '.join(missing))


def validate_local_voice_runtime(app):
    missing = [name for name in LOCAL_VOICE_RUNTIME_ASSETS
               if not (app / '_internal' / name).is_file()
               or (app / '_internal' / name).stat().st_size == 0]
    if missing:
        raise SystemExit('Local voice runtime assets missing from build: ' + ', '.join(missing))


def validate_local_database_runtime(app):
    missing = [name for name in LOCAL_DATABASE_RUNTIME_ASSETS
               if not (app / '_internal' / name).is_file()
               or (app / '_internal' / name).stat().st_size == 0]
    if missing:
        raise SystemExit('Local database runtime assets missing from build: ' + ', '.join(missing))


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def bootstrap_command(manifest=None, installer_source=None):
    """Return a visible, double-clickable Windows launcher for end users.

    ``Explorer`` sometimes runs a CMD directly from the compressed-folder
    view.  In that case only the CMD is materialised in a temporary
    ``*.zip.fNN`` directory and ``_internal`` is not available.  We still try
    to recover the original ZIP, but that folder is not guaranteed to exist
    (downloads opened by browsers and chat clients are often copied to a
    temporary location).  A release launcher therefore carries a small
    base64 copy of its installer and manifest as a last-resort fallback.  It
    can bootstrap itself even when the user accidentally double-clicks it
    before extracting the ZIP.

    The optional arguments keep the function useful for synthetic launcher
    tests, where a tiny custom installer is preferable to the real network
    installer.
    """
    embedded_manifest = ""
    embedded_installer = ""
    if manifest is not None:
        manifest_bytes = json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8")
        embedded_manifest = base64.b64encode(manifest_bytes).decode("ascii")
        if installer_source is None:
            # The fallback launcher is used precisely when Explorer only
            # materialises the CMD from inside the ZIP.  Render the same
            # versioned installer that we place under _internal; embedding
            # the raw template leaves {{VERSION}} in the temporary script and
            # fails on otherwise valid machines with "Unsupported package
            # version".
            installer_source = (ROOT / "install.ps1").read_text(encoding="utf-8-sig")
            installer_source = installer_source.replace("{{VERSION_REGEX}}", VERSION.replace(".", r"\.")) \
                .replace("{{VERSION}}", VERSION).encode("utf-8-sig")
        elif isinstance(installer_source, str):
            installer_source = installer_source.encode("utf-8-sig")
        embedded_installer = base64.b64encode(installer_source).decode("ascii")
    command = (
        '@echo off\r\n'
        'setlocal EnableExtensions\r\n'
        'chcp 65001 >nul\r\n'
        'title 成子电脑微信采集助手\r\n'
        'cd /d "%~dp0"\r\n'
        'set "INSTALLER=%~dp0_internal\\install.ps1"\r\n'
        'if exist "%INSTALLER%" goto installer_ready\r\n'
        'rem Windows Explorer can run a single file from a ZIP through a temporary\r\n'
        'rem folder named *.zip.fNN. Recover the original ZIP when it is still\r\n'
        'rem beside that temporary folder instead of showing a dead-end error.\r\n'
        'set "CHENGZI_VIRTUAL_DIR=%~dp0"\r\n'
        'set "CHENGZI_RECOVERY=%TEMP%\\ChengziCollector-%RANDOM%-%RANDOM%"\r\n'
        "powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command \"$dir=(Get-Item -LiteralPath $env:CHENGZI_VIRTUAL_DIR).FullName.TrimEnd('\\'); $match=[regex]::Match($dir, '^^(.*\\.zip)\\.f[0-9a-z]+$'); if(-not $match.Success){ exit 2 }; $zip=$match.Groups[1].Value; if(-not (Test-Path -LiteralPath $zip -PathType Leaf)){ exit 3 }; Expand-Archive -LiteralPath $zip -DestinationPath $env:CHENGZI_RECOVERY -Force\"\r\n"
        'if errorlevel 1 goto embedded_fallback\r\n'
        'echo 检测到你是从 ZIP 内直接打开文件，正在自动完整解压...\r\n'
        'set "INSTALLER=%CHENGZI_RECOVERY%\\_internal\\install.ps1"\r\n'
        'if not exist "%INSTALLER%" goto embedded_fallback\r\n'
        'goto installer_ready\r\n'
    )
    if embedded_manifest and embedded_installer:
        command += (
            ':embedded_fallback\r\n'
            'rem The original ZIP was not beside this file. Recreate the two\r\n'
            'rem tiny bootstrap files from the copy embedded in this launcher.\r\n'
            'set "CHENGZI_EMBEDDED=%TEMP%\\ChengziCollector-%RANDOM%-%RANDOM%"\r\n'
            'set "CHENGZI_MANIFEST_B64=' + embedded_manifest + '"\r\n'
            'set "CHENGZI_INSTALLER_B64=' + embedded_installer + '"\r\n'
            'powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command '
            '"$dir=New-Item -ItemType Directory -Force -Path $env:CHENGZI_EMBEDDED; '
            '[IO.File]::WriteAllBytes((Join-Path $dir.FullName \'manifest.json\'), '
            '[Convert]::FromBase64String($env:CHENGZI_MANIFEST_B64)); '
            '[IO.File]::WriteAllBytes((Join-Path $dir.FullName \'install.ps1\'), '
            '[Convert]::FromBase64String($env:CHENGZI_INSTALLER_B64))"\r\n'
            'if errorlevel 1 goto installer_missing\r\n'
            'set "INSTALLER=%CHENGZI_EMBEDDED%\\install.ps1"\r\n'
            'if not exist "%INSTALLER%" goto installer_missing\r\n'
            'goto installer_ready\r\n'
        )
    command += (
        ':installer_missing\r\n'
        'echo 没有找到完整的启动包。请把 ZIP 解压到文件夹后，再双击里面的「01-双击启动成子助手.cmd」。\r\n'
        'pause\r\n'
        'exit /b 1\r\n'
        ':installer_ready\r\n'
        'echo 正在启动成子电脑微信采集助手，请稍候...\r\n'
        'powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%INSTALLER%"\r\n'
        'set "EXITCODE=%ERRORLEVEL%"\r\n'
        'if "%EXITCODE%"=="0" goto launch_success\r\n'
        'echo.\r\n'
        'echo 安装未完成，错误码 %EXITCODE%。\r\n'
        'echo 请查看上方的实际错误信息。\r\n'
        'pause\r\n'
        'exit /b %EXITCODE%\r\n'
        ':launch_success\r\n'
        'echo 助手已启动。若没有看到窗口，请从任务栏或开始菜单切回「成子 · 电脑微信采集助手」。\r\n'
        'timeout /t 2 /nobreak >nul\r\n'
        'endlocal\r\n'
        'exit /b 0\r\n'
    )
    return command


def user_asset(name):
    """Read a user-facing asset and inject the package version."""
    return (ROOT / name).read_text(encoding="utf-8").replace("{{VERSION}}", VERSION).encode("utf-8")


def write_bootstrap(release, manifest):
    """Write the small download zip that users see after downloading."""
    output = release / "chengzi-wechat-collector-windows.zip"
    command = bootstrap_command(manifest)
    if max(map(len, command.splitlines())) >= 8000:
        raise SystemExit("Windows launcher contains a line longer than cmd.exe can execute.")
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as installer:
        # Keep the extracted folder deliberately small: one action and one
        # explanation. Technical files live under _internal so users do not
        # have to choose between duplicate launchers or instructions.
        installer.writestr("01-双击启动成子助手.cmd", command.encode("utf-8"))
        installer.writestr("02-打开使用说明.html", user_asset("使用说明.html"))
        # Windows PowerShell 5.1 needs the BOM to read UTF-8 Chinese scripts;
        # read with utf-8-sig so a source file that already has a BOM is not
        # published with two of them.
        script = (ROOT / "install.ps1").read_text(encoding="utf-8-sig")
        script = script.replace("{{VERSION_REGEX}}", VERSION.replace(".", r"\.")).replace("{{VERSION}}", VERSION)
        installer.writestr("_internal/install.ps1", script.encode("utf-8-sig"))
        installer.writestr("_internal/manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8"))
    return output


def main():
    parser = argparse.ArgumentParser(description="Package a built, isolated Windows collector directory.")
    parser.add_argument("--app", type=Path, default=APP, help="Built ChengziWeChatCollector directory; output is written beside it.")
    args = parser.parse_args()
    app = args.app.resolve()
    if app.name != "ChengziWeChatCollector":
        raise SystemExit("App directory must be named ChengziWeChatCollector for the installer layout.")
    release = app.parent / "release"
    executable = app / "ChengziWeChatCollector.exe"
    if not executable.is_file():
        raise SystemExit("Run PyInstaller first.")
    validate_offline_ocr(app)
    validate_local_voice_runtime(app)
    validate_local_database_runtime(app)
    release.mkdir(parents=True, exist_ok=True)
    source = app / "source"
    source.mkdir(exist_ok=True)
    for filename in SOURCE_FILES:
        destination = source / filename
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / filename, destination)
    upstream = ROOT / ".venv" / "Lib" / "site-packages"
    # Complete original Python library sources remain replaceable/rebuildable.
    for module in ("pyweixin", "pywechat"):
        shutil.copytree(upstream / module, source / module, dirs_exist_ok=True, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    licenses = source / "third-party-licenses"
    licenses.mkdir(exist_ok=True)
    for info in upstream.glob("*.dist-info"):
        for path in info.rglob("*"):
            if path.is_file() and ("license" in path.name.lower() or "copying" in path.name.lower() or "notice" in path.name.lower()):
                dest = licenses / info.name / path.relative_to(info)
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(path, dest)
    archive = Path(shutil.make_archive(str(app.parent / f"chengzi-wechat-collector-{VERSION}-full"), "zip", app.parent, app.name))
    parts = []
    with archive.open("rb") as stream:
        index = 1
        while data := stream.read(12 * 1024 * 1024):
            name = f"chengzi-wechat-collector-{VERSION}.part{index:02}.bin"
            target = release / name
            target.write_bytes(data)
            parts.append({"name": name, "bytes": len(data), "sha256": sha(target)})
            index += 1
    manifest = {
        "version": VERSION,
        "publisher": "成子智能体",
        "productName": "成子电脑微信采集助手",
        # The hash protects downloads; SmartScreen publisher reputation still
        # requires Authenticode signing with a certificate trusted by Windows.
        "authenticode": "unsigned-build-sign-with-sign_release.ps1-before-publishing",
        "bytes": archive.stat().st_size,
        "sha256": sha(archive),
        "exeSha256": sha(executable),
        "parts": parts,
    }
    (release / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    shutil.copy2(release / "manifest.json", release / f"manifest-{VERSION}.json")
    write_bootstrap(release, manifest)
    shutil.copy2(release / "chengzi-wechat-collector-windows.zip", release / f"chengzi-wechat-collector-windows-{VERSION}.zip")
    shutil.copy2(release / "chengzi-wechat-collector-windows.zip", release / f"chengzi-wechat-collector-windows-{VERSION}-simple.zip")
    print(json.dumps({"release": str(release), "fullBytes": manifest["bytes"], "partCount": len(parts), "bootstrapBytes": (release / "chengzi-wechat-collector-windows.zip").stat().st_size}, ensure_ascii=False))


if __name__ == "__main__":
    main()
