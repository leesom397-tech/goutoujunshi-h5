"""Bounded, in-memory DAT decoding. Never acquires, stores or transmits keys.

Windows V2 container layout and cfg-dword derivation documented by
fanyuantaier/wechatauto-replica (Apache-2.0), pinned in vendor/NOTICE.md.
V1 is selected by its exact ASCII-V1 magic; it is not the unrelated legacy
22-byte-header format that some projects also call "V1".
"""
import hashlib
from pathlib import Path
import struct

MAX_DAT_BYTES = 16 * 1024 * 1024
V1_MAGIC = b"\x07\x08V1\x08\x07"
V2_MAGIC = b"\x07\x08V2\x08\x07"
_V1_FIXED_KEY = b"cfcd208495d565ef"


class ImageDecodeError(ValueError):
    """A non-sensitive reason; never includes paths, data or key material."""
    def __init__(self, reason):
        self.reason = reason
        super().__init__(reason)


class ImageKeyContext:
    """Account-scoped material borrowed from the already verified DB session."""
    __slots__ = ("_root", "_account", "_aes", "_xor")

    def __init__(self, account_dir, account_id, cfg_dword):
        self._root = Path(account_dir).resolve()
        self._account = account_id
        self._aes = None
        self._xor = None
        # The existing login reader uses zero when its cfg read was unavailable.
        if (isinstance(account_id, str) and account_id and
                type(cfg_dword) is int and 0 < cfg_dword <= 0xFFFFFFFF):
            self._aes = hashlib.md5((str(cfg_dword) + account_id).encode("utf-8")).hexdigest()[:16].encode("ascii")
            self._xor = cfg_dword & 0xFF

    def __repr__(self):
        return "<ImageKeyContext redacted>"

    def for_account(self, account_dir, account_id):
        if (self._aes is None or account_id != self._account or
                Path(account_dir).resolve() != self._root):
            return None
        return self._aes, self._xor

    def close(self):
        self._aes = None
        self._xor = None
        self._account = None
        self._root = None


def _v1_tail_key(prefix, encrypted_tail):
    """Infer only a fully present JPEG/PNG trailer, never a guessed default."""
    marker = (b"\xff\xd9" if prefix.startswith(b"\xff\xd8\xff") else
              b"\x00\x00\x00\x00IEND\xaeB\x60\x82" if prefix.startswith(b"\x89PNG\r\n\x1a\n") else None)
    if not marker or len(encrypted_tail) < len(marker):
        raise ImageDecodeError("image-key-unavailable")
    tail = encrypted_tail[-len(marker):]
    key = tail[0] ^ marker[0]
    if any((value ^ key) != expected for value, expected in zip(tail, marker)):
        raise ImageDecodeError("image-key-unavailable")
    return key


def decode_versioned_dat(data, image_keys=None):
    """Return candidate raster bytes; the caller must fully decode the image."""
    if len(data) < 15 or len(data) > MAX_DAT_BYTES or data[:6] not in (V1_MAGIC, V2_MAGIC):
        raise ImageDecodeError("invalid-image-container")
    aes_size, xor_size = struct.unpack_from("<II", data, 6)
    # Header stores unpadded length. PKCS7 always adds at least one byte.
    aes_end = 15 + aes_size + (16 - aes_size % 16)
    xor_start = len(data) - xor_size
    if aes_size < 12 or aes_end > len(data) or xor_start < aes_end:
        raise ImageDecodeError("invalid-image-container")
    key = _V1_FIXED_KEY if data[:6] == V1_MAGIC else (image_keys[0] if image_keys else None)
    if not isinstance(key, bytes) or len(key) != 16:
        raise ImageDecodeError("image-key-unavailable")
    from cryptography.hazmat.primitives import padding
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
    try:
        decryptor = Cipher(algorithms.AES(key), modes.ECB()).decryptor()
        padded = decryptor.update(data[15:aes_end]) + decryptor.finalize()
        unpadder = padding.PKCS7(128).unpadder()
        plain = unpadder.update(padded) + unpadder.finalize()
    except ValueError:
        raise ImageDecodeError("invalid-image-container") from None
    if len(plain) != aes_size:
        raise ImageDecodeError("invalid-image-container")
    tail = data[xor_start:]
    if tail:
        xor_key = image_keys[1] if image_keys else _v1_tail_key(plain, tail)
        if type(xor_key) is not int or not 0 <= xor_key <= 255:
            raise ImageDecodeError("image-key-unavailable")
        tail = bytes(value ^ xor_key for value in tail)
    result = plain + data[aes_end:xor_start] + tail
    # Only documented small container footers may follow a complete raster.
    for signature, trailer in ((b"\xff\xd8\xff", b"\xff\xd9"),
                               (b"\x89PNG\r\n\x1a\n", b"\x00\x00\x00\x00IEND\xaeB\x60\x82")):
        if result.startswith(signature):
            end = result.rfind(trailer)
            if end < 0 or len(result) - end - len(trailer) > 32:
                raise ImageDecodeError("invalid-image-container")
            return result[:end + len(trailer)]
    if result.startswith((b"GIF87a", b"GIF89a")):
        if not result.endswith(b";"):
            raise ImageDecodeError("invalid-image-container")
        return result
    if result.startswith(b"RIFF") and result[8:12] == b"WEBP":
        if struct.unpack_from("<I", result, 4)[0] + 8 != len(result):
            raise ImageDecodeError("invalid-image-container")
        return result
    raise ImageDecodeError("unsupported-image-format")
