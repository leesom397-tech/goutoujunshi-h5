# Adapted from wechatauto-replica (Apache-2.0), commit 62503d76a0db069171cb4e42e87090ad285db489.

# Only read-only Windows cryptographic primitives and directory discovery. No constructor, persistence, export, logging, UI, or network code.

from __future__ import annotations

import ctypes

import glob

import hashlib

import hmac as hmac_mod

import json

import os

import queue

import re

import shutil

import sqlite3

import struct

import sys

import tempfile

import threading

import time

import unicodedata

from ctypes import wintypes

from typing import Dict, List, Optional, Tuple

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

PAGE_SZ = 4096

RESERVE_SZ = 80  # IV(16) + HMAC(64)

STAMP_VERSION = 3  # v3: stamp 内 mtime 改用 %r 完整精度（%f 只留 6 位小数，与 Windows 7 位小数比较恒不等→每秒重建缓存→磁盘 50MB/s 读+写）

CONFIG_CIPHER_NAME = b"com.Tencent.WCDB.Config.Cipher"

CONFIG_XOR_MASK = bytes.fromhex(
    "d2c7442458020000004889442450488b"
    "450048844c2448488944254048584c24"
)

HEX_LITERAL_RE = re.compile(rb"[xX]'([0-9a-fA-F]{64,192})'")

MASTER_DLL_PATTERN = bytes.fromhex(
    "83ec404889d64889cb0f57c00f1142100f11024c8bb1c8020000"
    "4883b9d0020000107209488b9bb8020000eb074881c3b8020000"
    "4d85f60f880a0200004983fe10736d4c89761048c746180f0000"
    "000f10030f110648b8"
)

MASTER_DLL_VERIFY = (b"488944242048b8", b"488944242848b8", b"488944243048b8")

CFG_LANDMARK = b"global_config"   # cfg 对象地标字符串(SSO 内联)

CFG_PTR_BACK = 0x138              # 地标前指针链回退偏移(版本敏感: 4.1.10.31=0x130)

CFG_OFFSET = 0x68                 # v18 → cfg 指针偏移(版本敏感)

CFG_DWORD_OFF = 0x40              # cfgDword(图片密钥派生源)

CFG_WXID_OFF = 0x48               # wxId std::string

CFG_CIPHER_OFF = 0x2B8            # dbKey 密文 std::string

MSG_TYPE_NAMES = {
    1: "文本",
    3: "图片",
    34: "语音",
    43: "视频",
    47: "动画表情",
    48: "位置",
    49: "文件/链接/卡片",
    50: "音视频通话",          # <voipmsg> 气泡（如「已拒绝」）
    10000: "系统消息",
    11000: "动画表情",         # 4.x 新版表情码（以复合码低 32 位出现，正文常为空）
    8594229559345: "红包",     # 红包卡片（0x7D100000031，get_moments 等场景会用）
}

class _MBI(ctypes.Structure):
    _fields_ = [
        ("BaseAddress", ctypes.c_void_p),
        ("AllocationBase", ctypes.c_void_p),
        ("AllocationProtect", wintypes.DWORD),
        ("__alignment1", wintypes.DWORD),
        ("RegionSize", ctypes.c_size_t),
        ("State", wintypes.DWORD),
        ("Protect", wintypes.DWORD),
        ("Type", wintypes.DWORD),
        ("__alignment2", wintypes.DWORD),
    ]

class _MODULEENTRY32W(ctypes.Structure):
    _fields_ = [
        ("dwSize", wintypes.DWORD),
        ("th32ModuleID", wintypes.DWORD),
        ("th32ProcessID", wintypes.DWORD),
        ("GlblcntUsage", wintypes.DWORD),
        ("ProccntUsage", wintypes.DWORD),
        ("modBaseAddr", ctypes.c_void_p),
        ("modBaseSize", wintypes.DWORD),
        ("hModule", wintypes.HMODULE),
        ("szModule", ctypes.c_wchar * 256),
        ("szExePath", ctypes.c_wchar * 260),
    ]

_k32 = ctypes.WinDLL("kernel32", use_last_error=True)

_k32.OpenProcess.restype = wintypes.HANDLE

_k32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]

_k32.VirtualQueryEx.argtypes = [
    wintypes.HANDLE, ctypes.c_void_p, ctypes.POINTER(_MBI), ctypes.c_size_t,
]

_k32.VirtualQueryEx.restype = ctypes.c_size_t

