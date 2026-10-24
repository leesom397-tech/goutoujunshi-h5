"""Experimental one-time Candidate -> fresh official-process account handoff.

No production routing, build allowlist, installed app or provider source changes.
The Candidate's process proof is discarded. Original process/account/code and
contact HMAC must be proved again after successful cleanup and restoration.
Secrets stay in mutable process-local buffers and cannot be pickled or logged.
"""
from __future__ import annotations

from dataclasses import dataclass
import hmac
import os
from pathlib import Path
import stat
import threading
import time

from macos_album_snapshot import Generation
from macos_candidate_source import CandidateSession, CandidateDatabaseSource, _header
import macos_candidate_database_probe as probe
import sqlcipher_primitives as primitive

EXPECTED_BUILD = ("4.1.15", "270135")
OFFICIAL_APP = Path("/Applications/WeChat.app")
HANDOFF_SECONDS = 60


class HandoffError(RuntimeError):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def _need(condition, code):
    if not condition:
        raise HandoffError(code) from None


def _wipe(value):
    value[:] = b"\0" * len(value)
    value.clear()


class _Private:
    def __repr__(self):
        return "<experimental Mac handoff: private>"

    def __reduce_ex__(self, protocol):
        raise HandoffError("handoff-serialization-prohibited")


class HandoffGrant(_Private):
    """Mint only while the Candidate lease is live; consume after its close.

    The 60-second handoff window does not renew the Candidate's absolute source
    deadline. A rebound source retains only the original grant's remaining TTL.
    """
    def __init__(self):
        raise HandoffError("handoff-use-capture-function")

    def close(self):
        with self._lock:
            _wipe(self._master)
            _wipe(self._contact_key)
            self._closed = True


@dataclass(frozen=True, repr=False)
class OriginalProof(_Private):
    generation: Generation
    account: Path
    build: tuple[str, str]


def _cleanly_restored(session):
    status = session.status
    _need(session.closed and session.proof is None and not session.master and not session.contact_key
          and not session.sources and all(status.get(name) is True for name in (
              "candidateAuthenticated", "runtimeCleanupComplete", "originalRestored", "ownedCandidateBuffersCleared",
              "officialSignatureVerified", "copyIntegrityVerified", "productionPolicyUnchangedVerified", "originalUnchangedVerified")),
          "handoff-original-restore-unverified")


def capture_handoff_grant(session, *, clock=time.monotonic):
    """Explicit local API, called inside the successfully authenticated session."""
    _need(isinstance(session, CandidateSession), "handoff-candidate-session-required")
    session.verify_scope()
    _need(not session.closed and session.status.get("candidateAuthenticated") is True
          and isinstance(session.proof, tuple) and len(session.proof) == 3
          and isinstance(session.digest, bytes) and len(session.digest) == 32
          and len(session.master) == 32 and len(session.contact_key) == 32
          and clock() < session.deadline, "handoff-candidate-unverified")
    source = session.open_source()
    grant = object.__new__(HandoffGrant)
    grant._lock, grant._closed, grant._consumed = threading.Lock(), False, False
    grant._master, grant._contact_key = bytearray(), bytearray()
    try:
        source.assert_unchanged()
        account = Path(session.proof[2])
        _need(source.account_dir == account and source.account_id == source.self_username,
              "handoff-candidate-account-unverified")
        first = _header(account / "db_storage/contact/contact.db")
        effective = primitive.effective_page_key(session.master, first)
        _need(effective is not None and hmac.compare_digest(effective, session.contact_key),
              "handoff-contact-hmac-failed")
        grant._candidate, grant._account, grant._account_id = session, account, source.account_id
        grant._source_digest, grant._salt = bytes(session.digest), first[:16]
        grant._expires = session.deadline
        grant._handoff_expires = min(session.deadline, clock() + HANDOFF_SECONDS)
        grant._clock = clock
        grant._master.extend(session.master)
        grant._contact_key.extend(session.contact_key)
        source.assert_unchanged()
        session.verify_scope()
        _need(clock() < grant._handoff_expires, "handoff-window-expired")
        return grant
    except BaseException:
        grant.close()
        raise
    finally:
        try:
            source.close()
        except BaseException:
            grant.close()
            raise


