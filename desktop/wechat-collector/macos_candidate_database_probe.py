"""Independent 270135 diagnostic: authenticated contact COUNT, never row content.

Requires the operator to normally quit original WeChat before explicit --start.
Reuses the already reviewed private-copy receipt/lifecycle, but does not mutate
the status-only probe, production allowlist, authorization cache, or original
installation. Candidates exist only in this short-lived process. No credentials,
account paths, SQL rows, plaintext databases or screenshots are serialized.
"""
from __future__ import annotations

import argparse
from collections import Counter
import importlib
import importlib.metadata
import importlib.util
import json
import os
from pathlib import Path
import platform
import stat
import struct
import sys
import time


DEPENDENCIES = {"apsw": "3.54.0.0", "cryptography": "50.0.2", "psutil": "7.2.2"}
EVENTS = {1: "constructor", 2: "load", 3: "resolve_attempt", 4: "resolve_ok",
          5: "resolve_failed", 6: "call", 7: "match", 8: "write_ok", 9: "write_failed"}
MAX_CANDIDATES = 64
MAX_DB_BYTES, MAX_WAL_BYTES = 64 * 1024 * 1024, 32 * 1024 * 1024
MAX_QUERY_PAGES, MAX_CONTACT_ROWS = 8192, 1_000_000


class Rejected(Exception):
    pass


def need(condition, code):
    if not condition:
        raise Rejected(code)


def check_dependencies():
    for name, expected in DEPENDENCIES.items():
        try:
            installed = importlib.metadata.version(name)
            found = importlib.util.find_spec(name) is not None
        except importlib.metadata.PackageNotFoundError:
            installed, found = "", False
        need(found, "dependency-missing-" + name)
        need(installed == expected, "dependency-version-mismatch-" + name)
    # Import failures also stop BEFORE a private copy or account file is opened.
    for name in DEPENDENCIES:
        try:
            importlib.import_module(name)
        except Exception:
            raise Rejected("dependency-import-failed-" + name) from None
    return {"dependenciesVerified": True, "versions": dict(DEPENDENCIES)}


class CandidateReader:
    """Bounded private bytes; only fixed event names/counters leave this object."""
    def __init__(self):
        self.buffer = bytearray()
        self.pending = []
        self.counts = Counter()
        self.frames = 0

    def feed(self, data):
        self.buffer.extend(data)
        need(len(self.buffer) <= 65536, "candidate-buffer-bound")
        while len(self.buffer) >= 4:
            magic = self.buffer[:4]
            need(magic in (b"WXK1", b"WXS1"), "candidate-frame-invalid")
            length = 36 if magic == b"WXK1" else 16
            if len(self.buffer) < length:
                break
            if length == 36:
                self.frames += 1
                need(self.frames <= 1024, "candidate-frame-bound")
                value = self.buffer[4:36]
                try:
                    if not any(value == existing for existing in self.pending):
                        need(len(self.pending) < MAX_CANDIDATES, "candidate-count-bound")
                        self.pending.append(bytearray(value))
                finally:
                    value[:] = b"\0" * len(value)
            else:
                code = self.buffer[4]
                need(code in EVENTS and not any(self.buffer[9:16]), "candidate-event-invalid")
                self.counts[EVENTS[code]] += 1
                detail = struct.unpack_from("<I", self.buffer, 5)[0]
                need(code != 2 or detail == 1, "observer-load-invalid")
                need(code not in (5, 9), "observer-forwarding-failed")
            self.buffer[:length] = b"\0" * length
            del self.buffer[:length]

    def drain(self, fd):
        for _ in range(64):
            try:
                chunk = bytearray(os.read(fd, 4096))
            except BlockingIOError:
                break
            if not chunk:
                break
            try:
                self.feed(chunk)
            finally:
                chunk[:] = b"\0" * len(chunk)

    def aggregate(self):
        return {"candidateFrameCount": self.frames, "distinctCandidateCount": len(self.pending),
                "observerEvents": dict(self.counts)}

    def close(self):
        self.buffer[:] = b"\0" * len(self.buffer)
        self.buffer.clear()
        for value in self.pending:
            value[:] = b"\0" * len(value)
            value.clear()
        self.pending.clear()


