"""Synthetic PE and fake-memory fixtures only; never opens a real process."""
import struct
import unittest
from pathlib import Path

from qt_accessibility_recovery import (
    AccessibilityRollbackError, UnsupportedGate, _WindowsTarget, _recover, scan_bytes,
)


def fixture():
    data = bytearray(0x1200)
    data[:2] = b"MZ"
    struct.pack_into("<I", data, 0x3C, 0x80)
    data[0x80:0x84] = b"PE\0\0"
    struct.pack_into("<HH", data, 0x84, 0x8664, 4)
    struct.pack_into("<H", data, 0x94, 0xF0)
    struct.pack_into("<H", data, 0x98, 0x20B)
    struct.pack_into("<I", data, 0x98 + 56, 0x5000)
    struct.pack_into("<I", data, 0x98 + 108, 16)
    struct.pack_into("<II", data, 0x98 + 112 + 24, 0x4000, 24)
    sections = [(b".text", 0x1000, 0x800, 0x400, 0x60000020),
                (b".rdata", 0x2000, 0x200, 0xC00, 0x40000040),
                (b".data", 0x3000, 0x200, 0xE00, 0xC0000040),
                (b".pdata", 0x4000, 0x200, 0x1000, 0x40000040)]
    for index, (name, rva, size, raw, flags) in enumerate(sections):
        offset = 0x188 + index * 40
        data[offset:offset + len(name)] = name
        struct.pack_into("<IIII", data, offset + 8, size, rva, size, raw)
        struct.pack_into("<I", data, offset + 36, flags)
    struct.pack_into("<III", data, 0x1000, 0x1000, 0x1100, 0x2080)
    struct.pack_into("<III", data, 0x100C, 0x1200, 0x1300, 0x2080)
    data[0xC00:0xC16] = b"qt.accessibility.core\0"
    data[0x600:0x607] = b"\x48\x8d\x0d" + struct.pack("<i", 0x2000 - 0x1207)
    set_gate(data)
    return data


def set_gate(data, rva=0x1020, target=0x3010, fail=0x10D0):
    code = (b"\x48\x85\xc9\x0f\x84" + struct.pack("<i", fail - (rva + 9))
            + b"\x80\x3d" + struct.pack("<i", target - (rva + 16))
            + b"\0\x0f\x84" + struct.pack("<i", fail - (rva + 22)))
    start = 0x400 + rva - 0x1000
    data[start:start + len(code)] = code


class ScanTests(unittest.TestCase):
    def test_unique_structural_gate(self):
        plan = scan_bytes(bytes(fixture()))
        self.assertEqual(plan.gate_rva, 0x3010)
        self.assertEqual(plan.instruction_rva, 0x1020)
        self.assertEqual(plan.core_xref_rva, 0x1200)
        self.assertEqual((plan.function_start, plan.function_end), (0x1000, 0x1100))

    def assert_rejected(self, data):
        with self.assertRaises(UnsupportedGate):
            scan_bytes(bytes(data))

    def test_missing_or_duplicated_category(self):
        for duplicate in (False, True):
            data = fixture()
            if duplicate:
                data[0xC30:0xC46] = b"qt.accessibility.core\0"
            else:
                data[0xC00] = 0
            self.assert_rejected(data)

    def test_category_must_be_read_only(self):
        data = fixture(); struct.pack_into("<I", data, 0x188 + 40 + 36, 0xC0000040)
        self.assert_rejected(data)

    def test_gate_target_must_be_writable_non_executable(self):
        for flags in (0x40000040, 0xE0000040):
            data = fixture(); struct.pack_into("<I", data, 0x188 + 80 + 36, flags)
            self.assert_rejected(data)

    def test_both_branches_must_converge_inside_function(self):
        data = fixture(); struct.pack_into("<i", data, 0x420 + 18, 0x10C0 - 0x1036)
        self.assert_rejected(data)
        data = fixture(); set_gate(data, fail=0x1400)
        self.assert_rejected(data)

    def test_gate_must_be_at_function_entry(self):
        data = fixture(); data[0x420:0x436] = b"\0" * 22; set_gate(data, rva=0x1090)
        self.assert_rejected(data)

    def test_ambiguous_gate_is_not_ranked_or_tried(self):
        data = fixture(); set_gate(data, rva=0x1060, target=0x3020)
        self.assert_rejected(data)

    def test_no_xref_no_fallback(self):
        data = fixture(); data[0x600:0x607] = b"\0" * 7
        self.assert_rejected(data)

    def test_unbounded_or_wrong_pe_rejected(self):
        for offset, value in ((0x84, 0x14C), (0x98, 0x10B)):
            data = fixture(); struct.pack_into("<H", data, offset, value)
            self.assert_rejected(data)
        data = fixture(); struct.pack_into("<I", data, 0x98 + 112 + 28, 0)
        self.assert_rejected(data)
        data = fixture(); struct.pack_into("<I", data, 0x188 + 80 + 12, 0x1000)
        self.assert_rejected(data)

    def test_invalid_function_directory_rejected(self):
        data = fixture(); struct.pack_into("<I", data, 0x100C, 0x1080)
        self.assert_rejected(data)


