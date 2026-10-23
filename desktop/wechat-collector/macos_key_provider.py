"""Mac authorization for the user's currently open WeChat account.

Only a direct, explicit local action can start the pinned upstream initializer.
Regular collection never extracts a key, launches WeChat or changes signatures.
Master keys live only in this process and a bounded private worker handoff.
"""
from __future__ import annotations

from dataclasses import dataclass, field
import hashlib
import importlib
import importlib.util
import json
import os
from pathlib import Path
import platform
import plistlib
import re
import stat
import subprocess
import sys
import threading
import time

from background_reader import BackgroundCaptureError
from sqlcipher_primitives import effective_page_key

UPSTREAM_COMMIT = "2225294fd0761e10ce15540f21e7dbb2ac304c3c"
SUPPORTED_BUILDS = frozenset({("4.1.11", "269136"), ("4.1.12", "269340"),
    ("4.1.12", "269364"), ("4.1.13", "269579"), ("4.1.15", "270100"), ("4.1.15", "270102")})
WECHAT_APP = Path("/Applications/WeChat.app")
PREPARE_TTL = 600
# One bounded background job may run for 20 minutes. Include a minute for spawn
# and handoff; no worker can request an unbounded or refreshed authorization.
WORKER_TTL = 21 * 60
_lock = threading.RLock()
_initializing = threading.Lock()
_prepared = None
_authorization = None


def _fail(code, message):
    return BackgroundCaptureError(code, message)


@dataclass(repr=False)
class _Authorization:
    account: Path
    key: bytearray = field(repr=False)
    salt: bytes = field(repr=False)
    build: tuple[str, str]
    expires: float | None = None

    def __repr__(self):
        return "<MacWeChatAuthorization redacted>"

    def close(self):
        self.key[:] = b"\0" * len(self.key)
        self.key.clear()


@dataclass(repr=False)
class WorkerAuthorization:
    """Internal pickle-only payload. Never put this in requests or JSON results."""
    account: str
    key: bytearray = field(repr=False)
    salt: bytes = field(repr=False)
    build: tuple[str, str]
    expires: float
    version: int = 1

    def __repr__(self):
        return "<MacWeChatWorkerAuthorization redacted>"

    def close(self):
        self.key[:] = b"\0" * len(self.key)
        self.key.clear()


def _require_mac():
    if sys.platform != "darwin" or platform.machine().lower() not in {"arm64", "aarch64"}:
        raise _fail("MAC_UNSUPPORTED_PLATFORM", "Mac 采集测试版需要 Apple 芯片，并使用原生 arm64 助手。")


def bundle_metadata(app=None):
    app = WECHAT_APP if app is None else Path(app)
    try:
        info_path = app / "Contents" / "Info.plist"
        if app.is_symlink() or info_path.is_symlink():
            raise ValueError("unexpected link")
        with info_path.open("rb") as handle:
            info = plistlib.load(handle)
        if info.get("CFBundleIdentifier") != "com.tencent.xinWeChat" or info.get("CFBundleExecutable") != "WeChat":
            raise ValueError("unexpected bundle")
        return str(info["CFBundleShortVersionString"]), str(info["CFBundleVersion"])
    except (OSError, ValueError, KeyError, plistlib.InvalidFileException):
        raise _fail("MAC_WECHAT_NOT_FOUND", "请将官方 Mac 微信安装到「应用程序」，再打开并登录。") from None


def _require_supported_bundle():
    _require_mac()
    build = bundle_metadata()
    if build not in SUPPORTED_BUILDS:
        raise _fail("MAC_WECHAT_VERSION_UNSUPPORTED", f"当前微信 {build[0]}（{build[1]}）尚未完成 Mac 采集适配，请先使用截图导入。")
    return build


def _verify_official_bundle():
    try:
        verified = subprocess.run(["/usr/bin/codesign", "--verify", "--deep", "--strict", str(WECHAT_APP)],
                                  capture_output=True, timeout=30, check=False)
        details = subprocess.run(["/usr/bin/codesign", "-d", "--verbose=4", str(WECHAT_APP)],
                                 capture_output=True, text=True, timeout=10, check=False)
    except (OSError, subprocess.SubprocessError):
        raise _fail("MAC_WECHAT_SIGNATURE_INVALID", "无法核验微信官方签名，请重新安装官方微信后重试。") from None
    if verified.returncode != 0 or details.returncode != 0 or not re.search(r"^TeamIdentifier=5A4RE8SF68\s*$", details.stderr, re.M):
        raise _fail("MAC_WECHAT_SIGNATURE_INVALID", "微信官方签名不匹配，请重新安装官方微信后重试。")


def data_roots():
    home = Path.home()
    return (home / "Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files",
            home / "Library/Group Containers/5A4RE8SF68.com.tencent.xinWeChat/xwechat_files")