_k32.ReadProcessMemory.argtypes = [
    wintypes.HANDLE, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_size_t,
    ctypes.POINTER(ctypes.c_size_t),
]

def _pbkdf2(passwd: bytes, salt: bytes, iters: int) -> bytes:
    return hashlib.pbkdf2_hmac("sha512", passwd, salt, iters, dklen=32)

def _aes_cbc_decrypt(key: bytes, iv: bytes, data: bytes) -> bytes:
    dec = Cipher(algorithms.AES(key), modes.CBC(iv)).decryptor()
    return dec.update(data) + dec.finalize()

def _split_key(key: bytes) -> Tuple[bytes, Optional[bytes]]:
    """拆分密钥形态：32 字节 = 标准裸 key（salt 用文件头前 16 字节）；
    48 字节 = SQLCipher 4 "Raw Key with Explicit Salt"（前 32B key + 后 16B salt，
    用于 cipher_plaintext_header_size 明文头模式）。返回 (enc_key, salt_or_None)。"""
    if len(key) == 48:
        return key[:32], key[32:]
    return key, None

def _verify_enc_key(enc_key: bytes, page1: bytes, salt: Optional[bytes] = None) -> bool:
    """验证 enc_key 是否为 page1 的 SQLCipher 4 密钥。

    - enc_key 为 32 字节裸 key：默认用文件头前 16 字节作 salt（标准形式）；
    - enc_key 为 48 字节 key+salt：显式 salt 优先于文件头（明文头模式）；
    - 也允许单独传 salt 参数覆盖（供提取逻辑按 96hex 拆分尝试）。
    """
    if len(page1) < PAGE_SZ:
        return False
    if len(enc_key) == 48 and salt is None:
        enc_key, salt = enc_key[:32], enc_key[32:]
    if salt is None:
        salt = page1[:16]
    elif len(salt) != 16:
        return False
    mac_salt = bytes(b ^ 0x3A for b in salt)
    mac_key = _pbkdf2(enc_key, mac_salt, 2)
    hmac_data = page1[16: PAGE_SZ - RESERVE_SZ + 16]
    stored_hmac = page1[PAGE_SZ - 64: PAGE_SZ]
    hm = hmac_mod.new(mac_key, hmac_data, hashlib.sha512)
    hm.update(struct.pack("<I", 1))
    return hm.digest() == stored_hmac

def _find_weixin_module(pid: int) -> Optional[Tuple[int, int, str]]:
    """返回 (模块基址, 模块大小, 路径); weixin.dll 为微信 4.x 主模块"""
    k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    k32.CreateToolhelp32Snapshot.restype = ctypes.c_void_p
    k32.CreateToolhelp32Snapshot.argtypes = [wintypes.DWORD, wintypes.DWORD]
    k32.CloseHandle.argtypes = [ctypes.c_void_p]
    k32.Module32FirstW.argtypes = [ctypes.c_void_p, ctypes.POINTER(_MODULEENTRY32W)]
    k32.Module32NextW.argtypes = [ctypes.c_void_p, ctypes.POINTER(_MODULEENTRY32W)]
    snap = k32.CreateToolhelp32Snapshot(0x08 | 0x10, pid)
    if not snap or snap == -1 or snap == (1 << 64) - 1:
        return None
    try:
        me = _MODULEENTRY32W()
        me.dwSize = ctypes.sizeof(me)
        ok = k32.Module32FirstW(snap, ctypes.byref(me))
        while ok:
            if me.szModule and me.szModule.lower() == "weixin.dll":
                return (me.modBaseAddr or 0), me.modBaseSize, me.szExePath
            me.dwSize = ctypes.sizeof(me)
            ok = k32.Module32NextW(snap, ctypes.byref(me))
    finally:
        k32.CloseHandle(snap)
    return None

