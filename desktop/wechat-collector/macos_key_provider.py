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
COLLECTOR_BUNDLE_ID = "love.lovetalk.coach.collector.macpreview"
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
EXPERIMENTAL_BUILD = ("4.1.15", "270135")
EXPERIMENTAL_WORKER_CAPABILITY = "macos-270135-local-experiment-v1"
_experimental_authorization = None


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


@dataclass(repr=False)
class ExperimentalWorkerAuthorization:
    """Private spawned-worker capability; never accepted as normal version 1."""
    account: str
    key: bytearray = field(repr=False)
    salt: bytes = field(repr=False)
    build: tuple[str, str]
    expires: float
    pid: int
    uid: int
    start_seconds: int
    start_microseconds: int
    code_stamp: tuple
    version: int = 2
    capability: str = EXPERIMENTAL_WORKER_CAPABILITY

    def __repr__(self):
        return "<ExperimentalMacWorkerAuthorization redacted>"

    def close(self):
        if isinstance(self.key, bytearray):
            self.key[:] = b"\0" * len(self.key)
            self.key.clear()
        else:
            self.key = bytearray()


@dataclass(repr=False)
class _ExperimentalAuthorization:
    account: Path
    key: bytearray = field(repr=False)
    contact_key: bytearray = field(repr=False)
    salt: bytes = field(repr=False)
    proof: dict = field(repr=False)
    code_stamp: tuple
    expires: float

    def __repr__(self):
        return "<ExperimentalMacAuthorization redacted>"

    def close(self):
        for value in (self.key, self.contact_key):
            value[:] = b"\0" * len(value)
            value.clear()
        self.proof.clear()


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
    with _lock:
        if _experimental_authorization is not None:
            return dict(_validate_experimental_authorization().proof)
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
    fields = ("pid", "started", "account", "build")
    if proof.get("experimental") is True:
        fields += ("uid", "startSeconds", "startMicroseconds", "experimental")
    if any(current.get(field) != proof.get(field) for field in fields):
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
        if _experimental_authorization is not None:
            state = experimental_status(validate=True)
            dependencies = all(importlib.util.find_spec(name) is not None for name in ("apsw", "cryptography", "psutil"))
            return {**state, "ready": state["ready"] and dependencies, "dependenciesReady": dependencies,
                    "platform": "macos-arm64", "initializationRequired": not state["ready"],
                    "message": "本机实验读取已就绪。" if state["ready"] else "本机实验授权已失效，请重新设置。"}
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


def _regular_component_path(root, relative, *, directory=False):
    """Reject linked sources and linked parent directories within the fixed root."""
    relative = Path(relative)
    if relative.is_absolute() or not relative.parts or any(part in {".", ".."} for part in relative.parts):
        raise ValueError("invalid component path")
    current = root
    for part in relative.parts:
        current = current / part
        if current.is_symlink():
            raise ValueError("linked component")
    metadata = current.lstat()
    if not (stat.S_ISDIR(metadata.st_mode) if directory else stat.S_ISREG(metadata.st_mode)):
        raise ValueError("invalid component type")
    if not current.resolve(strict=True).is_relative_to(root.resolve(strict=True)):
        raise ValueError("component escaped root")
    return current


def _upstream_vendor_root():
    if not getattr(sys, "frozen", False):
        return _regular_component_path(Path(__file__).resolve().parent, "vendor", directory=True)
    # PyInstaller's Python __file__ is under Frameworks, whose resource entries
    # are symlinks. Import the real, pinned sources in Resources instead. Neither
    # _MEIPASS nor a search of neighbouring directories may choose this root.
    executable = Path(sys.executable)
    if (not executable.is_absolute() or ".." in executable.parts
            or executable.parent.name != "MacOS" or executable.parent.parent.name != "Contents"
            or executable.parent.parent.parent.suffix != ".app"):
        raise ValueError("invalid app executable")
    bundle = executable.parent.parent.parent
    if bundle.is_symlink() or not bundle.is_dir():
        raise ValueError("linked app")
    _regular_component_path(bundle, executable.relative_to(bundle))
    info_path = _regular_component_path(bundle, "Contents/Info.plist")
    with info_path.open("rb") as handle:
        info = plistlib.load(handle)
    if (info.get("CFBundleIdentifier") != COLLECTOR_BUNDLE_ID
            or info.get("CFBundleExecutable") != executable.name):
        raise ValueError("unexpected collector bundle")
    return _regular_component_path(bundle, "Contents/Resources/vendor", directory=True)


