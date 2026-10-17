"""Small, windowed Windows bootstrap for the frozen WeChat collector.

The release manifest is bundled inside the launcher executable. Download URLs
are built only from checked part names at the fixed first-party HTTPS origin.
This module never invokes a shell or PowerShell.
"""

from __future__ import annotations

import hashlib
import http.client
import json
import os
from pathlib import Path
import queue
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import threading
import time
from typing import Callable
import urllib.error
import urllib.request
import zipfile


DOWNLOAD_ROOT = "https://coach.lovetalk.love/downloads/"
DOWNLOAD_USER_AGENT = "Mozilla/5.0"
ASSISTANT_PORT = 17863
ASSISTANT_TITLE = "成子 · 电脑微信采集助手"
APP_NAME = "ChengziWeChatCollector"
EXE_NAME = APP_NAME + ".exe"
CHUNK_SIZE = 1024 * 1024
MAX_ARCHIVE_BYTES = 2 * 1024 * 1024 * 1024
MAX_UNPACKED_BYTES = 8 * 1024 * 1024 * 1024
Report = Callable[[str, float | None], None]


class InstallError(Exception):
    """A failure that can be shown directly in the bootstrap window."""


def _is_sha256(value: object) -> bool:
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value) is not None


def validate_manifest(value: object) -> dict:
    """Reject malformed manifests before any network or filesystem operation."""
    if not isinstance(value, dict):
        raise InstallError("安装信息无效，请重新从成子网站下载启动程序。")
    version = value.get("version")
    if not isinstance(version, str) or not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", version):
        raise InstallError("安装包版本无效，请重新下载启动程序。")
    size = value.get("bytes")
    if type(size) is not int or not 0 < size <= MAX_ARCHIVE_BYTES:
        raise InstallError("安装包大小无效，请重新下载启动程序。")
    if not _is_sha256(value.get("sha256")) or not _is_sha256(value.get("exeSha256")):
        raise InstallError("安装包校验信息无效，请重新下载启动程序。")
    parts = value.get("parts")
    if not isinstance(parts, list) or not 1 <= len(parts) <= 99:
        raise InstallError("安装包下载信息无效，请重新下载启动程序。")
    total = 0
    for index, part in enumerate(parts, 1):
        name = f"chengzi-wechat-collector-{version}.part{index:02}.bin"
        if not isinstance(part, dict) or part.get("name") != name:
            raise InstallError("安装包文件名无效，请重新下载启动程序。")
        part_size = part.get("bytes")
        if type(part_size) is not int or not 0 < part_size <= 12 * 1024 * 1024:
            raise InstallError("安装包分块大小无效，请重新下载启动程序。")
        if not _is_sha256(part.get("sha256")):
            raise InstallError("安装包分块校验信息无效，请重新下载启动程序。")
        total += part_size
    if total != size:
        raise InstallError("安装包总大小不一致，请重新下载启动程序。")
    return value


def embedded_manifest() -> dict:
    bundle = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
    try:
        return validate_manifest(json.loads((bundle / "manifest.json").read_text(encoding="utf-8")))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise InstallError("启动程序缺少安装信息，请重新从成子网站下载。") from error


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while block := source.read(CHUNK_SIZE):
            digest.update(block)
    return digest.hexdigest()


def verified_file(path: Path, expected_size: int, expected_hash: str) -> bool:
    return path.is_file() and path.stat().st_size == expected_size and file_sha256(path) == expected_hash


class _DenyRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        raise InstallError("下载地址发生变化，请稍后重试或从成子网站重新下载启动程序。")


def download_part(part: dict, destination: Path, progress: Callable[[int], None], opener=None) -> None:
    """Stream exactly one pinned part; unverified bytes never become executable."""
    expected_size = part["bytes"]
    if verified_file(destination, expected_size, part["sha256"]):
        progress(expected_size)
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(destination.name + ".download")
    temporary.unlink(missing_ok=True)
    url = DOWNLOAD_ROOT + part["name"]
    request = urllib.request.Request(url, headers={"User-Agent": DOWNLOAD_USER_AGENT})
    opener = opener or urllib.request.build_opener(_DenyRedirects())
    digest = hashlib.sha256()
    count = 0
    try:
        with opener.open(request, timeout=60) as response, temporary.open("wb") as output:
            if response.geturl() != url or response.status != 200:
                raise InstallError("下载地址验证失败，请稍后重试。")
            while block := response.read(CHUNK_SIZE):
                count += len(block)
                if count > expected_size:
                    raise InstallError("下载文件大小不一致，请稍后重试。")
                output.write(block)
                digest.update(block)
                progress(len(block))
        if count != expected_size or digest.hexdigest() != part["sha256"]:
            raise InstallError("下载校验失败，请稍后重试或重新下载启动程序。")
        os.replace(temporary, destination)
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        raise InstallError("下载中断，请检查网络后点击重试。") from error
    finally:
        temporary.unlink(missing_ok=True)


