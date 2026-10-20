"""Explicitly authorized, local-only WeChat 4.x read provider for Windows.

No UI input, sending, network, persistent keys, or decrypted database files.
Only selected-contact queries are made by background_reader. Page decryption is
on demand through a read-only VFS; private rows are never dumped to disk.
"""
from __future__ import annotations

from collections import OrderedDict
import ctypes
from ctypes import wintypes
import hashlib
import hmac
import importlib.util
import os
from pathlib import Path
import re
import struct
import time
import uuid

from background_reader import BackgroundCaptureError

PAGE_SIZE = 4096
RESERVE = 80
MAX_WAL_FRAMES = 500_000
MAX_PAGE_CACHE = 64
KEY_SCAN_SECONDS = 70
SCAN_CHUNK_BYTES = 8 * 1024 * 1024
MAX_SCAN_BYTES = 8 * 1024 * 1024 * 1024


def _fail(code, message):
    return BackgroundCaptureError(code, message)


def probe_authorized_source():
    """Component readiness only; actual login/account compatibility is task-scoped.

    Health never inspects process memory or private databases. Every capture
    independently verifies the live account proof and each required database.
    """
    if os.name != "nt":
        return {"ready": False, "dependenciesReady": False, "status": "unsupported-platform",
                "message": "本地后台语音读取目前仅适配 Windows 微信。"}
    dependencies = all(importlib.util.find_spec(name) is not None for name in ("apsw", "cryptography", "psutil"))
    return {"ready": dependencies, "dependenciesReady": dependencies,
            "status": "components-ready" if dependencies else "missing-components",
            "message": "后台读取组件已就绪，导入时会核对当前微信账号和材料。" if dependencies else "后台读取组件尚未安装完整。"}


def _stat(path):
    try:
        s = os.stat(path)
        return s.st_size, s.st_mtime_ns
    except FileNotFoundError:
        return None


def _wal_checksum(data, state=(0, 0), endian="<"):
    if len(data) % 8:
        raise _fail("DATABASE_INTEGRITY", "本地聊天日志校验长度异常。")
    first, second = state
    for left, right in struct.iter_unpack(endian + "II", data):
        first = (first + left + second) & 0xFFFFFFFF
        second = (second + right + first) & 0xFFFFFFFF
    return first, second


def _primitives():
    from vendor import wechat_db_primitives as primitive
    primitive._k32.CloseHandle.argtypes = [wintypes.HANDLE]
    primitive._k32.CloseHandle.restype = wintypes.BOOL
    return primitive