def _verify_frozen_native_inputs(vendor):
    """Allow PyInstaller's two internal binary links, never an external target."""
    bundle = vendor.parents[2].resolve(strict=True)
    for name in ("macos_memory_scan", "macos_wechat_key_capture.dylib"):
        resource = vendor / "chatlog_keeper/scripts" / name
        target = resource.resolve(strict=True)
        allowed = (bundle / "Contents/Resources/vendor/chatlog_keeper/scripts" / name,
                   bundle / "Contents/Frameworks/vendor/chatlog_keeper/scripts" / name)
        if target not in allowed:
            raise ValueError("native component escaped fixed bundle location")
        _regular_component_path(bundle, target.relative_to(bundle))


def _load_upstream():
    try:
        vendor = _upstream_vendor_root()
        pin_path = _regular_component_path(vendor, "chatlog-keeper-pin.json")
        pin = json.loads(pin_path.read_text(encoding="utf-8-sig"))
        if (pin.get("commit") != UPSTREAM_COMMIT or not isinstance(pin.get("files"), dict)
                or not pin["files"]):
            raise ValueError("invalid component pin")
        package_path = _regular_component_path(vendor, "chatlog_keeper", directory=True)
        # These Python/C sources are shipped with the app. Never download a script.
        for relative, digest in pin["files"].items():
            if (not isinstance(relative, str) or "\\" in relative or not isinstance(digest, str)
                    or not re.fullmatch(r"[a-f0-9]{64}", digest)):
                raise ValueError("invalid source pin")
            path = _regular_component_path(package_path, relative)
            if hashlib.sha256(path.read_bytes()).hexdigest() != digest:
                raise ValueError("component hash mismatch")
        if getattr(sys, "frozen", False):
            _verify_frozen_native_inputs(vendor)
    except (OSError, ValueError, KeyError, TypeError, plistlib.InvalidFileException):
        raise _fail("MAC_COMPONENT_INVALID", "Mac 授权组件校验失败，请重新安装助手。") from None
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
    clear_experimental_authorization()
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
        if _experimental_authorization is not None:
            authorization = _validate_experimental_authorization()
            if authorization.account != account:
                clear_experimental_authorization()
                raise _fail("ACCOUNT_CHANGED", "微信账号已变化，请重新设置。")
            return bytes(authorization.key)
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
    with _lock:
        if _experimental_authorization is not None:
            authorization = _validate_experimental_authorization()
            proof = authorization.proof
            return ExperimentalWorkerAuthorization(str(authorization.account), bytearray(authorization.key), authorization.salt,
                EXPERIMENTAL_BUILD, min(authorization.expires, time.monotonic() + WORKER_TTL), proof["pid"], proof["uid"],
                proof["startSeconds"], proof["startMicroseconds"], authorization.code_stamp)
    proof = current_account_proof()
    key = get_authorized_key(proof["account"])
    _, header = _read_contact_header(proof["account"])
    return WorkerAuthorization(str(proof["account"]), bytearray(key), header[:16], proof["build"], time.monotonic() + WORKER_TTL)


def import_worker_authorization(payload):
    global _authorization
    if type(payload) is ExperimentalWorkerAuthorization:
        return _import_experimental_worker(payload)
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


def clear_experimental_authorization():
    global _experimental_authorization
    with _lock:
        if _experimental_authorization is not None:
            _experimental_authorization.close()
        _experimental_authorization = None


