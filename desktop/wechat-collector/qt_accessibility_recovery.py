"""Fail-closed recovery of the Qt accessibility flag in an owned WeChat window.

Gate signature and RIP-reference technique adapted from wechatauto-replica,
Apache-2.0, commit d322c4a9b1124228820bab363e5676016f188fc6. See
vendor/WECHATAUTO_ACCESSIBILITY_NOTICE.md and its accompanying license.
Changed: unique structural match, PE/function/memory validation, no fallback
addresses, no system settings, no candidate probing, mandatory UIA verification.

Import and scan_file() are read-only and portable. Only the explicit recover
entry point can change one runtime data byte; it never modifies the DLL on disk.
"""
from __future__ import annotations

import hashlib
import logging
import os
import re
import struct
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

_LOG = logging.getLogger(__name__)
_LOCK = threading.Lock()
_TRANSACTION_GUARD = None
_EXECUTE, _READ, _WRITE = 0x20000000, 0x40000000, 0x80000000
_CORE = b"qt.accessibility.core\0"
_GATE = re.compile(rb"\x48\x85\xc9\x0f\x84....\x80\x3d....\x00\x0f\x84....", re.S)
_LEA = re.compile(rb"[\x48-\x4f]\x8d[\x05\x0d\x15\x1d\x25\x2d\x35\x3d]....", re.S)
_MAX_CORE_DISTANCE = 0x4000


class UnsupportedGate(ValueError):
    """The binary does not provide enough evidence for exactly one flag."""


class AccessibilityRollbackError(RuntimeError):
    """The original byte could not be restored and verified; stop recovery."""


@dataclass(frozen=True)
class Section:
    rva: int
    virtual_size: int
    raw_size: int
    raw_offset: int
    flags: int


@dataclass(frozen=True)
class GatePlan:
    path: str
    sha256: str
    image_size: int
    header: bytes
    gate_rva: int
    instruction_rva: int
    instruction: bytes
    core_rva: int
    core_xref_rva: int
    core_xref: bytes
    function_start: int
    function_end: int


class _Image:
    def __init__(self, data: bytes):
        self.data = data
        if len(data) < 0x100 or data[:2] != b"MZ":
            raise UnsupportedGate("invalid DOS header")
        pe = struct.unpack_from("<I", data, 0x3C)[0]
        if pe < 0x40 or pe + 24 > len(data) or data[pe:pe + 4] != b"PE\0\0":
            raise UnsupportedGate("invalid PE header")
        machine, count = struct.unpack_from("<HH", data, pe + 4)
        optional_size = struct.unpack_from("<H", data, pe + 20)[0]
        optional = pe + 24
        table = optional + optional_size
        if machine != 0x8664 or not 1 <= count <= 96 or optional_size < 144 or table + count * 40 > len(data):
            raise UnsupportedGate("expected bounded x64 PE")
        if struct.unpack_from("<H", data, optional)[0] != 0x20B:
            raise UnsupportedGate("expected PE32+")
        self.image_size = struct.unpack_from("<I", data, optional + 56)[0]
        if not 0x1000 < self.image_size < 0x80000000:
            raise UnsupportedGate("invalid image size")
        self.sections = []
        for index in range(count):
            offset = table + index * 40
            vs, va, rs, rp = struct.unpack_from("<IIII", data, offset + 8)
            flags = struct.unpack_from("<I", data, offset + 36)[0]
            if va + max(vs, rs) > self.image_size or rp + rs > len(data):
                raise UnsupportedGate("section outside image")
            section = Section(va, vs, rs, rp, flags)
            for other in self.sections:
                if max(va, other.rva) < min(va + max(vs, rs), other.rva + max(other.virtual_size, other.raw_size)):
                    raise UnsupportedGate("overlapping sections")
                if rs and other.raw_size and max(rp, other.raw_offset) < min(rp + rs, other.raw_offset + other.raw_size):
                    raise UnsupportedGate("overlapping raw sections")
            self.sections.append(section)
        self.header = data[:table + count * 40]
        if struct.unpack_from("<I", data, optional + 108)[0] < 4:
            raise UnsupportedGate("missing exception directory")
        exception_rva, self.exception_size = struct.unpack_from("<II", data, optional + 112 + 3 * 8)
        exception_section = self.section(exception_rva, self.exception_size)
        if not self.exception_size or self.exception_size % 12 or exception_section.flags & (_WRITE | _EXECUTE):
            raise UnsupportedGate("invalid function directory")
        self.exception_offset = self.offset(exception_rva, self.exception_size)
        # Validate ordering once. Function lookup below is logarithmic.
        last_end = 0
        for offset in range(self.exception_offset, self.exception_offset + self.exception_size, 12):
            begin, end, unwind = struct.unpack_from("<III", data, offset)
            if not last_end <= begin < end <= self.image_size or not unwind < self.image_size:
                raise UnsupportedGate("ambiguous function directory")
            last_end = end

    def section(self, rva, length=1):
        matches = [s for s in self.sections if s.rva <= rva and rva + length <= s.rva + max(s.virtual_size, s.raw_size)]
        if len(matches) != 1 or length <= 0:
            raise UnsupportedGate("unmapped range")
        return matches[0]

    def offset(self, rva, length=1):
        section = self.section(rva, length)
        relative = rva - section.rva
        if relative + length > section.raw_size:
            raise UnsupportedGate("range not backed by file")
        return section.raw_offset + relative

    def function(self, rva):
        low, high = 0, self.exception_size // 12
        while low < high:
            middle = (low + high) // 2
            begin, end, _ = struct.unpack_from("<III", self.data, self.exception_offset + middle * 12)
            if rva < begin:
                high = middle
            elif rva >= end:
                low = middle + 1
            else:
                return begin, end
        raise UnsupportedGate("instruction lacks function boundary")