class EncryptedSnapshot:
    """Authenticated SQLCipher pages + committed WAL overlay, memory bounded."""
    def __init__(self, path, key):
        self.path = Path(path)
        self.wal_path = Path(str(self.path) + "-wal")
        self.before = (_stat(self.path), _stat(self.wal_path))
        self.key = bytes(key)
        self.cache = OrderedDict()
        self.frames = {}
        self._file = self.path.open("rb")
        self._wal = None
        self._wal_prefix_hash = None
        self.closed = False
        try:
            first = self._file.read(PAGE_SIZE)
            primitive = _primitives()
            if not primitive._verify_enc_key(self.key, first):
                raise _fail("DATABASE_KEY_UNAVAILABLE", "当前微信数据库无法通过本机只读校验。")
            salt = self.key[32:] if len(self.key) == 48 else first[:16]
            self.mac_key = hashlib.pbkdf2_hmac("sha512", self.key[:32], bytes(b ^ 0x3A for b in salt), 2, 32)
            size = self.before[0][0]
            if size < PAGE_SIZE or size % PAGE_SIZE:
                raise _fail("SOURCE_CHANGED", "微信正在更新本地聊天，请稍后重试。")
            self.pages = size // PAGE_SIZE
            self._index_wal()
            self.assert_unchanged()
        except BaseException:
            self.close()
            raise

    def _index_wal(self):
        if not self.before[1] or self.before[1][0] < 32:
            return
        self._wal = self.wal_path.open("rb")
        header = self._wal.read(32)
        magic, version, page_size = struct.unpack(">III", header[:12])
        if magic not in (0x377F0682, 0x377F0683) or version != 3_007_000 or page_size != PAGE_SIZE:
            raise _fail("UNSUPPORTED_DATABASE", "当前微信数据库日志格式暂不支持。")
        endian = "<" if magic == 0x377F0682 else ">"
        checksum = _wal_checksum(header[:24], endian=endian)
        if checksum != struct.unpack(">II", header[24:32]):
            raise _fail("DATABASE_INTEGRITY", "本地聊天日志头校验未通过，未导入。")
        count = (self.before[1][0] - 32) // (24 + PAGE_SIZE)
        if count > MAX_WAL_FRAMES:
            raise _fail("SOURCE_TOO_LARGE", "微信正在整理较大的聊天日志，请稍后再导入。")
        salt = header[16:24]
        pending = {}
        for index in range(count):
            offset = 32 + index * (24 + PAGE_SIZE)
            self._wal.seek(offset)
            frame = self._wal.read(24)
            if len(frame) != 24 or frame[8:16] != salt:
                break
            data = self._wal.read(PAGE_SIZE)
            if len(data) != PAGE_SIZE:
                break
            checksum = _wal_checksum(frame[:8] + data, checksum, endian)
            if checksum != struct.unpack(">II", frame[16:24]):
                raise _fail("DATABASE_INTEGRITY", "本地聊天日志事务校验未通过，未导入。")
            page_no, committed_size = struct.unpack(">II", frame[:8])
            if not 1 <= page_no <= 0x7FFFFFFF:
                raise _fail("DATABASE_INTEGRITY", "本地聊天日志页号异常，未导入。")
            pending[page_no] = offset + 24
            if committed_size:
                if committed_size > self.pages + count or committed_size < 1:
                    raise _fail("DATABASE_INTEGRITY", "本地聊天日志提交范围异常，未导入。")
                self.frames.update(pending)
                pending.clear()
                self.pages = committed_size
        # Uncommitted trailing frames must never be visible to SQLite.
        self.frames = {pg: offset for pg, offset in self.frames.items() if pg <= self.pages}
        self._wal_prefix_hash = self._wal_prefix_digest(self.before[1][0])

    def _wal_prefix_digest(self, size):
        digest = hashlib.sha256()
        with self.wal_path.open("rb") as handle:
            while size:
                data = handle.read(min(size, 1024 * 1024))
                if not data:
                    return None
                digest.update(data)
                size -= len(data)
        return digest.digest()

    def assert_unchanged(self):
        current = (_stat(self.path), _stat(self.wal_path))
        if self.before == current:
            return
        if self.before[0] == current[0]:
            # An append adds newer transactions outside this snapshot; the
            # original committed frame offsets remain valid. Verify the entire
            # old prefix before tolerating it. A checkpoint/truncate/rewrite
            # still fails closed and is retried from a fresh source.
            if self.before[1] is None and current[1] is not None:
                return
            if (self.before[1] and current[1] and current[1][0] > self.before[1][0]
                    and self._wal_prefix_hash is not None
                    and self._wal_prefix_digest(self.before[1][0]) == self._wal_prefix_hash):
                return
        raise _fail("SOURCE_CHANGED", "微信聊天正在同步或更新，请稍后重新导入。")

    def read_page(self, page_no):
        if page_no in self.cache:
            self.cache.move_to_end(page_no)
            return self.cache[page_no]
        if page_no < 1 or page_no > self.pages:
            return b"\0" * PAGE_SIZE
        if page_no in self.frames:
            handle, offset = self._wal, self.frames[page_no]
        else:
            handle, offset = self._file, (page_no - 1) * PAGE_SIZE
        handle.seek(offset)
        encrypted = handle.read(PAGE_SIZE)
        if len(encrypted) != PAGE_SIZE:
            raise _fail("SOURCE_CHANGED", "本地聊天页正在变化，请稍后重新导入。")
        start = 16 if page_no == 1 else 0
        digest = hmac.new(self.mac_key, encrypted[start:PAGE_SIZE - 64] + struct.pack("<I", page_no), hashlib.sha512).digest()
        if not hmac.compare_digest(digest, encrypted[-64:]):
            raise _fail("DATABASE_INTEGRITY", "本地聊天页校验未通过，未导入。")
        plain = bytearray(_primitives()._decrypt_page(self.key, encrypted, page_no))
        if page_no == 1:
            if plain[:16] != b"SQLite format 3\0" or plain[16:18] != b"\x10\x00":
                raise _fail("UNSUPPORTED_DATABASE", "当前微信数据库页格式暂不支持。")
            plain[18:20] = b"\x01\x01"  # WAL is already overlaid; SQLite must not open it.
            plain[28:32] = struct.pack(">I", self.pages)
        result = bytes(plain)
        self.cache[page_no] = result
        if len(self.cache) > MAX_PAGE_CACHE:
            self.cache.popitem(last=False)
        return result

    def read(self, amount, offset):
        if amount < 0 or offset < 0 or amount > 8 * 1024 * 1024:
            raise _fail("DATABASE_INTEGRITY", "本地数据库读取范围异常。")
        result = bytearray()
        while amount:
            page_no, within = divmod(offset, PAGE_SIZE)
            take = min(amount, PAGE_SIZE - within)
            result.extend(self.read_page(page_no + 1)[within:within + take])
            offset += take
            amount -= take
        return bytes(result)

    def close(self):
        if self.closed:
            return
        self.closed = True
        self.cache.clear()
        self.frames.clear()
        self.key = b""
        self.mac_key = b""
        for handle in (getattr(self, "_file", None), self._wal):
            if handle is not None:
                handle.close()