def _extract_movabs_xor_key(dll_path: str, deadline=None) -> Optional[bytes]:
    """从 weixin.dll 特征码后提取 4×movabs 立即数拼接成 32 字节 XOR 材料。

    特征码(sub_1803308D0 前缀)后紧跟 4 个 '48 b8 <imm64>' movabs 指令,
    立即数即主密钥的 XOR 材料。小版本通常不改此代码段, 大版本需重采。
    """
    import mmap
    try:
        if deadline is not None and time.monotonic() > deadline:
            return None
        if not 0 < os.path.getsize(dll_path) <= 512 * 1024 * 1024:
            return None
        with open(dll_path, "rb") as f, mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ) as data:
            hit = data.find(MASTER_DLL_PATTERN)
            if hit < 0:
                return None
            take = min(200, len(data) - hit)
            hex_txt = data[hit:hit + take].hex()
        if deadline is not None and time.monotonic() > deadline:
            return None
    except (OSError, ValueError):
        return None
    hex_txt = hex_txt[len(MASTER_DLL_PATTERN) * 2:]  # 丢弃特征码自身
    key = ""
    for vf in MASTER_DLL_VERIFY:
        if len(hex_txt) < 30 or hex_txt[16:30] != vf.decode():
            return None
        key += hex_txt[0:16]
        hex_txt = hex_txt[30:]
    if len(hex_txt) < 16:
        return None
    key += hex_txt[0:16]
    try:
        return bytes.fromhex(key)
    except ValueError:
        return None

def _read_remote_string(h, read, addr: int) -> str:
    """跨进程读 MSVC x64 std::string(SSO: size<=15 内联, 否则堆指针)"""
    sz_buf = read(addr + 16, 8)
    if not sz_buf:
        return ""
    size = struct.unpack_from("<Q", sz_buf)[0]
    if size <= 0 or size > 512:
        return ""
    if size <= 15:
        data = read(addr, size)
    else:
        p_buf = read(addr, 8)
        if not p_buf:
            return ""
        data = read(struct.unpack_from("<Q", p_buf)[0], size)
    if not data:
        return ""
    return data[:size].decode("utf-8", "replace")

def _read_remote_bytes(h, read, addr: int) -> Optional[bytes]:
    """跨进程读字节缓冲(std::string 布局: data@+0, size@+16, cap@+24)"""
    sz_buf = read(addr + 16, 8)
    if not sz_buf:
        return None
    size = struct.unpack_from("<Q", sz_buf)[0]
    if size <= 0 or size > 0x400:
        return None
    cap_buf = read(addr + 24, 4)
    cap = struct.unpack_from("<I", cap_buf)[0] if cap_buf else 0
    if (cap | 0xF) == 0xF:
        data = read(addr, size)          # SSO 内联
    else:
        p_buf = read(addr, 8)
        if not p_buf:
            return None
        data = read(struct.unpack_from("<Q", p_buf)[0], size)
    if not data or len(data) != size:
        return None
    return data[:size]

def extract_master_key_from_cfg(pid: int, include_proof: bool = False, deadline=None):
    """从 Weixin.exe 进程提取 (主密钥hex, cfgDword, wxId)。

    流程(ReadWeixinKey-rev 同源): 整块读 weixin.dll 映像 → 扫 global_config
    SSO 地标 → 指针链 cfg → 读 cfg+0x2B8 密文与 cfg+0x40 cfgDword →
    密文 XOR DLL movabs 材料得主密钥。锚点(CFG_PTR_BACK/CFG_OFFSET/特征码)
    每版本重采; 提取失败返回 None。
    """
    base, mod_size, dll_path = _find_weixin_module(pid) or (0, 0, "")
    if not base or not dll_path or mod_size <= 0 or mod_size > 512 * 1024 * 1024:
        return None
    h = _k32.OpenProcess(0x0010 | 0x0400, False, pid)
    if not h:
        return None
    try:
        def read(addr: int, n: int):
            if not 0 < n <= 8 * 1024 * 1024 or (deadline is not None and time.monotonic() > deadline):
                return None
            buf = ctypes.create_string_buffer(n)
            br = ctypes.c_size_t(0)
            if _k32.ReadProcessMemory(h, ctypes.c_void_p(addr), buf, n, ctypes.byref(br)) and br.value:
                return buf.raw[: br.value]
            return None

        image = bytearray()
        for offset in range(0, mod_size, 8 * 1024 * 1024):
            size = min(mod_size - offset, 8 * 1024 * 1024)
            chunk = read(base + offset, size)
            if not chunk or len(chunk) != size:
                return None
            image.extend(chunk)
        # 扫 global_config SSO 地标(size==13@+16, cap==15@+24, 内容内联@+0)
        pos = -1
        search_end = len(image)
        while search_end:
            if deadline is not None and time.monotonic() > deadline:
                return None
            found = image.rfind(CFG_LANDMARK, 0, search_end)
            if found < 0:
                break
            i = found + 16
            if i + 12 <= len(image) and i % 8 == 0:
                cap = struct.unpack_from("<I", image, i + 8)[0]
                if struct.unpack_from("<I", image, i)[0] == len(CFG_LANDMARK) and cap and (cap | 0xF) == 0xF:
                    pos = i
                    break
            search_end = found
        if pos < 0:
            return None
        # 指针链: v18 = *(base + pos - CFG_PTR_BACK); cfg = *(v18 + CFG_OFFSET)
        v18_buf = read(base + pos - CFG_PTR_BACK, 8)
        if not v18_buf:
            return None
        v18 = struct.unpack_from("<Q", v18_buf)[0]
        cfg_buf = read(v18 + CFG_OFFSET, 8)
        if not cfg_buf:
            return None
        cfg = struct.unpack_from("<Q", cfg_buf)[0]
        if not (0x10000 <= cfg < 0x800000000000):
            return None
        # cfgDword + wxId
        dw_buf = read(cfg + CFG_DWORD_OFF, 4)
        cfg_dword = struct.unpack_from("<I", dw_buf)[0] if dw_buf else 0
        wxid = _read_remote_string(h, read, cfg + CFG_WXID_OFF)
        # dbKey 密文
        cipher = _read_remote_bytes(h, read, cfg + CFG_CIPHER_OFF)
        if not cipher:
            return None
        material = _extract_movabs_xor_key(dll_path, deadline=deadline)
        if not material or len(material) != len(cipher):
            return None
        master = bytes(a ^ b for a, b in zip(cipher, material))
        if include_proof:
            return master.hex(), cfg_dword, wxid, cfg, hashlib.sha256(cipher).digest(), base + pos - CFG_PTR_BACK
        return master.hex(), cfg_dword, wxid
    finally:
        _k32.CloseHandle(h)

