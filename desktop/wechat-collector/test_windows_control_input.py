"""Regression for CPython #78961; invented protocol bytes, no WeChat access."""
import contextlib
import json
import multiprocessing as mp
from multiprocessing.connection import Connection
import os
from pathlib import Path
import subprocess
import sys
import threading
import time
import unittest


def _probe(isolate, frozen_executable=None):
    from desktop_service import isolated_control_input
    if frozen_executable:
        mp.set_executable(frozen_executable)
        sys.frozen = True
    context = isolated_control_input(sys.stdin) if isolate else contextlib.nullcontext(sys.stdin)
    ctx = mp.get_context("spawn")
    parent, child = ctx.Pipe(duplex=False)
    worker = ctx.Process(target=Connection.send, args=(child, {"synthetic": True}))
    started = threading.Event()
    received = []
    with context as incoming:
        def read_command():
            started.set()
            received.append(incoming.readline())
        reader = threading.Thread(target=read_command, daemon=True)
        reader.start()
        started.wait(2)
        time.sleep(.1)  # Ensure the host pipe has an outstanding ReadFile.
        before = time.monotonic()
        try:
            worker.start()
            child.close()
            ready = parent.poll(2)
            if ready:
                ready = parent.recv() == {"synthetic": True}
        finally:
            worker.join(.1)
            if worker.is_alive():
                worker.terminate()
            worker.join(2)
            parent.close()
            child.close()
        print(json.dumps({"workerReady": ready, "isolated": isolate,
                          "milliseconds": round((time.monotonic()-before)*1000),
                          "controlReadStillPending": reader.is_alive()}), flush=True)
        # Test parent now writes a made-up command, proving the private pipe was
        # neither closed nor consumed by the worker. Do not exit with a reader
        # holding CPython's buffered stdin lock.
        reader.join(5)
        print(json.dumps({"controlIntact": received == ["synthetic-control\n"]}), flush=True)


@unittest.skipUnless(sys.platform == "win32", "Windows inherited-handle regression")
class WindowsControlInputTest(unittest.TestCase):
    def run_probe(self, isolate, frozen_executable=None):
        args = [sys.executable, str(Path(__file__).resolve()), "probe", str(int(isolate))]
        if frozen_executable:
            args.append(frozen_executable)
        process = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, text=True, encoding="utf-8")
        try:
            reply = json.loads(process.stdout.readline())
            process.stdin.write("synthetic-control\n")
            process.stdin.flush()
            intact = json.loads(process.stdout.readline())
            process.stdin.close()
            process.wait(8)
            self.assertEqual(process.returncode, 0, process.stderr.read())
            self.assertTrue(intact["controlIntact"])
            self.assertTrue(reply["controlReadStillPending"])
            return reply
        finally:
            if process.poll() is None:
                process.kill()
                process.wait(3)
            process.stdout.close()
            process.stderr.close()

    def test_busy_host_pipe_is_not_inherited_by_worker(self):
        unsafe = self.run_probe(False)
        fixed = self.run_probe(True)
        # The old code must reproduce the reported failure on this Windows
        # runtime; otherwise this test cannot claim to cover the incident.
        self.assertFalse(unsafe["workerReady"], unsafe)
        self.assertTrue(fixed["workerReady"], fixed)
        self.assertLess(fixed["milliseconds"], 2000)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "probe":
        _probe(sys.argv[2] == "1", sys.argv[3] if len(sys.argv) > 3 else None)
    else:
        unittest.main()