class _ReadOnlyFile:
    def __init__(self, snapshot): self.snapshot = snapshot
    def xRead(self, amount, offset): return self.snapshot.read(amount, offset)
    def xFileSize(self): return self.snapshot.pages * PAGE_SIZE
    def xClose(self): pass
    def xLock(self, level): pass
    def xUnlock(self, level): pass
    def xCheckReservedLock(self): return False
    def xSectorSize(self): return PAGE_SIZE
    def xDeviceCharacteristics(self):
        import apsw
        return apsw.SQLITE_IOCAP_IMMUTABLE
    def xFileControl(self, opcode, ptr): return False
    def xWrite(self, *_): raise _fail("READ_ONLY", "本机聊天读取器不会修改微信数据库。")
    def xTruncate(self, *_): raise _fail("READ_ONLY", "本机聊天读取器不会修改微信数据库。")
    def xSync(self, *_): pass


def open_encrypted_connection(snapshot):
    import apsw
    class VFS(apsw.VFS):
        def __init__(self):
            self.name = "chengzi-readonly-" + uuid.uuid4().hex
            super().__init__(self.name, "")
        def xOpen(self, name, flags):
            if flags[0] & (apsw.SQLITE_OPEN_READWRITE | apsw.SQLITE_OPEN_CREATE):
                raise _fail("READ_ONLY", "本机聊天读取器只支持只读打开。")
            return _ReadOnlyFile(snapshot)
        def xAccess(self, name, flags): return False
        def xFullPathname(self, name): return name
        def xDelete(self, *_): raise _fail("READ_ONLY", "本机聊天读取器不会删除文件。")
    vfs = VFS()
    try:
        conn = apsw.Connection("file:chengzi-selected?immutable=1&mode=ro",
                               flags=apsw.SQLITE_OPEN_READONLY | apsw.SQLITE_OPEN_URI, vfs=vfs.name)
        conn.execute("PRAGMA query_only=ON")
        conn.execute("PRAGMA temp_store=MEMORY")
        conn.execute("PRAGMA cache_size=-1024")
        return conn, vfs
    except BaseException:
        vfs.unregister()
        raise