def _decrypt_page(enc_key: bytes, page: bytes, pgno: int) -> bytes:
    iv = page[PAGE_SZ - RESERVE_SZ: PAGE_SZ - RESERVE_SZ + 16]
    if pgno == 1:
        # 48 字节 key（key+salt）= cipher_plaintext_header_size 明文头模式：
        # 页 1 前 16 字节是明文头（非加密 salt），加密数据从 offset 16 开始；
        # 解密后拼接明文头 + 明文数据 + reserve。
        if len(enc_key) == 48:
            enc = page[16: PAGE_SZ - RESERVE_SZ]
            return page[:16] + _aes_cbc_decrypt(enc_key[:32], iv, enc) + b"\x00" * RESERVE_SZ
        enc = page[16: PAGE_SZ - RESERVE_SZ]
        return b"SQLite format 3\x00" + _aes_cbc_decrypt(enc_key, iv, enc) + b"\x00" * RESERVE_SZ
    enc = page[: PAGE_SZ - RESERVE_SZ]
    return _aes_cbc_decrypt(enc_key[:32] if len(enc_key) == 48 else enc_key, iv, enc) + b"\x00" * RESERVE_SZ

_ZSTD_MODULE = None

def _find_account_dirs(db_dir: str) -> List[str]:
    """列出 db_dir 下所有含 db_storage 子目录的账号目录。

    微信号目录不一定以 wxid_ 开头（如自定义微信号），这里只依赖
    db_storage 子目录的存在性判断。
    """
    out = []
    try:
        for name in os.listdir(db_dir):
            p = os.path.join(db_dir, name, "db_storage")
            if os.path.isdir(p):
                out.append(os.path.join(db_dir, name))
    except OSError:
        pass
    return sorted(out)


_LISTENER_STOP = object()

def _extract_path_from_config(content: str) -> Optional[str]:
    """从配置内容中提取数据目录路径，兼容 JSON 字段 / 纯路径 / 任意文本。

    微信 4.x 不同版本配置文件格式不一：有的是纯路径，有的是 JSON
    （字段如 dataDir / fileSavePath）。这里统一兜底提取第一个 Windows 路径。
    """
    content = (content or "").strip().lstrip("\ufeff")
    if not content:
        return None
    try:
        obj = json.loads(content)
        if isinstance(obj, dict):
            for key in ("dataDir", "data_dir", "fileSavePath", "savePath",
                        "path", "defaultFileSavePath"):
                v = obj.get(key)
                if isinstance(v, str) and v.strip():
                    return v.strip()
        elif isinstance(obj, list):
            for item in obj:
                if isinstance(item, str) and re.match(r"^[A-Za-z]:[\\/]", item):
                    return item
    except Exception:
        pass
    if re.match(r"^[A-Za-z]:[\\/]", content):
        return content
    m = re.search(r"[A-Za-z]:[\\/][^\s\x00-\x1f\"']+", content)
    if m:
        return _abs_root(m.group(0))        # 不能用 rstrip：'d:\\' 会变成 'd:'（盘符相对）
    return None