def _account_from_file(filename):
    raw = Path(filename)
    if not raw.is_absolute():
        return None
    try:
        for root in data_roots():
            if root.is_symlink():
                continue
            relative = raw.relative_to(root)
            if len(relative.parts) < 4 or relative.parts[1] != "db_storage":
                continue
            if raw.suffix != ".db" and not raw.name.endswith((".db-wal", ".db-shm")):
                continue
            account = root / relative.parts[0]
            # A redirect into another account/container must never change scope.
            if account.is_symlink() or (account / "db_storage").is_symlink():
                continue
            if account.resolve().parent != root.resolve() or not raw.resolve().is_relative_to((account / "db_storage").resolve()):
                continue
            return account.resolve()
    except (OSError, ValueError):
        pass
    return None


def _processes():
    import psutil
    executable = str(WECHAT_APP / "Contents/MacOS/WeChat")
    result = []
    for process in psutil.process_iter(["pid", "exe", "create_time", "uids"]):
        try:
            info = process.info
            if info.get("exe") != executable:
                continue
            if info.get("uids") is None or info["uids"].real != os.getuid():
                raise _fail("MAC_ACCOUNT_UNVERIFIED", "微信进程所属账号无法核对。")
            result.append((int(info["pid"]), float(info["create_time"])))
        except (psutil.NoSuchProcess, psutil.ZombieProcess):
            continue
        except psutil.AccessDenied:
            raise _fail("MAC_FILE_ACCESS_REQUIRED", "请在系统设置中允许成子助手访问微信数据，再重新打开助手。") from None
    return result


def _open_database_files(pid):
    import psutil
    try:
        files = psutil.Process(pid).open_files()
        return [item.path for item in files]
    except (psutil.AccessDenied, psutil.NoSuchProcess, OSError):
        raise _fail("MAC_FILE_ACCESS_REQUIRED", "无法核对微信当前打开的数据库，请允许成子助手完全磁盘访问后重试。") from None


def current_account_proof():
    """Bind only the current owned official process's open DBs, never old directories."""
    build = _require_supported_bundle()
    processes = _processes()
    if len(processes) != 1:
        raise _fail("WECHAT_NOT_LOGGED_IN" if not processes else "MAC_ACCOUNT_AMBIGUOUS",
                    "请打开官方微信并登录一个账号，再开始导入。")
    pid, started = processes[0]
    accounts = {account for name in _open_database_files(pid) if (account := _account_from_file(name)) is not None}
    if len(accounts) != 1 or _processes() != processes:
        raise _fail("MAC_ACCOUNT_UNVERIFIED", "尚无法唯一核对微信当前账号，请打开一个聊天后重试。")
    account = accounts.pop()
    return {"pid": pid, "started": started, "account": account, "build": build}


def verify_account_proof(proof):
    current = current_account_proof()
    if any(current.get(field) != proof.get(field) for field in ("pid", "started", "account", "build")):
        raise _fail("ACCOUNT_CHANGED", "微信已重开或切换账号，本次读取已停止，请重新选择联系人。")


def _read_contact_header(account):
    base = Path(account) / "db_storage"
    path = base / "contact/contact.db"
    try:
        if path.is_symlink() or not path.resolve().is_relative_to(base.resolve()):
            raise ValueError("invalid path")
        before = path.stat()
        with path.open("rb") as handle:
            header = handle.read(4096)
        after = path.stat()
        if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns) or len(header) != 4096:
            raise ValueError("changed")
        return path, header
    except (OSError, ValueError):
        raise _fail("MAC_DATABASE_UNAVAILABLE", "微信联系人数据库尚未就绪，请完成同步后重试。") from None


def probe_setup():
    """Metadata/dependency readiness only. Does not open chat DBs or process memory."""
    try:
        build = _require_supported_bundle()
        dependencies = all(importlib.util.find_spec(name) is not None for name in ("apsw", "cryptography", "psutil"))
        with _lock:
            authorized = _authorization is not None and bool(_authorization.key)
        return {"ready": dependencies and authorized, "dependenciesReady": dependencies,
                "status": ("authorized" if authorized else "authorization-required") if dependencies else "missing-components", "platform": "macos-arm64",
                "wechatVersion": build[0], "wechatBuild": build[1], "initializationRequired": not authorized,
                "message": ("Mac 本地读取已授权。" if authorized else "请在助手窗口完成一次 Mac 微信读取授权。") if dependencies else "Mac 读取组件未安装完整，请重新安装助手。"}
    except BackgroundCaptureError as exc:
        return {"ready": False, "dependenciesReady": False, "status": getattr(exc, "code", "unsupported-platform"),
                "platform": "macos-arm64", "message": str(exc)}