def _running_processes():
    import psutil
    result = []
    for proc in psutil.process_iter(["pid", "name", "create_time"]):
        if (proc.info.get("name") or "").casefold() == "weixin.exe":
            result.append((int(proc.info["pid"]), proc.info.get("create_time")))
    return sorted(result)


def _read_live_config(pid, cfg, root_pointer):
    """Read only the already-identified login fields, never rescan memory."""
    primitive = _primitives()
    handle = primitive._k32.OpenProcess(0x0010 | 0x0400, False, pid)
    if not handle:
        raise _fail("ACCOUNT_CHANGED", "无法继续核对微信登录状态，本次读取已停止。")
    try:
        def read(address, length):
            if not 0 < length <= 4096:
                return None
            data = ctypes.create_string_buffer(length)
            count = ctypes.c_size_t(0)
            if primitive._k32.ReadProcessMemory(handle, ctypes.c_void_p(address), data, length, ctypes.byref(count)) and count.value == length:
                return data.raw
            return None
        root = read(root_pointer, 8)
        v18 = struct.unpack("<Q", root)[0] if root else 0
        current = read(v18 + primitive.CFG_OFFSET, 8) if v18 else None
        current_cfg = struct.unpack("<Q", current)[0] if current else 0
        if current_cfg != cfg:
            return "", None
        username = primitive._read_remote_string(handle, read, cfg + primitive.CFG_WXID_OFF)
        cipher = primitive._read_remote_bytes(handle, read, cfg + primitive.CFG_CIPHER_OFF)
        return username, hashlib.sha256(cipher).digest() if cipher else None
    finally:
        primitive._k32.CloseHandle(handle)


def _verify_login(proof):
    import psutil
    try:
        process = psutil.Process(proof["pid"])
        if process.name().casefold() != "weixin.exe" or process.create_time() != proof["created"]:
            raise ValueError("identity changed")
        username, fingerprint = _read_live_config(proof["pid"], proof["cfg"], proof["rootPointer"])
        if username != proof["username"] or fingerprint is None or not hmac.compare_digest(fingerprint, proof["cipherFingerprint"]):
            raise ValueError("login changed")
    except Exception:
        raise _fail("ACCOUNT_CHANGED", "微信登录账号发生变化，本次读取已停止，已完成内容保留。") from None




def _contact_files(root):
    primitive = _primitives()
    found = []
    for account_dir in primitive._find_account_dirs(str(root)):
        account = Path(account_dir)
        path = account / "db_storage" / "contact" / "contact.db"
        if path.is_file():
            found.append((str(account), str(path), path.stat().st_size))
    if not found or len(found) > 16:
        raise _fail("ACCOUNT_UNAVAILABLE", "未找到可核对的微信本地账号，请先登录并完成聊天同步。")
    return found


def _needed_database_files(account_dir):
    """Only headers of this uniquely proven account's required shared stores."""
    base = (Path(account_dir) / "db_storage").resolve()
    files = [("contact/contact.db", base / "contact" / "contact.db")]
    for path in sorted((base / "message").glob("*.db")):
        if re.fullmatch(r"(?:message|media)_\d+\.db", path.name):
            files.append(("message/" + path.name, path))
    if len(files) > 129:
        raise _fail("SOURCE_TOO_LARGE", "本地聊天分片超出当前支持范围。")
    result = []
    for relative, path in files:
        resolved = path.resolve()
        if not resolved.is_relative_to(base) or not resolved.is_file():
            raise _fail("SOURCE_INVALID", "本地聊天分片路径无法核对。")
        with resolved.open("rb") as handle:
            page = handle.read(PAGE_SIZE)
        if len(page) != PAGE_SIZE:
            raise _fail("SOURCE_CHANGED", "本地聊天分片正在变化，请稍后重试。")
        result.append((relative, resolved, page))
    return result


