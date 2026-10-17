"""Offline, CPU-only OCR for caller-provided images.

Models must already be present in the installed rapidocr_onnxruntime package.
This module never captures a screen, reads a clipboard, downloads a model, logs
recognized text, or sends image data over the network.
"""
from __future__ import annotations

import importlib.util
import math
import os
from pathlib import Path
import re
import threading
import time

from local_ocr import LocalOCRError, MAX_DIMENSION, MAX_FILE_BYTES, MAX_PIXELS

_ENGINE = None
_RUN_LOCK = threading.Lock()
_MODEL_FILES = {
    "det_model_path": "ch_PP-OCRv4_det_infer.onnx",
    "cls_model_path": "ch_ppocr_mobile_v2.0_cls_infer.onnx",
    "rec_model_path": "ch_PP-OCRv4_rec_infer.onnx",
}
_DURATION = re.compile(r'([1-9]|[1-5][0-9]|60)\s*["″”“＂]')


def _engine():
    """Called only with _RUN_LOCK held, including during lazy initialization."""
    global _ENGINE
    if _ENGINE is not None:
        return _ENGINE
    try:
        spec = importlib.util.find_spec("rapidocr_onnxruntime")
        if spec is None or not spec.origin:
            raise LocalOCRError("OCR_UNAVAILABLE", "离线识别组件缺失，请安装完整的采集助手。")
        model_dir = Path(spec.origin).resolve().parent / "models"
        paths = {key: model_dir / name for key, name in _MODEL_FILES.items()}
        if any(not path.is_file() or path.stat().st_size == 0 for path in paths.values()):
            raise LocalOCRError("OCR_MODEL_MISSING", "离线识别模型缺失；不会自动下载模型。")
        from rapidocr_onnxruntime import RapidOCR
        _ENGINE = RapidOCR(
            **{key: str(path) for key, path in paths.items()},
            intra_op_num_threads=2, inter_op_num_threads=1,
            det_use_cuda=False, det_use_dml=False,
            cls_use_cuda=False, cls_use_dml=False,
            rec_use_cuda=False, rec_use_dml=False,
            use_cls=False, print_verbose=False,
        )
        return _ENGINE
    except LocalOCRError:
        raise
    except Exception:
        raise LocalOCRError("OCR_UNAVAILABLE", "离线识别组件无法初始化。") from None


def _deadline(timeout):
    if isinstance(timeout, bool) or not isinstance(timeout, (int, float)) or not math.isfinite(timeout) or not 0 < timeout <= 120:
        raise ValueError("timeout must be greater than 0 and at most 120 seconds")
    return time.monotonic() + timeout


def _prepare(image_or_path, scale):
    if isinstance(scale, bool) or not isinstance(scale, (int, float)) or not math.isfinite(scale) or not 1 <= scale <= 3:
        raise ValueError("scale must be between 1 and 3")
    from PIL import Image
    opened = None
    try:
        if isinstance(image_or_path, Image.Image):
            image = image_or_path
        elif isinstance(image_or_path, (str, os.PathLike)):
            path = Path(image_or_path).resolve(strict=True)
            if not path.is_file() or path.stat().st_size > MAX_FILE_BYTES:
                raise LocalOCRError("OCR_IMAGE_TOO_LARGE", "提供的图片过大或不可读取。")
            opened = Image.open(path)
            image = opened
        else:
            raise TypeError("image_or_path must be a PIL image or a local image path")
        width, height = image.size
        resized = (round(width * scale), round(height * scale))
        if min(width, height) < 1 or max(resized) > MAX_DIMENSION or resized[0] * resized[1] > MAX_PIXELS:
            raise LocalOCRError("OCR_IMAGE_TOO_LARGE", "提供的图片超出离线识别尺寸上限。")
        with image.convert("RGBA") as rgba:
            with Image.new("RGBA", image.size, "white") as opaque:
                opaque.alpha_composite(rgba)
                rgb = opaque.convert("RGB")
        if resized != image.size:
            enlarged = rgb.resize(resized, Image.Resampling.LANCZOS)
            rgb.close()
            rgb = enlarged
        return rgb, width, height
    except LocalOCRError:
        raise
    except FileNotFoundError:
        raise LocalOCRError("OCR_IMAGE_MISSING", "指定的本地图片不存在。") from None
    except (OSError, Image.DecompressionBombError):
        raise LocalOCRError("OCR_INVALID_IMAGE", "无法读取提供的本地图片。") from None
    finally:
        if opened is not None:
            opened.close()