class FakeTarget:
    def __init__(self, value=b"\0"):
        self.value, self.writes, self.validations = value, [], 0
        self.identity = True
        self.fail_write = False
        self.fail_rollback = False
        self.ignore_activation = False
        self.changed_after_scan = False

    def validate(self, _plan):
        self.validations += 1
        if not self.identity or (self.changed_after_scan and self.validations == 2):
            raise UnsupportedGate("fixture identity changed")

    def same_window(self):
        return self.identity

    def read(self, _rva, length):
        assert length == 1
        return self.value

    def write(self, _rva, value):
        self.writes.append(value)
        if value == b"\0" and self.fail_rollback:
            raise OSError("fixture rollback denied")
        if not (value == b"\1" and self.ignore_activation):
            self.value = value
        if value == b"\1" and self.fail_write:
            raise OSError("fixture partial write")


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.plan = scan_bytes(bytes(fixture()))

    def test_success_requires_provider_and_readback(self):
        target = FakeTarget()
        self.assertTrue(_recover(target, self.plan, lambda: True))
        self.assertEqual(target.writes, [b"\1"])
        self.assertEqual(target.validations, 2)

    def test_already_active_still_requires_provider(self):
        target = FakeTarget(b"\1")
        self.assertFalse(_recover(target, self.plan, lambda: False))
        self.assertEqual(target.writes, [])

    def test_non_boolean_original_is_never_written(self):
        for value in (b"\x02", b"\xff", b""):
            target = FakeTarget(value)
            self.assertFalse(_recover(target, self.plan, lambda: True))
            self.assertEqual(target.writes, [])

    def test_failed_provider_restores_original(self):
        target = FakeTarget()
        self.assertFalse(_recover(target, self.plan, lambda: False))
        self.assertEqual(target.writes, [b"\1", b"\0"])
        self.assertEqual(target.value, b"\0")

    def test_provider_exception_restores_original(self):
        target = FakeTarget()
        def fail():
            raise TimeoutError("fixture UIA timeout")
        with self.assertRaises(TimeoutError):
            _recover(target, self.plan, fail)
        self.assertEqual(target.value, b"\0")

    def test_failed_write_also_rolls_back(self):
        target = FakeTarget(); target.fail_write = True
        with self.assertRaises(OSError):
            _recover(target, self.plan, lambda: True)
        self.assertEqual(target.value, b"\0")
        self.assertEqual(target.writes, [b"\1", b"\0"])

    def test_failed_readback_rolls_back_without_provider_check(self):
        target = FakeTarget(); target.ignore_activation = True
        self.assertFalse(_recover(target, self.plan, lambda: self.fail("must not verify unconfirmed write")))
        self.assertEqual(target.writes, [b"\1", b"\0"])

    def test_rollback_failure_is_explicit(self):
        target = FakeTarget(); target.fail_rollback = True
        with self.assertRaises(AccessibilityRollbackError):
            _recover(target, self.plan, lambda: False)

    def test_identity_change_before_write_is_rejected(self):
        target = FakeTarget(); target.changed_after_scan = True
        with self.assertRaises(UnsupportedGate):
            _recover(target, self.plan, lambda: True)
        self.assertEqual(target.writes, [])

    def test_identity_change_during_verification_restores(self):
        target = FakeTarget()
        def changed():
            target.identity = False
            return True
        self.assertFalse(_recover(target, self.plan, changed))
        self.assertEqual(target.value, b"\0")


