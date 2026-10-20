"""Real crypto/VFS with generated synthetic SQLite pages; no WeChat access."""
import hashlib
import hmac
import os
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch, Mock

import apsw
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

from background_reader import BackgroundCaptureError
from local_database_source import (EncryptedSnapshot, _verify_login, _wal_checksum, _read_live_config,
                                   open_encrypted_connection, probe_authorized_source, open_authorized_source,
                                   _extract_current_account_keys, _needed_database_files)


def plain_database(path, text):
    conn = apsw.Connection(str(path))
    conn.execute("PRAGMA page_size=4096")
    conn.reserve_bytes("main", 80)
    conn.execute("VACUUM")
    conn.execute("CREATE TABLE sample(body TEXT)")
    conn.execute("INSERT INTO sample VALUES(?)", (text,))
    conn.close()
    raw = path.read_bytes()
    assert raw[20] == 80
    return raw


def encrypt_page(plain, page_no, key, salt):
    iv = hashlib.sha256(salt + struct.pack("<I", page_no)).digest()[:16]
    start = 16 if page_no == 1 else 0
    cipher = Cipher(algorithms.AES(key), modes.CBC(iv)).encryptor()
    body = cipher.update(plain[start:4016]) + cipher.finalize()
    prefix = salt if page_no == 1 else b""
    mac_key = hashlib.pbkdf2_hmac("sha512", key, bytes(b ^ 0x3A for b in salt), 2, 32)
    digest = hmac.new(mac_key, body + iv + struct.pack("<I", page_no), hashlib.sha512).digest()
    return prefix + body + iv + digest