def _code_state(path):
    info = path.lstat()
    _need(not path.is_symlink() and path.resolve() == path and stat.S_ISREG(info.st_mode),
          "handoff-official-code-changed")
    return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns


class _NativeOriginalVerifier:
    def __init__(self, grant):
        self._grant = grant
        self._code = None
        self._files = (OFFICIAL_APP / "Contents/MacOS/WeChat", OFFICIAL_APP / "Contents/Info.plist",
                       OFFICIAL_APP / "Contents/_CodeSignature/CodeResources")

    def __call__(self, expected=None):
        import psutil
        import macos_key_provider as authorization
        grant = self._grant
        _cleanly_restored(grant._candidate)
        _need(grant._clock() < grant._expires, "handoff-lease-expired")
        if self._code is None:
            # These helpers do not consult or change the supported-build set.
            authorization._verify_official_bundle()
            _need(authorization.bundle_metadata() == EXPECTED_BUILD, "handoff-official-build-changed")
            _need(grant._candidate.debug._bundle_source_digest(OFFICIAL_APP) == grant._source_digest,
                  "handoff-official-code-changed")
            self._code = tuple(_code_state(path) for path in self._files)
        _need(tuple(_code_state(path) for path in self._files) == self._code, "handoff-official-code-changed")
        debug, key = grant._candidate.debug, grant._candidate.key
        copy_pids = debug._exact_process_pids(grant._candidate.executable)
        _need(copy_pids is not None and len(copy_pids) == 0, "handoff-candidate-still-running")
        executable = OFFICIAL_APP / "Contents/MacOS/WeChat"
        pids = debug._exact_process_pids(executable)
        _need(pids is not None and len(pids) == 1, "handoff-official-process-not-unique")
        expected_tuple = None if expected is None else (expected.generation.pid,
            (os.fsencode(executable), expected.generation.seconds, expected.generation.microseconds), expected.account)
        observed = probe.process_account(pids[0], executable, debug, key, psutil, expected=expected_tuple)
        proof = OriginalProof(Generation(observed[0], os.getuid(), observed[1][1], observed[1][2]), observed[2], EXPECTED_BUILD)
        _need(expected is None or proof == expected, "handoff-official-generation-changed")
        _need(tuple(_code_state(path) for path in self._files) == self._code and grant._clock() < grant._expires,
              "handoff-official-code-changed")
        return proof