def scan_bytes(data: bytes, path="") -> GatePlan:
    """Identify one structural candidate without touching any running process."""
    image = _Image(data)
    core_offsets = [m.start() for m in re.finditer(re.escape(_CORE), data)]
    if len(core_offsets) != 1:
        raise UnsupportedGate("accessibility category must be unique")
    core_offset = core_offsets[0]
    core_sections = [s for s in image.sections if s.raw_offset <= core_offset and core_offset + len(_CORE) <= s.raw_offset + s.raw_size]
    if len(core_sections) != 1 or core_sections[0].flags & (_WRITE | _EXECUTE) or not core_sections[0].flags & _READ:
        raise UnsupportedGate("accessibility category must be read-only")
    core_rva = core_sections[0].rva + core_offset - core_sections[0].raw_offset
    xrefs, candidates = [], []
    for section in image.sections:
        if not section.flags & _EXECUTE or section.flags & _WRITE:
            continue
        start, end = section.raw_offset, section.raw_offset + section.raw_size
        for match in _LEA.finditer(data, start, end):
            rva = section.rva + match.start() - start
            if rva + 7 + struct.unpack_from("<i", match.group(), 3)[0] == core_rva:
                try:
                    begin, finish = image.function(rva)
                except UnsupportedGate:
                    continue
                if rva + 7 <= finish:
                    xrefs.append((rva, match.group()))
        for match in _GATE.finditer(data, start, end):
            rva = section.rva + match.start() - start
            instruction = match.group()
            target = rva + 16 + struct.unpack_from("<i", instruction, 11)[0]
            try:
                target_section = image.section(target)
                begin, finish = image.function(rva)
            except UnsupportedGate:
                continue
            branch_null = rva + 9 + struct.unpack_from("<i", instruction, 5)[0]
            branch_gate = rva + 22 + struct.unpack_from("<i", instruction, 18)[0]
            if (not target_section.flags & _WRITE or not target_section.flags & _READ or target_section.flags & _EXECUTE
                    or rva - begin > 0x80 or branch_null != branch_gate
                    or not rva + 22 <= branch_gate < finish):
                continue
            candidates.append((rva, target, instruction, begin, finish))
    strong = []
    for candidate in candidates:
        near = [(rva, code) for rva, code in xrefs if abs(rva - candidate[0]) <= _MAX_CORE_DISTANCE
                and image.section(rva) == image.section(candidate[0])]
        if near:
            strong.append((candidate, min(near, key=lambda item: abs(item[0] - candidate[0]))))
    if len(strong) != 1:
        raise UnsupportedGate("expected exactly one structurally anchored gate")
    (rva, target, instruction, begin, finish), (xref, xref_code) = strong[0]
    return GatePlan(str(path), hashlib.sha256(data).hexdigest(), image.image_size, image.header,
                    target, rva, instruction, core_rva, xref, xref_code, begin, finish)