def _run(image, *, detect, deadline):
    """Serialize the reusable engine, while bounding the caller's wait.

    An in-flight native inference cannot be killed safely. On timeout its daemon
    worker finishes locally; the lock prevents any overlapping use or backlog.
    No late result is exposed to the caller.
    """
    remaining = deadline - time.monotonic()
    if remaining <= 0 or not _RUN_LOCK.acquire(timeout=max(0, remaining)):
        image.close()
        raise LocalOCRError("OCR_TIMEOUT", "离线识别超时，未取得可靠结果。")
    finished = threading.Event()
    holder = {}

    def work():
        try:
            import numpy as np
            # RapidOCR interprets ndarray inputs as BGR, unlike PIL inputs.
            pixels = np.asarray(image)[:, :, ::-1].copy()
            holder["result"], _ = _engine()(
                pixels, use_det=detect, use_cls=False, use_rec=True,
                text_score=0.8 if detect else 0.6,
            )
        except LocalOCRError as error:
            holder["error"] = error
        except Exception:
            holder["error"] = LocalOCRError("OCR_RECOGNITION_FAILED", "离线识别未能读取这张图片。")
        finally:
            image.close()
            _RUN_LOCK.release()
            finished.set()

    try:
        threading.Thread(target=work, name="chengzi-local-vision", daemon=True).start()
    except Exception:
        image.close()
        _RUN_LOCK.release()
        raise LocalOCRError("OCR_UNAVAILABLE", "无法启动离线识别。") from None
    if not finished.wait(max(0, deadline - time.monotonic())):
        raise LocalOCRError("OCR_TIMEOUT", "离线识别超时，未取得可靠结果。")
    if "error" in holder:
        raise holder["error"]
    return holder.get("result") or []


def _confidence(value):
    try:
        confidence = float(value)
        return confidence if math.isfinite(confidence) and 0 <= confidence <= 1 else None
    except (TypeError, ValueError):
        return None


def _box(points, width, height, sx, sy):
    try:
        if len(points) != 4 or any(len(point) != 2 for point in points):
            raise ValueError
        points = [(float(x) / sx, float(y) / sy) for x, y in points]
        if not all(math.isfinite(value) for point in points for value in point):
            raise ValueError
        left = min(width, max(0, min(x for x, _ in points)))
        top = min(height, max(0, min(y for _, y in points)))
        right = min(width, max(left, max(x for x, _ in points)))
        bottom = min(height, max(top, max(y for _, y in points)))
        if right <= left or bottom <= top:
            raise ValueError
        return {"x": left, "y": top, "width": right - left, "height": bottom - top}
    except (TypeError, ValueError):
        raise LocalOCRError("OCR_INVALID_RESULT", "离线识别返回了无效坐标。") from None


def recognize_image(image_or_path, language="zh-Hans-CN", *, scale=1, timeout=20):
    """Return lines with bounding boxes in ORIGINAL image pixels.

    This bundled model recognizes Chinese and Latin text. The language argument
    is accepted for local_ocr compatibility; it never selects or fetches a model.
    """
    deadline = _deadline(timeout)
    image, width, height = _prepare(image_or_path, scale)
    sx, sy = image.width / width, image.height / height
    result = _run(image, detect=True, deadline=deadline)
    lines = []
    for item in result:
        if not isinstance(item, (list, tuple)) or len(item) < 3 or not isinstance(item[1], str):
            raise LocalOCRError("OCR_INVALID_RESULT", "离线识别返回了无效结果。")
        confidence = _confidence(item[2])
        if confidence is None or confidence < 0.8 or not item[1].strip():
            continue
        lines.append({"text": item[1], "bbox": _box(item[0], width, height, sx, sy), "confidence": confidence})
    return {
        "text": "\n".join(line["text"] for line in lines), "language": "zh-Hans-CN",
        "width": width, "height": height, "textAngle": 0, "lines": lines,
    }


def recognize_duration(image_or_path, *, timeout=10):
    """Recognize one cropped duration label, never use it as voice identity.

    A ready result MUST be paired with independent native conversion-menu proof
    and surrounding message identity before it can trigger any UI action.
    """
    deadline = _deadline(timeout)
    image, _, _ = _prepare(image_or_path, 1)
    result = _run(image, detect=False, deadline=deadline)
    if len(result) != 1 or not isinstance(result[0], (list, tuple)) or len(result[0]) < 2:
        return {"status": "needs-review", "reason": "duration-not-unique"}
    text, confidence = result[0][0], _confidence(result[0][1])
    match = _DURATION.fullmatch(text.strip()) if isinstance(text, str) else None
    if not match or confidence is None or confidence < 0.6:
        return {"status": "needs-review", "reason": "duration-not-reliable"}
    return {"status": "ready", "durationSeconds": int(match.group(1)), "confidence": confidence}