def _native_generation(pid):
    """Public libproc identity; no debugger, AX, key helper or app launch."""
    import ctypes as C
    class BSD(C.Structure):
        _fields_ = [(name, C.c_uint32) for name in ("flags", "status", "xstatus", "pid", "ppid", "uid", "gid", "ruid", "rgid", "svuid", "svgid", "reserved")]
        _fields_ += [("comm", C.c_char * 16), ("name", C.c_char * 32)]
        _fields_ += [(name, C.c_uint32) for name in ("nfiles", "pgid", "pjobc", "tdev", "tpgid")]
        _fields_ += [("nice", C.c_int32), ("seconds", C.c_uint64), ("microseconds", C.c_uint64)]
    library = C.CDLL("/usr/lib/libproc.dylib")
    library.proc_pidinfo.argtypes = [C.c_int, C.c_int, C.c_uint64, C.c_void_p, C.c_int]
    library.proc_pidinfo.restype = C.c_int
    library.proc_pidpath.argtypes = [C.c_int, C.c_void_p, C.c_uint32]
    library.proc_pidpath.restype = C.c_int
    info, path = BSD(), C.create_string_buffer(4096)
    if (C.sizeof(info) != 136 or library.proc_pidinfo(pid, 3, 0, C.byref(info), C.sizeof(info)) != C.sizeof(info)
            or library.proc_pidpath(pid, path, len(path)) <= 0 or path.value != os.fsencode((WECHAT_APP / "Contents/MacOS/WeChat").resolve())
            or info.pid != pid or info.uid != os.getuid() or info.ruid != os.getuid()
            or info.seconds <= 0 or not 0 <= info.microseconds < 1_000_000):
        raise _fail("ACCOUNT_CHANGED", "微信进程已变化，请重新设置。")
    return int(info.uid), int(info.seconds), int(info.microseconds)


def _original_code_stamp():
    result = []
    for relative in ("Contents/MacOS/WeChat", "Contents/Info.plist", "Contents/_CodeSignature/CodeResources"):
        path = WECHAT_APP / relative
        info = path.lstat()
        if path.is_symlink() or path.resolve() != path or not stat.S_ISREG(info.st_mode):
            raise _fail("ACCOUNT_CHANGED", "微信程序已变化，请重新设置。")
        result.append((info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns))
    return tuple(result)


def experimental_original_proof(*, consent=False, expected=None, verify_signature=False):
    """Explicit local experiment proof. Does not modify SUPPORTED_BUILDS."""
    if consent is not True:
        raise _fail("MAC_LOCAL_CONSENT_REQUIRED", "请在本机确认实验设置。")
    _require_mac()
    if bundle_metadata() != EXPERIMENTAL_BUILD:
        raise _fail("MAC_WECHAT_VERSION_UNSUPPORTED", "当前微信不属于本次本机实验版本。")
    if verify_signature:
        _verify_official_bundle()
    processes = _processes()
    if len(processes) != 1:
        raise _fail("WECHAT_NOT_LOGGED_IN" if not processes else "MAC_ACCOUNT_AMBIGUOUS", "请在原微信完成同一账号登录。")
    pid = processes[0][0]
    before = _native_generation(pid)
    accounts = {account for name in _open_database_files(pid) if (account := _account_from_file(name)) is not None}
    if len(accounts) != 1:
        raise _fail("MAC_ACCOUNT_UNVERIFIED", "正在等待原微信打开当前账号资料。")
    if _processes() != processes or _native_generation(pid) != before:
        raise _fail("ACCOUNT_CHANGED", "微信进程已变化，请重新设置。")
    uid, seconds, microseconds = before
    proof = {"pid": pid, "uid": uid, "startSeconds": seconds, "startMicroseconds": microseconds,
             "started": seconds + microseconds / 1_000_000, "account": accounts.pop(), "build": EXPERIMENTAL_BUILD, "experimental": True}
    if expected is not None and any(proof.get(name) != expected.get(name) for name in proof):
        raise _fail("ACCOUNT_CHANGED", "微信账号或进程已变化，请重新设置。")
    return proof


def _validate_experimental_authorization():
    with _lock:
        authorization = _experimental_authorization
        try:
            if authorization is None or not authorization.key or not time.monotonic() < authorization.expires:
                raise _fail("MAC_AUTHORIZATION_REQUIRED", "本机实验授权已过期，请重新设置。")
            experimental_original_proof(consent=True, expected=authorization.proof)
            if _original_code_stamp() != authorization.code_stamp:
                raise _fail("ACCOUNT_CHANGED", "微信程序已变化，请重新设置。")
            _, header = _read_contact_header(authorization.account)
            import sqlcipher_primitives as primitive
            if header[:16] != authorization.salt or not primitive._verify_enc_key(authorization.contact_key, header):
                raise _fail("ACCOUNT_CHANGED", "微信账号资料已变化，请重新设置。")
            if not time.monotonic() < authorization.expires:
                raise _fail("MAC_AUTHORIZATION_REQUIRED", "本机实验授权已过期，请重新设置。")
            return authorization
        except BaseException:
            clear_experimental_authorization()
            raise


