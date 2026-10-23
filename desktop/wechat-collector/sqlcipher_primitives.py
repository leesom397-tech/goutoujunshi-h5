"""Portable SQLCipher 4 page primitives. No process, filesystem or key access.

The wire format matches the Apache-2.0 primitives already used by the Windows
reader (vendor/NOTICE.md). Authentication is mandatory before any page decrypt.
"""
import hashlib
import hmac
import struct

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

PAGE_SZ = 4096
RESERVE_SZ = 80


def _pbkdf2(password, salt, iterations):
    return hashlib.pbkdf2_hmac("sha512", password, salt, iterations, dklen=32)


def _verify_enc_key(key, page1, salt=None):
    if len(key) not in (32, 48) or len(page1) != PAGE_SZ:
        return False
    if len(key) == 48:
        key, explicit_salt = key[:32], key[32:]
        salt = explicit_salt if salt is None else salt
    salt = page1[:16] if salt is None else salt
    if len(salt) != 16:
        return False
    mac_key = _pbkdf2(key, bytes(value ^ 0x3A for value in salt), 2)
    digest = hmac.new(mac_key, page1[16:PAGE_SZ - 64] + struct.pack("<I", 1), hashlib.sha512).digest()
    return hmac.compare_digest(digest, page1[-64:])


def effective_page_key(master, page1):
    """Select raw or password mode using authenticated bytes, never a version guess."""
    if len(master) != 32 or len(page1) != PAGE_SZ:
        return None
    if _verify_enc_key(master, page1):
        return master
    derived = _pbkdf2(master, page1[:16], 256000)
    return derived if _verify_enc_key(derived, page1) else None


def _decrypt_page(key, page, page_no):
    start = 16 if page_no == 1 else 0
    iv = page[PAGE_SZ - RESERVE_SZ:PAGE_SZ - RESERVE_SZ + 16]
    decryptor = Cipher(algorithms.AES(key[:32]), modes.CBC(iv)).decryptor()
    body = decryptor.update(page[start:PAGE_SZ - RESERVE_SZ]) + decryptor.finalize()
    prefix = (page[:16] if len(key) == 48 else b"SQLite format 3\0") if page_no == 1 else b""
    return prefix + body + b"\0" * RESERVE_SZ
