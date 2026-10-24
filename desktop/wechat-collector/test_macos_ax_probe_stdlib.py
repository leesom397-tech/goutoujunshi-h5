"""Synthetic CF/AX API and walker tests. No WeChat, macOS permissions or UI."""
import ctypes as C
import json
import subprocess
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import macos_ax_probe_stdlib as probe


def put(pointer, ctype, value):
    C.cast(pointer, C.POINTER(ctype))[0] = value


class FakeCF:
    """Counts borrowed array membership separately from owned Copy/Retain refs."""
    def __init__(self):
        self.next = 10
        self.objects = {}
        self.events = []

    def make(self, kind, value, refs=1):
        self.next += 1
        self.objects[self.next] = [kind, value, refs]
        return self.next

    def entry(self, value):
        assert value in self.objects and self.objects[value][2] > 0, ("dead CF reference", value)
        return self.objects[value]

    def retain(self, value):
        self.entry(value)[2] += 1
        self.events.append(("retain", value))
        return value

    def release(self, value):
        entry = self.entry(value)
        entry[2] -= 1
        self.events.append(("release", value))
        if entry[2] == 0 and entry[0] == 2:
            for member in entry[1]:
                self.release(member)

    def array(self, members):
        for value in members:
            self.retain(value)
        return self.make(2, members)

    def temp_strings(self, strings):
        members = [self.make(3, value) for value in strings]
        array = self.array(members)
        for value in members:
            self.release(value)
        return array

    def no_leaks(self):
        return [key for key, entry in self.objects.items() if entry[2] != 0]