def _config_candidates() -> List[str]:
    """可能的微信 4.x 配置目录（按新旧版本与 32/64 位安装差异）。"""
    out = []
    for env in ("APPDATA", "LOCALAPPDATA"):
        base = os.environ.get(env, "")
        if base:
            out.extend([
                os.path.join(base, "Tencent", "xwechat"),
                os.path.join(base, "Tencent", "xwechat", "config"),
                os.path.join(base, "Tencent", "WeChat"),
            ])
    return out

def _registry_data_dirs() -> List[str]:
    """从注册表读取可能指向数据目录的值（用户自定义保存位置时补充来源）。"""
    import winreg
    dirs = []
    for hive, sub in (
        (winreg.HKEY_CURRENT_USER, r"Software\Tencent\xwechat"),
        (winreg.HKEY_CURRENT_USER, r"Software\Tencent\xwechat\config"),
        (winreg.HKEY_CURRENT_USER, r"Software\Tencent\WeChat"),
    ):
        try:
            key = winreg.OpenKey(hive, sub)
        except OSError:
            continue
        try:
            i = 0
            while True:
                try:
                    name, data, _ = winreg.EnumValue(key, i)
                except OSError:
                    break
                i += 1
                if not isinstance(data, str) or not data.strip():
                    continue
                low = name.lower()
                if "path" in low or "dir" in low or "save" in low:
                    dirs.append(data.strip())
        finally:
            winreg.CloseKey(key)
    return dirs

def _abs_root(path: str) -> str:
    """把目录路径规范化成绝对路径，尤其修好「盘符根目录」这一类。

    以前这里用 ``rstrip("\\\\/")`` 去掉尾分隔符，于是 ``d:\\`` 变成 ``d:`` ——
    而 ``d:`` 在 Windows 上是**盘符相对路径**（相对该盘当前目录），
    ``os.path.join('d:', 'xwechat_files')`` 得到 ``d:xwechat_files``，会按进程在
    D 盘的当前目录解析：从 ``D:\\`` 启动恰好对，从 ``D:\\某个子目录`` 启动就找错地方
    （issue #32）。normpath 保留根目录语义；再补一手「只写了盘符没写分隔符」的输入。
    """
    p = os.path.normpath(path or "")
    if re.match(r"^[A-Za-z]:$", p):          # "d:" 这种盘符相对写法
        p = p + os.sep
    return p

def _locate_account_root(root: Optional[str]) -> Optional[str]:
    """在候选根目录下定位「包含账号目录」的目录。

    账号目录以含 db_storage 子目录为准（微信号不一定以 wxid_ 开头）。
    兼容两种布局：
      <root>/xwechat_files/<account>/db_storage
      <root>/<account>/db_storage
    返回的目录即 WeChatDB.db_dir（账号目录的父目录）。
    """
    if not root or not os.path.isdir(root):
        return None
    root = _abs_root(root)
    candidates = [root]
    for name in ("xwechat_files", "WeChat Files", "xwechat_files_data"):
        candidates.append(os.path.join(root, name))
    seen = set()
    for cand in candidates:
        cand = _abs_root(cand)
        if cand in seen or not os.path.isdir(cand):
            continue
        seen.add(cand)
        try:
            dirs = os.listdir(cand)
        except OSError:
            continue
        if any(
            os.path.isdir(os.path.join(cand, d, "db_storage"))
            for d in dirs
        ):
            return cand
    return None

def auto_detect_db_dir() -> Optional[str]:
    """自动定位微信 4.x 数据目录（不同电脑存储位置不同）。

    探测顺序：
      1. 微信配置文件（%APPDATA%/%LOCALAPPDATA%，支持 JSON/纯路径/任意文本）；
      2. 注册表；
      3. 常见默认目录（Documents / 用户主目录）。
    """
    # 1) 配置文件
    for cfg_dir in _config_candidates():
        if not os.path.isdir(cfg_dir):
            continue
        for fp in glob.glob(os.path.join(cfg_dir, "*")):
            if os.path.isdir(fp):
                continue
            try:
                raw = open(fp, "r", encoding="utf-8").read(8192)
            except (UnicodeDecodeError, OSError):
                try:
                    raw = open(fp, "r", encoding="gbk").read(8192)
                except (UnicodeDecodeError, OSError):
                    continue
            path = _extract_path_from_config(raw)
            if not path:
                continue
            hit = _locate_account_root(path)
            if hit:
                return hit
    # 2) 注册表
    for p in _registry_data_dirs():
        hit = _locate_account_root(p)
        if hit:
            return hit
    # 3) 常见默认目录兜底
    userprofile = os.environ.get("USERPROFILE", "")
    for base in (os.path.join(userprofile, "Documents"), userprofile):
        hit = _locate_account_root(base)
        if hit:
            return hit
    return None


