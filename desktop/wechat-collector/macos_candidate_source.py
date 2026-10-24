"""Private 270135 capture adapter; deliberately absent from production routing.

The receipt-verified copy stays alive for the entire grant. No proof or key is
handed to the restored original process. Keys and selected-contact batches are
process-local; the command prints only fixed status fields and aggregate counts.
"""
from __future__ import annotations

import argparse
from collections import Counter
import copy
import os
from pathlib import Path
import platform
import re
import sys
import time

from background_reader import BackgroundCaptureError
import macos_candidate_database_probe as probe
import sqlcipher_primitives as primitive
from local_database_source import EncryptedSnapshot, LocalDatabaseSource, open_encrypted_connection


MAX_DATABASE_BYTES = 4 * 1024 * 1024 * 1024
MAX_WAL_BYTES = 64 * 1024 * 1024
MAX_QUERY_PAGES = 65536
DATABASE_NAME = re.compile(r"(?:contact/contact|message/(?:message|media)_\d+|sns/sns)\.db")


def _wipe(value):
    value[:] = b"\0" * len(value)
    value.clear()


def _disable_core_dumps():
    import resource
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))


class _PrivateArgumentParser(argparse.ArgumentParser):
    def error(self, message):
        # argparse's default error includes unrecognized values in stderr.
        raise probe.Rejected("source-arguments-rejected")


def _header(path):
    before = probe.file_state(path, max_bytes=MAX_DATABASE_BYTES)
    probe.need(before[2] >= 4096 and before[2] % 4096 == 0, "source-header-format-rejected")
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_CLOEXEC", 0)
                 | getattr(os, "O_BINARY", 0))
    try:
        opened = os.fstat(fd)
        probe.need(before == (opened.st_dev, opened.st_ino, opened.st_size, opened.st_mtime_ns),
                   "source-open-descriptor-changed")
        first = os.read(fd, 4096)
        probe.need(len(first) == 4096 and probe.file_state(path, max_bytes=MAX_DATABASE_BYTES) == before,
                   "source-file-changed")
        return first
    finally:
        os.close(fd)


class _BoundedSnapshot(EncryptedSnapshot):
    def __init__(self, path, key, deadline, budget):
        self.deadline, self.budget = deadline, budget
        self._check()
        probe.file_state(path, max_bytes=MAX_DATABASE_BYTES)
        probe.file_state(Path(str(path) + "-wal"), required=False, max_bytes=MAX_WAL_BYTES)
        super().__init__(path, key, primitives=primitive)
        try:
            for filename, handle, maximum in ((self.path, self._file, MAX_DATABASE_BYTES),
                    (self.wal_path, self._wal, MAX_WAL_BYTES)):
                if handle is not None:
                    current = probe.file_state(filename, max_bytes=maximum)
                    opened = os.fstat(handle.fileno())
                    probe.need(current[:2] == (opened.st_dev, opened.st_ino), "source-open-descriptor-changed")
        except BaseException:
            self.close()
            raise

    def _check(self):
        probe.need(time.monotonic() < self.deadline, "source-grant-expired")

    def _index_wal(self):
        self._check()
        for filename, captured, maximum, required in (
                (self.path, self.before[0], MAX_DATABASE_BYTES, True),
                (self.wal_path, self.before[1], MAX_WAL_BYTES, False)):
            probe.need(captured is None or 0 <= captured[0] <= maximum, "source-snapshot-size-bound")
            expected = None if captured is None else (captured[2], captured[3], captured[0], captured[1])
            probe.need(probe.file_state(filename, required=required, max_bytes=maximum) == expected,
                       "source-file-changed")
        super()._index_wal()
        self._check()

    def assert_unchanged(self, *, allow_equivalent=False):
        self._check()
        probe.file_state(self.path, max_bytes=MAX_DATABASE_BYTES)
        probe.file_state(self.wal_path, required=False, max_bytes=MAX_WAL_BYTES)
        # Never enter the parent's unbounded fresh-snapshot fallback.
        super().assert_unchanged(allow_equivalent=False)
        self._check()

    def read_page(self, page_no):
        self._check()
        if page_no not in self.read_fingerprints:
            probe.need(self.budget[0] < MAX_QUERY_PAGES, "source-query-page-bound")
            self.budget[0] += 1
        return super().read_page(page_no)