def data_roots(home=None):
    home = Path.home() if home is None else Path(home)
    return (home / "Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files",
            home / "Library/Group Containers/5A4RE8SF68.com.tencent.xinWeChat/xwechat_files")


def account_for_open_path(filename, roots):
    """Map a proven process's open descriptor only; never enumerate accounts."""
    path = Path(filename)
    if not path.is_absolute():
        return None
    for root in roots:
        try:
            relative = path.relative_to(root)
        except ValueError:
            continue
        if (len(relative.parts) < 4 or relative.parts[1] != "db_storage"
                or not path.name.endswith((".db", ".db-wal", ".db-shm"))):
            continue
        account = root / relative.parts[0]
        need(root.resolve() == root and account.resolve() == account
             and (account / "db_storage").resolve() == account / "db_storage"
             and path.resolve() == path, "account-path-redirected")
        return account
    return None


def process_account(pid, executable, debug, key, psutil, *, expected=None, roots=None):
    roots = data_roots() if roots is None else roots
    pids = debug._exact_process_pids(executable)
    need(pids is not None and len(pids) == 1 and pids[0] == pid, "candidate-process-not-unique")
    identity = key.process_identity(pid, timeout=3)
    need(identity is not None and identity[0] == os.fsencode(executable.resolve()),
         "candidate-process-identity-rejected")
    process = psutil.Process(pid)
    need(process.uids().real == os.getuid() and Path(process.exe()) == executable,
         "candidate-process-owner-rejected")
    files = process.open_files()
    need(len(files) <= 8192, "open-descriptor-count-bound")
    accounts = {account for item in files
                if (account := account_for_open_path(item.path, roots)) is not None}
    need(accounts, "active-account-not-ready")
    need(len(accounts) == 1, "active-account-not-unique")
    proof = (pid, identity, accounts.pop())
    need(key.process_identity(pid, timeout=3) == identity, "candidate-generation-changed")
    need(expected is None or proof == expected, "active-account-changed")
    return proof


def file_state(path, *, required=True, max_bytes=MAX_DB_BYTES):
    try:
        info = path.lstat()
    except FileNotFoundError:
        need(not required, "contact-database-not-ready")
        return None
    need(not path.is_symlink() and path.resolve() == path and stat.S_ISREG(info.st_mode)
         and info.st_uid == os.getuid() and 0 <= info.st_size <= max_bytes,
         "contact-file-scope-rejected")
    return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns


def contact_header(account):
    path = account / "db_storage/contact/contact.db"
    before = file_state(path)
    need(before[2] >= 4096 and before[2] % 4096 == 0, "contact-header-format-rejected")
    file_state(Path(str(path) + "-wal"), required=False, max_bytes=MAX_WAL_BYTES)
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_CLOEXEC", 0)
                 | getattr(os, "O_BINARY", 0))
    try:
        opened = os.fstat(fd)
        need((opened.st_dev, opened.st_ino, opened.st_size, opened.st_mtime_ns) == before,
             "contact-file-changed")
        first = os.read(fd, 4096)
        need(len(first) == 4096 and file_state(path) == before, "contact-file-changed")
        return path, first
    finally:
        os.close(fd)


def authenticate(reader, first, primitive, *, deadline, start=0, clock=time.monotonic):
    need(type(start) is int and 0 <= start <= len(reader.pending), "candidate-index-rejected")
    for candidate in reader.pending[start:]:
        need(clock() < deadline, "candidate-authentication-timeout")
        effective = primitive.effective_page_key(candidate, first)
        need(clock() < deadline, "candidate-authentication-timeout")
        if effective is not None:
            return bytearray(effective)
    return None