def _extract_current_account_keys(account_dir, proof, deadline):
    """WCDB 4.1.13+ raw keys, fixed live PID; no key files or broad DB queries."""
    primitive = _primitives()
    files = _needed_database_files(account_dir)
    _verify_login(proof)

    class ScopedReader(primitive.ConfigKeyReader):
        def __init__(self):
            self._db_files = [(relative, str(path), len(page)) for relative, path, page in files]
            self._headers = {relative: page for relative, _, page in files}
            self.needles = []
            self.pairs = None

        def _check_scan(self):
            if time.monotonic() > deadline:
                raise _fail("KEY_SCAN_TIMEOUT", "本次本机读取准备超时，请稍后重试。")

        def _chunks(self, handle, read):
            address = 0x10000
            scanned = 0
            while address < 0x800000000000:
                self._check_scan()
                info = primitive._MBI()
                if not primitive._k32.VirtualQueryEx(handle, ctypes.c_void_p(address), ctypes.byref(info), ctypes.sizeof(info)):
                    break
                base = int(info.BaseAddress or 0)
                size = int(info.RegionSize)
                end = base + size
                if end <= address:
                    break
                # Committed and readable, never guarded/no-access pages.
                if info.State == 0x1000 and info.Protect & 0xFF in (2, 4, 8, 0x20, 0x40, 0x80) and not info.Protect & 0x100:
                    cursor = max(base, address)
                    overlap = b""
                    while cursor < end:
                        self._check_scan()
                        amount = min(SCAN_CHUNK_BYTES, end - cursor)
                        scanned += amount
                        if scanned > MAX_SCAN_BYTES:
                            raise _fail("KEY_SCAN_TIMEOUT", "本次微信内存准备范围过大，请稍后重试。")
                        chunk = read(cursor, amount)
                        if chunk:
                            yield cursor - len(overlap), overlap + chunk
                            overlap = chunk[-64:]
                        else:
                            overlap = b""
                        cursor += amount
                address = end

        def _find_bytes(self, handle, read, pattern):
            self._check_scan()
            if pattern == primitive.CONFIG_CIPHER_NAME:
                matches = set()
                for address, chunk in self._chunks(handle, read):
                    start = 0
                    while (index := chunk.find(pattern, start)) >= 0:
                        matches.add(address + index)
                        if len(matches) > 256:
                            raise _fail("SOURCE_TOO_LARGE", "当前微信密钥配置数量异常，已停止读取。")
                        start = index + 1
                self.needles = sorted(matches)
                return self.needles
            if self.pairs is None:
                # A single second pass locates every (name pointer, length).
                # Repeating a complete process scan for each pointer is slow.
                by_pointer = {struct.pack("<Q", pointer): struct.pack("<QQ", pointer, len(primitive.CONFIG_CIPHER_NAME))
                              for pointer in self.needles}
                self.pairs = {pair: set() for pair in by_pointer.values()}
                suffix = struct.pack("<Q", len(primitive.CONFIG_CIPHER_NAME))
                count = 0
                for address, chunk in self._chunks(handle, read):
                    start = 8
                    while (index := chunk.find(suffix, start)) >= 0:
                        pair = by_pointer.get(chunk[index - 8:index])
                        if pair is not None:
                            self.pairs[pair].add(address + index - 8)
                            count += 1
                            if count > 4096:
                                raise _fail("SOURCE_TOO_LARGE", "当前微信密钥配置数量异常，已停止读取。")
                        start = index + 1
            return sorted(self.pairs.get(pattern, ()))

    reader = ScopedReader()
    try:
        keys = reader._extract_keys_pid(proof["pid"], set())
        reader._check_scan()
        _verify_login(proof)
        # Independently enforce the account's exact header whitelist.
        return {relative: key for relative, key in keys.items()
                if relative in reader._headers and primitive._verify_enc_key(key, reader._headers[relative])}
    finally:
        reader._headers.clear()
        reader._db_files.clear()
        reader.needles.clear()
        if reader.pairs is not None:
            reader.pairs.clear()


