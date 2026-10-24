"""Presentation-only Mac setup phases from fixed lifecycle facts.

No app, process, window, permission, account, key or filesystem access occurs
here. This adapter cannot authorize capture or renew a source lease. Its owner
must perform every existing version/account/generation/HMAC check on continue.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, replace
import threading
import time


OBSERVER_EVENTS = frozenset(("constructor", "load", "resolve_attempt", "resolve_ok",
                            "resolve_failed", "call", "match", "write_ok", "write_failed"))
WAIT_TIMEOUTS = frozenset(("candidate-source-authentication-timeout", "candidate-database-validation-timeout",
                           "MAC_WECHAT_LOGIN_REQUIRED", "MAC_FILE_ACCESS_REQUIRED", "MAC_KEY_UNAVAILABLE"))
IDENTITY_FAILURES = frozenset(("candidate-generation-changed", "active-account-changed", "ACCOUNT_CHANGED",
    "candidate-process-identity-rejected", "candidate-process-owner-rejected", "candidate-process-not-unique",
    "source-account-key-changed", "source-ui-generation-changed"))
CANCELLED = frozenset(("source-cancelled", "diagnostic-cancelled", "CANCELLED"))
NOT_READY = frozenset(("active-account-not-ready", "contact-database-not-ready"))
SIGNALS = frozenset(("launchRequested", "watchdogAlive", "processCount", "processVerified", "accountStatus",
                    "observerEvents", "candidateAuthenticated", "selectedReadStarted", "cleanupStarted",
                    "userActionRequired", "reason"))
BOOLEAN_SIGNALS = SIGNALS - {"processCount", "accountStatus", "observerEvents", "reason"}


class SetupStateError(ValueError):
    pass


def _need(condition, code):
    if not condition:
        raise SetupStateError(code)


def _reason(value):
    _need(isinstance(value, str), "setup-signals-invalid")
    if not value:
        return ""
    if value in WAIT_TIMEOUTS | IDENTITY_FAILURES | CANCELLED | NOT_READY | {"candidate-watchdog-exited", "observer-forwarding-failed"}:
        return value
    return "setup-failed"


def _signals(value):
    _need(isinstance(value, dict) and not set(value) - SIGNALS, "setup-signals-invalid")
    result = {}
    for name, item in value.items():
        if name in BOOLEAN_SIGNALS:
            _need(type(item) is bool, "setup-signals-invalid")
        elif name == "processCount":
            _need(type(item) is int and 0 <= item <= 16, "setup-signals-invalid")
        elif name == "accountStatus":
            _need(item in ("not-observed", "not-ready", "checking", "verified"), "setup-signals-invalid")
        elif name == "observerEvents":
            _need(isinstance(item, dict) and not set(item) - OBSERVER_EVENTS
                  and all(type(count) is int and 0 <= count <= 1_000_000 for count in item.values()),
                  "setup-signals-invalid")
            item = dict(item)
        elif name == "reason":
            item = _reason(item)
        result[name] = item
    return result


@dataclass(frozen=True)
class SetupView:
    attempt: int = 0
    revision: int = 0
    phase: str = "idle"
    message: str = "首次使用，请完成本机设置。"
    active: bool = False
    can_continue: bool = False
    continue_action: str = ""
    error_code: str = ""

    def public(self):
        value = asdict(self)
        value.update(continue_label="继续" if self.can_continue else "",
                     pending_cause="undetermined", authorization_granted=False,
                     capture_compatibility_validated=False)
        return value


class SetupProgressAdapter:
    """One current attempt, stale-callback rejection, and explicit continuation.

    Only pass signals already established by the source's own guards. Observer
    load/call/key-frame counts never count as successful account authentication.
    A short startup grace avoids describing normal account opening as a user
    wait; no setup window text is read or interpreted.
    """
    def __init__(self, *, on_change=None, clock=time.monotonic, startup_grace=4):
        _need(callable(clock) and (on_change is None or callable(on_change))
              and type(startup_grace) in (int, float) and 0 <= startup_grace <= 30,
              "setup-adapter-invalid")
        self._lock = threading.RLock()
        self._clock, self._on_change, self._grace = clock, on_change, startup_grace
        self._view = SetupView()
        self._facts = {}
        self._process_seen_at = None
        self._process_seen = self._authenticated = self._may_have_started = False
        self._cleanup_complete = True
        self._settled = True
        self._restored = False
        self._failure = ""
        self.notification_failed = False

    def snapshot(self):
        with self._lock:
            return self._view.public()

    def _set(self, **changes):
        next_view = replace(self._view, **changes)
        if next_view == self._view:
            return self._view.public()
        self._view = replace(next_view, revision=self._view.revision + 1)
        value = self._view.public()
        if self._on_change is not None:
            try:
                self._on_change(dict(value))
            except Exception:
                # A UI queue failure cannot bypass source verification or abort
                # cleanup. The status owner can still poll the current view.
                self.notification_failed = True
        return value

    def begin(self):
        with self._lock:
            _need(not self._view.active and self._settled, "setup-attempt-busy")
            self._facts = {}
            self._process_seen_at = None
            self._process_seen = self._authenticated = self._may_have_started = False
            self._restored, self._failure = False, ""
            return self._set(attempt=self._view.attempt + 1, active=True,
                phase="waiting-for-app-start", message="正在准备微信首次设置窗口…",
                can_continue=False, continue_action="", error_code="")

    def callback(self, attempt):
        """A worker-bound phase callback. It never starts a new attempt."""
        return lambda **facts: self.observe(attempt, facts)

    def observe(self, attempt, facts):
        with self._lock:
            _need(type(attempt) is int and attempt > 0, "setup-attempt-invalid")
            if attempt != self._view.attempt or not self._view.active:
                return self._view.public()
            incoming = _signals(facts)
            if incoming.get("reason") in NOT_READY:
                incoming["accountStatus"] = "not-ready" if incoming["reason"] == "active-account-not-ready" else "checking"
            data = {**self._facts, **incoming}
            process_verified = (data.get("processCount") == 1 and data.get("processVerified") is True
                                and data.get("watchdogAlive") is True)
            if incoming.get("candidateAuthenticated") is True:
                _need(process_verified and data.get("accountStatus") == "verified", "setup-authentication-facts-incomplete")
            if incoming.get("selectedReadStarted") is True:
                _need((self._authenticated or incoming.get("candidateAuthenticated") is True) and process_verified
                      and data.get("accountStatus") == "verified", "setup-selected-read-unverified")
            self._facts = data
            if data.get("launchRequested") or data.get("watchdogAlive"):
                self._may_have_started = True
                self._cleanup_complete = False
                self._settled = False
            if incoming.get("reason") and incoming["reason"] not in NOT_READY:
                # Later timeout/cancel notifications cannot turn an established
                # identity/watchdog/observer failure into an ordinary user wait.
                if (not self._failure or self._failure in WAIT_TIMEOUTS | CANCELLED
                        or incoming["reason"] in IDENTITY_FAILURES and self._failure not in IDENTITY_FAILURES):
                    self._failure = incoming["reason"]
            if data.get("cleanupStarted") or self._failure in WAIT_TIMEOUTS | CANCELLED:
                return self._set(phase="cleanup", message="正在结束本次设置并恢复微信…",
                                 can_continue=False, continue_action="", error_code="")
            if self._failure:
                return self._failed_view(self._failure)
            observer = data.get("observerEvents", {})
            if observer.get("resolve_failed", 0) or observer.get("write_failed", 0):
                self._failure = "observer-forwarding-failed"
                return self._failed_view(self._failure)
            if data.get("watchdogAlive") is False:
                self._failure = "candidate-watchdog-exited"
                return self._failed_view(self._failure)
            count = data.get("processCount", 0)
            if count > 1 or self._process_seen and (count == 0 or data.get("processVerified") is False):
                self._failure = "candidate-process-not-unique" if count > 1 else "candidate-generation-changed"
                return self._failed_view(self._failure)
            verified = count == 1 and data.get("processVerified") is True and data.get("watchdogAlive") is True
            if verified and not self._process_seen:
                self._process_seen, self._process_seen_at = True, self._clock()
            if self._authenticated and (incoming.get("candidateAuthenticated") is False
                    or "accountStatus" in incoming and incoming["accountStatus"] != "verified"):
                self._failure = "active-account-changed"
                return self._failed_view(self._failure)
            if incoming.get("candidateAuthenticated") is True:
                _need(verified and data.get("accountStatus") == "verified", "setup-authentication-facts-incomplete")
                self._authenticated = True
            if data.get("selectedReadStarted"):
                _need(self._authenticated and verified, "setup-selected-read-unverified")
                return self._set(phase="reading-selected", message="正在读取所选联系人的资料…",
                                 can_continue=False, continue_action="", error_code="")
            user_wait = data.get("userActionRequired") or (verified and data.get("accountStatus") == "not-ready"
                and self._clock() - self._process_seen_at >= self._grace)
            if user_wait and not self._authenticated:
                return self._set(phase="waiting-for-user", message="请在微信或系统窗口完成首次设置，然后点「继续」。",
                    can_continue=True, continue_action="recheck-current-attempt", error_code="")
            if verified:
                return self._set(phase="checking-account", message="正在核对微信当前账号…",
                                 can_continue=False, continue_action="", error_code="")
            return self._set(phase="waiting-for-app-start", message="正在等待微信首次设置窗口启动…",
                             can_continue=False, continue_action="", error_code="")

    def _failed_view(self, reason, *, active=None):
        identity = reason in IDENTITY_FAILURES
        code = ("PROCESS_CHANGED" if identity else "WATCHDOG_EXITED" if reason == "candidate-watchdog-exited"
                else "OBSERVER_UNAVAILABLE" if reason == "observer-forwarding-failed" else "SETUP_FAILED")
        changes = {} if active is None else {"active": active}
        return self._set(**changes, phase="failed", can_continue=False, continue_action="", error_code=code,
            message="微信账号或进程已变化，请重新核对账号后设置。" if identity else "本机设置未完成，正在等待安全结束本次设置。")

    def finish(self, attempt, result):
        """Consume aggregate result only; discard all unrelated/raw fields."""
        _need(isinstance(result, dict), "setup-result-invalid")
        with self._lock:
            if type(attempt) is not int or attempt != self._view.attempt or not self._view.active:
                return self._view.public()
            for name in ("ok", "runtimeCleanupComplete", "originalRestored", "candidateAuthenticated"):
                _need(name not in result or type(result[name]) is bool, "setup-result-invalid")
            reported = _reason(result.get("reason", ""))
            reason = (self._failure if self._failure and self._failure not in WAIT_TIMEOUTS | CANCELLED
                      else reported or self._failure)
            self._cleanup_complete = result.get("runtimeCleanupComplete") is True
            self._restored = result.get("originalRestored") is True
            restore_required = self._may_have_started or reason in WAIT_TIMEOUTS | CANCELLED or result.get("candidateAuthenticated") is True
            self._settled = self._cleanup_complete and (not restore_required or self._restored)
            if not self._settled:
                return self._set(active=False, phase="failed", message="本次设置尚未完成清理或恢复，请先检查微信窗口。",
                    can_continue=False, continue_action="", error_code="CLEANUP_INCOMPLETE")
            if reason in WAIT_TIMEOUTS | CANCELLED:
                return self._set(active=False, phase="waiting-for-user",
                    message="首次设置尚未完成。请在微信或系统窗口完成设置，再点「继续」重新核对。" if reason in WAIT_TIMEOUTS
                            else "已停止本次设置，稍后可点「继续」重新核对。",
                    can_continue=True, continue_action="start-fresh-attempt", error_code="SETUP_PENDING")
            if reason or result.get("ok") is not True:
                return self._failed_view(reason or "setup-failed", active=False)
            if result.get("candidateAuthenticated") is not True:
                return self._set(active=False, phase="failed", message="当前账号尚未通过核对，请重新设置。",
                    can_continue=False, continue_action="", error_code="AUTHORIZATION_NOT_VERIFIED")
            return self._set(active=False, phase="completed", message="本次设置检查已完成。",
                             can_continue=False, continue_action="", error_code="")

    def continue_setup(self, attempt):
        """Return a controller instruction, never a grant or deadline extension."""
        with self._lock:
            _need(type(attempt) is int and attempt == self._view.attempt, "setup-attempt-stale")
            _need(self._view.can_continue, "setup-continuation-unavailable")
            action = self._view.continue_action
            if action == "start-fresh-attempt":
                _need(self._cleanup_complete and self._restored, "setup-cleanup-incomplete")
            self._set(phase="checking-account", message="正在重新核对微信当前状态…",
                      can_continue=False, continue_action="", error_code="")
            return {"attempt": attempt, "action": action, "requires_fresh_proof": True,
                    "renews_deadline": False, "authorization_granted": False}