def assemble_archive(manifest: dict, stage: Path, report: Report, opener=None) -> Path:
    stage.mkdir(parents=True, exist_ok=True)
    archive = stage / "collector.zip"
    if verified_file(archive, manifest["bytes"], manifest["sha256"]):
        report("已找到校验通过的安装包，正在安装…", 0.85)
        return archive
    archive.unlink(missing_ok=True)
    completed = 0

    def advance(amount: int) -> None:
        nonlocal completed
        completed += amount
        report("正在下载助手，请保持网络连接…", 0.05 + 0.75 * completed / manifest["bytes"])

    for part in manifest["parts"]:
        download_part(part, stage / part["name"], advance, opener=opener)
    temporary = stage / "collector.zip.assembling"
    digest = hashlib.sha256()
    count = 0
    try:
        with temporary.open("wb") as output:
            for part in manifest["parts"]:
                with (stage / part["name"]).open("rb") as source:
                    while block := source.read(CHUNK_SIZE):
                        output.write(block)
                        digest.update(block)
                        count += len(block)
        if count != manifest["bytes"] or digest.hexdigest() != manifest["sha256"]:
            raise InstallError("安装包完整性校验失败，请点击重试。")
        os.replace(temporary, archive)
        return archive
    finally:
        temporary.unlink(missing_ok=True)


def _safe_member_name(name: str) -> tuple[str, ...]:
    if not name or "\\" in name or name.startswith("/") or "\x00" in name:
        raise InstallError("安装包内容无效，请重新下载启动程序。")
    parts = tuple(name.rstrip("/").split("/"))
    if parts[0] != APP_NAME:
        raise InstallError("安装包目录无效，请重新下载启动程序。")
    for component in parts:
        if (component in ("", ".", "..") or component.endswith((" ", "."))
                or ":" in component or any(ord(char) < 32 for char in component)):
            raise InstallError("安装包路径无效，请重新下载启动程序。")
    return parts


def extract_verified_archive(archive: Path, destination: Path) -> Path:
    """Extract the trusted ZIP without following paths or links outside staging."""
    seen: set[str] = set()
    unpacked = 0
    try:
        with zipfile.ZipFile(archive) as package:
            entries = []
            for entry in package.infolist():
                parts = _safe_member_name(entry.filename)
                key = "/".join(parts).casefold()
                if key in seen:
                    raise InstallError("安装包存在重复文件，请重新下载启动程序。")
                seen.add(key)
                mode = (entry.external_attr >> 16) & 0xFFFF
                if stat.S_IFMT(mode) == stat.S_IFLNK:
                    raise InstallError("安装包包含不支持的链接，请重新下载启动程序。")
                unpacked += entry.file_size
                if unpacked > MAX_UNPACKED_BYTES:
                    raise InstallError("安装包内容过大，请重新下载启动程序。")
                entries.append((entry, parts))
            if f"{APP_NAME}/{EXE_NAME}".casefold() not in seen:
                raise InstallError("安装包缺少助手程序，请重新下载启动程序。")
            for entry, parts in entries:
                target = destination.joinpath(*parts)
                if entry.is_dir():
                    target.mkdir(parents=True, exist_ok=True)
                else:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with package.open(entry) as source, target.open("xb") as output:
                        shutil.copyfileobj(source, output, CHUNK_SIZE)
    except (zipfile.BadZipFile, RuntimeError, OSError) as error:
        raise InstallError("解压失败，请检查磁盘空间后点击重试。") from error
    return destination / APP_NAME / EXE_NAME


def default_install_base() -> Path:
    local = os.environ.get("LOCALAPPDATA")
    if not local:
        raise InstallError("找不到 Windows 用户安装目录，请重新登录 Windows 后重试。")
    return Path(local) / "Chengzi" / "WechatCollector"