class NativeFixture:
    def __init__(self):
        self.cf = FakeCF()
        self.now = 0.0
        self.pids = [12]
        self.paths = {12: probe.EXECUTABLE}
        self.timeouts = []
        self.attr_reads = []
        self.fail_timeout = False
        self.fail_copy = False
        self.copy_exception = False
        self.foreign = set()
        self.children = {}
        self.string_buffers = []
        ax, cf, cg, proc = (SimpleNamespace() for _ in range(4))
        def bind(library, name, implementation):
            # Python functions also permit signature attributes assigned by NativeAX.
            def call(*args):
                return implementation(*args)
            setattr(library, name, call)

        bind(proc, "proc_listallpids", self.list_pids)
        bind(proc, "proc_pidpath", self.path)
        bind(ax, "AXIsProcessTrusted", lambda: True)
        bind(cg, "CGPreflightScreenCaptureAccess", lambda: False)
        bind(ax, "AXUIElementCreateApplication", lambda pid: self.cf.make(1, {"pid": pid, "role": "AXApplication"}))
        bind(ax, "AXUIElementGetTypeID", lambda: 1)
        bind(ax, "AXUIElementGetPid", self.get_pid)
        bind(ax, "AXUIElementSetMessagingTimeout", self.timeout)
        bind(ax, "AXUIElementCopyAttributeValue", self.value)
        bind(ax, "AXUIElementCopyAttributeNames", lambda element, out: self.names(element, out, False))
        bind(ax, "AXUIElementCopyActionNames", lambda element, out: self.names(element, out, True))
        bind(ax, "AXUIElementGetAttributeValueCount", self.count)
        bind(ax, "AXUIElementCopyAttributeValues", self.values)
        bind(ax, "AXValueGetTypeID", lambda: 4)
        bind(ax, "AXValueGetType", lambda value: self.cf.entry(value)[1][0])
        bind(ax, "AXValueGetValue", self.pair)
        bind(cf, "CFGetTypeID", lambda value: self.cf.entry(value)[0])
        bind(cf, "CFRetain", self.cf.retain)
        bind(cf, "CFRelease", self.cf.release)
        bind(cf, "CFArrayGetTypeID", lambda: 2)
        bind(cf, "CFArrayGetCount", lambda value: len(self.cf.entry(value)[1]))
        bind(cf, "CFArrayGetValueAtIndex", lambda value, index: self.cf.entry(value)[1][index])
        bind(cf, "CFStringGetTypeID", lambda: 3)
        bind(cf, "CFStringCreateWithCString", lambda _, value, encoding: self.cf.make(3, value.decode("ascii")))
        bind(cf, "CFStringGetLength", lambda value: len(self.cf.entry(value)[1]))
        bind(cf, "CFStringGetCString", self.string)
        self.libraries = ax, cf, cg, proc

    def api(self, deadline=2.7):
        return probe.NativeAX(clock=lambda: self.now, deadline=deadline, libraries=self.libraries)

    def list_pids(self, buffer, _):
        for i, pid in enumerate(self.pids[:probe.MAX_PIDS]):
            buffer[i] = pid
        return len(self.pids)

    def path(self, pid, buffer, _):
        value = self.paths.get(pid, b"")
        buffer.value = value
        return len(value)

    def get_pid(self, element, out):
        put(out, C.c_int, 999 if element in self.foreign else self.cf.entry(element)[1]["pid"])
        return 0

    def timeout(self, element, seconds):
        self.timeouts.append((element, seconds))
        return -1 if self.fail_timeout else 0

    def value(self, element, name, out):
        attribute = self.cf.entry(name)[1]
        self.attr_reads.append(attribute)
        if attribute == "AXRole":
            value = self.cf.make(3, self.cf.entry(element)[1]["role"])
        else:
            value = self.cf.make(4, (1, (12.5, -4.0)) if attribute == "AXPosition" else (2, (100.0, 200.0)))
        put(out, C.c_void_p, value)
        if self.copy_exception:
            raise RuntimeError("must never serialize private exception")
        return -1 if self.fail_copy else 0

    def names(self, element, out, actions):
        put(out, C.c_void_p, self.cf.temp_strings(["AXPress", "私人正文"] if actions else ["AXRole", "AXTitle", "AXDescription", "AXValue", "bad private value"]))
        return 0

    def count(self, element, name, out):
        put(out, C.c_long, len(self.children.get(element, [])))
        return 0

    def values(self, element, name, start, count, out):
        put(out, C.c_void_p, self.cf.array(self.children.get(element, [])[start:start+count]))
        return 0

    def pair(self, value, kind, out):
        pair = C.cast(out, C.POINTER(probe._Pair))
        pair[0].first, pair[0].second = self.cf.entry(value)[1][1]
        return True

    def string(self, value, buffer, size, encoding):
        raw = self.cf.entry(value)[1].encode("utf-8")
        if len(raw) >= size:
            return False
        buffer.value = raw
        return True


class WalkerFixture:
    def __init__(self, branching=3, levels=8):
        self.branching, self.levels = branching, levels
        self.owned, self.released = set(), []
        self.reads = []
        self.next = 0
        self.depths = {}
        self.trusted = True
        self.targets = [12]
        self.limit_calls = 100000
        self.scope_changed = False
        self.closed = False

    def new(self, depth):
        self.next += 1
        self.depths[self.next] = depth
        self.owned.add(self.next)
        return self.next

    def check_budget(self):
        self.limit_calls -= 1
        if self.limit_calls < 0:
            raise probe.BudgetExceeded()

    def permissions(self): return self.trusted, False
    def target_pids(self): return self.targets
    def application(self, pid): return self.new(-1)
    def assert_target(self):
        if self.scope_changed:
            raise probe.TargetChanged()

    def elements(self, element, name, limit):
        self.check_budget()
        self.reads.append(name)
        depth = self.depths[element]
        count = 1 if name == "AXWindows" else self.branching if depth < self.levels else 0
        return [self.new(depth+1) for _ in range(min(count, limit))], count

    def role(self, element):
        self.check_budget()
        self.assert_target()
        return "AXWindow" if self.depths[element] == 0 else "AXGroup"

    def names(self, element, actions=False): return ["AXPress"] if actions else ["AXRole", "AXChildren"]
    def geometry(self, element): return [0, 0, 100, 200]
    def release(self, value):
        if value is not None:
            assert value in self.owned, "double release"
            self.owned.remove(value)
            self.released.append(value)
    def close(self): self.closed = True