class ReboundOriginalLease(_Private):
    """Fresh original-owned source lease, deliberately outside production routing."""
    def __init__(self, grant, verify, factory):
        self._lock = threading.RLock()
        self._grant, self._verify, self._factory = grant, verify, factory
        self._master, self._contact_key = bytearray(grant._master), bytearray(grant._contact_key)
        self._closed, self._registered, self._sources = False, False, []
        self._proof = None
        self._valid = False
        self._master_bound = False
        self._expires = grant._expires
        self._budget = [0]

    def _check(self):
        _need(not self._closed and self._grant._clock() < self._expires, "handoff-lease-expired")
        _cleanly_restored(self._grant._candidate)

    @property
    def deadline(self):
        return self._expires

    def verify_scope(self):
        self.assert_current()

    def assert_current(self):
        self._valid = False
        self._check()
        observed = self._verify(self._proof)
        _need(isinstance(observed, OriginalProof) and observed.account == self._grant._account
              and observed.build == EXPECTED_BUILD and (self._proof is None or observed == self._proof),
              "handoff-original-account-changed")
        first = _header(observed.account / "db_storage/contact/contact.db")
        _need(first[:16] == self._grant._salt and primitive._verify_enc_key(self._contact_key, first),
              "handoff-contact-hmac-failed")
        if not self._master_bound:
            effective = primitive.effective_page_key(self._master, first)
            _need(effective is not None and hmac.compare_digest(effective, self._contact_key),
                  "handoff-contact-hmac-failed")
            self._master_bound = True
        self._check()
        self._proof = observed
        self._valid = True

    def open_source(self):
        with self._lock:
            self.assert_current()
            source = self._factory(self._proof.account, self._master, self._contact_key, self.assert_current,
                                   deadline=self._expires, budget=self._budget)
            try:
                _need(source.account_id == self._grant._account_id and source.self_username == self._grant._account_id,
                      "handoff-self-identity-changed")
                source.assert_unchanged()
                self.assert_current()
            except BaseException:
                source.close()
                raise
            self._sources.append(source)
            return source

    def ui_generation(self):
        self.assert_current()
        return self._proof.generation

    def verify_ui_generation(self, generation):
        expected = self.ui_generation()
        _need(type(generation) is Generation and generation == expected, "handoff-ui-generation-changed")

    def register_with_provider(self, provider=None):
        """Use the existing provider import gate; never bypass its build policy.

        Current production rejects 270135 here. A successful private rebind is
        not described as provider activation. No allowlist is changed by this API.
        """
        if provider is None:
            import macos_key_provider as provider
        with self._lock:
            self.assert_current()
            _need(provider._require_supported_bundle() == EXPECTED_BUILD, "handoff-provider-build-rejected")
            payload = provider.WorkerAuthorization(str(self._proof.account), bytearray(self._master),
                self._grant._salt, EXPECTED_BUILD, self._expires)
            try:
                provider.import_worker_authorization(payload)
                self.assert_current()
                _need(hmac.compare_digest(provider.get_authorized_key(self._proof.account), self._master),
                      "handoff-provider-registration-failed")
                self._registered = True
                self.close()
            except BaseException:
                # This method is an explicit registration transfer. A partially
                # accepted registration must never outlive failed final checks.
                provider.clear_authorization()
                self._registered = False
                raise
            finally:
                payload.close()
            return {"status": "experimental-original-provider-registered", "providerRegistered": True,
                    "contentIncluded": False, "productionPolicyChanged": False,
                    "captureCompatibilityValidated": False}

    def register_experimental_with_provider(self, provider=None, *, consent=False):
        """Explicit local experiment; normal provider registration stays gated."""
        if provider is None:
            import macos_key_provider as provider
        _need(consent is True, "handoff-local-consent-required")
        with self._lock:
            self.assert_current()
            try:
                provider.register_experimental_original(proof=self._proof, key=self._master,
                    salt=self._grant._salt, expires=self._expires, consent=True)
                self.assert_current()
                _need(hmac.compare_digest(provider.get_authorized_key(self._proof.account), self._master),
                      "handoff-provider-registration-failed")
                self._registered = True
                self.close()
            except BaseException:
                provider.clear_experimental_authorization()
                self._registered = False
                raise
            return {"status": "experimental-original-provider-registered", "providerRegistered": True,
                    "experimental": True, "realDeviceValidated": False, "productionPolicyChanged": False,
                    "captureCompatibilityValidated": False, "contentIncluded": False}

    def aggregate(self):
        valid = self._valid and not self._closed and self._grant._clock() < self._expires
        return {"status": "experimental-original-rebound" if valid else "experimental-original-lease-inactive",
                "freshOriginalVerified": valid,
                "sameAccountHmacVerified": valid, "providerRegistered": self._registered,
                "sourceLeaseClosed": self._closed, "contentIncluded": False,
                "productionPolicyChanged": False, "captureCompatibilityValidated": False}

    def close(self):
        with self._lock:
            if self._closed:
                return
            self._closed = True
            self._valid = False
            failed = False
            try:
                for source in self._sources:
                    try:
                        source.close()
                    except Exception:
                        failed = True
                self._sources.clear()
            finally:
                _wipe(self._master)
                _wipe(self._contact_key)
            _need(not failed, "handoff-source-cleanup-failed")


def rebind_after_restore(grant, *, _verifier=None, _source_factory=CandidateDatabaseSource):
    """Consume a grant exactly once; no launch, permission request or disk write."""
    _need(type(grant) is HandoffGrant, "handoff-grant-rejected")
    with grant._lock:
        _need(not grant._closed and not grant._consumed, "handoff-grant-consumed")
        grant._consumed = True
    lease = None
    try:
        _need(grant._clock() < grant._handoff_expires, "handoff-window-expired")
        _cleanly_restored(grant._candidate)
        verify = _NativeOriginalVerifier(grant) if _verifier is None else _verifier
        lease = ReboundOriginalLease(grant, verify, _source_factory)
        lease.assert_current()
        source = lease.open_source()  # Actual VFS/self-username verification.
        source.close()
        lease.assert_current()
        return lease
    except BaseException:
        if lease is not None:
            lease.close()
        raise
    finally:
        grant.close()