def _connect(snapshot):
    conn, vfs = open_encrypted_connection(snapshot)
    try:
        conn.set_progress_handler(lambda: time.monotonic() >= snapshot.deadline, 1000)
        conn.execute("PRAGMA trusted_schema=OFF")
        return conn, vfs
    except BaseException:
        conn.close()
        vfs.unregister()
        raise


class CandidateDatabaseSource(LocalDatabaseSource):
    """A fresh page view leased from one still-live private-copy grant."""
    def __init__(self, account, master, contact_key, verify_scope, *, deadline, budget=None):
        self._verify_scope, self.deadline = verify_scope, deadline
        self._budget = [0] if budget is None else budget
        account = Path(account)
        probe.need(account.is_absolute() and account.resolve() == account, "account-path-redirected")
        self._owned_keys = [bytearray(master), bytearray(contact_key)]
        snapshot = conn = vfs = None
        try:
            verify_scope()
            snapshot = _BoundedSnapshot(account / "db_storage/contact/contact.db", self._owned_keys[1], deadline, self._budget)
            conn, vfs = _connect(snapshot)
            names = {account.name}
            if "_" in account.name:
                names.add(account.name.rsplit("_", 1)[0])
            names = sorted(name for name in names if re.fullmatch(r"[A-Za-z0-9_.@-]{1,128}", name))
            probe.need(bool(names), "source-self-identity-unverified")
            marks = ",".join("?" for _ in names)
            rows = list(conn.execute(f"SELECT username FROM contact WHERE username COLLATE BINARY IN ({marks}) LIMIT 3", names))
            snapshot.assert_unchanged()
            verify_scope()
            probe.need(len(rows) == 1 and isinstance(rows[0][0], str) and rows[0][0] in names,
                       "source-self-identity-unverified")
            username = rows[0][0]
        except BaseException:
            for value in self._owned_keys:
                _wipe(value)
            raise
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
        try:
            super().__init__(account, self._owned_keys[1], {"username": username}, self._owned_keys[0])
            self.assert_unchanged()
            self.sealed = False
        except BaseException:
            self.close()
            raise

    def _guard(self):
        probe.need(not self.closed and time.monotonic() < self.deadline, "source-grant-expired")
        self._verify_scope()
        first = _header(self.account_dir / "db_storage/contact/contact.db")
        probe.need(primitive._verify_enc_key(self.keys["contact/contact.db"], first), "source-account-key-changed")
        probe.need(time.monotonic() < self.deadline, "source-grant-expired")

    def _path(self, relative):
        probe.need(isinstance(relative, str) and DATABASE_NAME.fullmatch(relative), "source-database-type-rejected")
        path = self.base / relative
        probe.need(path.resolve() == path, "source-path-redirected")
        probe.file_state(path, max_bytes=MAX_DATABASE_BYTES)
        return path

    def _key_for(self, relative):
        if relative not in self.keys:
            key = primitive.effective_page_key(self.master, _header(self._path(relative)))
            probe.need(key is not None, "source-database-key-unavailable")
            self.keys[relative] = bytearray(key)
            self._owned_keys.append(self.keys[relative])
        return self.keys[relative]

    def _open(self, relative):
        self._guard()
        if relative not in self.connections:
            snapshot = _BoundedSnapshot(self._path(relative), self._key_for(relative), self.deadline, self._budget)
            try:
                conn, vfs = _connect(snapshot)
            except BaseException:
                snapshot.close()
                raise
            self.snapshots[relative], self.connections[relative], self.vfs[relative] = snapshot, conn, vfs
            self.sealed = False
        return self.connections[relative]

    def _relative_shards(self):
        self._guard()
        directory = self.base / "message"
        probe.need(directory.resolve() == directory, "source-path-redirected")
        files = []
        if not directory.exists():
            return files
        with os.scandir(directory) as entries:
            for index, item in enumerate(entries):
                probe.need(index < 1024, "source-shard-directory-bound")
                if re.fullmatch(r"(?:message|media)_\d+\.db", item.name):
                    probe.need(not item.is_symlink() and item.is_file(follow_symlinks=False), "source-path-redirected")
                    files.append("message/" + item.name)
                    probe.need(len(files) <= 128, "source-shard-count-bound")
        return sorted(files)

    def open_database(self, relative):
        return self._open(relative)

    def database_exists(self, relative):
        self._guard()
        probe.need(relative == "sns/sns.db", "source-database-type-rejected")
        path = self.base / relative
        if not path.exists() and not path.is_symlink():
            return False
        self._path(relative)
        return True

    def moments_shards(self):
        if self.database_exists("sns/sns.db"):
            yield "sns/sns.db", self._open("sns/sns.db")

    def assert_unchanged(self):
        self._guard()
        # Fresh source per history page. Revalidate consumed pages on every
        # publication, including after a slow media operation.
        for snapshot in self.snapshots.values():
            snapshot.assert_unchanged()
        self._guard()

    def close(self):
        failed = False
        try:
            # Keep clearing all resources if one native close raises.
            for name, method in (("connections", "close"), ("vfs", "unregister"), ("snapshots", "close")):
                for resource in list(getattr(self, name, {}).values()):
                    try:
                        getattr(resource, method)()
                    except Exception:
                        failed = True
            for name in ("connections", "vfs", "snapshots", "keys"):
                getattr(self, name, {}).clear()
            self.master = None
            context = getattr(self, "image_key_context", None)
            if context is not None:
                context.close()
        finally:
            self.closed = True
            for value in self._owned_keys:
                _wipe(value)
        probe.need(not failed, "source-resource-cleanup-failed")


