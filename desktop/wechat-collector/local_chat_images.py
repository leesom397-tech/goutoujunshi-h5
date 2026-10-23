"""Read selected-message cached images only; no UI, network or key extraction.

One bounded filename index is shared by a message batch. Versioned DAT keys
come only from the already verified account session, and stay in memory.
"""
import base64
import io
import os
from pathlib import Path
import re
import time
from xml.etree import ElementTree
from local_image_codec import ImageDecodeError, V1_MAGIC, V2_MAGIC, decode_versioned_dat

MAX_SOURCE_BYTES = 16 * 1024 * 1024
MAX_PREVIEW_BYTES = 750_000
MAX_PIXELS = 20_000_000
MAX_INDEX_ENTRIES = 100_000
INDEX_SECONDS = 3.0
PHOTO_ROOTS = ("msg/attach", "FileStorage/Image", "FileStorage/Cache")
MAX_PACKED_IMAGE_BYTES = 4096


def packed_image_reference(data):
    """Read only packed_info_data field 3 -> field 4's local image name.

    In 4.x the XML md5 identifies content, while this protobuf field names the
    cached DAT. They need not match. Do not pick arbitrary hex strings (which
    may be unrelated metadata), partial protobufs, or ambiguous file names.
    """
    if not isinstance(data, bytes) or not 0 < len(data) <= MAX_PACKED_IMAGE_BYTES:
        return ""

    def fields(blob):
        cursor = 0
        def number():
            nonlocal cursor
            value = 0
            for shift in range(0, 70, 7):
                if cursor >= len(blob):
                    raise ValueError()
                byte = blob[cursor]
                cursor += 1
                value |= (byte & 127) << shift
                if byte < 128:
                    return value
            raise ValueError()
        result = []
        while cursor < len(blob):
            tag = number()
            field, wire = tag >> 3, tag & 7
            if not 0 < field < (1 << 29):
                raise ValueError()
            if wire == 0:
                number()
            elif wire in (1, 2, 5):
                size = number() if wire == 2 else (8 if wire == 1 else 4)
                end = cursor + size
                if end > len(blob):
                    raise ValueError()
                if wire == 2:
                    result.append((field, blob[cursor:end]))
                cursor = end
            else:
                raise ValueError()
        return result

    try:
        names = []
        for field, nested in fields(data):
            if field != 3:
                continue
            for subfield, name in fields(nested):
                if subfield == 4:
                    if re.fullmatch(rb"[0-9a-fA-F]{32}", name) is None:
                        return ""
                    names.append(name.decode("ascii").lower())
        return names[0] if len(names) == 1 else ""
    except (ValueError, UnicodeError):
        return ""


def _local_reference(value):
    return value.lower() if isinstance(value, str) and re.fullmatch(r"[0-9a-fA-F]{32}", value) else ""


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


def readable_image_bytes(data, image_keys=None):
    """Decode known containers; never treat unknown encryption as an image."""
    if len(data) < 12 or len(data) > MAX_SOURCE_BYTES:
        return None
    if data[:6] in (V1_MAGIC, V2_MAGIC):
        return decode_versioned_dat(data, image_keys)
    signatures = (b"\xff\xd8\xff", b"\x89PNG\r\n\x1a\n", b"GIF87a", b"GIF89a", b"RIFF")
    for signature in signatures:
        key = data[0] ^ signature[0]
        if any((data[index] ^ key) != byte for index, byte in enumerate(signature)):
            continue
        if signature == b"RIFF" and bytes(byte ^ key for byte in data[8:12]) != b"WEBP":
            continue
        return data if key == 0 else bytes(byte ^ key for byte in data)
    return None


def _preview(data, image_keys=None):
    from PIL import Image, ImageOps
    try:
        plain = readable_image_bytes(data, image_keys)
    except ImageDecodeError as error:
        return None, error.reason
    if plain is None:
        return None, "unsupported-encryption"
    try:
        # verify checks PNG checksums; load below also rejects truncated rasters.
        with Image.open(io.BytesIO(plain)) as check:
            if check.width * check.height > MAX_PIXELS:
                return None, "image-too-large"
            check.verify()
        with Image.open(io.BytesIO(plain)) as source:
            if source.width * source.height > MAX_PIXELS:
                return None, "image-too-large"
            source.load()
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
    except (OSError, ValueError, SyntaxError, EOFError, Image.DecompressionBombError):
        return None, "invalid-image"


class LocalChatImages:
    def __init__(self, account_dir, contents, *, account_id=None, image_key_context=None, file_references=(),
                 max_entries=MAX_INDEX_ENTRIES, seconds=INDEX_SECONDS):
        self.root = Path(account_dir).resolve()
        self.account_id = account_id
        self.image_key_context = image_key_context
        self.targets = {value for content in contents if (value := image_reference(content))}
        self.targets.update(value for reference in file_references if (value := _local_reference(reference)))
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

    def resolve(self, content, *, file_reference=None):
        references = tuple(dict.fromkeys(reference for reference in
            (_local_reference(file_reference), image_reference(content)) if reference))
        if not references:
            return None, "message-reference-missing"
        if references in self.cache:
            return self.cache[references]
        paths = [path for reference in references for path in self.files.get(reference, [])]
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
                keys = (self.image_key_context.for_account(self.root, self.account_id)
                        if self.image_key_context is not None else None)
                image, status = _preview(data, keys)
                if image:
                    if len(self.cache) >= 16:
                        self.cache.pop(next(iter(self.cache)))
                    self.cache[references] = image, status
                    return image, status
            except OSError:
                status = "missing-local"
        self.cache[references] = None, status
        return None, status
