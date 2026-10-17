"""Offline Windows OCR for caller-supplied PIL images or PNG files only.

No screen capture, UI interaction, network, model download, clipboard access or logging.
Include local_ocr.ps1 as PyInstaller data beside this module.
"""
from __future__ import annotations
import ctypes
import json
import math
import os
from pathlib import Path
import re
import subprocess
import tempfile

MAX_PIXELS = 25_000_000
MAX_DIMENSION = 10_000
MAX_FILE_BYTES = 25_000_000
BRIDGE = Path(__file__).resolve().with_name("local_ocr.ps1")


class LocalOCRError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def _powershell() -> Path:
    if os.name != "nt":
        raise LocalOCRError("OCR_PLATFORM_UNSUPPORTED", "本机 OCR 需要 Windows 10 或更新版本。")
    # Resolve a Windows-owned executable, never PATH or a downloaded OCR binary.
    buffer = ctypes.create_unicode_buffer(32768)
    if not ctypes.windll.kernel32.GetWindowsDirectoryW(buffer, len(buffer)):
        raise LocalOCRError("OCR_UNAVAILABLE", "无法定位 Windows 系统目录。")
    path = Path(buffer.value) / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe"
    if not path.is_file():
        raise LocalOCRError("OCR_UNAVAILABLE", "系统 Windows PowerShell 不可用。")
    return path


def _invoke(arguments: list[str], timeout: float) -> dict:
    if not isinstance(timeout, (int, float)) or not math.isfinite(timeout) or not 0 < timeout <= 120:
        raise ValueError("timeout must be greater than 0 and at most 120 seconds")
    if not BRIDGE.is_file():
        raise LocalOCRError("OCR_BRIDGE_MISSING", "本机 OCR 脚本缺失，请使用完整的助手安装包。")
    command = [str(_powershell()), "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", str(BRIDGE), *arguments]
    startup = subprocess.STARTUPINFO()
    startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    startup.wShowWindow = subprocess.SW_HIDE
    try:
        result = subprocess.run(
            command, shell=False, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, encoding="utf-8", errors="replace", timeout=timeout,
            creationflags=subprocess.CREATE_NO_WINDOW, startupinfo=startup,
        )
    except subprocess.TimeoutExpired as error:
        raise LocalOCRError("OCR_TIMEOUT", "本机 OCR 超时，未读取到可靠文字。") from error
    except OSError as error:
        raise LocalOCRError("OCR_UNAVAILABLE", "系统本机 OCR 无法启动。") from error
    try:
        payload = json.loads(result.stdout.lstrip("\ufeff").strip())
    except (ValueError, TypeError) as error:
        raise LocalOCRError("OCR_BRIDGE_FAILED", "系统本机 OCR 未返回有效结果。") from error
    if not isinstance(payload, dict):
        raise LocalOCRError("OCR_BRIDGE_FAILED", "系统本机 OCR 未返回有效结果。")
    if not payload.get("ok") or result.returncode:
        error_info = payload.get("error") or {}
        code = error_info.get("code", "OCR_RECOGNITION_FAILED") if isinstance(error_info, dict) else "OCR_RECOGNITION_FAILED"
        messages = {
            "OCR_LANGUAGE_UNAVAILABLE": "系统未安装所选 OCR 语言；不会自动下载模型。",
            "OCR_IMAGE_TOO_LARGE": "提供的图片超出本机 OCR 尺寸上限。",
            "OCR_DECODE_FAILED": "无法读取提供的 PNG 图片。",
            "OCR_UNAVAILABLE": "系统 OCR 组件不可用。",
        }
        raise LocalOCRError(code, messages.get(code, "本机 OCR 未能识别这张图片。"))
    return payload


def available_languages(*, timeout: float = 15) -> list[dict]:
    """Installed Windows OCR languages only; never installs language packages."""
    return _invoke(["-Languages"], timeout).get("languages", [])


def _box(value: dict, width: int, height: int, sx: float, sy: float, angle: float = 0.0) -> dict:
    try:
        values = [float(value[name]) for name in ("x", "y", "width", "height")]
    except (KeyError, TypeError, ValueError) as error:
        raise LocalOCRError("OCR_INVALID_RESULT", "本机 OCR 返回了无效坐标。") from error
    if not all(math.isfinite(item) for item in values) or values[2] < 0 or values[3] < 0:
        raise LocalOCRError("OCR_INVALID_RESULT", "本机 OCR 返回了无效坐标。")
    # WinRT boxes refer to its deskewed image. Rotate clockwise around the
    # decoded image center, as Microsoft OcrResult.TextAngle specifies.
    radians = math.radians(angle)
    cosine, sine = math.cos(radians), math.sin(radians)
    cx, cy = width * sx / 2, height * sy / 2
    x0, y0, bw, bh = values
    corners = [(x0, y0), (x0 + bw, y0), (x0, y0 + bh), (x0 + bw, y0 + bh)]
    mapped = [((cx + (x - cx) * cosine - (y - cy) * sine) / sx,
               (cy + (x - cx) * sine + (y - cy) * cosine) / sy) for x, y in corners]
    left = min(width, max(0.0, min(x for x, _ in mapped)))
    top = min(height, max(0.0, min(y for _, y in mapped)))
    right = min(width, max(left, max(x for x, _ in mapped)))
    bottom = min(height, max(top, max(y for _, y in mapped)))
    return {"x": left, "y": top, "width": right - left, "height": bottom - top}


