"""Read selected-message cached images only; no UI, network or key extraction.

One bounded filename index is shared by a message batch. Modern encrypted DAT
formats stay unavailable rather than treating a placeholder as an image.
"""
import base64
import io
import os
from pathlib import Path
import re
import time
from xml.etree import ElementTree

MAX_SOURCE_BYTES = 16 * 1024 * 1024
MAX_PREVIEW_BYTES = 750_000
MAX_PIXELS = 20_000_000
MAX_INDEX_ENTRIES = 100_000
INDEX_SECONDS = 3.0
PHOTO_ROOTS = ("msg/attach", "FileStorage/Image", "FileStorage/Cache")


def image_reference(content):
    if not isinstance(content, str) or len(content) > 30_000 or "<!" in content:
        return ""
    try:
        root = ElementTree.fromstring(content)
        node = root if root.tag == "img" else root.find(".//img")
        value = str(node.attrib.get("md5") or "").lower() if node is not None else ""
        return value if re.fullmatch(r"[0-9a-f]{32}", value) else ""
    except ElementTree.ParseError:
        return ""


def readable_image_bytes(data):
    """Plain images and old single-byte XOR DAT only, never unknown encryption."""
    if len(data) < 12 or len(data) > MAX_SOURCE_BYTES:
        return None
    signatures = (b"\xff\xd8\xff", b"\x89PNG\r\n\x1a\n", b"GIF87a", b"GIF89a", b"RIFF")
    for signature in signatures:
        key = data[0] ^ signature[0]
        if any((data[index] ^ key) != byte for index, byte in enumerate(signature)):
            continue
        if signature == b"RIFF" and bytes(byte ^ key for byte in data[8:12]) != b"WEBP":
            continue
        return data if key == 0 else bytes(byte ^ key for byte in data)
    return None


def _preview(data):
    from PIL import Image, ImageOps
    plain = readable_image_bytes(data)
    if plain is None:
        return None, "unsupported-encryption"
    try:
        with Image.open(io.BytesIO(plain)) as source:
            if source.width * source.height > MAX_PIXELS:
                return None, "image-too-large"
            source.thumbnail((1600, 1600))
            oriented = ImageOps.exif_transpose(source)
            with oriented.convert("RGBA") as rgba, Image.new("RGBA", oriented.size, "white") as canvas:
                canvas.alpha_composite(rgba)
                with canvas.convert("RGB") as rgb:
                    for quality in (82, 68, 50):
                        output = io.BytesIO()
                        rgb.save(output, format="JPEG", quality=quality)
                        if output.tell() <= MAX_PREVIEW_BYTES:
                            return {"mime": "image/jpeg", "name": "chat-photo-preview.jpg",
                                    "data": base64.b64encode(output.getvalue()).decode("ascii")}, "preview"
        return None, "image-too-large"
    except (OSError, ValueError, Image.DecompressionBombError):
        return None, "invalid-image"


class LocalChatImages:
    def __init__(self, account_dir, contents, *, max_entries=MAX_INDEX_ENTRIES, seconds=INDEX_SECONDS):
        self.root = Path(account_dir).resolve()
        self.targets = {value for content in contents if (value := image_reference(content))}
        self.files = {value: [] for value in self.targets}
        self.complete = True
        self.cache = {}
        if not self.targets:
            return
        deadline, visited = time.monotonic() + seconds, 0
        for relative in PHOTO_ROOTS:
            base = self.root / relative
            if not base.is_dir() or not base.resolve().is_relative_to(self.root):
                continue
            def unreadable(_error):
                self.complete = False
            for directory, dirs, files in os.walk(base, followlinks=False, onerror=unreadable):
                # Windows junctions/reparse points must not leave this account.
                allowed_dirs = []
                for name in dirs:
                    child = Path(directory) / name
                    try:
                        if not child.is_symlink() and not getattr(child.lstat(), "st_file_attributes", 0) & 0x400 and child.resolve().is_relative_to(self.root):
                            allowed_dirs.append(name)
                    except OSError:
                        self.complete = False
                dirs[:] = allowed_dirs
                for name in files:
                    visited += 1
                    if visited > max_entries or time.monotonic() > deadline:
                        self.complete = False
                        return
                    match = re.search(r"(?:^|[^a-f0-9])([a-f0-9]{32})(?=[^a-f0-9]|$)", name.lower())
                    if match and match[1] in self.targets:
                        path = Path(directory) / name
                        if path.resolve().is_relative_to(self.root) and not path.is_symlink():
                            self.files[match[1]].append(path)

    def resolve(self, content):
        reference = image_reference(content)
        if not reference:
            return None, "message-reference-missing"
        if reference in self.cache:
            return self.cache[reference]
        paths = self.files.get(reference, [])
        # Prefer an original-sized cached file to the _t thumbnail, when usable.
        paths = sorted(paths, key=lambda path: (bool(re.search(r"(?:_t|thumb)", path.stem, re.I)), str(path)))
        status = "missing-local" if self.complete else "scan-incomplete"
        for path in paths:
            try:
                if path.stat().st_size > MAX_SOURCE_BYTES:
                    status = "image-too-large"
                    continue
                with path.open("rb") as handle:
                    data = handle.read(MAX_SOURCE_BYTES + 1)
                image, status = _preview(data)
                if image:
                    if len(self.cache) >= 16:
                        self.cache.pop(next(iter(self.cache)))
                    self.cache[reference] = image, status
                    return image, status
            except OSError:
                status = "missing-local"
        self.cache[reference] = None, status
        return None, status
