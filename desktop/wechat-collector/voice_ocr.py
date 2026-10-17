"""Pure parsing of OCR from caller-verified Weixin voice/menu image regions.

No capture, UI action, audio transcription, network or implicit screen coordinates.
A ready transcript is OCR of visible words, not a claim of verified accuracy.
Caller must verify the target/message before capture and again before any action.
"""
from __future__ import annotations
import math
import re
import unicodedata

from voice_transcript import _status

_MENU_LABELS = frozenset((
    "语音转文字", "转文字", "語音轉文字", "轉文字",
    "convert to text", "transcribe",
))
_MENU_SUPPORTING_CANONICAL = {
    "收藏": "收藏", "多选": "多选", "多選": "多选", "提醒": "提醒",
    "引用": "引用", "删除": "删除", "刪除": "删除",
    "favorites": "收藏", "add to favorites": "收藏",
    "multi-select": "多选", "select messages": "多选",
    "remind": "提醒", "reminder": "提醒", "quote": "引用", "delete": "删除",
}
# These glyphs were observed when native conversion/quote icons were OCR'd.
# Never treat an arbitrary Han/Latin prefix as an icon (e.g. 不转文字).
_OCR_ICON_GLYPHS = frozenset(("囡", "@"))
_CJK = r"\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff"
_HEADER = re.compile(r'^(?:语音|語音|Audio)\s*\d{1,5}\s*["″]?\s*(?:秒|sec)$', re.I)


def normalize_ocr_spacing(text: str) -> str:
    """Remove OCR-added spaces between Han characters; keep English word spaces."""
    value = re.sub(r"[ \t\u00a0]+", " ", str(text)).strip()
    value = re.sub(r"(?<=[" + _CJK + r"]) +(?=[" + _CJK + r"])", "", value)
    value = re.sub(r" +([，。！？；：、）》】])", r"\1", value)
    value = re.sub(r"([（《【]) +", r"\1", value)
    return value


def _bounds(value):
    if not isinstance(value, dict):
        return None
    try:
        x, y, width, height = [float(value[name]) for name in ("x", "y", "width", "height")]
    except (TypeError, ValueError, KeyError):
        return None
    if not all(math.isfinite(number) for number in (x, y, width, height)) or width <= 0 or height <= 0:
        return None
    return {"x": x, "y": y, "width": width, "height": height}


def _inside(inner, outer):
    return (inner["x"] >= outer["x"] and inner["y"] >= outer["y"]
            and inner["x"] + inner["width"] <= outer["x"] + outer["width"]
            and inner["y"] + inner["height"] <= outer["y"] + outer["height"])


def _intersects(a, b):
    return (a["x"] < b["x"] + b["width"] and a["x"] + a["width"] > b["x"]
            and a["y"] < b["y"] + b["height"] and a["y"] + a["height"] > b["y"])


def _read_region(result, region):
    if not isinstance(result, dict):
        return None, None, "invalid-ocr-result"
    image = _bounds({"x": 0, "y": 0, "width": result.get("width"), "height": result.get("height")})
    if image is None:
        return None, None, "invalid-ocr-result"
    target = image if region is None else _bounds(region)
    if target is None or not _inside(target, image):
        return None, None, "invalid-region"
    values = result.get("lines", [])
    if not isinstance(values, list) or len(values) > 128:
        return None, target, "invalid-ocr-result"
    lines = []
    for value in values:
        if not isinstance(value, dict) or not isinstance(value.get("text"), str):
            return None, target, "invalid-ocr-result"
        box = _bounds(value.get("bbox"))
        if box is None or not _inside(box, image):
            return None, target, "invalid-ocr-result"
        if not _intersects(box, target):
            continue
        if not _inside(box, target):
            return None, target, "clipped-region"
        if value["text"].strip():
            item = {"rawText": value["text"], "text": normalize_ocr_spacing(value["text"]), "bbox": box}
            if "words" in value:
                item["words"] = value["words"]
            lines.append(item)
    if sum(len(line["rawText"]) for line in lines) > 16000:
        return None, target, "invalid-ocr-result"
    return sorted(lines, key=lambda line: (line["bbox"]["y"], line["bbox"]["x"])), target, None


def _menu_key(value):
    return normalize_ocr_spacing(value).casefold()