def running_assistant() -> tuple[str, str] | None:
    """Distinguish our loopback helper from another process using its port."""
    connection = http.client.HTTPConnection("127.0.0.1", ASSISTANT_PORT, timeout=4)
    try:
        connection.request("GET", "/health", headers={"Origin": "https://coach.lovetalk.love"})
        response = connection.getresponse()
        if response.status != 200:
            return ("occupied", "")
        payload = json.loads(response.read(16 * 1024 + 1))
        if (isinstance(payload, dict) and payload.get("protocol") == 1
                and isinstance(payload.get("version"), str)
                and re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", payload["version"])):
            return ("assistant", payload["version"])
        return ("occupied", "")
    except ConnectionRefusedError:
        return None
    except (OSError, http.client.HTTPException, ValueError, UnicodeError):
        return ("occupied", "")
    finally:
        connection.close()


def assistant_state(expected_version: str) -> tuple[str, str] | None:
    active = running_assistant()
    if active and active[0] == "assistant":
        return ("current" if active[1] == expected_version else "outdated", active[1])
    return active


def focus_running_assistant() -> bool:
    """Restore the already-running helper without launching a second copy."""
    if sys.platform != "win32":
        return False
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.windll.user32
    user32.FindWindowW.argtypes = [wintypes.LPCWSTR, wintypes.LPCWSTR]
    user32.FindWindowW.restype = wintypes.HWND
    user32.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
    user32.ShowWindow.restype = wintypes.BOOL
    user32.SetForegroundWindow.argtypes = [wintypes.HWND]
    user32.SetForegroundWindow.restype = wintypes.BOOL
    window = user32.FindWindowW(None, ASSISTANT_TITLE)
    if not window:
        return False
    user32.ShowWindow(window, 9)  # SW_RESTORE
    return bool(user32.SetForegroundWindow(window))


def install(manifest: dict, report: Report, base: Path | None = None, opener=None) -> Path:
    manifest = validate_manifest(manifest)
    base = base or default_install_base()
    version_root = base / manifest["version"]
    target = version_root / APP_NAME
    exe = target / EXE_NAME
    if exe.is_file() and file_sha256(exe) == manifest["exeSha256"]:
        report("助手已准备好，正在打开…", 1.0)
        return exe
    base.mkdir(parents=True, exist_ok=True)
    required = max(1024 * 1024 * 1024, manifest["bytes"] * 4)
    if shutil.disk_usage(base).free < required:
        raise InstallError("磁盘空间不足。请至少腾出 1 GB 空间后点击重试。")
    stage = base / "downloads" / manifest["version"]
    archive = assemble_archive(manifest, stage, report, opener=opener)
    report("下载完成，正在安装助手…", 0.88)
    temporary_root = base / "temp"
    temporary_root.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="install-", dir=temporary_root) as temp_name:
        extracted = extract_verified_archive(archive, Path(temp_name))
        if file_sha256(extracted) != manifest["exeSha256"]:
            raise InstallError("助手程序校验失败，请重新下载启动程序。")
        version_root.mkdir(exist_ok=True)
        backup = version_root / (APP_NAME + ".previous")
        if backup.exists():
            shutil.rmtree(backup)
        if target.exists():
            target.rename(backup)
        try:
            extracted.parent.rename(target)
        except Exception:
            if backup.exists() and not target.exists():
                backup.rename(target)
            raise
        if backup.exists():
            shutil.rmtree(backup)
    archive.unlink(missing_ok=True)
    for part in manifest["parts"]:
        (stage / part["name"]).unlink(missing_ok=True)
    report("助手已准备好，正在打开…", 1.0)
    return exe


def launch_assistant(exe: Path, base: Path | None = None) -> None:
    base = base or default_install_base()
    runtime_temp = base / "temp"
    runtime_temp.mkdir(parents=True, exist_ok=True)
    environment = os.environ.copy()
    environment["TEMP"] = str(runtime_temp)
    environment["TMP"] = str(runtime_temp)
    environment["CHENGZI_VOICE_DATA_DIR"] = str(base / "voice")
    try:
        process = subprocess.Popen([str(exe)], cwd=str(exe.parent), env=environment, close_fds=True)
    except OSError as error:
        raise InstallError("助手无法启动，请重新打开启动程序重试。") from error
    time.sleep(0.8)
    if process.poll() is not None:
        active = running_assistant()
        if active and active[0] == "assistant":
            raise InstallError("助手已经在运行。请切换到任务栏中的助手窗口并点击「打开网页并连接」。")
        raise InstallError(f"助手启动失败（错误码 {process.returncode}）。请把错误码发给客服。")