class CandidateSession:
    """Receipt-bound owner. Closing every source precedes copy teardown."""
    def __init__(self, receipt, *, seconds=300, authentication_seconds=120, human_setup=False, progress=None, cancel=None):
        self.receipt, self.seconds, self.authentication_seconds = receipt, seconds, authentication_seconds
        self.human_setup = human_setup
        probe.need(progress is None or callable(progress), "source-progress-callback-rejected")
        probe.need(cancel is None or callable(cancel), "source-cancel-callback-rejected")
        self._cancel = cancel or (lambda: False)
        self._setup = self._setup_attempt = None
        self._setup_failure = ""
        if human_setup or progress is not None:
            from macos_setup_progress import SetupProgressAdapter
            self._setup = SetupProgressAdapter(on_change=progress)
        self.work = self.shadow = self.debug = self.capture = self.key = None
        self.channel = self.watcher = self.lock = self.digest = None
        self.proof = None
        self.master, self.contact_key = bytearray(), bytearray()
        self.reader = probe.CandidateReader()
        self.sources, self.budget = [], [0]
        self.launched = self.closed = False
        self.status = {"candidateAuthenticated": False, "productionAuthorizationChanged": False,
                       "allowlistChanged": False, "captureCompatibilityValidated": False}

    def __enter__(self):
        import macos_candidate_device_runtime as device
        import macos_candidate_runtime as runtime
        try:
            probe.need(sys.platform == "darwin" and platform.machine() == "arm64", "apple-silicon-mac-required")
            _disable_core_dumps()
            self._check_cancel()
            probe.need(type(self.human_setup) is bool and type(self.authentication_seconds) is int and type(self.seconds) is int
                       and 30 <= self.authentication_seconds <= (600 if self.human_setup else 120)
                       and self.authentication_seconds <= self.seconds <= 600,
                       "source-duration-rejected")
            if self._setup is not None:
                self._setup_attempt = self._setup.begin()["attempt"]
            probe.need(not any(name.startswith("DYLD_") or name == "CHATLOG_KEEPER_WECHAT_KEY_FIFO" for name in os.environ),
                       "inherited-injection-environment-rejected")
            probe.check_dependencies()
            self._check_cancel()
            probe.need(device._sip_state() == "enabled", "normal-sip-required")
            self.work, self.shadow, self.digest = device._load_receipt(self.receipt)
            self.debug, self.capture, self.key = device._load_modules(self.work)
            self.lock = self.debug._acquire_launch_lock(self.work, "candidate-device")
            probe.need(self.lock is not None, "diagnostic-already-running")
            self.status.update(device._verify(self.work, self.shadow, self.digest, self.debug))
            self._check_cancel()
            library, helper = self.capture.ensure_capture_library(), self.key.ensure_helper()
            probe.need(library is not None and helper is not None, "pinned-components-unavailable")
            self._check_cancel()
            probe.need(self.key.debug_copy_bundle_is_running(self.shadow) is False, "existing-candidate-rejected")
            device._original_is_closed(self.debug)
            self.channel = runtime._new_channel(self.capture, library, Path.home() / "Library/Containers/com.tencent.xinWeChat")
            probe.need(self.capture.validate_capture_fifo(self.channel.path, expected_identity=self.channel.identity),
                       "private-fifo-rejected")
            device._original_is_closed(self.debug)
            self._check_cancel()
            self.launched = True
            self.deadline = time.monotonic() + self.seconds
            self._report_progress(launchRequested=True)
            self.watcher = self.key.launch_debug_copy_watchdog("wechat", self.shadow / "Contents/MacOS/WeChat", self.shadow,
                            capture_library=self.channel.library_path, capture_fifo=self.channel.path)
            probe.need(self.watcher is not None, "candidate-launch-failed")
            self._authenticate()
            return self
        except BaseException as error:
            self._setup_failure = self._safe_failure(error)
            self.close()
            raise

    @property
    def executable(self):
        return self.shadow / "Contents/MacOS/WeChat"

    @staticmethod
    def _safe_failure(error):
        if isinstance(error, probe.Rejected):
            return str(error)
        if isinstance(error, KeyboardInterrupt):
            return "source-cancelled"
        return "source-private-test-failed"

    def _report_progress(self, **facts):
        if self._setup is not None and self._setup_attempt is not None:
            self.status["setup"] = self._setup.observe(self._setup_attempt, facts)

    def _check_cancel(self):
        probe.need(not self._cancel(), "source-cancelled")

    def _authenticate(self):
        import psutil
        deadline = min(self.deadline, time.monotonic() + self.authentication_seconds)
        generation = None
        checked, previous_header = 0, None
        while time.monotonic() < deadline:
            self._check_cancel()
            self.reader.drain(self.channel.read_fd)
            alive = self.watcher.poll() is None
            self._report_progress(watchdogAlive=alive)
            probe.need(alive, "candidate-watchdog-exited")
            pids = self.debug._exact_process_pids(self.executable)
            probe.need(pids is not None and len(pids) <= 1, "candidate-process-state-rejected")
            self._report_progress(processCount=len(pids))
            if not pids:
                probe.need(generation is None, "candidate-exited")
                time.sleep(.2)
                continue
            identity = self.key.process_identity(pids[0], timeout=3)
            probe.need(identity is not None and identity[0] == os.fsencode(self.executable.resolve()),
                       "candidate-process-identity-rejected")
            observed = (pids[0], identity)
            probe.need(generation is None or generation == observed, "candidate-generation-changed")
            generation = observed
            self._check_cancel()
            try:
                self.proof = probe.process_account(pids[0], self.executable, self.debug, self.key, psutil, expected=self.proof)
                self._check_cancel()
                self._report_progress(processVerified=True, accountStatus="verified",
                                      observerEvents=dict(self.reader.counts) if self._setup is not None else {})
                path, first = probe.contact_header(self.proof[2])
            except probe.Rejected as error:
                if str(error) == "contact-database-not-ready" or self.proof is None and str(error) == "active-account-not-ready":
                    if str(error) == "active-account-not-ready" and self._setup is not None:
                        # process_account already checked unique executable and
                        # owner before reporting no account descriptors. Bind
                        # its final generation too before offering a user hint.
                        probe.need(self.key.process_identity(pids[0], timeout=3) == identity,
                                   "candidate-generation-changed")
                    self._report_progress(processVerified=True,
                        accountStatus="not-ready" if str(error) == "active-account-not-ready" else "checking",
                        observerEvents=dict(self.reader.counts) if self._setup is not None else {})
                    time.sleep(.2)
                    continue
                raise
            start = checked if first == previous_header else 0
            for candidate in self.reader.pending[start:]:
                self._check_cancel()
                probe.need(time.monotonic() < deadline, "candidate-authentication-timeout")
                effective = primitive.effective_page_key(candidate, first)
                self._check_cancel()
                probe.need(time.monotonic() < deadline, "candidate-authentication-timeout")
                if effective is not None:
                    self.master.extend(candidate)
                    self.contact_key.extend(effective)
                    self.reader.drain(self.channel.read_fd)
                    probe.need(all(self.reader.counts[name] for name in ("constructor", "load", "call", "match", "write_ok", "resolve_ok")),
                               "observer-events-incomplete")
                    self.status.update(self.reader.aggregate())
                    self.status.update(candidateAuthenticated=True, activeAccountUnique=True)
                    for value in self.reader.pending:
                        _wipe(value)
                    self.reader.pending.clear()
                    self.verify_scope()
                    self._report_progress(accountStatus="verified", candidateAuthenticated=True)
                    return
            checked, previous_header = len(self.reader.pending), first
            time.sleep(.2)
        raise probe.Rejected("candidate-source-authentication-timeout")

    def verify_scope(self):
        import psutil
        import macos_candidate_device_runtime as device
        self._check_cancel()
        probe.need(not self.closed and time.monotonic() < self.deadline, "source-grant-expired")
        self.reader.drain(self.channel.read_fd)
        for value in self.reader.pending:
            _wipe(value)
        self.reader.pending.clear()
        probe.need(self.watcher.poll() is None, "candidate-watchdog-exited")
        device._original_is_closed(self.debug)
        probe.process_account(self.proof[0], self.executable, self.debug, self.key, psutil, expected=self.proof)
        _, first = probe.contact_header(self.proof[2])
        probe.need(primitive._verify_enc_key(self.contact_key, first), "source-account-key-changed")
        probe.need(time.monotonic() < self.deadline, "source-grant-expired")
        self._check_cancel()

    def open_source(self):
        self.verify_scope()
        source = CandidateDatabaseSource(self.proof[2], self.master, self.contact_key, self.verify_scope,
                                         deadline=self.deadline, budget=self.budget)
        self.sources.append(source)
        return source

    def ui_generation(self):
        """Private exact native identity; caller must independently trust UI path."""
        self.verify_scope()
        from macos_album_snapshot import Generation
        return Generation(self.proof[0], os.getuid(), self.proof[1][1], self.proof[1][2])

    def verify_ui_generation(self, generation):
        expected = self.ui_generation()
        probe.need(type(generation) is type(expected) and generation == expected, "source-ui-generation-changed")

    def close(self):
        if self.closed:
            return
        import macos_candidate_device_runtime as device
        if self._setup_failure:
            self._report_progress(reason=self._setup_failure)
        self._report_progress(cleanupStarted=True)
        self.closed, cleanup = True, True
        for source in self.sources:
            try:
                source.close()
            except Exception:
                cleanup = False
        self.sources.clear()
        _wipe(self.master)
        _wipe(self.contact_key)
        self.reader.close()
        self.proof = None
        self.status["ownedCandidateBuffersCleared"] = not self.master and not self.contact_key and not self.reader.buffer and not self.reader.pending
        for operation in (
                lambda: self.watcher is None or self.key.request_debug_copy_watchdog_cleanup(self.watcher),
                lambda: not self.launched or self.key.cleanup_debug_copy_bundle(self.shadow),
                lambda: not self.launched or self.key.debug_copy_bundle_is_running(self.shadow) is False,
                lambda: self.channel is None or self.channel.close()):
            try:
                cleanup = bool(operation()) and cleanup
            except Exception:
                cleanup = False
        self.status.update(runtimeCleanupComplete=cleanup, consumedPageCount=self.budget[0], originalRestored=False)
        # Keep the launch lock until restore/integrity verification is complete.
        if self.launched and cleanup:
            try:
                self.status["originalRestored"] = device._restore_original(self.debug, self.key)
                self.status.update(device._verify(self.work, self.shadow, self.digest, self.debug))
            except Exception:
                self.status["originalRestored"] = False
        if self.debug is not None:
            try:
                self.debug._release_launch_lock(self.lock)
            except Exception:
                self.status["runtimeCleanupComplete"] = False
        if self._setup is not None and self._setup_attempt is not None:
            self.status["setup"] = self._setup.finish(self._setup_attempt, {
                "ok": bool(self.status["candidateAuthenticated"] and self.status["runtimeCleanupComplete"]
                           and self.status["originalRestored"] and not self._setup_failure),
                "reason": self._setup_failure,
                "candidateAuthenticated": self.status["candidateAuthenticated"],
                "runtimeCleanupComplete": self.status["runtimeCleanupComplete"],
                "originalRestored": self.status["originalRestored"]})

    def __exit__(self, *exc):
        if exc[1] is not None:
            self._setup_failure = self._safe_failure(exc[1])
        self.close()
        if not exc[0]:
            probe.need(self.status["runtimeCleanupComplete"] and self.status["originalRestored"], "source-cleanup-or-restore-failed")