def _menu_words(line):
    """Return trustworthy left-to-right word boxes, not reconstructed geometry."""
    values = line.get("words")
    if not isinstance(values, list) or not 2 <= len(values) <= 64:
        return None
    words = []
    for value in values:
        if not isinstance(value, dict) or not isinstance(value.get("text"), str) or not value["text"].strip():
            return None
        box = _bounds(value.get("bbox"))
        if box is None or not _inside(box, line["bbox"]):
            return None
        words.append({"text": value["text"].strip(), "bbox": box})
    words.sort(key=lambda word: word["bbox"]["x"])
    for first, second in zip(words, words[1:]):
        a, b = first["bbox"], second["bbox"]
        overlap_y = min(a["y"] + a["height"], b["y"] + b["height"]) - max(a["y"], b["y"])
        # The local engine maps rotated OCR rectangles back to image space;
        # neighboring CJK word bounding boxes can then overlap by 1–2 pixels.
        tolerance = min(2.5, min(a["height"], b["height"]) * 0.12)
        if (b["x"] < a["x"] + a["width"] - tolerance
                or overlap_y < min(a["height"], b["height"]) * 0.5):
            return None
    # Word data must describe the actual line, including any prefix/suffix.
    # Whitespace may differ between the two OCR representations.
    if re.sub(r"\s+", "", "".join(word["text"] for word in words)).casefold() != re.sub(r"\s+", "", line["text"]).casefold():
        return None
    return words


def _menu_candidate(line, labels):
    exact = {label.casefold(): label for label in labels}
    label = exact.get(_menu_key(line["text"]))
    if label:
        return label, line["bbox"]
    words = _menu_words(line)
    if not words:
        return None
    icon = words[0]
    token = icon["text"]
    if len(token) != 1 or not (token in _OCR_ICON_GLYPHS or unicodedata.category(token) in ("So", "Sm", "Co")):
        return None
    label = exact.get(_menu_key(" ".join(word["text"] for word in words[1:])))
    if not label:
        return None
    first = words[1]["bbox"]
    gap = first["x"] - icon["bbox"]["x"] - icon["bbox"]["width"]
    # Menu icons occupy their own column. An adjacent word is not an icon.
    if gap < max(6, first["height"] * 0.5) or gap > first["height"] * 3:
        return None
    if icon["bbox"]["width"] > first["height"] * 2 or icon["bbox"]["height"] > first["height"] * 2:
        return None
    boxes = [word["bbox"] for word in words[1:]]
    left, top = min(box["x"] for box in boxes), min(box["y"] for box in boxes)
    return label, {"x": left, "y": top,
                   "width": max(box["x"] + box["width"] for box in boxes) - left,
                   "height": max(box["y"] + box["height"] for box in boxes) - top}


def _menu_lines(ocr_result, menu_region):
    lines, region, error = _read_region(ocr_result, menu_region)
    if error:
        return None, error
    for line in lines:
        box = line["bbox"]
        if min(box["x"] - region["x"], box["y"] - region["y"],
               region["x"] + region["width"] - box["x"] - box["width"],
               region["y"] + region["height"] - box["y"] - box["height"]) <= 0.5:
            return None, "touches-region-edge"
    return lines, None


def parse_voice_menu(ocr_result: dict, *, menu_region: dict | None = None) -> dict:
    """Return the unique exact conversion label's bbox, in input image pixels.

    A cropped menu image may omit menu_region. A larger caller-supplied image
    must pass the explicitly verified menu region. No fuzzy character matching.
    """
    lines, error = _menu_lines(ocr_result, menu_region)
    if error:
        return {"status": "needs-review", "reason": error, "bbox": None, "label": ""}
    choices = []
    for line in lines:
        candidate = _menu_candidate(line, _MENU_LABELS)
        if candidate:
            choices.append((line, *candidate))
    if len(choices) != 1:
        return {"status": "needs-review", "reason": "ambiguous-menu" if choices else "menu-not-found", "bbox": None, "label": ""}
    choice, label, box = choices[0]
    return {"status": "ready", "reason": "unique-exact-menu", "bbox": box,
            "label": label, "rawOcrText": choice["rawText"]}


