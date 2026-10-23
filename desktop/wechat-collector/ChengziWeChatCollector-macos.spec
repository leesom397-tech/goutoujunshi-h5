# -*- mode: python ; coding: utf-8 -*-
"""Apple Silicon preview only. Build through build_macos.py on a native Mac."""
import os
from pathlib import Path
from PyInstaller.utils.hooks import collect_all, copy_metadata
from build_macos import BASE_VERSION, PREVIEW_VERSION, APP_NAME, verify_vendor

root = Path(SPECPATH)
native_root = Path(os.environ["CHENGZI_MACOS_NATIVE_DIR"])
asset_root = Path(os.environ["CHENGZI_MACOS_ASSET_DIR"])
verify_vendor(root)

datas = [(str(root / "chengzi-fluted-chat-v1.png"), "."),
         (str(root / "LICENSE-voice-dependencies.txt"), "."),
         (str(root / "MACOS-PREVIEW.md"), "."),
         (str(root / "vendor" / "CHATLOG_KEEPER_LICENSE"), "vendor"),
         (str(root / "vendor" / "chatlog-keeper-pin.json"), "vendor"),
         (str(root / "vendor" / "NOTICE.md"), "vendor"),
         (str(root / "vendor" / "LICENSE.wechatauto-replica.txt"), "vendor")]
# The audited vendor sources are also resources: the provider imports the
# fixed, packaged directory and native helpers without any runtime download.
vendor_root = root / "vendor" / "chatlog_keeper"
for path in vendor_root.rglob("*"):
    if path.is_file() and path.suffix in (".py", ".c", ".md", ".txt", ".json"):
        datas.append((str(path), "vendor/chatlog_keeper/" + str(path.parent.relative_to(vendor_root))))

binaries = [(str(native_root / "macos_memory_scan"), "vendor/chatlog_keeper/scripts"),
            (str(native_root / "macos_wechat_key_capture.dylib"), "vendor/chatlog_keeper/scripts")]
hiddenimports = [
    "background_reader", "capture_transport", "local_voice_transcriber", "voice_media_cache",
    "voice_runtime_self_test", "database_runtime_self_test", "macos_runtime_self_test",
    "macos_key_provider", "macos_database_source", "macos_moments", "macos_accessibility",
    "macos_setup_ui", "platform_runtime",
    "sqlcipher_primitives", "local_chat_images", "local_image_codec", "_cffi_backend",
    "apsw", "zstandard", "psutil", "cryptography.hazmat.bindings._rust",
]
# collect_all also gathers dylibs owned by sherpa-onnx-core inside sherpa_onnx.
for package in ("sherpa_onnx", "pysilk", "objc", "Foundation", "AppKit", "ApplicationServices", "Quartz", "CoreText"):
    package_data, package_binaries, package_imports = collect_all(package)
    datas += package_data
    binaries += package_binaries
    hiddenimports += package_imports
for distribution in (
    "numpy", "silk-python", "sherpa-onnx", "sherpa-onnx-core", "cffi", "pycparser",
    "apsw", "cryptography", "zstandard", "psutil", "pillow", "pyobjc-core",
    "pyobjc-framework-Cocoa", "pyobjc-framework-ApplicationServices",
    "pyobjc-framework-Quartz", "pyobjc-framework-CoreText",
):
    datas += copy_metadata(distribution)

a = Analysis([str(root / "main.py")], pathex=[str(root), str(root / "vendor")],
             binaries=binaries, datas=datas, hiddenimports=hiddenimports,
             hookspath=[], hooksconfig={}, runtime_hooks=[],
             excludes=["pyweixin", "pywechat", "pywinauto", "win32api", "win32gui", "win32process",
                       "pythoncom", "pywintypes", "comtypes", "matplotlib", "pandas"],
             noarchive=False, optimize=0)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name=APP_NAME,
          debug=False, bootloader_ignore_signals=False, strip=False, upx=False,
          console=False, disable_windowed_traceback=False, argv_emulation=False,
          target_arch="arm64", codesign_identity=None, entitlements_file=None)
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name=APP_NAME)
app = BUNDLE(coll, name=APP_NAME + ".app", icon=str(asset_root / "chengzi-fluted-chat-v1.icns"),
             bundle_identifier="love.lovetalk.coach.collector.macpreview", version=BASE_VERSION,
             info_plist={"CFBundleDisplayName": "成子微信助手（Mac 预览）",
                         "CFBundleVersion": BASE_VERSION, "ChengziPreviewVersion": PREVIEW_VERSION,
                         "LSMinimumSystemVersion": "11.0", "NSHighResolutionCapable": True,
                         "NSHumanReadableCopyright": "成子 · 上游许可见应用内随包文件。"})