def selected_request(source, contact_id, *, page_size=100, cursor=None, by_alias=False, by_visible_identifier=False):
    """Exact ephemeral ID only; duplicate display names cannot select a person."""
    from background_reader import _short_id, _identity, _contact_display, _contact_label, _duplicate_displays
    _short_id(contact_id, "联系人")
    probe.need(type(by_visible_identifier) is bool and not (by_alias and by_visible_identifier), "selected-identifier-mode-rejected")
    if by_visible_identifier:
        from macos_candidate_contact_selection import resolve_visible_identifier
        contact_id = resolve_visible_identifier(source, contact_id)[0]
    column = "alias" if by_alias else "username"
    if by_alias:
        columns = list(source.contacts().execute("PRAGMA table_info(contact)"))
        probe.need(any(row[1] == "alias" for row in columns), "selected-alias-schema-unavailable")
    rows = list(source.contacts().execute(f"SELECT username,nick_name,remark FROM contact WHERE {column} COLLATE BINARY=? LIMIT 2", (contact_id,)))
    probe.need(len(rows) == 1 and isinstance(rows[0][0], str) and bool(rows[0][0]), "selected-contact-unverified")
    contact_id = _short_id(rows[0][0], "联系人")
    probe.need(contact_id != source.self_username and not contact_id.endswith("@chatroom"), "selected-contact-rejected")
    display = _contact_display(rows[0])
    label = _contact_label(rows[0], display in _duplicate_displays(source.contacts(), {display}))
    source.assert_unchanged()
    request = {"kind": "chat", "friend": label, "contactId": contact_id,
               "accountKey": _identity(source.account_id), "includeVoice": False,
               "pageSize": page_size, "direction": "backward"}
    if cursor is not None:
        request["cursor"] = cursor
    return request