def _private_support_dir():
    root = Path.home() / "Library/Application Support/ChengziCollector"
    for path in (root, root / "mac-support"):
        path.mkdir(mode=0o700, exist_ok=True)
        metadata = path.lstat()
        if not stat.S_ISDIR(metadata.st_mode) or path.is_symlink() or metadata.st_uid != os.getuid():
            raise _fail("MAC_SUPPORT_DIRECTORY_INVALID", "本机授权组件目录无法核验，请重新安装助手。")
        path.chmod(0o700)
    return root / "mac-support"


def _load_upstream():
    vendor = Path(__file__).resolve().parent / "vendor"
    pin = json.loads((vendor / "chatlog-keeper-pin.json").read_text(encoding="utf-8-sig"))
    if pin.get("commit") != UPSTREAM_COMMIT:
        raise _fail("MAC_COMPONENT_INVALID", "Mac 授权组件版本无法核验，请重新安装助手。")
    # These Python/C sources are shipped with the app. Never download a script.
    for relative, digest in pin["files"].items():
        path = vendor / "chatlog_keeper" / relative
        if not path.resolve().is_relative_to((vendor / "chatlog_keeper").resolve()) or path.is_symlink() or hashlib.sha256(path.read_bytes()).hexdigest() != digest:
            raise _fail("MAC_COMPONENT_INVALID", "Mac 授权组件校验失败，请重新安装助手。")
    existing = sys.modules.get("chatlog_keeper")
    if existing is not None and not Path(existing.__file__).resolve().is_relative_to(vendor.resolve()):
        raise _fail("MAC_COMPONENT_INVALID", "Mac 授权组件发生冲突，请重新打开助手。")
    if existing is None:
        package_path = vendor / "chatlog_keeper"
        specification = importlib.util.spec_from_file_location("chatlog_keeper", package_path / "__init__.py",
                                                              submodule_search_locations=[str(package_path)])
        package = importlib.util.module_from_spec(specification)
        sys.modules["chatlog_keeper"] = package
        specification.loader.exec_module(package)
    resolver = importlib.import_module("chatlog_keeper.core._path_resolver")
    resolver.data_dir = _private_support_dir
    return importlib.import_module("chatlog_keeper.active_key")


def clear_authorization():
    global _authorization, _prepared
    with _lock:
        if _authorization is not None:
            _authorization.close()
        _authorization = None
        _prepared = None


def prepare_authorized_access():
    """Freeze current account BEFORE the user normally quits daily WeChat."""
    global _prepared
    _verify_official_bundle()
    proof = current_account_proof()
    _, header = _read_contact_header(proof["account"])
    verify_account_proof(proof)
    with _lock:
        _prepared = (proof["account"], header[:16], proof["build"], time.monotonic() + PREPARE_TTL)
    return {"status": "close-wechat-required", "message": "已核对当前账号。请从微信菜单正常退出微信，再点「继续授权」。"}


def _initialization_failure():
    """Only fixed reason codes leave the upstream boundary, never raw transcripts."""
    reason = ""
    for name in ("macos_wechat_capture", "macos_debug_app", "macos_key"):
        module = sys.modules.get("chatlog_keeper." + name)
        if module is not None:
            candidate = module.last_error()
            if candidate:
                reason = candidate
                break
    if reason in {"helper_compile_failed", "capture_compile_failed", "capture_source_unreadable"}:
        return _fail("MAC_COMPONENTS_MISSING", "本机授权组件未安装完整，请使用完整 Mac 安装包。")
    if reason == "daily_client_single_instance_conflict":
        return _fail("MAC_WECHAT_MUST_CLOSE", "请从微信菜单正常退出原微信后再继续授权。")
    if reason == "debug_copy_unsupported_client":
        return _fail("MAC_WECHAT_VERSION_UNSUPPORTED", "当前微信版本尚未完成 Mac 采集适配，请先使用截图导入。")
    if reason in {"capture_library_not_loaded", "capture_native_write_failed", "process_access_denied"}:
        return _fail("MAC_FILE_ACCESS_REQUIRED", "请允许临时微信窗口访问应用数据，并在系统设置中允许成子助手完全磁盘访问，再重试授权。")
    if reason in {"capture_no_kdf_calls", "capture_kdf_shape_unmatched"}:
        return _fail("MAC_WECHAT_LOGIN_REQUIRED", "临时微信尚未完成账号读取，请确认已点击「进入微信」并完成手机登录确认。")
    if reason == "debug_copy_cleanup_failed":
        return _fail("MAC_TEMP_CLIENT_CLOSE_REQUIRED", "请正常关闭本次临时微信窗口后重试，原微信应用未更改。")
    return _fail("MAC_KEY_UNAVAILABLE", "本次 Mac 微信授权未完成，请确认临时窗口已登录并允许访问数据后重试。")