class LocalDatabaseSource:
    def __init__(self, account_dir, contact_key, login_proof, master, keys=None):
        self.account_dir = Path(account_dir)
        self.account_id = login_proof["username"]
        self.account_label = self.account_id
        self.self_username = self.account_id
        self.login_proof = login_proof
        self.keys = dict(keys or {})
        self.keys["contact/contact.db"] = contact_key
        self.master = master
        self.connections = {}
        self.snapshots = {}
        self.vfs = {}
        self.sealed = False
        self.closed = False
        self.base = (self.account_dir / "db_storage").resolve()
        try:
            contact = self.contacts()
            rows = list(contact.execute("SELECT username,nick_name FROM contact WHERE username=? LIMIT 2",
                                        (self.account_id,)))
            if len(rows) != 1 or not rows[0][0]:
                raise _fail("ACCOUNT_IDENTITY_UNVERIFIED", "当前账号身份无法唯一核对，未读取聊天。")
            self.account_id = self.self_username = str(rows[0][0])
            self.account_label = str(rows[0][1] or self.account_id)
        except BaseException:
            self.close()
            raise

    def _path(self, relative):
        path = (self.base / relative).resolve()
        if not path.is_relative_to(self.base) or not path.is_file():
            raise _fail("SOURCE_INVALID", "本地聊天分片路径无法核对。")
        return path

    def _key_for(self, relative):
        if relative in self.keys:
            return self.keys[relative]
        path = self._path(relative)
        primitive = _primitives()
        with path.open("rb") as handle:
            first = handle.read(PAGE_SIZE)
        if self.master:
            key = primitive._pbkdf2(self.master, first[:16], 256000)
            if primitive._verify_enc_key(key, first):
                self.keys[relative] = key
                return key
        if relative not in self.keys:
            raise _fail("DATABASE_KEY_UNAVAILABLE", "部分聊天或语音分片尚无法在本机读取，请保持微信登录后重试。")
        return self.keys[relative]

    def _relative_shards(self):
        files = []
        for prefix in ("message_", "media_"):
            for path in sorted((self.base / "message").glob(prefix + "*.db")):
                if re.fullmatch(prefix + r"\d+\.db", path.name):
                    files.append("message/" + path.name)
        if len(files) > 128:
            raise _fail("SOURCE_TOO_LARGE", "本地聊天分片超出当前支持范围。")
        return files

    def _open(self, relative):
        if relative not in self.connections:
            snapshot = EncryptedSnapshot(self._path(relative), self._key_for(relative))
            try:
                conn, vfs = open_encrypted_connection(snapshot)
            except BaseException:
                snapshot.close()
                raise
            self.snapshots[relative], self.connections[relative], self.vfs[relative] = snapshot, conn, vfs
        return self.connections[relative]

    def contacts(self): return self._open("contact/contact.db")
    def message_shards(self):
        for relative in self._relative_shards():
            if Path(relative).name.startswith("message_"):
                yield relative, self._open(relative)
    def selected_message_shards(self, labels):
        # Voice enrichment opens only the shards identified during text import.
        # Browser references are intersected with locally discovered names.
        for relative in self._relative_shards():
            if relative in labels and Path(relative).name.startswith("message_"):
                yield relative, self._open(relative)
    def media_shards(self):
        for relative in self._relative_shards():
            if Path(relative).name.startswith("media_"):
                yield relative, self._open(relative)

    def assert_unchanged(self):
        _verify_login(self.login_proof)
        if not self.sealed:
            for snapshot in self.snapshots.values():
                snapshot.assert_unchanged()
            self.sealed = True
        # After all requested bytes have been copied to the bounded capture, new
        # chat arrivals are fine. But the old contact key must still authenticate
        # this exact account and the login process must remain the same.
        contact_path = self._path("contact/contact.db")
        with contact_path.open("rb") as handle:
            first = handle.read(PAGE_SIZE)
        if not _primitives()._verify_enc_key(self.keys["contact/contact.db"], first):
            raise _fail("ACCOUNT_CHANGED", "微信账号校验发生变化，本次读取已停止。")

    def close(self):
        if self.closed:
            return
        self.closed = True
        for conn in self.connections.values():
            conn.close()
        for vfs in self.vfs.values():
            vfs.unregister()
        for snapshot in self.snapshots.values():
            snapshot.close()
        self.connections.clear()
        self.vfs.clear()
        self.snapshots.clear()
        self.keys.clear()
        self.master = None
        self.login_proof = {}