class ConfigKeyReader:

    def _extract_keys_pid(self, pid: int, tested: set) -> Dict[str, bytes]:
        h = _k32.OpenProcess(0x0010 | 0x0400, False, pid)
        if not h:
            return {}
        try:
            def read(addr: int, n: int):
                if hasattr(self, "_check_scan"):
                    self._check_scan()
                if not 0 < n <= 8 * 1024 * 1024:
                    return None
                buf = ctypes.create_string_buffer(n)
                br = ctypes.c_size_t(0)
                if _k32.ReadProcessMemory(h, ctypes.c_void_p(addr), buf, n, ctypes.byref(br)) and br.value:
                    return buf.raw[: br.value]
                return None

            needles = self._find_bytes(h, read, CONFIG_CIPHER_NAME)
            pairs = [
                struct.pack("<Q", addr) + struct.pack("<Q", len(CONFIG_CIPHER_NAME))
                for addr in needles
            ]
            keys: Dict[str, bytes] = {}
            for pair in pairs:
                for qaddr in self._find_bytes(h, read, pair):
                    if hasattr(self, "_check_scan"):
                        self._check_scan()
                    node = read(qaddr - 0x10, 0x50)
                    if not node or len(node) < 0x40:
                        continue
                    if struct.unpack_from("<Q", node, 0x10)[0] not in needles:
                        continue
                    if struct.unpack_from("<Q", node, 0x18)[0] != len(CONFIG_CIPHER_NAME):
                        continue
                    config_ptr = struct.unpack_from("<Q", node, 0x28)[0]
                    if not (0x10000 <= config_ptr < 0x800000000000):
                        continue
                    obj = read(config_ptr + 0x88, 0x28)
                    if not obj or len(obj) < 0x18:
                        continue
                    data_ptr = struct.unpack_from("<Q", obj, 0x8)[0]
                    data_len = struct.unpack_from("<Q", obj, 0x10)[0]
                    if not (0 < data_len <= 1024 and 0x10000 <= data_ptr < 0x800000000000):
                        continue
                    blob = read(data_ptr, int(data_len))
                    if not blob or len(blob) != data_len:
                        continue
                    decoded = bytes(
                        v ^ CONFIG_XOR_MASK[i % len(CONFIG_XOR_MASK)]
                        for i, v in enumerate(blob)
                    )
                    for m in HEX_LITERAL_RE.finditer(decoded):
                        run = m.group(1).decode().lower()
                        starts = [0]
                        if len(run) > 96:
                            starts += list(range(0, len(run) - 63, 32))
                            starts.append(len(run) - 64)
                        for s in dict.fromkeys(starts):
                            if s + 64 > len(run):
                                continue
                            cand = bytes.fromhex(run[s:s + 64])
                            if not self._probable_key(cand):
                                continue
                            # 96hex 形式：后 32 hex 是显式 salt（Raw Key with
                            # Explicit Salt），与文件头 salt 都要尝试
                            explicit = None
                            if s + 96 <= len(run):
                                explicit = bytes.fromhex(run[s + 64: s + 96])
                            salt_choices = [None]
                            if explicit:
                                salt_choices.append(explicit)
                            for salt_opt in salt_choices:
                                candidate_identity = (cand, salt_opt)
                                if candidate_identity in tested:
                                    continue
                                tested.add(candidate_identity)
                                for rel, path, _ in self._db_files:
                                    if rel in keys:
                                        continue
                                    page1 = self._headers[rel]
                                    if _verify_enc_key(cand, page1, salt=salt_opt):
                                        # 显式 salt 通过 → 存 key+salt（明文头模式）；
                                        # 文件头 salt 通过 → 存裸 key
                                        keys[rel] = cand + (salt_opt or b"")
        finally:
            _k32.CloseHandle(h)
        return keys

    @staticmethod
    def _probable_key(b: bytes) -> bool:
        return (
            len(b) == 32
            and len(set(b)) >= 15
            and b not in {b"\x00" * 32, b"\xff" * 32}
        )