class MappedImageTests(unittest.TestCase):
    def setUp(self):
        import ctypes
        from ctypes import wintypes
        from types import SimpleNamespace
        self.plan = scan_bytes(bytes(fixture()), Path("synthetic-Weixin.dll").resolve())
        target = object.__new__(_WindowsTarget)
        target.c, target.w = ctypes, wintypes
        target.base, target.size = 0x180000000, self.plan.image_size
        target.path, target.handle = Path(self.plan.path), 123
        target.same_window = lambda: True
        target._module = lambda: (target.base, target.size, target.path)
        self.memory = {0: self.plan.header, self.plan.instruction_rva: self.plan.instruction,
                       self.plan.core_rva: b"qt.accessibility.core\0", self.plan.core_xref_rva: self.plan.core_xref}
        target.read = lambda rva, length: self.memory[rva][:length]
        self.protect, self.state, self.kind = 0x04, 0x1000, 0x1000000
        self.allocation_base = target.base
        def query(_handle, _address, pointer, _length):
            memory = pointer._obj
            memory.BaseAddress = target.base + 0x3000
            memory.AllocationBase = self.allocation_base
            memory.RegionSize = 0x1000
            memory.State, memory.Protect, memory.Type = self.state, self.protect, self.kind
            return ctypes.sizeof(memory)
        target.kernel = SimpleNamespace(VirtualQueryEx=query)
        self.target = target

    def test_exact_mapped_instructions_and_writable_data_accepted(self):
        self.target.validate(self.plan)

    def test_loader_image_base_relocation_is_accepted_only_for_actual_module_base(self):
        header = bytearray(self.plan.header)
        field = struct.unpack_from("<I", header, 0x3C)[0] + 48
        struct.pack_into("<Q", header, field, self.target.base)
        self.memory[0] = bytes(header)
        self.target.validate(self.plan)
        struct.pack_into("<Q", header, field, self.target.base + 0x10000)
        self.memory[0] = bytes(header)
        with self.assertRaises(UnsupportedGate):
            self.target.validate(self.plan)

    def test_relocated_header_with_other_changed_field_remains_rejected(self):
        header = bytearray(self.plan.header)
        field = struct.unpack_from("<I", header, 0x3C)[0] + 48
        struct.pack_into("<Q", header, field, self.target.base)
        header[field + 8] ^= 1
        self.memory[0] = bytes(header)
        with self.assertRaises(UnsupportedGate):
            self.target.validate(self.plan)

    def test_loaded_header_instruction_string_and_xref_mismatch_rejected(self):
        for rva, expected in list(self.memory.items()):
            self.memory[rva] = b"X" * len(expected)
            with self.assertRaises(UnsupportedGate):
                self.target.validate(self.plan)
            self.memory[rva] = expected

    def test_guard_executable_and_read_only_pages_rejected(self):
        for protection in (0x02, 0x10, 0x20, 0x40, 0x80, 0x104):
            self.protect = protection
            with self.assertRaises(UnsupportedGate):
                self.target.validate(self.plan)

    def test_other_allocation_uncommitted_or_private_memory_rejected(self):
        self.allocation_base += 0x10000
        with self.assertRaises(UnsupportedGate):
            self.target.validate(self.plan)
        self.allocation_base = self.target.base
        self.state = 0x2000
        with self.assertRaises(UnsupportedGate):
            self.target.validate(self.plan)
        self.state, self.kind = 0x1000, 0x20000
        with self.assertRaises(UnsupportedGate):
            self.target.validate(self.plan)

    def test_mapping_and_window_replacement_rejected(self):
        self.target._module = lambda: (self.target.base + 0x10000, self.target.size, self.target.path)
        with self.assertRaises(UnsupportedGate):
            self.target.validate(self.plan)
        self.target._module = lambda: (self.target.base, self.target.size, self.target.path)
        self.target.same_window = lambda: False
        with self.assertRaises(UnsupportedGate):
            self.target.validate(self.plan)


if __name__ == "__main__":
    unittest.main()
