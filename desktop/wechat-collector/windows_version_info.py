"""Generate Windows VERSIONINFO resources for the collector executables.

The version resource is separate from Authenticode signing.  It gives Explorer
stable product and publisher metadata, while a trusted certificate is still
required to make SmartScreen recognise the publisher.
"""

from __future__ import annotations

from pathlib import Path
import re


PUBLISHER = "成子智能体"
PRODUCT_NAME = "成子电脑微信采集助手"
PRODUCT_VERSION = "成子关系决策系统"
COPYRIGHT = "Copyright (c) 2026 成子智能体"


def _version_parts(version: str) -> tuple[int, int, int, int]:
    if not isinstance(version, str) or re.fullmatch(r"\d+\.\d+\.\d+", version) is None:
        raise ValueError("version must use MAJOR.MINOR.PATCH")
    major, minor, patch = (int(part) for part in version.split("."))
    return major, minor, patch, 0


def render_version_info(version: str, *, file_description: str = PRODUCT_NAME,
                        original_filename: str = "ChengziWeChatCollector.exe") -> str:
    """Return a PyInstaller version-file expression for *version*."""
    parts = _version_parts(version)
    # 040904B0 is English (US), Unicode.  String values themselves remain
    # Chinese and are encoded by PyInstaller into the VERSIONINFO resource.
    rows = [
        ("CompanyName", PUBLISHER),
        ("FileDescription", file_description),
        ("FileVersion", version),
        ("InternalName", original_filename.removesuffix(".exe")),
        ("LegalCopyright", COPYRIGHT),
        ("OriginalFilename", original_filename),
        ("ProductName", PRODUCT_VERSION),
        ("ProductVersion", version),
    ]
    strings = ",\n".join(f"        StringStruct({key!r}, {value!r})" for key, value in rows)
    return f'''# UTF-8\nVSVersionInfo(\n    ffi=FixedFileInfo(\n        filevers={parts!r}, prodvers={parts!r},\n        mask=0x3f, flags=0x0, OS=0x40004, fileType=0x1,\n        subtype=0x0, date=(0, 0)\n    ),\n    kids=[\n        StringFileInfo([\n            StringTable('040904B0', [\n{strings}\n            ])\n        ]),\n        VarFileInfo([VarStruct('Translation', [1033, 1200])])\n    ]\n)\n'''


def write_version_info(path: Path, version: str, *, file_description: str = PRODUCT_NAME,
                       original_filename: str = "ChengziWeChatCollector.exe") -> Path:
    """Write a version resource file and return its resolved path."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(render_version_info(version, file_description=file_description,
                                        original_filename=original_filename), encoding="utf-8")
    return path