class NativeTests(unittest.TestCase):
    def setUp(self):
        self.f = NativeFixture()
        self.api = self.f.api()
        self.app = self.api.application(12)

    def tearDown(self):
        self.api.release(self.app)
        self.api.close()
        self.assertEqual(self.f.cf.no_leaks(), [])

    def test_only_names_role_geometry_and_no_prompt(self):
        self.assertEqual(self.api.permissions(), (True, False))
        self.assertEqual(self.api.role(self.app), "AXApplication")
        self.assertEqual(self.api.names(self.app), ["AXDescription", "AXRole", "AXTitle", "AXValue"])
        self.assertEqual(self.api.names(self.app, actions=True), ["AXPress"])
        self.assertEqual(self.api.geometry(self.app), [12.5, -4.0, 100.0, 200.0])
        self.assertEqual(self.f.attr_reads, ["AXRole", "AXPosition", "AXSize"])

    def test_sensitive_values_and_unbounded_arrays_are_rejected(self):
        for name in ["AXTitle", "AXValue", "AXDescription", "AXIdentifier", "AXChildren", "AXSelectedText"]:
            with self.assertRaises(ValueError): self.api._value(self.app, name)
        for name, limit in [("AXTitle", 1), ("AXChildren", 25), ("AXWindows", 0), ("AXChildren", True)]:
            with self.assertRaises(ValueError): self.api.elements(self.app, name, limit)
        self.assertEqual(self.f.attr_reads, [])

    def test_each_element_gets_timeout_not_only_root(self):
        child = self.f.cf.make(1, {"pid": 12, "role": "AXButton"})
        self.assertEqual(self.api.role(child), "AXButton")
        self.api.release(child)
        self.assertTrue(self.f.timeouts)
        self.assertTrue(all(element == child and 0 < seconds <= .15 for element, seconds in self.f.timeouts))

    def test_timeout_shrinks_to_deadline(self):
        self.f.now = 2.65
        self.api.role(self.app)
        self.assertTrue(all(seconds < .051 for _, seconds in self.f.timeouts))
        self.f.now = 2.7
        with self.assertRaises(probe.BudgetExceeded): self.api.role(self.app)

    def test_foreign_pid_is_rejected_before_attribute_read(self):
        self.f.foreign.add(self.app)
        with self.assertRaises(probe.TargetChanged): self.api.role(self.app)
        self.assertEqual(self.f.attr_reads, [])

    def test_path_change_and_timeout_failure_are_fail_closed(self):
        self.f.paths[12] = b"/tmp/WeChat"
        with self.assertRaises(probe.TargetChanged): self.api.role(self.app)
        self.f.paths[12] = probe.EXECUTABLE
        self.f.fail_timeout = True
        with self.assertRaises(probe.NativeFailure): self.api.role(self.app)
        self.assertEqual(self.f.attr_reads, [])

    def test_copy_error_and_exception_release_output(self):
        self.f.fail_copy = True
        self.assertEqual(self.api.role(self.app), "AXUnknown")
        self.f.copy_exception = True
        with self.assertRaises(RuntimeError): self.api.role(self.app)

    def test_retained_child_survives_array_release(self):
        child = self.f.cf.make(1, {"pid": 12, "role": "AXGroup"})
        self.f.children[self.app] = [child]
        children, count = self.api.elements(self.app, "AXChildren", 1)
        self.assertEqual((children, count), ([child], 1))
        self.f.cf.release(child)  # remove fixture's original ownership
        self.assertEqual(self.api.role(children[0]), "AXGroup")
        self.api.release(children[0])

    def test_malformed_array_releases_already_retained_children(self):
        child = self.f.cf.make(1, {"pid": 12, "role": "AXGroup"})
        invalid = self.f.cf.make(3, "not an element")
        self.f.children[self.app] = [child, invalid]
        with self.assertRaises(probe.NativeFailure): self.api.elements(self.app, "AXChildren", 2)
        self.assertEqual(self.f.cf.entry(child)[2], 1)
        self.f.cf.release(child)
        self.f.cf.release(invalid)

    def test_exact_process_path_and_complete_process_enumeration(self):
        self.f.pids = [12, 13, 14]
        self.f.paths.update({13: probe.EXECUTABLE+b" Helper", 14: b"/tmp/WeChat"})
        self.assertEqual(self.api.target_pids(), [12])
        self.f.paths[14] = probe.EXECUTABLE
        self.assertEqual(self.api.target_pids(), [12, 14])
        self.f.pids = list(range(1, probe.MAX_PIDS+1))
        with self.assertRaises(probe.NativeFailure): self.api.target_pids()