def scan_file(path) -> GatePlan:
    path = Path(path).resolve(strict=True)
    with path.open("rb") as stream:
        before = os.fstat(stream.fileno())
        if before.st_size > 512 * 1024 * 1024:
            raise UnsupportedGate("image exceeds scan bound")
        data = stream.read()
        after = os.fstat(stream.fileno())
    if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
        raise UnsupportedGate("image changed while scanning")
    return scan_bytes(data, path)


def bind_transaction_guard(guard):
    """Bind the owning capture process's private cancellation guard."""
    global _TRANSACTION_GUARD
    _TRANSACTION_GUARD = guard


def _recover(target, plan: GatePlan, verify: Callable[[], bool]) -> bool:
    # File scanning is deliberately outside this region. The parent acquires
    # the same lock before terminating this worker, so a user cancellation
    # cannot interrupt a write/verification/rollback transaction.
    if _TRANSACTION_GUARD is None:
        return _recover_transaction(target, plan, verify)
    with _TRANSACTION_GUARD:
        return _recover_transaction(target, plan, verify)


def _recover_transaction(target, plan: GatePlan, verify: Callable[[], bool]) -> bool:
    """Transaction isolated from Windows bindings for synthetic memory tests."""
    target.validate(plan)
    original = target.read(plan.gate_rva, 1)
    if original not in (b"\0", b"\1"):
        return False
    if original == b"\1":
        return verify() is True and target.same_window()
    attempted, accepted = False, False
    try:
        target.validate(plan)  # Recheck mapping/protection/instructions immediately before write.
        if target.read(plan.gate_rva, 1) != original:
            return False
        attempted = True  # A partial/failed OS write must also be rolled back.
        target.write(plan.gate_rva, b"\1")
        if target.read(plan.gate_rva, 1) != b"\1":
            return False
        accepted = verify() is True and target.same_window() and target.read(plan.gate_rva, 1) == b"\1"
        return accepted
    finally:
        if attempted and not accepted:
            try:
                target.write(plan.gate_rva, original)
                if target.read(plan.gate_rva, 1) != original:
                    raise OSError("rollback readback differs")
            except Exception as error:
                raise AccessibilityRollbackError("Qt accessibility flag rollback could not be verified") from error