def recognize_image(image_or_path, language: str = "zh-Hans-CN", *, timeout: float = 20, scale: float = 1.0) -> dict:
    """Return text/language/width/height/lines, with text+bbox for every line/word.

    Coordinates refer to ORIGINAL image pixels, even with scale=2 for small menu
    text. No screen offset is inferred or included. No file remains after return.
    """
    if not isinstance(language, str) or not re.fullmatch(r"[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*", language):
        raise ValueError("language must be a Windows BCP-47 language tag")
    if not isinstance(scale, (int, float)) or not math.isfinite(scale) or not 1 <= scale <= 3:
        raise ValueError("scale must be between 1 and 3")
    from PIL import Image
    opened = None
    try:
        if isinstance(image_or_path, Image.Image):
            image = image_or_path
        elif isinstance(image_or_path, (str, os.PathLike)):
            path = Path(image_or_path).resolve(strict=True)
            if not path.is_file() or path.stat().st_size > MAX_FILE_BYTES:
                raise LocalOCRError("OCR_IMAGE_TOO_LARGE", "提供的 PNG 图片过大或不可读取。")
            opened = Image.open(path)
            if opened.format != "PNG":
                raise LocalOCRError("OCR_INVALID_IMAGE", "路径输入需要 PNG 图片。")
            image = opened
        else:
            raise TypeError("image_or_path must be a PIL image or local PNG path")
        width, height = image.size
        resized = (round(width * scale), round(height * scale))
        if min(width, height) < 1 or max(resized) > MAX_DIMENSION or resized[0] * resized[1] > MAX_PIXELS:
            raise LocalOCRError("OCR_IMAGE_TOO_LARGE", "提供的图片超出本机 OCR 尺寸上限。")
        rgba = image.convert("RGBA")
        normalized = Image.new("RGBA", image.size, "white")
        normalized.alpha_composite(rgba)
        rgb = normalized.convert("RGB")
        rgba.close()
        normalized.close()
        if resized != image.size:
            enlarged = rgb.resize(resized, Image.Resampling.LANCZOS)
            rgb.close()
            rgb = enlarged
        try:
            with tempfile.TemporaryDirectory(prefix="chengzi-local-ocr-") as temporary:
                png = Path(temporary) / "input.png"
                rgb.save(png, format="PNG")
                payload = _invoke(["-ImagePath", str(png), "-Language", language], timeout)
        finally:
            rgb.close()
    except FileNotFoundError as error:
        raise LocalOCRError("OCR_IMAGE_MISSING", "指定的 PNG 图片不存在。") from error
    except OSError as error:
        raise LocalOCRError("OCR_INVALID_IMAGE", "无法读取提供的 PNG 图片。") from error
    finally:
        if opened is not None:
            opened.close()
    sx, sy = resized[0] / width, resized[1] / height
    try:
        angle = float(payload.get("textAngle") or 0)
    except (TypeError, ValueError) as error:
        raise LocalOCRError("OCR_INVALID_RESULT", "本机 OCR 返回了无效角度。") from error
    if not math.isfinite(angle):
        raise LocalOCRError("OCR_INVALID_RESULT", "本机 OCR 返回了无效角度。")
    lines = []
    for line in payload.get("lines", []):
        words = [{"text": str(word.get("text", "")), "bbox": _box(word["bbox"], width, height, sx, sy, angle)} for word in line.get("words", [])]
        if not words:
            continue
        left = min(word["bbox"]["x"] for word in words)
        top = min(word["bbox"]["y"] for word in words)
        right = max(word["bbox"]["x"] + word["bbox"]["width"] for word in words)
        bottom = max(word["bbox"]["y"] + word["bbox"]["height"] for word in words)
        box = {"x": left, "y": top, "width": right - left, "height": bottom - top}
        lines.append({"text": str(line.get("text", "")), "bbox": box, "words": words})
    return {"text": str(payload.get("text", "")), "language": payload["language"], "width": width, "height": height, "textAngle": angle, "lines": lines}