def capture_selected_history(session, contact_id, *, pages=2, page_size=100, on_batch=None, by_alias=False, by_visible_identifier=False):
    """Use the real production parser; private batches only reach local caller."""
    from background_reader import capture_from_source
    probe.need(type(pages) is int and 1 <= pages <= 20 and type(page_size) is int and 1 <= page_size <= 500,
               "selected-history-range-rejected")
    cursor, ids, kinds, roles, media, count, complete = None, set(), Counter(), Counter(), Counter(), 0, False
    selected = None
    for _ in range(pages):
        source = session.open_source()
        try:
            request = selected_request(source, contact_id, page_size=page_size, cursor=cursor,
                                       by_alias=by_alias, by_visible_identifier=by_visible_identifier)
            probe.need(selected is None or request["contactId"] == selected, "selected-contact-changed")
            selected = request["contactId"]
            report = getattr(session, "_report_progress", None)
            if callable(report):
                report(selectedReadStarted=True)
            batch = capture_from_source(request, lambda _: None, None, source)
        finally:
            source.close()
        session.verify_scope()
        rows = batch["records"]
        current = {row["id"] for row in rows}
        probe.need(len(current) == len(rows) and not current.intersection(ids), "selected-history-duplicate")
        ids.update(current)
        kinds.update(row["kind"] for row in rows)
        roles.update(row["senderRole"] for row in rows)
        media.update(row["source"].get("mediaKind", row["kind"]) for row in rows if row["kind"] != "text")
        count += 1
        complete = batch["history"]["complete"]
        cursor = batch["history"]["nextCursor"]
        # No batch, cursor, contact identifier or message identifier is logged.
        if on_batch is not None:
            on_batch(copy.deepcopy(batch))
        if complete:
            break
        probe.need(bool(cursor), "selected-history-cursor-unavailable")
    session.verify_scope()
    return {"selectedContactVerified": True, "historyPageCount": count, "messageCount": len(ids),
            "messageKinds": dict(kinds), "historyComplete": complete, "duplicateMessageCount": 0,
            "speakerCounts": dict(roles), "mediaMessageCounts": dict(media), "voiceAvailabilityChecked": False,
            "databaseReadOnlyValidated": True, "contentIncluded": False, "keyWritten": False}