class _WindowsTarget:
    def __init__(self, hwnd):
        import ctypes as c
        from ctypes import wintypes as w
        import win32api
        self.c, self.w, self.hwnd = c, w, int(hwnd)
        self.kernel = c.WinDLL("kernel32", use_last_error=True)
        self.user = c.WinDLL("user32", use_last_error=True)
        self.user.GetWindowThreadProcessId.argtypes = [w.HWND, c.POINTER(w.DWORD)]
        self.user.GetWindowThreadProcessId.restype = w.DWORD
        self.kernel.OpenProcess.argtypes = [w.DWORD, w.BOOL, w.DWORD]
        self.kernel.OpenProcess.restype = w.HANDLE
        self.kernel.CloseHandle.argtypes = [w.HANDLE]
        self.kernel.CloseHandle.restype = w.BOOL
        self.kernel.QueryFullProcessImageNameW.argtypes = [w.HANDLE, w.DWORD, w.LPWSTR, c.POINTER(w.DWORD)]
        self.kernel.QueryFullProcessImageNameW.restype = w.BOOL
        self.pid = self._pid()
        if not self.pid:
            raise UnsupportedGate("window has no process")
        self.handle = self.kernel.OpenProcess(0x0400 | 0x0010 | 0x0020 | 0x0008, False, self.pid)
        if not self.handle:
            raise OSError("cannot open accessibility process")
        try:
            buffer, size = c.create_unicode_buffer(32768), w.DWORD(32768)
            if not self.kernel.QueryFullProcessImageNameW(self.handle, 0, buffer, c.byref(size)):
                raise OSError("cannot identify executable")
            self.exe = Path(buffer.value).resolve(strict=True)
            if self.exe.name.lower() != "weixin.exe":
                raise UnsupportedGate("unexpected executable")
            self.base, self.size, self.path = self._module()
            if self.path.name.lower() != "weixin.dll" or self.exe.parent not in self.path.parents:
                raise UnsupportedGate("module is outside the running installation")
            for binary in (self.exe, self.path):
                version = win32api.GetFileVersionInfo(str(binary), "\\")
                major, minor = version["FileVersionMS"] >> 16, version["FileVersionMS"] & 0xFFFF
                if major != 4 or minor < 2:
                    raise UnsupportedGate("unsupported version family")
        except BaseException:
            self.close()
            raise

    def _pid(self):
        value = self.w.DWORD()
        self.user.GetWindowThreadProcessId(self.hwnd, self.c.byref(value))
        return value.value

    def same_window(self):
        return self._pid() == self.pid

    def _module(self):
        c, w, kernel = self.c, self.w, self.kernel
        class Entry(c.Structure):
            _fields_ = [("dwSize", w.DWORD), ("th32ModuleID", w.DWORD), ("th32ProcessID", w.DWORD),
                        ("GlblcntUsage", w.DWORD), ("ProccntUsage", w.DWORD), ("modBaseAddr", c.c_void_p),
                        ("modBaseSize", w.DWORD), ("hModule", w.HMODULE), ("szModule", w.WCHAR * 256),
                        ("szExePath", w.WCHAR * 260)]
        kernel.CreateToolhelp32Snapshot.argtypes = [w.DWORD, w.DWORD]
        kernel.CreateToolhelp32Snapshot.restype = w.HANDLE
        for name in ("Module32FirstW", "Module32NextW"):
            getattr(kernel, name).argtypes = [w.HANDLE, c.POINTER(Entry)]
            getattr(kernel, name).restype = w.BOOL
        snapshot = kernel.CreateToolhelp32Snapshot(0x08 | 0x10, self.pid)
        if snapshot == c.c_void_p(-1).value:
            raise OSError("module enumeration failed")
        found = []
        try:
            entry = Entry(); entry.dwSize = c.sizeof(entry)
            present = kernel.Module32FirstW(snapshot, c.byref(entry))
            while present:
                if entry.szModule.lower() == "weixin.dll":
                    found.append((int(entry.modBaseAddr), int(entry.modBaseSize), Path(entry.szExePath).resolve(strict=True)))
                present = kernel.Module32NextW(snapshot, c.byref(entry))
        finally:
            kernel.CloseHandle(snapshot)
        if len(found) != 1:
            raise UnsupportedGate("expected one loaded Weixin.dll")
        return found[0]

    def read(self, rva, length):
        c, w = self.c, self.w
        if not 0 <= rva < rva + length <= self.size:
            raise UnsupportedGate("read outside mapped image")
        function = self.kernel.ReadProcessMemory
        function.argtypes = [w.HANDLE, c.c_void_p, c.c_void_p, c.c_size_t, c.POINTER(c.c_size_t)]
        function.restype = w.BOOL
        buffer, count = c.create_string_buffer(length), c.c_size_t()
        if not function(self.handle, self.base + rva, buffer, length, c.byref(count)) or count.value != length:
            raise OSError("accessibility memory read failed")
        return buffer.raw

    def write(self, rva, value):
        c, w = self.c, self.w
        if len(value) != 1 or value not in (b"\0", b"\1") or not 0 <= rva < self.size:
            raise UnsupportedGate("only one Boolean data byte is permitted")
        function = self.kernel.WriteProcessMemory
        function.argtypes = [w.HANDLE, c.c_void_p, c.c_void_p, c.c_size_t, c.POINTER(c.c_size_t)]
        function.restype = w.BOOL
        buffer, count = c.create_string_buffer(value), c.c_size_t()
        if not function(self.handle, self.base + rva, buffer, 1, c.byref(count)) or count.value != 1:
            raise OSError("accessibility flag write failed")

    def validate(self, plan):
        c, w = self.c, self.w
        if not self.same_window() or self._module() != (self.base, self.size, self.path):
            raise UnsupportedGate("window or loaded module changed")
        if Path(plan.path) != self.path or self.size != plan.image_size:
            raise UnsupportedGate("scanned image differs from loaded module")
        # The Windows loader may replace OptionalHeader.ImageBase after ASLR.
        # Accept only the exact preferred header or that single field equal to
        # the independently enumerated module base; instructions remain exact.
        loaded_header = self.read(0, len(plan.header))
        relocated_header = bytearray(plan.header)
        image_base_offset = struct.unpack_from("<I", plan.header, 0x3C)[0] + 48
        struct.pack_into("<Q", relocated_header, image_base_offset, self.base)
        if loaded_header not in (plan.header, bytes(relocated_header)):
            raise UnsupportedGate("loaded image header does not match file")
        for rva, expected in ((plan.instruction_rva, plan.instruction),
                              (plan.core_rva, _CORE), (plan.core_xref_rva, plan.core_xref)):
            if self.read(rva, len(expected)) != expected:
                raise UnsupportedGate("loaded image instructions do not match file")
        class Memory(c.Structure):
            _fields_ = [("BaseAddress", c.c_void_p), ("AllocationBase", c.c_void_p), ("AllocationProtect", w.DWORD),
                        ("PartitionId", w.WORD), ("RegionSize", c.c_size_t), ("State", w.DWORD),
                        ("Protect", w.DWORD), ("Type", w.DWORD)]
        query = self.kernel.VirtualQueryEx
        query.argtypes = [w.HANDLE, c.c_void_p, c.POINTER(Memory), c.c_size_t]
        query.restype = c.c_size_t
        memory = Memory(); address = self.base + plan.gate_rva
        if query(self.handle, address, c.byref(memory), c.sizeof(memory)) != c.sizeof(memory):
            raise UnsupportedGate("cannot validate data page")
        if (memory.AllocationBase != self.base or memory.State != 0x1000 or memory.Type != 0x1000000
                or memory.Protect not in (0x04, 0x08) or not memory.BaseAddress <= address < memory.BaseAddress + memory.RegionSize):
            raise UnsupportedGate("gate page must be committed writable non-executable image data")

    def close(self):
        if self.handle:
            self.kernel.CloseHandle(self.handle)
            self.handle = None


def recover_qt_accessibility(hwnd: int, verify: Callable[[], bool]) -> bool:
    """Recover only a uniquely identified Boolean gate, then verify actual UIA.

    Caller must supply a bounded fresh provider check tied to this HWND/PID.
    False means unsupported or verification failed and any change was restored.
    Rollback failure is raised explicitly and must stop the caller's UI action.
    """
    if os.name != "nt" or not callable(verify) or not _LOCK.acquire(blocking=False):
        return False
    target = None
    try:
        import ctypes
        if ctypes.sizeof(ctypes.c_void_p) != 8:
            return False
        target = _WindowsTarget(hwnd)
        return _recover(target, scan_file(target.path), verify)
    except AccessibilityRollbackError:
        raise
    except Exception as error:
        _LOG.info("Qt accessibility recovery unavailable: %s", type(error).__name__)
        return False
    finally:
        if target is not None:
            target.close()
        _LOCK.release()
