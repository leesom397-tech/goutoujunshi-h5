"""Explicit synthetic encrypted-SQLite smoke test, never a live WeChat source."""
import hashlib
import hmac
import io
import os
from pathlib import Path
import struct
import tempfile
import time


def _synthetic_encrypted_database(plain_path, encrypted_path):
    import apsw
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
    expected = "chengzi-synthetic-vfs-check"
    conn = apsw.Connection(str(plain_path))
    try:
        conn.execute("PRAGMA page_size=4096")
        conn.reserve_bytes("main", 80)
        conn.execute("VACUUM")
        conn.execute("CREATE TABLE sample(body TEXT)")
        conn.execute("INSERT INTO sample VALUES(?)", (expected,))
    finally:
        conn.close()
    raw = plain_path.read_bytes()
    plain_path.unlink()
    key, salt = os.urandom(32), os.urandom(16)
    mac_key = hashlib.pbkdf2_hmac("sha512", key, bytes(byte ^ 0x3A for byte in salt), 2, 32)
    encrypted = bytearray()
    for offset in range(0, len(raw), 4096):
        page_no, plain = offset // 4096 + 1, raw[offset:offset + 4096]
        iv = os.urandom(16)
        start = 16 if page_no == 1 else 0
        encryptor = Cipher(algorithms.AES(key), modes.CBC(iv)).encryptor()
        body = encryptor.update(plain[start:4016]) + encryptor.finalize()
        digest = hmac.new(mac_key, body + iv + struct.pack("<I", page_no), hashlib.sha512).digest()
        encrypted.extend((salt if page_no == 1 else b"") + body + iv + digest)
    encrypted_path.write_bytes(encrypted)
    return key, expected


def run_database_self_test():
    started = time.monotonic()
    result = {"mode": "local-database-runtime-self-test", "ok": False,
              "userDataUsed": False, "processMemoryRead": False, "networkUsed": False,
              "decryptionPassed": False, "readOnlyGuard": False, "compressionReady": False,
              "imageDecryptionPassed": False}
    try:
        import apsw
        import zstandard
        from local_database_source import EncryptedSnapshot, open_encrypted_connection
        with tempfile.TemporaryDirectory(prefix="chengzi-synthetic-runtime-") as temporary:
            root = Path(temporary)
            encrypted_path = root / "synthetic-encrypted.db"
            key, expected = _synthetic_encrypted_database(root / "synthetic-plain.db", encrypted_path)
            before = hashlib.sha256(encrypted_path.read_bytes()).digest()
            snapshot = EncryptedSnapshot(encrypted_path, key)
            conn = vfs = None
            try:
                conn, vfs = open_encrypted_connection(snapshot)
                if conn.execute("SELECT body FROM sample").fetchall() != [(expected,)]:
                    raise RuntimeError("synthetic-read-mismatch")
                result["decryptionPassed"] = True
                try:
                    conn.execute("INSERT INTO sample VALUES('must not write')")
                except apsw.ReadOnlyError:
                    result["readOnlyGuard"] = True
                else:
                    raise RuntimeError("read-only-guard-missing")
            finally:
                if conn is not None:
                    conn.close()
                if vfs is not None:
                    vfs.unregister()
                snapshot.close()
            if hashlib.sha256(encrypted_path.read_bytes()).digest() != before:
                raise RuntimeError("synthetic-source-modified")
            payload = b"chengzi-synthetic-zstandard-check"
            packed = zstandard.ZstdCompressor().compress(payload)
            if zstandard.ZstdDecompressor().decompress(packed) != payload:
                raise RuntimeError("compression-roundtrip-failed")
            result["compressionReady"] = True
            # Exercise the shipped AES and raster components with a generated
            # PNG, not a cache file, live account or process-memory reader.
            from cryptography.hazmat.primitives import padding
            from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
            from PIL import Image
            from local_chat_images import _preview
            from local_image_codec import ImageKeyContext, V1_MAGIC, V2_MAGIC
            image_file = io.BytesIO()
            Image.new("RGB", (48, 32), "orange").save(image_file, format="PNG")
            plain_image = image_file.getvalue()
            context = ImageKeyContext(root, "synthetic-self", 123456)
            keys = context.for_account(root, "synthetic-self")
            for magic, aes_key in ((V1_MAGIC, b"cfcd208495d565ef"), (V2_MAGIC, keys[0])):
                padder = padding.PKCS7(128).padder()
                padded = padder.update(plain_image[:32]) + padder.finalize()
                encryptor = Cipher(algorithms.AES(aes_key), modes.ECB()).encryptor()
                ciphertext = encryptor.update(padded) + encryptor.finalize()
                data = (magic + struct.pack("<II", 32, 20) + b"\0" + ciphertext +
                        plain_image[32:-20] + bytes(byte ^ keys[1] for byte in plain_image[-20:]))
                preview, status = _preview(data, keys)
                if not preview or status != "preview":
                    raise RuntimeError("image-roundtrip-failed")
            context.close()
            result["imageDecryptionPassed"] = True
            result["syntheticPages"] = encrypted_path.stat().st_size // 4096
            result["ok"] = True
    except Exception as error:
        result["reason"] = getattr(error, "code", "database-runtime-check-failed")
        result["errorType"] = type(error).__name__
    finally:
        result["elapsedMilliseconds"] = round((time.monotonic() - started) * 1000)
    return result