class WalkerTests(unittest.TestCase):
    def test_node_bound_releases_queue(self):
        f = WalkerFixture()
        result = probe.collect(f)
        self.assertEqual(len(result["nodes"]), 128)
        self.assertTrue(result["truncated"])
        self.assertEqual(f.owned, set())
        self.assertTrue(f.closed)
        self.assertEqual(set(f.reads), {"AXWindows", "AXChildren"})

    def test_depth_bound(self):
        f = WalkerFixture(branching=1)
        result = probe.collect(f)
        self.assertEqual(max(node["depth"] for node in result["nodes"]), 6)
        self.assertEqual(f.owned, set())

    def test_budget_partial_and_cleanup(self):
        f = WalkerFixture()
        f.limit_calls = 12
        result = probe.collect(f)
        self.assertEqual(result["status"], "budget-exceeded")
        self.assertEqual(f.owned, set())

    def test_scope_change_discards_partial_tree(self):
        f = WalkerFixture(branching=0)
        old = f.geometry
        def geometry(element):
            f.scope_changed = True
            return old(element)
        f.geometry = geometry
        result = probe.collect(f)
        self.assertEqual(result["status"], "target-changed")
        self.assertNotIn("nodes", result)
        self.assertEqual(f.owned, set())

    def test_permission_and_nonunique_target_never_read_ui(self):
        for targets, trusted, status in [([12], False, "accessibility-permission-required"), ([], True, "wechat-not-running"), ([12, 13], True, "multiple-official-wechat-processes")]:
            f = WalkerFixture()
            f.targets, f.trusted = targets, trusted
            result = probe.collect(f)
            self.assertEqual(result["status"], status)
            self.assertEqual(f.reads, [])
            self.assertEqual(f.next, 0)
            self.assertTrue(f.closed)

    def test_invalid_bounds(self):
        for kwargs in [{"max_nodes": 129}, {"max_nodes": True}, {"max_depth": 7}, {"max_depth": -1}]:
            with self.assertRaises(ValueError): probe.collect(WalkerFixture(), **kwargs)

    def test_watchdog_terminates_read_only_worker(self):
        class Child:
            returncode = -9
            killed = False
            calls = 0
            def communicate(self, timeout=None):
                self.calls += 1
                if not self.killed:
                    self.timeout = timeout
                    raise subprocess.TimeoutExpired("probe", timeout)
                return b"", None
            def kill(self): self.killed = True
        child = Child()
        with patch.object(probe.sys, "platform", "darwin"):
            result = probe.probe(popen=lambda *args, **kwargs: child, clock=lambda: 0)
        self.assertEqual(result["status"], "watchdog-timeout")
        self.assertTrue(child.killed)
        self.assertEqual(child.timeout, 3)
        self.assertEqual(child.calls, 2)

    def test_cli_result_has_no_native_exception_text(self):
        f = WalkerFixture()
        f.role = lambda _: (_ for _ in ()).throw(RuntimeError("PRIVATE CHAT TEXT"))
        result = probe.collect(f)
        self.assertNotIn("PRIVATE", json.dumps(result))
        self.assertEqual(result["status"], "probe-failed")
        self.assertEqual(f.owned, set())


if __name__ == "__main__":
    unittest.main()
