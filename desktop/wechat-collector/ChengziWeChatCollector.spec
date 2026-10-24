# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_submodules
from PyInstaller.utils.hooks import collect_all
from PyInstaller.utils.hooks import copy_metadata
from PyInstaller.utils.hooks import collect_data_files, collect_dynamic_libs
from pathlib import Path
from normalize import VERSION
from windows_version_info import write_version_info

desktop_service_build = bool(globals().get('CHENGZI_DESKTOP_SERVICE_BUILD', False))
executable_name = 'ChengziDesktopService' if desktop_service_build else 'ChengziWeChatCollector'

# Keep the Explorer publisher/product fields in sync with normalize.VERSION.
# PyInstaller evaluates this spec before building the EXE, so generate the
# resource in the temporary spec directory instead of checking in a stale
# version-specific file.
version_info_path = write_version_info(
    Path(SPECPATH) / '.chengzi-version-info.txt', VERSION,
    original_filename=executable_name + '.exe',
)

datas = [('local_ocr.ps1', '.'), ('LICENSE-voice-dependencies.txt', '.'),
         ('LICENSE-sensevoice-model.txt', '.'), ('THIRD-PARTY-VOICE-MODEL.md', '.'),
         ('chengzi-fluted-chat-v1.ico', '.'), ('chengzi-fluted-chat-v1.png', '.'),
         ('vendor/LICENSE.wechatauto-replica.txt', 'vendor'), ('vendor/NOTICE.md', 'vendor'),
         ('vendor/WECHATAUTO_ACCESSIBILITY_LICENSE', 'vendor'),
         ('vendor/WECHATAUTO_ACCESSIBILITY_NOTICE.md', 'vendor'),
         ('vendor/wechatauto-accessibility-pin.json', 'vendor')]
binaries = []
hiddenimports = ['desktop_service', 'pythoncom', 'pywintypes', 'voice_ui', 'voice_transcript', 'voice_ocr', 'local_ocr',
                 'voice_context', 'voice_candidates', 'visual_voice_enrichment', 'voice_menu_ui', 'native_transcript',
                 'local_vision', 'voice_frame_identity', 'onnxruntime.capi.onnxruntime_pybind11_state',
                 'background_reader', 'capture_transport', 'local_voice_transcriber', 'apsw', 'zstandard', 'cryptography',
                 'pysilk.backends.cython._silk', 'voice_runtime_self_test', 'voice_media_cache',
                 'local_database_source', 'local_chat_images', 'vendor.wechat_db_primitives', 'database_runtime_self_test']
datas += copy_metadata('pywechat127')
hiddenimports += collect_submodules('comtypes')

# OCR models ship with the helper. Full Electron desktop staging adds the
# pinned speech weights beside this service; standalone/lite helpers can fetch
# the same weights on an explicit request, with resumable integrity checking.
datas += collect_data_files('rapidocr_onnxruntime', includes=['config.yaml', 'models/*.onnx'])
datas += copy_metadata('rapidocr-onnxruntime')
datas += copy_metadata('onnxruntime')
hiddenimports += collect_submodules('rapidocr_onnxruntime')
# The standard ONNX Runtime hook also collects these provider DLLs; listing them
# explicitly keeps the offline dependency visible in this application's spec.
binaries += collect_dynamic_libs('onnxruntime')
tmp_ret = collect_all('pyweixin')
datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]

for package in ('sherpa_onnx', 'pysilk'):
    package_data, package_binaries, package_imports = collect_all(package)
    datas += package_data
    binaries += package_binaries
    hiddenimports += package_imports


a = Analysis(
    ['main.py'],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['matplotlib', 'pandas'],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name=executable_name,
    icon=str(Path(SPECPATH) / 'chengzi-fluted-chat-v1.ico'),
    version=str(version_info_path),
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=desktop_service_build,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name=executable_name,
)