def register_experimental_original(*, proof, key, salt, expires, consent=False):
    """Only the explicit local handoff owner calls this private registration."""
    global _experimental_authorization
    from macos_candidate_handoff import OriginalProof
    if consent is not True or type(proof) is not OriginalProof:
        raise _fail("MAC_LOCAL_CONSENT_REQUIRED", "请在本机确认实验设置。")
    generation = proof.generation
    if not (all(type(value) is int for value in (generation.pid, generation.uid, generation.seconds, generation.microseconds))
            and generation.pid > 0 and generation.uid >= 0 and generation.seconds > 0 and 0 <= generation.microseconds < 1_000_000):
        raise _fail("MAC_AUTHORIZATION_REQUIRED", "实验账号进程证明无效。")
    expected = {"pid": generation.pid, "uid": generation.uid, "startSeconds": generation.seconds,
                "startMicroseconds": generation.microseconds, "started": generation.seconds + generation.microseconds / 1_000_000,
                "account": proof.account, "build": proof.build, "experimental": True}
    if proof.build != EXPERIMENTAL_BUILD or len(key) != 32 or len(salt) != 16 or not time.monotonic() < expires <= time.monotonic() + 600:
        raise _fail("MAC_AUTHORIZATION_REQUIRED", "实验授权范围无效或已过期。")
    observed = experimental_original_proof(consent=True, expected=expected, verify_signature=True)
    stamp = _original_code_stamp()
    _, header = _read_contact_header(observed["account"])
    effective = effective_page_key(key, header)
    if header[:16] != salt or effective is None:
        raise _fail("ACCOUNT_CHANGED", "原微信账号资料未通过核对。")
    authorization = _ExperimentalAuthorization(observed["account"], bytearray(key), bytearray(effective), salt, observed, stamp, expires)
    with _lock:
        clear_experimental_authorization()
        _experimental_authorization = authorization
    try:
        _validate_experimental_authorization()
    except BaseException:
        clear_experimental_authorization()
        raise
    return experimental_status(validate=False)


def _import_experimental_worker(payload):
    global _experimental_authorization
    clear_experimental_authorization()
    try:
        if (payload.version != 2 or payload.capability != EXPERIMENTAL_WORKER_CAPABILITY or payload.build != EXPERIMENTAL_BUILD
                or type(payload.key) is not bytearray or len(payload.key) != 32 or type(payload.salt) is not bytes
                or len(payload.salt) != 16 or not time.monotonic() < payload.expires <= time.monotonic() + 600
                or not all(type(value) is int for value in (payload.pid, payload.uid, payload.start_seconds, payload.start_microseconds))
                or payload.pid <= 0 or payload.uid < 0 or payload.start_seconds <= 0 or not 0 <= payload.start_microseconds < 1_000_000):
            raise _fail("MAC_AUTHORIZATION_REQUIRED", "实验后台授权无效或已过期。")
        expected = {"pid": payload.pid, "uid": payload.uid, "startSeconds": payload.start_seconds,
            "startMicroseconds": payload.start_microseconds, "started": payload.start_seconds + payload.start_microseconds / 1_000_000,
            "account": Path(payload.account), "build": payload.build, "experimental": True}
        observed = experimental_original_proof(consent=True, expected=expected, verify_signature=True)
        if _original_code_stamp() != payload.code_stamp:
            raise _fail("ACCOUNT_CHANGED", "微信程序已变化，后台读取未启动。")
        _, header = _read_contact_header(observed["account"])
        effective = effective_page_key(payload.key, header)
        if header[:16] != payload.salt or effective is None:
            raise _fail("ACCOUNT_CHANGED", "后台账号资料未通过核对。")
        with _lock:
            _experimental_authorization = _ExperimentalAuthorization(observed["account"], bytearray(payload.key),
                bytearray(effective), payload.salt, observed, payload.code_stamp, payload.expires)
        _validate_experimental_authorization()
    except BaseException:
        clear_experimental_authorization()
        raise
    finally:
        payload.close()


def experimental_status(*, validate=True):
    try:
        authorization = _validate_experimental_authorization() if validate else _experimental_authorization
        ready = authorization is not None and bool(authorization.key) and time.monotonic() < authorization.expires
        if not ready:
            clear_experimental_authorization()
        return {"ready": ready, "experimental": True, "status": "experimental-authorized" if ready else "experimental-setup-required",
                "productionReady": False, "realDeviceValidated": False}
    except Exception:
        return {"ready": False, "experimental": True, "status": "experimental-setup-required", "productionReady": False,
                "realDeviceValidated": False}