def open_authorized_source():
    state = probe_authorized_source()
    if not state["ready"]:
        raise _fail("BACKGROUND_SOURCE_UNAVAILABLE", state.get("message") or "当前电脑尚不支持本机后台读取。")
    primitive = _primitives()
    process_identity = _running_processes()
    if not process_identity:
        raise _fail("WECHAT_NOT_LOGGED_IN", "请先在电脑微信登录原账号，再开始导入。")
    root = primitive.auto_detect_db_dir()
    if not root:
        raise _fail("DATABASE_NOT_FOUND", "未找到微信本地聊天目录，请先在电脑微信完成同步。")
    contacts = _contact_files(root)
    found = []
    deadline = time.monotonic() + KEY_SCAN_SECONDS
    # Live config supplies both current wxid and master key; do not infer login
    # from whichever old account directory or key cache happens to be readable.
    for pid, created in process_identity:
        if time.monotonic() > deadline:
            raise _fail("KEY_SCAN_TIMEOUT", "本次本机读取准备超时，请稍后重试。")
        try:
            live = primitive.extract_master_key_from_cfg(pid, include_proof=True, deadline=deadline)
        except Exception:
            live = None
        if not live:
            continue
        master_hex, _, username, cfg, fingerprint, root_pointer = live
        if not username or len(username) > 200:
            continue
        master = bytes.fromhex(master_hex)
        proof = {"pid": pid, "created": created, "username": username, "cfg": cfg,
                 "cipherFingerprint": fingerprint, "rootPointer": root_pointer}
        for account_dir, path, _ in contacts:
            name = Path(account_dir).name
            if name != username and not re.fullmatch(re.escape(username) + r"_\w{4}", name):
                continue
            with open(path, "rb") as handle:
                first = handle.read(PAGE_SIZE)
            key = primitive._pbkdf2(master, first[:16], 256000)
            key = key if primitive._verify_enc_key(key, first) else None
            found.append((account_dir, key, proof, master))
    if len(found) != 1:
        code = "ACCOUNT_AMBIGUOUS" if len(found) > 1 else "DATABASE_KEY_UNAVAILABLE"
        message = ("检测到多个可读取账号，无法唯一核对；请保持单一账号登录后重试。" if len(found) > 1 else
                   "当前微信的本机数据库读取校验未通过，本次未读取聊天；助手需要完成兼容适配。")
        raise _fail(code, message)
    account_dir, contact_key, proof, master = found[0]
    _verify_login(proof)
    keys = None
    if contact_key is None:
        keys = _extract_current_account_keys(account_dir, proof, deadline)
        contact_key = keys.get("contact/contact.db")
        if contact_key is None:
            raise _fail("DATABASE_KEY_UNAVAILABLE", "当前微信数据库密钥无法通过本机校验，本次未读取聊天。")
        master = None
    _verify_login(proof)
    return LocalDatabaseSource(account_dir, contact_key, proof, master, keys)
