"""Preserve a previously verified voice identity while its body expands below.

This module performs no OCR or UI actions. A caller must first bind the source
with both unique text anchors (for example via match_voice_sequence). A matching
frame is continuity evidence for that binding, never a new message identifier.
The caller must still guard account/contact, foreground, window and occlusion.
"""
from dataclasses import dataclass, field
import math


@dataclass(frozen=True)
class VoiceFrameIdentity:
    source_id: str
    matched_anchors: tuple
    frame_size: tuple
    bubble: tuple
    region: tuple
    pixels: bytes = field(repr=False)


def _finite(value):
    if isinstance(value, bool):
        raise ValueError('Boolean coordinates are not valid')
    result = float(value)
    if not math.isfinite(result):
        raise ValueError('Coordinate is not finite')
    return result


def _bubble(value):
    x, y, width, height = (_finite(value[key]) for key in ('x', 'y', 'width', 'height'))
    if width <= 0 or height <= 0:
        raise ValueError('Empty bubble')
    return x, y, width, height


def _pixels(image, region):
    crop = image.crop(region)
    try:
        rgb = crop.convert('RGB')
        try:
            return rgb.tobytes()
        finally:
            rgb.close()
    finally:
        crop.close()


def capture_frame_identity(image, *, chat_region, bubble, anchor,
                           source_id, matched_anchors):
    """Capture the full-width prefix from the verified left anchor to the voice.

    ``anchor`` is the preceding item returned by text_anchors, including its
    localId, top and bottom. ``matched_anchors`` must be the two IDs returned by
    the successful source match. Return None for incomplete or clipped inputs.
    The immutable snapshot deliberately excludes the body below the voice so
    expanding that body need not discard the already established source ID.
    """
    try:
        if not isinstance(source_id, str) or not source_id:
            return None
        if (not isinstance(matched_anchors, (tuple, list)) or len(matched_anchors) != 2
                or any(not isinstance(value, str) or not value for value in matched_anchors)
                or matched_anchors[0] == matched_anchors[1]
                or source_id in matched_anchors or anchor['localId'] != matched_anchors[0]):
            return None
        if isinstance(chat_region, dict):
            x, y, width, height = (_finite(chat_region[key]) for key in ('x', 'y', 'width', 'height'))
        else:
            x, y, width, height = map(_finite, chat_region)
        if (min(x, y) < 0 or min(width, height) <= 0
                or x+width > image.width or y+height > image.height
                or width*height > 2_000_000):
            return None
        box = _bubble(bubble)
        bx, by, bw, bh = box
        top, bottom = _finite(anchor['top']), _finite(anchor['bottom'])
        # Both anchor and source must be wholly visible inside the chat. Use
        # the whole chat width so all intervening bubbles are protected too.
        if (not y <= top < bottom < by or bx < x or bx+bw > x+width
                or by+bh >= y+height or bubble.get('clipped') or anchor.get('clipped')):
            return None
        region = (math.floor(x), math.floor(top), math.ceil(x+width), math.ceil(by+bh))
        pixels = _pixels(image, region)
        return VoiceFrameIdentity(source_id=source_id, matched_anchors=tuple(matched_anchors),
                                  frame_size=image.size, bubble=box, region=region, pixels=pixels)
    except (KeyError, TypeError, ValueError, AttributeError, OverflowError):
        return None


def frame_identity_matches(identity, image, *, source_id, bubble):
    """True only while source ID, box and complete anchor-to-source pixels match.

    Any movement requires a fresh full match; this does not search for a similar
    bubble elsewhere. In particular, two equal-duration bubbles cannot replace
    each other merely because their own pixels happen to be identical.
    """
    try:
        return bool(isinstance(identity, VoiceFrameIdentity)
                    and identity.source_id == source_id
                    and image.size == identity.frame_size
                    and not bubble.get('clipped')
                    and _bubble(bubble) == identity.bubble
                    and _pixels(image, identity.region) == identity.pixels)
    except (KeyError, TypeError, ValueError, AttributeError, OverflowError):
        return False