class LauncherWindow:
    def __init__(self, root, manifest: dict):
        import tkinter as tk

        self.root = root
        self.manifest = manifest
        self.messages: queue.Queue[tuple[str, object]] = queue.Queue()
        self.running = False
        root.title("成子 · 电脑微信助手")
        root.geometry("470x235")
        root.minsize(470, 235)
        root.maxsize(470, 235)
        root.configure(bg="#FFF9F5")
        tk.Label(root, text="正在准备成子微信助手", font=("Microsoft YaHei UI", 16, "bold"),
                 fg="#26201D", bg="#FFF9F5").pack(pady=(27, 7))
        tk.Label(root, text="首次打开会自动下载。以后双击即可使用。", font=("Microsoft YaHei UI", 10),
                 fg="#786D68", bg="#FFF9F5").pack()
        self.status = tk.StringVar(value="正在检查安装…")
        tk.Label(root, textvariable=self.status, font=("Microsoft YaHei UI", 10),
                 fg="#574842", bg="#FFF9F5", wraplength=420).pack(pady=(18, 8))
        self.canvas = tk.Canvas(root, width=410, height=8, highlightthickness=0, bg="#EEDCD3")
        self.canvas.pack()
        self.bar = self.canvas.create_rectangle(0, 0, 0, 8, fill="#CF6F57", outline="")
        buttons = tk.Frame(root, bg="#FFF9F5")
        buttons.pack(pady=18)
        self.existing = tk.Button(buttons, text="切换到助手", command=self._focus_existing, width=12)
        self.retry = tk.Button(buttons, text="重试", command=self.start, state="disabled", width=10)
        self.retry.pack(side="left", padx=6)
        tk.Button(buttons, text="关闭", command=root.destroy, width=10).pack(side="left", padx=6)
        root.after(50, self._pump)
        root.after(100, self.start)

    def start(self):
        if self.running:
            return
        self.running = True
        self.existing.pack_forget()
        self.retry.configure(state="disabled")
        self.status.set("正在检查安装…")
        self.canvas.coords(self.bar, 0, 0, 0, 8)
        threading.Thread(target=self._work, daemon=True).start()

    def _work(self):
        try:
            active = assistant_state(self.manifest["version"])
            if active and active[0] in ("current", "outdated"):
                self.messages.put(active)
                return
            if active:
                raise InstallError("本机连接端口已被其他程序占用。请关闭占用程序后点击重试。")
            base = default_install_base()
            exe = install(self.manifest, lambda message, progress: self.messages.put(("progress", (message, progress))), base)
            active = assistant_state(self.manifest["version"])
            if active and active[0] in ("current", "outdated"):
                self.messages.put(active)
                return
            if active:
                raise InstallError("本机连接端口已被其他程序占用。请关闭占用程序后点击重试。")
            launch_assistant(exe, base)
            self.messages.put(("done", None))
        except InstallError as error:
            self.messages.put(("error", str(error)))
        except Exception:
            self.messages.put(("error", "准备助手时遇到问题。请检查网络和磁盘空间，然后点击重试。"))

    def _focus_existing(self):
        if not focus_running_assistant():
            self.status.set("请在 Windows 任务栏找到「成子 · 电脑微信采集助手」窗口，打开后点击「打开网页并连接」。")

    def _pump(self):
        try:
            while True:
                kind, value = self.messages.get_nowait()
                if kind == "progress":
                    message, fraction = value
                    self.status.set(message)
                    if fraction is not None:
                        self.canvas.coords(self.bar, 0, 0, 410 * min(1.0, max(0.0, fraction)), 8)
                elif kind == "error":
                    self.running = False
                    self.status.set(value)
                    self.retry.configure(state="normal")
                elif kind in ("current", "outdated"):
                    self.running = False
                    version = value
                    if kind == "current":
                        self.status.set("助手已经在运行。请在助手窗口点击「打开网页并连接」。")
                        self.existing.configure(text="切换到助手")
                        self.existing.pack(side="left", padx=6, before=self.retry)
                        self._focus_existing()
                    else:
                        self.status.set(f"旧版助手（{version}）仍在运行。请先在旧版窗口点击「退出助手」，再回到这里点「重试」升级。")
                        self.existing.configure(text="打开旧版助手")
                        self.existing.pack(side="left", padx=6, before=self.retry)
                    self.retry.configure(state="normal")
                elif kind == "done":
                    self.root.destroy()
                    return
        except queue.Empty:
            pass
        self.root.after(100, self._pump)


def main() -> None:
    import tkinter as tk
    from tkinter import messagebox

    root = tk.Tk()
    try:
        manifest = embedded_manifest()
    except InstallError as error:
        root.withdraw()
        messagebox.showerror("成子微信助手", str(error), parent=root)
        root.destroy()
        return
    LauncherWindow(root, manifest)
    root.mainloop()


if __name__ == "__main__":
    main()