def menu_supporting_labels(ocr_result: dict, *, menu_region: dict | None = None) -> set[str]:
    """Read labels only inside the same verified menu/crop as parse_voice_menu."""
    lines, error = _menu_lines(ocr_result, menu_region)
    if error:
        return set()
    found = set()
    for line in lines:
        candidate = _menu_candidate(line, _MENU_SUPPORTING_CANONICAL)
        if candidate:
            found.add(_MENU_SUPPORTING_CANONICAL[candidate[0]])
    return found


def parse_transcript_copy_menu(ocr_result: dict) -> dict:
    """Copy is valid only in the completed voice-transcript context menu."""
    lines, error = _menu_lines(ocr_result, None)
    if error:
        return {'status': 'needs-review', 'reason': error}
    labels = {'复制', '複製', 'copy'}
    collapse = {'收起文字', '隐藏文字', '隱藏文字', 'hide text', 'collapse text'}
    support = {'放大阅读', '放大閱讀', '翻译', '翻譯', '收藏', 'translate', 'read enlarged', 'favorites'}
    enlarged = {'放大阅读', '放大閱讀', 'read enlarged'}
    translated = {'翻译', '翻譯', 'translate'}
    choices = [_menu_candidate(line, labels) for line in lines]
    choices = [choice for choice in choices if choice]
    transcript_menu = (any(_menu_candidate(line, collapse) for line in lines) or
                       (any(_menu_candidate(line, enlarged) for line in lines) and
                        any(_menu_candidate(line, translated) for line in lines)))
    if (len(choices) != 1 or not transcript_menu
            or not any(_menu_candidate(line, support) for line in lines)):
        return {'status': 'needs-review', 'reason': 'transcript-copy-menu-unconfirmed'}
    return {'status': 'ready', 'reason': 'exact-transcript-copy', 'label': choices[0][0], 'bbox': choices[0][1]}


def parse_voice_transcript(ocr_result: dict, *, body_region: dict | None = None) -> dict:
    """Read every OCR line strictly within the caller's verified transcript region.

    With body_region=None the input must already be cropped to that ONE voice
    transcript body, excluding adjacent messages, sender, time and voice bubble.
    Larger images require an explicit body_region in original image pixels.
    Non-ready results never expose partial words as finished text.
    """
    lines, region, error = _read_region(ocr_result, body_region)
    result = {"status": "needs-review", "reason": error or "empty", "text": "",
              "rawOcrText": "\n".join(line["rawText"] for line in (lines or [])),
              "lines": lines or [], "requiresVerification": True}
    if error or not lines:
        return result
    if any("\ufffd" in line["text"] for line in lines):
        result["reason"] = "unreadable-characters"
        return result
    states = [_status(line["text"]) for line in lines]
    # Short UI status messages may wrap within the caller-provided region.
    states += [_status(first["text"] + second["text"]) for first, second in zip(lines, lines[1:])]
    if "failed" in states or "pending" in states:
        result["reason"] = "failed" if "failed" in states else "pending"
        return result
    if "not-visible" in states or any(_HEADER.fullmatch(line["text"]) or line["text"].strip(" []【】").casefold() in ("语音", "語音", "语音消息", "語音消息", "voice", "audio") for line in lines):
        result["reason"] = "contains-control-or-placeholder"
        return result
    # Content touching a crop edge may have lost characters or the next line.
    # Do not claim a complete transcript from that observation.
    for line in lines:
        box = line["bbox"]
        if min(box["x"] - region["x"], box["y"] - region["y"],
               region["x"] + region["width"] - box["x"] - box["width"],
               region["y"] + region["height"] - box["y"] - box["height"]) <= 0.5:
            result["reason"] = "touches-region-edge"
            return result
    # Two distinct OCR lines occupying the same row have ambiguous reading order.
    # Return them for review instead of inventing how the fragments connect.
    for previous, current in zip(lines, lines[1:]):
        a, b = previous["bbox"], current["bbox"]
        overlap = min(a["y"] + a["height"], b["y"] + b["height"]) - max(a["y"], b["y"])
        if overlap > min(a["height"], b["height"]) * 0.5:
            result["reason"] = "ambiguous-line-order"
            return result
    result.update(status="ready", reason="visible-text", text="\n".join(line["text"] for line in lines))
    return result