def count_contact_rows(path, page_key, *, deadline, verify_scope, clock=time.monotonic):
    """No SELECT of private fields; all reads use the authenticated memory VFS."""
    from local_database_source import EncryptedSnapshot, open_encrypted_connection
    import sqlcipher_primitives as primitive

    class LimitedSnapshot(EncryptedSnapshot):
        def _index_wal(self):
            need(clock() < deadline, "contact-query-timeout")
            # Parent indexing uses its captured sizes, not a subsequent stat.
            # Bind both before it can scan any WAL frames. A replacement or
            # growth between the outer preflight and construction must stop.
            for source_path, captured, maximum, required in (
                    (self.path, self.before[0], MAX_DB_BYTES, True),
                    (self.wal_path, self.before[1], MAX_WAL_BYTES, False)):
                need(captured is None or 0 <= captured[0] <= maximum,
                     "contact-snapshot-size-bound")
                current = file_state(source_path, required=required, max_bytes=maximum)
                expected = None if captured is None else (captured[2], captured[3], captured[0], captured[1])
                need(current == expected, "contact-file-changed")
            super()._index_wal()
            need(clock() < deadline, "contact-query-timeout")

        def assert_unchanged(self, *, allow_equivalent=False):
            need(clock() < deadline, "contact-query-timeout")
            file_state(self.path)
            file_state(self.wal_path, required=False, max_bytes=MAX_WAL_BYTES)
            # The production fallback opens a new base snapshot. This isolated
            # probe must never bypass its own size/page/deadline limits.
            super().assert_unchanged(allow_equivalent=False)
            need(clock() < deadline, "contact-query-timeout")

        def read_page(self, page_no):
            need(clock() < deadline, "contact-query-timeout")
            need(len(self.read_fingerprints) < MAX_QUERY_PAGES or page_no in self.read_fingerprints,
                 "contact-query-page-bound")
            return super().read_page(page_no)

    need(clock() < deadline, "contact-query-timeout")
    verify_scope()
    file_state(path)
    file_state(Path(str(path) + "-wal"), required=False, max_bytes=MAX_WAL_BYTES)
    snapshot = conn = vfs = None
    try:
        snapshot = LimitedSnapshot(path, page_key, primitives=primitive)
        # The VFS opens source files internally. Confirm those descriptors still
        # point at the same owned, unredirected paths before asking SQLite to read.
        for source_path, handle, maximum in ((path, snapshot._file, MAX_DB_BYTES),
                (Path(str(path) + "-wal"), snapshot._wal, MAX_WAL_BYTES)):
            if handle is None:
                continue
            current = file_state(source_path, max_bytes=maximum)
            opened = os.fstat(handle.fileno())
            need(current[:2] == (opened.st_dev, opened.st_ino), "contact-open-descriptor-changed")
        conn, vfs = open_encrypted_connection(snapshot)
        conn.set_progress_handler(lambda: clock() >= deadline, 1000)
        conn.execute("PRAGMA trusted_schema=OFF")
        present = list(conn.execute("SELECT COUNT(*) FROM sqlite_schema WHERE type='table' AND name='contact'"))
        need(present == [(1,)], "contact-schema-unavailable")
        # Schema, not rows. Do not output even column names.
        columns = list(conn.execute("PRAGMA table_info(contact)"))
        need(0 < len(columns) <= 128 and any(row[1] == "username" for row in columns),
             "contact-schema-unavailable")
        del columns
        rows = list(conn.execute("SELECT COUNT(*) FROM contact"))
        need(len(rows) == 1 and len(rows[0]) == 1 and type(rows[0][0]) is int
             and 0 <= rows[0][0] <= MAX_CONTACT_ROWS, "contact-row-count-rejected")
        need(clock() < deadline, "contact-query-timeout")
        snapshot.assert_unchanged()
        verify_scope()
        need(clock() < deadline, "contact-query-timeout")
        return {"contactSchemaValidated": True, "contactRows": rows[0][0],
                "consumedPageCount": len(snapshot.read_fingerprints), "databaseReadOnlyValidated": True}
    finally:
        try:
            if conn is not None:
                conn.close()
        finally:
            try:
                if vfs is not None:
                    vfs.unregister()
            finally:
                if snapshot is not None:
                    snapshot.close()