def initialize_authorized_access(*, consent=False, cancel=None, progress=None, timeout=180):
    """Local GUI only. Open a temporary compatible copy after explicit user action."""
    global _authorization
    if consent is not True:
        raise _fail("MAC_LOCAL_CONSENT_REQUIRED", "请在本机助手窗口确认 Mac 微信读取授权。")
    if not _initializing.acquire(blocking=False):
        raise _fail("MAC_AUTHORIZATION_BUSY", "Mac 微信授权正在进行，请稍候。")
    canceled = cancel or (lambda: False)
    report = progress or (lambda _message: None)
    try:
        build = _require_supported_bundle()
        if canceled():
            raise _fail("CANCELLED", "已取消 Mac 微信授权。")
        _verify_official_bundle()
        if _processes():
            prepare_authorized_access()
            raise _fail("MAC_WECHAT_MUST_CLOSE", "已核对当前账号。请从微信菜单正常退出微信，再点「继续授权」。")
        with _lock:
            prepared = _prepared
        if prepared is None or prepared[3] <= time.monotonic() or prepared[2] != build:
            raise _fail("MAC_ACCOUNT_PREPARATION_REQUIRED", "请先打开并登录微信，点击授权核对当前账号，再正常退出微信继续。")
        account, salt, _, _ = prepared
        path, before = _read_contact_header(account)
        if before[:16] != salt:
            raise _fail("ACCOUNT_CHANGED", "当前账号数据库已变化，请打开微信重新授权。")
        upstream = _load_upstream()
        report("正在准备本机授权组件，原微信应用保持不变。")
        key = upstream.extract_wechat_key_active(db_path=str(path), timeout=max(30, min(int(timeout), 600)),
            _cancel_requested=canceled, _require_closed_client=True,
            _recovery_notify=lambda: report("请在临时微信窗口完成登录或系统授权，完成后会自动关闭临时窗口。"))
        if canceled():
            raise _fail("CANCELLED", "已取消 Mac 微信授权；请正常打开原微信。")
        if key is None:
            raise _initialization_failure()
        _, current = _read_contact_header(account)
        if current[:16] != salt or effective_page_key(key, current) is None:
            raise _fail("ACCOUNT_CHANGED", "授权窗口与先前选定账号不一致，未读取聊天。请重新打开原账号授权。")
        _verify_official_bundle()
        with _lock:
            if _authorization is not None:
                _authorization.close()
            _authorization = _Authorization(account, bytearray(key), salt, build)
        report("授权完成，请重新打开原微信，然后回网页选择联系人。")
        return {"status": "authorized", "message": "授权完成，请重新打开原微信。关闭助手后需重新授权。"}
    finally:
        _initializing.release()


def get_authorized_key(account_dir):
    """Internal only. Always authenticate the current contact DB before returning."""
    account = Path(account_dir).resolve()
    with _lock:
        authorization = _authorization
        if (authorization is None or not authorization.key or authorization.account != account or
                (authorization.expires is not None and authorization.expires <= time.monotonic())):
            raise _fail("MAC_AUTHORIZATION_REQUIRED", "请先在 Mac 助手窗口完成本次微信读取授权。")
        _, header = _read_contact_header(account)
        if header[:16] != authorization.salt or effective_page_key(bytes(authorization.key), header) is None:
            authorization.close()
            raise _fail("ACCOUNT_CHANGED", "微信账号数据库已变化，请重新授权后导入。")
        return bytes(authorization.key)


def export_worker_authorization():
    proof = current_account_proof()
    key = get_authorized_key(proof["account"])
    _, header = _read_contact_header(proof["account"])
    return WorkerAuthorization(str(proof["account"]), bytearray(key), header[:16], proof["build"], time.monotonic() + WORKER_TTL)


def import_worker_authorization(payload):
    global _authorization
    clear_authorization()
    try:
        if (not isinstance(payload, WorkerAuthorization) or payload.version != 1 or len(payload.key) != 32 or
                not time.monotonic() < payload.expires <= time.monotonic() + WORKER_TTL):
            raise _fail("MAC_AUTHORIZATION_REQUIRED", "Mac 读取授权已过期，请重新导入。")
        proof = current_account_proof()
        if str(proof["account"]) != payload.account or proof["build"] != payload.build:
            raise _fail("ACCOUNT_CHANGED", "Mac 微信当前账号已变化，请重新导入。")
        _, header = _read_contact_header(proof["account"])
        if header[:16] != payload.salt or effective_page_key(bytes(payload.key), header) is None:
            raise _fail("ACCOUNT_CHANGED", "Mac 微信当前数据库未通过校验。")
        with _lock:
            if _authorization is not None:
                _authorization.close()
            _authorization = _Authorization(proof["account"], bytearray(payload.key), payload.salt, payload.build, payload.expires)
    finally:
        if isinstance(payload, WorkerAuthorization):
            payload.close()