def run(receipt, contact_id, *, seconds=300, pages=2, page_size=100, by_alias=False,
        authentication_seconds=120, human_setup=False, progress=None):
    result = {"mode": "macos-270135-selected-history-private-test", "ok": False,
              "contentIncluded": False, "keyWritten": False, "captureCompatibilityValidated": False}
    session = CandidateSession(receipt, seconds=seconds, authentication_seconds=authentication_seconds,
                               human_setup=human_setup, progress=progress)
    began = time.monotonic()
    try:
        with session:
            result.update(capture_selected_history(session, contact_id, pages=pages, page_size=page_size, by_alias=by_alias))
        result["ok"] = True
    except probe.Rejected as error:
        result["reason"] = str(error)
    except BackgroundCaptureError as error:
        result["reason"] = error.code if re.fullmatch(r"[A-Z_]{1,80}", error.code) else "source-capture-failed"
    except KeyboardInterrupt:
        result["reason"] = "source-cancelled"
    except Exception:
        result["reason"] = "source-private-test-failed"
    finally:
        session.close()
        result.update(session.status)
        result["elapsedSeconds"] = round(time.monotonic() - began, 2)
    return result


def main():
    parser = _PrivateArgumentParser(description=__doc__)
    parser.add_argument("--receipt", type=Path, required=True)
    selection = parser.add_mutually_exclusive_group(required=True)
    selection.add_argument("--contact-id")
    selection.add_argument("--contact-alias")
    parser.add_argument("--start", action="store_true", required=True)
    parser.add_argument("--restore-original", action="store_true", required=True)
    parser.add_argument("--seconds", type=int, default=300)
    parser.add_argument("--authentication-seconds", type=int, default=120)
    parser.add_argument("--human-setup", action="store_true")
    parser.add_argument("--pages", type=int, default=2)
    parser.add_argument("--page-size", type=int, default=100)
    args = parser.parse_args()
    def report(view):
        import json
        print(json.dumps({"event": "setup-progress", "setup": view}, ensure_ascii=True, separators=(",", ":")), flush=True)
    return run(args.receipt, args.contact_alias if args.contact_alias is not None else args.contact_id,
               seconds=args.seconds, pages=args.pages, page_size=args.page_size, by_alias=args.contact_alias is not None,
               authentication_seconds=args.authentication_seconds, human_setup=args.human_setup,
               progress=report if args.human_setup else None)


if __name__ == "__main__":
    import json
    try:
        output = main()
    except Exception:
        output = {"mode": "macos-270135-selected-history-private-test", "ok": False,
                  "reason": "source-arguments-rejected", "contentIncluded": False, "keyWritten": False}
    print(json.dumps(output, ensure_ascii=True, separators=(",", ":")))
    raise SystemExit(0 if output.get("ok") else 1)