def observe_database(shadow, debug, key, watcher, channel, reader, output, seconds):
    import psutil
    import sqlcipher_primitives as primitive
    executable = shadow / "Contents/MacOS/WeChat"
    deadline = time.monotonic() + seconds
    proof = None
    process_generation = None
    checked_candidates = 0
    header_seen = None
    while time.monotonic() < deadline:
        reader.drain(channel.read_fd)
        need(watcher.poll() is None, "candidate-watchdog-exited")
        pids = debug._exact_process_pids(executable)
        need(pids is not None and len(pids) <= 1, "candidate-process-state-rejected")
        if not pids:
            need(process_generation is None, "candidate-exited")
            time.sleep(.2)
            continue
        identity = key.process_identity(pids[0], timeout=3)
        need(identity is not None and identity[0] == os.fsencode(executable.resolve()),
             "candidate-process-identity-rejected")
        observed_generation = (pids[0], identity)
        need(process_generation is None or process_generation == observed_generation,
             "candidate-generation-changed")
        process_generation = observed_generation
        try:
            current = process_account(pids[0], executable, debug, key, psutil, expected=proof)
            # Bind the account as soon as its open descriptors prove it. A
            # not-yet-created contact DB must not let a later account take over.
            proof = current
            path, first = contact_header(current[2])
        except Rejected as error:
            if (str(error) == "contact-database-not-ready"
                    or proof is None and str(error) == "active-account-not-ready"):
                time.sleep(.2)
                continue
            raise
        if not reader.pending or checked_candidates == len(reader.pending) and header_seen == first:
            time.sleep(.2)
            continue
        effective = authenticate(reader, first, primitive, start=checked_candidates if header_seen == first else 0,
                                 deadline=min(deadline, time.monotonic() + 20))
        checked_candidates, header_seen = len(reader.pending), first
        if effective is None:
            time.sleep(.2)
            continue
        try:
            output.update(candidateAuthenticated=True, activeAccountUnique=True)
            verify_scope = lambda: process_account(proof[0], executable, debug, key, psutil, expected=proof)
            output.update(count_contact_rows(path, effective, deadline=min(deadline, time.monotonic() + 15),
                                             verify_scope=verify_scope))
            reader.drain(channel.read_fd)
            need(all(reader.counts[name] for name in ("constructor", "load", "call", "match", "write_ok", "resolve_ok")),
                 "observer-events-incomplete")
            return
        finally:
            effective[:] = b"\0" * len(effective)
            effective.clear()
    raise Rejected("candidate-database-validation-timeout")