def encrypt_database(raw, key, salt):
    return b"".join(encrypt_page(raw[offset:offset+4096], offset//4096+1, key, salt)
                    for offset in range(0, len(raw), 4096))


def wal_bytes(frames, endian="<"):
    header = struct.pack(">IIIIII", 0x377F0682 if endian == "<" else 0x377F0683,
                         3_007_000, 4096, 0, 123, 456)
    checksum = _wal_checksum(header, endian=endian)
    result = bytearray(header + struct.pack(">II", *checksum))
    for page_no, committed_size, encrypted in frames:
        prefix = struct.pack(">II", page_no, committed_size)
        checksum = _wal_checksum(prefix + encrypted, checksum, endian)
        result.extend(prefix + header[16:24] + struct.pack(">II", *checksum) + encrypted)
    return result


class DatabaseSourceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="chengzi-synthetic-vfs-")
        self.root = Path(self.temp.name)
        self.key = hashlib.sha256(b"synthetic key").digest()
        self.salt = hashlib.md5(b"synthetic salt").digest()
        self.raw = plain_database(self.root / "synthetic-plain.db", "original")
        self.path = self.root / "synthetic-encrypted.db"
        self.path.write_bytes(encrypt_database(self.raw, self.key, self.salt))

    def tearDown(self): self.temp.cleanup()

    def query(self, snapshot):
        conn, vfs = open_encrypted_connection(snapshot)
        try:
            return conn.execute("SELECT body FROM sample").fetchall()
        finally:
            conn.close()
            vfs.unregister()

    def test_authenticated_vfs_reads_without_writing_plaintext(self):
        before = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in self.root.iterdir()}
        snapshot = EncryptedSnapshot(self.path, self.key)
        try:
            self.assertEqual(self.query(snapshot), [("original",)])
        finally:
            snapshot.close()
        self.assertEqual(before, {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in self.root.iterdir()})

    def test_wrong_key_and_tampered_page_are_rejected(self):
        with self.assertRaises(BackgroundCaptureError):
            EncryptedSnapshot(self.path, hashlib.sha256(b"wrong key").digest())
        changed = bytearray(self.path.read_bytes())
        changed[4096 + 10] ^= 1
        self.path.write_bytes(changed)
        snapshot = EncryptedSnapshot(self.path, self.key)
        try:
            with self.assertRaises(BackgroundCaptureError):
                snapshot.read_page(2)
        finally:
            snapshot.close()

    def test_different_database_salt_and_key_cannot_be_reused(self):
        other = self.root / "other-encrypted.db"
        other_key = hashlib.sha256(b"another key").digest()
        other_salt = hashlib.md5(b"another salt").digest()
        other.write_bytes(encrypt_database(self.raw, other_key, other_salt))
        with self.assertRaises(BackgroundCaptureError):
            EncryptedSnapshot(other, self.key)
        snapshot = EncryptedSnapshot(other, other_key)
        try:
            self.assertEqual(self.query(snapshot), [("original",)])
        finally:
            snapshot.close()

    def test_explicit_salt_48_byte_key_with_plaintext_header(self):
        encrypted = bytearray(encrypt_database(self.raw, self.key, self.salt))
        encrypted[:16] = self.raw[:16]
        self.path.write_bytes(encrypted)
        with self.assertRaises(BackgroundCaptureError):
            EncryptedSnapshot(self.path, self.key)
        snapshot = EncryptedSnapshot(self.path, self.key + self.salt)
        try:
            self.assertEqual(self.query(snapshot), [("original",)])
        finally:
            snapshot.close()

    def test_explicit_salt_key_reads_committed_wal_page_one(self):
        encrypted = bytearray(encrypt_database(self.raw, self.key, self.salt))
        encrypted[:16] = self.raw[:16]
        self.path.write_bytes(encrypted)
        new_raw = plain_database(self.root / "explicit-new.db", "updated explicit salt")
        page_one = bytearray(encrypt_page(new_raw[:4096], 1, self.key, self.salt))
        page_one[:16] = new_raw[:16]
        page_two = encrypt_page(new_raw[4096:8192], 2, self.key, self.salt)
        Path(str(self.path) + "-wal").write_bytes(wal_bytes([(1, 0, bytes(page_one)), (2, 2, page_two)]))
        snapshot = EncryptedSnapshot(self.path, self.key + self.salt)
        try:
            self.assertEqual(self.query(snapshot), [("updated explicit salt",)])
        finally:
            snapshot.close()

    def test_vfs_is_read_only(self):
        digest = hashlib.sha256(self.path.read_bytes()).digest()
        snapshot = EncryptedSnapshot(self.path, self.key)
        conn, vfs = open_encrypted_connection(snapshot)
        try:
            with self.assertRaises(apsw.ReadOnlyError):
                conn.execute("INSERT INTO sample VALUES('must not write')")
        finally:
            conn.close(); vfs.unregister(); snapshot.close()
        self.assertEqual(digest, hashlib.sha256(self.path.read_bytes()).digest())

    def test_committed_wal_visible_uncommitted_tail_ignored_both_endians(self):
        new_raw = plain_database(self.root / "synthetic-new.db", "committed")
        new_page = encrypt_page(new_raw[4096:8192], 2, self.key, self.salt)
        old_page = encrypt_page(self.raw[4096:8192], 2, self.key, self.salt)
        for endian in ("<", ">"):
            Path(str(self.path) + "-wal").write_bytes(wal_bytes([(2, 2, new_page), (2, 0, old_page)], endian))
            snapshot = EncryptedSnapshot(self.path, self.key)
            try:
                self.assertEqual(self.query(snapshot), [("committed",)])
            finally:
                snapshot.close()

    def test_tampered_commit_header_rejected_despite_valid_page_hmac(self):
        page = encrypt_page(self.raw[4096:8192], 2, self.key, self.salt)
        data = bytearray(wal_bytes([(2, 0, page)]))
        data[36:40] = struct.pack(">I", 2)
        Path(str(self.path) + "-wal").write_bytes(data)
        with self.assertRaises(BackgroundCaptureError) as caught:
            EncryptedSnapshot(self.path, self.key)
        self.assertEqual(caught.exception.code, "DATABASE_INTEGRITY")

    def test_invalid_wal_header_checksum_rejected(self):
        data = bytearray(wal_bytes([]))
        data[20] ^= 1
        Path(str(self.path) + "-wal").write_bytes(data)
        with self.assertRaises(BackgroundCaptureError):
            EncryptedSnapshot(self.path, self.key)

    def test_appended_wal_transactions_do_not_restart_frozen_import(self):
        page = encrypt_page(self.raw[4096:8192], 2, self.key, self.salt)
        wal = Path(str(self.path) + "-wal")
        wal.write_bytes(wal_bytes([(2, 2, page)]))
        snapshot = EncryptedSnapshot(self.path, self.key)
        try:
            wal.write_bytes(wal_bytes([(2, 2, page), (2, 2, page)]))
            snapshot.assert_unchanged()
            self.assertEqual(self.query(snapshot), [("original",)])
            changed = bytearray(wal.read_bytes())
            changed[100] ^= 1
            wal.write_bytes(changed)
            with self.assertRaises(BackgroundCaptureError) as error:
                snapshot.assert_unchanged()
            self.assertEqual(error.exception.code, "SOURCE_CHANGED")
        finally:
            snapshot.close()

    def test_new_wal_keeps_original_database_snapshot(self):
        snapshot = EncryptedSnapshot(self.path, self.key)
        try:
            page = encrypt_page(self.raw[4096:8192], 2, self.key, self.salt)
            Path(str(self.path) + "-wal").write_bytes(wal_bytes([(2, 2, page)]))
            snapshot.assert_unchanged()
            self.assertEqual(self.query(snapshot), [("original",)])
        finally:
            snapshot.close()

    def test_source_changed_before_snapshot_seal_rejected(self):
        snapshot = EncryptedSnapshot(self.path, self.key)
        try:
            data = self.path.read_bytes()
            self.path.write_bytes(data + b"extra")
            with self.assertRaises(BackgroundCaptureError) as caught:
                snapshot.assert_unchanged()
            self.assertEqual(caught.exception.code, "SOURCE_CHANGED")
        finally:
            snapshot.close()

    def test_live_login_proof_rejects_same_pid_changed_identity_or_key(self):
        proof = {"pid": 123, "created": 55, "cfg": 9000, "rootPointer": 8000,
                 "username": "synthetic-self", "cipherFingerprint": b"same"}
        with patch("psutil.Process") as process:
            process.return_value.name.return_value = "Weixin.exe"
            process.return_value.create_time.return_value = 55
            with patch("local_database_source._read_live_config", return_value=("synthetic-self", b"same")):
                _verify_login(proof)
            for result in (("other", b"same"), ("synthetic-self", b"new"), ("", None)):
                with patch("local_database_source._read_live_config", return_value=result):
                    with self.assertRaises(BackgroundCaptureError):
                        _verify_login(proof)

    def test_live_root_pointer_change_rejects_stale_cfg_object(self):
        import ctypes
        primitive = Mock()
        primitive.CFG_OFFSET = 104
        primitive._k32.OpenProcess.return_value = 1
        memory = {8000: struct.pack("<Q", 8100), 8204: struct.pack("<Q", 9999)}
        def read(_handle, address, buffer, length, count):
            data = memory.get(address.value)
            if data is None or len(data) != length:
                return False
            ctypes.memmove(buffer, data, length)
            count._obj.value = length
            return True
        primitive._k32.ReadProcessMemory.side_effect = read
        with patch("local_database_source._primitives", return_value=primitive):
            self.assertEqual(_read_live_config(123, 9000, 8000), ("", None))
        primitive._read_remote_string.assert_not_called()
        primitive._k32.CloseHandle.assert_called_once_with(1)

    def test_checksum_matches_real_sqlite_generated_wal(self):
        path = self.root / "sqlite-generated.db"
        conn = apsw.Connection(str(path))
        try:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA wal_autocheckpoint=0")
            conn.execute("CREATE TABLE native_test(value TEXT)")
            conn.execute("INSERT INTO native_test VALUES('generated by SQLite')")
            data = Path(str(path) + "-wal").read_bytes()
            header = data[:32]
            endian = "<" if struct.unpack(">I", header[:4])[0] == 0x377F0682 else ">"
            checksum = _wal_checksum(header[:24], endian=endian)
            self.assertEqual(checksum, struct.unpack(">II", header[24:32]))
            frames = 0
            for offset in range(32, len(data), 4120):
                frame = data[offset:offset+4120]
                checksum = _wal_checksum(frame[:8] + frame[24:], checksum, endian)
                self.assertEqual(checksum, struct.unpack(">II", frame[16:24]))
                frames += 1
            self.assertGreater(frames, 0)
        finally:
            conn.close()

    def test_health_does_not_inspect_processes_or_private_databases(self):
        with patch("local_database_source._running_processes", side_effect=AssertionError("private lookup")), \
             patch("local_database_source._primitives", side_effect=AssertionError("key lookup")), \
             patch("local_database_source.os.name", "nt"), \
             patch("local_database_source.importlib.util.find_spec", return_value=object()):
            result = probe_authorized_source()
        self.assertTrue(result["dependenciesReady"])
        self.assertTrue(result["ready"])
        self.assertEqual(result["status"], "components-ready")
        self.assertIn("导入时会核对", result["message"])

    def test_missing_components_stop_capture_before_private_lookup(self):
        with patch("local_database_source._running_processes", side_effect=AssertionError("private lookup")), \
             patch("local_database_source._primitives", side_effect=AssertionError("key lookup")), \
             patch("local_database_source.os.name", "nt"), \
             patch("local_database_source.importlib.util.find_spec", return_value=None):
            result = probe_authorized_source()
            self.assertFalse(result["ready"])
            self.assertEqual(result["status"], "missing-components")
            with self.assertRaises(BackgroundCaptureError) as error:
                open_authorized_source()
            self.assertEqual(error.exception.code, "BACKGROUND_SOURCE_UNAVAILABLE")

    def test_rawkey_scanner_only_authenticates_required_current_account_headers(self):
        import ctypes
        import time
        from vendor import wechat_db_primitives as primitive
        account = self.root / "synthetic-self_abcd"
        base = account / "db_storage"
        for folder in ("contact", "message", "session"):
            (base / folder).mkdir(parents=True)
        payload = encrypt_database(self.raw, self.key, self.salt)
        for relative in ("contact/contact.db", "message/message_0.db", "message/media_0.db", "session/session.db", "message/fav_0.db"):
            (base / relative).write_bytes(payload)
        self.assertEqual({r[0] for r in _needed_database_files(account)},
                         {"contact/contact.db", "message/message_0.db", "message/media_0.db"})
        start = 0x10000
        memory = bytearray(4096)
        name_address = start + 200
        memory[200:200+len(primitive.CONFIG_CIPHER_NAME)] = primitive.CONFIG_CIPHER_NAME
        node = 500
        struct.pack_into("<QQ", memory, node + 0x10, name_address, len(primitive.CONFIG_CIPHER_NAME))
        struct.pack_into("<Q", memory, node + 0x28, start + 900)
        literal = ("x'" + self.key.hex() + self.salt.hex() + "'").encode()
        blob = bytes(v ^ primitive.CONFIG_XOR_MASK[i % len(primitive.CONFIG_XOR_MASK)] for i, v in enumerate(literal))
        memory[1500:1500+len(blob)] = blob
        struct.pack_into("<QQ", memory, 900 + 0x88 + 8, start + 1500, len(blob))
        kernel = Mock()
        kernel.OpenProcess.return_value = 55
        query_count = 0
        def query(handle, address, pointer, _size):
            nonlocal query_count
            query_count += 1
            if address.value >= start + len(memory):
                return 0
            info = pointer._obj
            info.BaseAddress = start
            info.RegionSize = len(memory)
            info.State = 0x1000
            info.Protect = 4
            return ctypes.sizeof(info)
        def read(handle, address, buffer, length, pointer):
            offset = address.value - start
            data = memory[offset:offset+length] if offset >= 0 else b""
            if len(data) != length:
                return False
            ctypes.memmove(buffer, bytes(data), length)
            pointer._obj.value = length
            return True
        kernel.VirtualQueryEx.side_effect = query
        kernel.ReadProcessMemory.side_effect = read
        proof = {"pid": 12345}
        with patch.object(primitive, "_k32", kernel), \
             patch("local_database_source._primitives", return_value=primitive), \
             patch("local_database_source._verify_login") as login:
            keys = _extract_current_account_keys(account, proof, time.monotonic() + 5)
        self.assertEqual(set(keys), {"contact/contact.db", "message/message_0.db", "message/media_0.db"})
        self.assertTrue(all(key == self.key for key in keys.values()))
        self.assertEqual(query_count, 4, "only two complete passes, including terminal queries")
        self.assertEqual(login.call_count, 2)
        kernel.OpenProcess.assert_called_once_with(0x0010 | 0x0400, False, 12345)
        kernel.CloseHandle.assert_called_once_with(55)

    def test_rawkey_scan_deadline_and_account_change_stop_before_return(self):
        import time
        from vendor import wechat_db_primitives as primitive
        headers = [("contact/contact.db", self.path, self.path.read_bytes()[:4096])]
        proof = {"pid": 123}
        with patch("local_database_source._needed_database_files", return_value=headers), \
             patch("local_database_source._verify_login"), \
             patch.object(primitive.ConfigKeyReader, "_extract_keys_pid", return_value={"contact/contact.db": self.key}):
            with self.assertRaises(BackgroundCaptureError) as error:
                _extract_current_account_keys(self.root, proof, time.monotonic() - 1)
            self.assertEqual(error.exception.code, "KEY_SCAN_TIMEOUT")
        with patch("local_database_source._needed_database_files", return_value=headers), \
             patch("local_database_source._verify_login", side_effect=[None, BackgroundCaptureError("ACCOUNT_CHANGED", "changed")]), \
             patch.object(primitive.ConfigKeyReader, "_extract_keys_pid", return_value={"contact/contact.db": self.key}):
            with self.assertRaises(BackgroundCaptureError) as error:
                _extract_current_account_keys(self.root, proof, time.monotonic() + 5)
            self.assertEqual(error.exception.code, "ACCOUNT_CHANGED")


if __name__ == "__main__":
    unittest.main()