def run(receipt, *, seconds=120):
    result = {"mode": "macos-270135-contact-count-diagnostic", "ok": False,
              "candidateAuthenticated": False, "databaseReadOnlyValidated": False,
              "contentIncluded": False, "imageSaved": False, "keyWritten": False,
              "captureCompatibilityValidated": False, "allowlistChanged": False,
              "productionAuthorizationChanged": False, "originalStoppedByDiagnostic": False}
    work = shadow = debug = capture = key = channel = watcher = lock = None
    reader, launched, cleanup = CandidateReader(), False, True
    started = time.monotonic()
    try:
        need(sys.platform == "darwin" and platform.machine() == "arm64", "apple-silicon-mac-required")
        need(30 <= seconds <= 120, "diagnostic-duration-rejected")
        need(not any(n.startswith("DYLD_") or n == "CHATLOG_KEEPER_WECHAT_KEY_FIFO" for n in os.environ),
             "inherited-injection-environment-rejected")
        check_dependencies()
        # Import the VFS/dependencies before starting a private application.
        import local_database_source
        import sqlcipher_primitives
        import macos_candidate_device_runtime as device
        import macos_candidate_runtime as runtime
        need(device._sip_state() == "enabled", "normal-sip-required")
        work, shadow, digest = device._load_receipt(receipt)
        debug, capture, key = device._load_modules(work)
        lock = debug._acquire_launch_lock(work, "candidate-device")
        need(lock is not None, "diagnostic-already-running")
        result.update(device._verify(work, shadow, digest, debug))
        library, helper = capture.ensure_capture_library(), key.ensure_helper()
        need(library is not None and helper is not None, "pinned-components-unavailable")
        need(key.debug_copy_bundle_is_running(shadow) is False, "existing-candidate-rejected")
        device._original_is_closed(debug)
        channel = runtime._new_channel(capture, library, Path.home() / "Library/Containers/com.tencent.xinWeChat")
        need(capture.validate_capture_fifo(channel.path, expected_identity=channel.identity), "private-fifo-rejected")
        device._original_is_closed(debug)
        launched = True
        watcher = key.launch_debug_copy_watchdog("wechat", shadow / "Contents/MacOS/WeChat", shadow,
                    capture_library=channel.library_path, capture_fifo=channel.path)
        need(watcher is not None, "candidate-launch-failed")
        observe_database(shadow, debug, key, watcher, channel, reader, result, seconds)
        result["ok"] = True
    except Rejected as error:
        result["reason"] = str(error)
    except KeyboardInterrupt:
        result["reason"] = "diagnostic-cancelled"
    except Exception:
        # Upstream/native/database exception representations may contain paths.
        result["reason"] = "candidate-database-diagnostic-failed"
    finally:
        result.update(reader.aggregate())
        reader.close()
        result["ownedCandidateBuffersCleared"] = not reader.buffer and not reader.pending
        if watcher is not None:
            try:
                cleanup = key.request_debug_copy_watchdog_cleanup(watcher) and cleanup
            except Exception:
                cleanup = False
        if launched and key is not None and shadow is not None:
            try:
                cleanup = key.cleanup_debug_copy_bundle(shadow) and cleanup
                cleanup = key.debug_copy_bundle_is_running(shadow) is False and cleanup
            except Exception:
                cleanup = False
        if channel is not None:
            try:
                cleanup = channel.close() and cleanup
            except Exception:
                cleanup = False
        if debug is not None:
            try:
                debug._release_launch_lock(lock)
            except Exception:
                cleanup = False
        result["runtimeCleanupComplete"] = cleanup
        result["originalRestored"] = False
        if launched and cleanup:
            try:
                result["originalRestored"] = device._restore_original(debug, key)
                result.update(device._verify(work, shadow, digest, debug))
            except Exception:
                result["reason"] = "original-restore-or-integrity-failed"
        result["ok"] = bool(result["ok"] and cleanup and result["originalRestored"] and not result.get("reason"))
        result["elapsedSeconds"] = round(time.monotonic() - started, 2)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check-dependencies", action="store_true")
    mode.add_argument("--start", action="store_true")
    parser.add_argument("--receipt", type=Path)
    parser.add_argument("--restore-original", action="store_true")
    parser.add_argument("--seconds", type=int, default=120)
    args = parser.parse_args()
    if args.check_dependencies:
        need(args.receipt is None and not args.restore_original, "arguments-rejected")
        return {"status": "dependencies-ready", **check_dependencies(), "accountDataRead": False}
    need(args.receipt is not None and args.restore_original, "explicit-restore-required")
    import resource
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    return run(args.receipt, seconds=args.seconds)


if __name__ == "__main__":
    try:
        result = main()
    except Rejected as error:
        result = {"status": str(error), "ok": False}
    except Exception:
        result = {"status": "candidate-database-probe-failed", "ok": False}
    print(json.dumps({"contentIncluded": False, "keyWritten": False, **result},
                     separators=(",", ":"), ensure_ascii=True))
    raise SystemExit(0 if result.get("ok") or result.get("status") == "dependencies-ready" else 1)
