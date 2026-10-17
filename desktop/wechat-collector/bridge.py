"""Loopback bridge. No filesystem resource endpoints, body logs, or arbitrary commands."""
import hashlib
import hmac
import json
import math
import multiprocessing as mp
import re
import secrets
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

from normalize import VERSION
from background_reader import (MAX_ROWS as BACKGROUND_MAX_ROWS, MAX_PAGE_SIZE,
                               HISTORY_FIELDS, BackgroundCaptureError, _validate_request)
from pairing import CONNECTION_PAGE, HANDOFF_TTL, SESSION_TTL, WEB_ORIGIN

PORT = 17863
ORIGINS = frozenset([WEB_ORIGIN] + [f"http://{host}:{port}" for host in ("localhost", "127.0.0.1") for port in (3000, 5173, 4173)])
MAX_BODY = 64 * 1024
MAX_RESULT = 32 * 1024 * 1024
JOB_TTL = 15 * 60
JOB_TIMEOUT = 180
BACKGROUND_JOB_TIMEOUT = 20 * 60


class BridgeError(Exception):
    def __init__(self, status, code, message):
        self.status, self.code, self.message = status, code, message


def _capture_process(conn, request):
    # Third-party debug prints may contain names or messages; never write these
    # to console/logs. Results travel only over the private process pipe.
    import contextlib
    import os
    with open(os.devnull, "w") as sink, contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
        try:
            if request.get("mode") == "background":
                from background_reader import capture_background as capture
            else:
                from adapter import capture
            def partial(batch):
                if len(json.dumps(batch, ensure_ascii=False).encode("utf-8")) > MAX_RESULT:
                    raise ValueError("RESULT_TOO_LARGE")
                conn.send({"type": "partial", "partial": batch})
            result = capture(request, lambda progress, message: conn.send({"type": "progress", "progress": progress, "message": message}), on_partial=partial)
            if len(json.dumps(result, ensure_ascii=False).encode("utf-8")) > MAX_RESULT:
                raise ValueError("RESULT_TOO_LARGE")
            conn.send({"type": "result", "result": result})
        except Exception as error:
            from adapter import CaptureError
            try:
                from background_reader import BackgroundCaptureError
            except ImportError:
                BackgroundCaptureError = ()
            if isinstance(error, CaptureError) or BackgroundCaptureError and isinstance(error, BackgroundCaptureError):
                code, message = error.code, error.message
            else:
                code = "CAPTURE_FAILED"
                message = ("后台读取未完成，已完成的材料会保留。请确认电脑微信已登录后重试。"
                           if request.get("mode") == "background" else
                           "微信界面未能读取完整。请将微信放到前台、关闭弹窗后重试；未上传任何内容。")
            conn.send({"type": "error", "error": {"code": code, "message": message}})
        finally:
            conn.close()


class CollectorState:
    def __init__(self, health_provider=None, capture_target=None):
        self.lock = threading.RLock()
        self.code = secrets.token_hex(4).upper()
        self.code_created = time.monotonic()
        self.token = ""
        self.origin = ""
        self.token_created = 0
        self.handoff_digest = b""
        self.handoff_created = 0
        self.pair_failures = []
        self.jobs = {}
        self.active = None
        self.health_provider = health_provider
        self.capture_target = capture_target or _capture_process
        self.local_message = "等待网页连接"
        self.closing = False

    def health(self):
        from compatibility import compatibility_probe
        health = (self.health_provider or compatibility_probe)()
        background = {}
        if not self.health_provider:
            try:
                from background_reader import probe_background
                background = probe_background()
            except (ImportError, OSError, RuntimeError):
                pass
        capabilities = {**health.get("capabilities", {}), "deferredVoice": True}
        if background:
            capabilities.update(backgroundChat=bool(background.get("ready")),
                                backgroundVoice=bool(background.get("voiceReady")),
                                backgroundContacts=bool(background.get("ready")))
        capabilities["backgroundHistory"] = bool(capabilities.get("backgroundChat"))
        result = {"version": VERSION, "protocol": 1, **health, "capabilities": capabilities}
        result["backgroundMaxRows"] = BACKGROUND_MAX_ROWS if capabilities.get("backgroundChat") else 0
        result["backgroundPageSize"] = MAX_PAGE_SIZE if capabilities["backgroundHistory"] else 0
        result["momentsMaxRows"] = 2000
        if background:
            result["backgroundModelReady"] = bool(background.get("modelReady"))
            result["backgroundStatus"] = str(background.get("status") or "unavailable")[:80]
            result["backgroundMessage"] = str(background.get("message") or "")[:300]
            if background.get("ready"):
                result["message"] = "后台组件已就绪，导入时将核对当前账号和本机材料。"
        return result

    def rotate(self):
        with self.lock:
            self.cancel_active()
            self.token, self.origin = "", ""
            self.revoke_handoff()
            self.jobs.clear()
            self.code = secrets.token_hex(4).upper()
            self.code_created = time.monotonic()
            self.local_message = "已断开网页，请使用新连接码"

    def create_handoff(self):
        # No HTTP route issues handoffs: only the visible local button does.
        # The URL contains a short-lived exchange secret, never a session token.
        with self.lock:
            if self.active:
                raise BridgeError(409, "CAPTURE_BUSY", "请先完成或停止本次导入，再打开新的网页连接。")
            handoff = secrets.token_urlsafe(32)
            self.handoff_digest = hashlib.sha256(handoff.encode("ascii")).digest()
            self.handoff_created = time.monotonic()
            self.local_message = "正在打开成子网页；连接后，点击导入才会读取聊天。"
            return CONNECTION_PAGE + "#connect=" + handoff

    def revoke_handoff(self):
        with self.lock:
            self.handoff_digest = b""
            self.handoff_created = 0

    def _pair_rate_limit(self, now):
        self.pair_failures = [t for t in self.pair_failures if now - t < 60]
        if len(self.pair_failures) >= 5:
            raise BridgeError(429, "PAIR_RATE_LIMIT", "连接尝试过多，请一分钟后重试。")

    def _create_session(self, origin, now):
        self.cancel_active()
        self.jobs.clear()
        self.revoke_handoff()
        self.token = secrets.token_urlsafe(32)
        self.origin, self.token_created = origin, now
        self.code = secrets.token_hex(4).upper()  # successful codes cannot be replayed
        self.code_created = now
        self.local_message = "网页已连接；点击导入后才会读取选定聊天。"
        return {"token": self.token, "expiresIn": SESSION_TTL, "version": VERSION}

    def pair(self, origin, code):
        with self.lock:
            now = time.monotonic()
            self._pair_rate_limit(now)
            if origin not in ORIGINS:
                raise BridgeError(403, "ORIGIN_DENIED", "网页来源未授权。")
            if now - self.code_created > 600:
                raise BridgeError(410, "PAIR_CODE_EXPIRED", "连接码已过期，请在本机助手刷新连接码。")
            supplied = code.strip().upper() if isinstance(code, str) else ""
            if not re.fullmatch(r"[A-F0-9]{8}", supplied) or not hmac.compare_digest(supplied, self.code):
                self.pair_failures.append(now)
                raise BridgeError(401, "PAIR_INVALID", "连接码不正确。")
            return self._create_session(origin, now)

    def pair_handoff(self, origin, handoff):
        with self.lock:
            now = time.monotonic()
            self._pair_rate_limit(now)
            if origin != WEB_ORIGIN:
                self.pair_failures.append(now)
                raise BridgeError(403, "HANDOFF_ORIGIN_DENIED", "请在助手打开的成子网页完成连接。")
            valid_format = isinstance(handoff, str) and re.fullmatch(r"[A-Za-z0-9_-]{43}", handoff)
            digest = hashlib.sha256(handoff.encode("ascii")).digest() if valid_format else b""
            if not self.handoff_digest or not hmac.compare_digest(digest, self.handoff_digest):
                self.pair_failures.append(now)
                raise BridgeError(401, "HANDOFF_INVALID", "连接已失效，请在本机助手重新点击打开网页并连接。")
            if now - self.handoff_created >= HANDOFF_TTL:
                self.revoke_handoff()
                raise BridgeError(410, "HANDOFF_EXPIRED", "连接已过期，请在本机助手重新点击打开网页并连接。")
            if self.active:
                raise BridgeError(409, "CAPTURE_BUSY", "请先完成或停止本次导入，再连接新的网页。")
            return self._create_session(origin, now)

    def authorize(self, origin, authorization):
        with self.lock:
            remaining = SESSION_TTL - (time.monotonic() - self.token_created)
            if not self.token or remaining <= 0 or origin != self.origin:
                raise BridgeError(401, "PAIR_REQUIRED", "请先连接本机助手。")
            if not isinstance(authorization, str) or not hmac.compare_digest(authorization.encode("utf-8"), ("Bearer " + self.token).encode("ascii")):
                raise BridgeError(401, "TOKEN_INVALID", "连接已失效，请重新连接本机助手。")
            return {"connected": True, "expiresIn": math.ceil(remaining), "version": VERSION}

    def _prune(self):
        now = time.monotonic()
        self.jobs = {key: job for key, job in self.jobs.items() if key == self.active or now - job["updated"] < JOB_TTL}
        completed = sorted((job for job in self.jobs.values() if job["jobId"] != self.active), key=lambda job: job["updated"])
        for job in completed[:-3]:
            self.jobs.pop(job["jobId"], None)

    def search_contacts(self, query):
        if not isinstance(query, str) or not query.strip() or len(query) > 100 or re.search(r"[\x00-\x1f]", query):
            raise BridgeError(400, "INVALID_CONTACT_QUERY", "请输入联系人昵称或备注中的文字。")
        try:
            from background_reader import search_contacts
            return search_contacts(query)
        except BackgroundCaptureError as error:
            raise BridgeError(409, error.code, error.message) from None
        except Exception:
            raise BridgeError(503, "CONTACT_SEARCH_FAILED", "本机联系人目录暂时无法读取，请确认电脑微信已登录后重试。") from None

    def start(self, request):
        if not isinstance(request, dict) or set(request) - ({"kind", "friend", "contactId", "accountKey", "limit", "includeVoice", "mode"} | HISTORY_FIELDS):
            raise BridgeError(400, "INVALID_REQUEST", "仅接受采集类型、好友完整备注、数量和语音补全选项。")
        paged = bool(HISTORY_FIELDS.intersection(request))
        selected = "contactId" in request or "accountKey" in request
        kind, friend, limit = request.get("kind"), request.get("friend"), request.get("limit", MAX_PAGE_SIZE if paged else None)
        include_voice = request.get("includeVoice", False)
        mode = request.get("mode", "ui")
        if mode not in ("ui", "background") or mode == "background" and kind != "chat":
            raise BridgeError(400, "INVALID_MODE", "后台读取仅支持聊天记录。")
        if paged and mode != "background":
            raise BridgeError(400, "INVALID_MODE", "完整历史分页仅支持后台聊天读取。")
        if selected and mode != "background":
            raise BridgeError(400, "INVALID_MODE", "选择联系人后请使用后台聊天导入。")
        if type(include_voice) is not bool:
            raise BridgeError(400, "INVALID_REQUEST", "语音补全选项必须明确为是或否。")
        if kind not in ("chat", "moments") or not isinstance(friend, str) or not friend.strip() or len(friend) > 100 or re.search(r"[\x00-\x1f]", friend):
            raise BridgeError(400, "INVALID_REQUEST", "请填写完整的好友备注。")
        maximum = BACKGROUND_MAX_ROWS if mode == "background" else (500 if kind == "chat" else 2000)
        if type(limit) is not int or not 1 <= limit <= maximum:
            raise BridgeError(400, "INVALID_LIMIT", "后台聊天每次最多1000条，界面聊天最多500条，朋友圈单次最多2000条可见动态。")
        if paged or selected:
            try:
                _validate_request(request)
            except BackgroundCaptureError as error:
                raise BridgeError(400, error.code, error.message) from None
        with self.lock:
            self._prune()
            if self.active:
                raise BridgeError(409, "CAPTURE_BUSY", "已有采集任务，请等完成或先停止。")
            health = self.health()
            capable = health.get("capabilities", {})
            if mode == "background" and not capable.get("backgroundChat"):
                raise BridgeError(409, "BACKGROUND_NOT_READY", health.get("backgroundMessage") or "当前助手暂不能后台读取聊天。")
            if mode == "background" and include_voice and not capable.get("backgroundVoice"):
                raise BridgeError(409, "BACKGROUND_VOICE_NOT_READY", "后台语音组件尚未就绪，请更新或重启本机助手。")
            if mode == "ui" and not health.get("ready"):
                message = health.get("message")
                message = message.strip()[:500] if isinstance(message, str) else ""
                raise BridgeError(409, "WECHAT_NOT_READY", message or "微信界面暂不可读取，请查看本机助手的兼容性提示后重试。")
            job_id = secrets.token_urlsafe(18)
            ctx = mp.get_context("spawn")
            parent, child = ctx.Pipe(duplex=False)
            payload = {"kind": kind, "friend": friend.strip(), "limit": limit, "includeVoice": include_voice, "mode": mode}
            payload.update({key: request[key] for key in HISTORY_FIELDS if key in request})
            payload.update({key: request[key] for key in ("contactId", "accountKey") if key in request})
            proc = ctx.Process(target=self.capture_target, args=(child, payload), daemon=True)
            job = {"jobId": job_id, "mode": mode, "status": "running", "progress": 0, "partialRevision": 0,
                   "message": "正在检查本机聊天与语音" if mode == "background" else "正在连接微信界面", "updated": time.monotonic(), "process": proc}
            self.jobs[job_id], self.active = job, job_id
            self.local_message = "正在后台导入，可以继续使用电脑；可随时停止" if mode == "background" else "采集中，请暂时不要操作微信；可随时停止"
            try:
                proc.start()
            except Exception:
                self.jobs.pop(job_id, None)
                self.active = None
                self.local_message = "采集任务未能启动，请重启本机助手后重试。"
                parent.close()
                child.close()
                raise BridgeError(503, "CAPTURE_START_FAILED", self.local_message) from None
            child.close()
            threading.Thread(target=self._monitor, args=(job_id, parent), daemon=True).start()
            return {"jobId": job_id}

    def _monitor(self, job_id, pipe):
        began = time.monotonic()
        timeout = BACKGROUND_JOB_TIMEOUT if self.jobs[job_id].get("mode") == "background" else JOB_TIMEOUT
        try:
            while time.monotonic() - began < timeout:
                with self.lock:
                    job = self.jobs.get(job_id)
                    if not job or job["status"] != "running":
                        return
                    alive = job["process"].is_alive()
                if pipe.poll(0.15):
                    msg = pipe.recv()
                    with self.lock:
                        if job["status"] != "running":
                            return
                        job["updated"] = time.monotonic()
                        if msg.get("type") == "progress":
                            job.update(progress=max(0, min(99, int(msg.get("progress", 0)))), message=str(msg.get("message", ""))[:100])
                        elif msg.get("type") == "partial":
                            job.update(partial=msg["partial"], partialRevision=job.get("partialRevision", 0) + 1,
                                       message="文字已导入，正在补全语音…可随时停止。")
                        elif msg.get("type") == "result":
                            job.update(status="completed", progress=100, message="已采集，请在网页确认导入", result=msg["result"])
                            return
                        elif msg.get("type") == "error":
                            job.update(status="failed", error=msg["error"], message=msg["error"]["message"])
                            return
                elif not alive:
                    # A child can exit before its pipe is drained (for
                    # example an unavailable encrypted database dependency or
                    # an unexpected provider exception).  Treat that as an
                    # immediate failure instead of falling through to the
                    # full 20-minute background timeout.  The old behavior
                    # left the browser showing a full progress bar with
                    # "0 条" for many minutes and hid the actionable error.
                    with self.lock:
                        job = self.jobs.get(job_id)
                        if job and job["status"] == "running":
                            message = ("后台读取进程已退出，已核对的文字仍可导入。"
                                       if job.get("partial") else
                                       "后台读取进程已退出，请重启本机助手后重试。")
                            job.update(status="failed", message=message,
                                        error={"code": "CAPTURE_INTERRUPTED", "message": message},
                                        updated=time.monotonic())
                    return
            with self.lock:
                if job["status"] == "running":
                    message = ("本次语音补全已到时限，已核对的文字仍可导入。" if job.get("partial") else
                               "后台读取超时，请确认电脑微信已登录后重试。" if job.get("mode") == "background" else
                               "微信界面未在三分钟内完成读取，请确认窗口可见后重试。")
                    job.update(status="failed", message=message, error={"code": "CAPTURE_TIMEOUT", "message": message})
        except (EOFError, OSError):
            with self.lock:
                if job and job["status"] == "running":
                    message = ("语音补全已中断，已核对的文字仍可导入。" if job.get("partial") else
                               "后台读取进程已退出，请重启本机助手后重试。" if job.get("mode") == "background" else
                               "采集已中断，没有上传内容。")
                    job.update(status="failed", message=message, error={"code": "CAPTURE_INTERRUPTED", "message": message})
        finally:
            pipe.close()
            with self.lock:
                job = self.jobs.get(job_id)
                if job:
                    proc = job["process"]
                    if proc.is_alive():
                        proc.terminate()
                    proc.join(timeout=1)
                if self.active == job_id:
                    self.active = None
                self.local_message = "采集结束；原文仅暂存在本机内存，等待网页操作"

    def get(self, job_id):
        with self.lock:
            self._prune()
            if job_id not in self.jobs:
                raise BridgeError(404, "JOB_NOT_FOUND", "任务不存在或已过期。")
            return {key: value for key, value in self.jobs[job_id].items() if key not in ("process", "updated")}

    def cancel(self, job_id):
        with self.lock:
            job = self.jobs.get(job_id)
            if not job:
                raise BridgeError(404, "JOB_NOT_FOUND", "任务不存在。")
            if job["status"] == "running":
                job.update(status="cancelled", message="已停止语音补全，已核对的文字仍可导入。" if job.get("partial") else "已停止，未上传内容", updated=time.monotonic())
                if job["process"].is_alive():
                    job["process"].terminate()
                    job["process"].join(timeout=1)
                if self.active == job_id:
                    self.active = None
            job.pop("result", None)
            return {"jobId": job_id, "status": job["status"], "partialRevision": job.get("partialRevision", 0),
                    **({"partial": job["partial"]} if "partial" in job else {})}

    def cancel_active(self):
        if self.active:
            self.cancel(self.active)


def server_for(state, port=PORT):
    class LimitedServer(ThreadingHTTPServer):
        def __init__(self, *args, **kwargs):
            self.slots = threading.BoundedSemaphore(12)
            super().__init__(*args, **kwargs)

        def process_request(self, request, client_address):
            if not self.slots.acquire(blocking=False):
                request.close()
                return
            try:
                super().process_request(request, client_address)
            except Exception:
                self.slots.release()
                raise

        def process_request_thread(self, request, client_address):
            try:
                super().process_request_thread(request, client_address)
            finally:
                self.slots.release()

        def handle_error(self, request, client_address):
            # Never render exceptions containing received data or UI objects.
            pass

    class Handler(BaseHTTPRequestHandler):
        server_version = "ChengziCollector/1"
        def setup(self):
            super().setup()
            self.connection.settimeout(5)

        def log_message(self, *_args):
            pass

        def _check(self):
            if self.client_address[0] != "127.0.0.1":
                raise BridgeError(403, "LOOPBACK_ONLY", "仅允许本机访问。")
            if len(self.headers.get_all("Host", [])) != 1 or self.headers.get("Host") not in (f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"):
                raise BridgeError(403, "HOST_DENIED", "地址不受支持。")
            if len(self.headers.get_all("Origin", [])) != 1 or self.headers.get("Origin") not in ORIGINS:
                raise BridgeError(403, "ORIGIN_DENIED", "网页来源未授权。")
            if self.headers.get("Transfer-Encoding"):
                raise BridgeError(400, "INVALID_BODY", "不支持此请求格式。")
            self.origin = self.headers["Origin"]
            parts = urlsplit(self.path)
            if parts.scheme or parts.netloc or parts.query or parts.fragment or "%" in parts.path:
                raise BridgeError(400, "INVALID_PATH", "请求路径不受支持。")
            return parts.path

        def _send(self, status, value):
            data = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Vary", "Origin")
            if getattr(self, "origin", None) in ORIGINS:
                self.send_header("Access-Control-Allow-Origin", self.origin)
                self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
                self.send_header("Access-Control-Allow-Private-Network", "true")
            self.end_headers()
            self.wfile.write(data)

        def _body(self):
            if len(self.headers.get_all("Content-Length", [])) != 1:
                raise BridgeError(411, "LENGTH_REQUIRED", "缺少请求长度。")
            if self.headers.get_content_type() != "application/json":
                raise BridgeError(415, "JSON_REQUIRED", "仅接受JSON。")
            try:
                length = int(self.headers["Content-Length"])
            except ValueError:
                raise BridgeError(400, "INVALID_BODY", "请求长度无效。")
            if not 0 < length <= MAX_BODY:
                raise BridgeError(413, "BODY_TOO_LARGE", "请求过大。")
            self.connection.settimeout(4)
            try:
                raw = self.rfile.read(length)
                if len(raw) != length:
                    raise ValueError()
                data = json.loads(raw)
                if not isinstance(data, dict):
                    raise ValueError()
                return data
            except (ValueError, OSError):
                raise BridgeError(400, "INVALID_BODY", "请求内容无效。")

        def _run(self, method):
            try:
                path = self._check()
                if method == "OPTIONS":
                    if self.headers.get("Access-Control-Request-Method") not in ("GET", "POST"):
                        raise BridgeError(403, "METHOD_DENIED", "请求方式不受支持。")
                    headers = {v.strip().lower() for v in self.headers.get("Access-Control-Request-Headers", "").split(",") if v.strip()}
                    if headers - {"content-type", "authorization"}:
                        raise BridgeError(403, "HEADERS_DENIED", "请求头不受支持。")
                    return self._send(200, {})
                if method == "GET" and path == "/health":
                    return self._send(200, state.health())
                if method == "POST" and path == "/pair":
                    body = self._body()
                    if set(body) != {"code"}:
                        raise BridgeError(400, "INVALID_REQUEST", "只接受连接码。")
                    return self._send(200, state.pair(self.origin, body["code"]))
                if method == "POST" and path == "/pair/handoff":
                    body = self._body()
                    if set(body) != {"handoff"}:
                        raise BridgeError(400, "INVALID_REQUEST", "只接受一次性连接凭证。")
                    return self._send(200, state.pair_handoff(self.origin, body["handoff"]))
                if len(self.headers.get_all("Authorization", [])) != 1:
                    raise BridgeError(401, "PAIR_REQUIRED", "请先连接本机助手。")
                session = state.authorize(self.origin, self.headers.get("Authorization"))
                if method == "GET" and path == "/session":
                    return self._send(200, session)
                if method == "POST" and path == "/contacts/search":
                    body = self._body()
                    if set(body) != {"query"}:
                        raise BridgeError(400, "INVALID_REQUEST", "联系人搜索只接受查询文字。")
                    return self._send(200, state.search_contacts(body["query"]))
                if method == "POST" and path == "/capture":
                    return self._send(202, state.start(self._body()))
                matched = re.fullmatch(r"/jobs/([A-Za-z0-9_-]{24})(/cancel)?", path)
                if matched and method == "GET" and not matched[2]:
                    return self._send(200, state.get(matched[1]))
                if matched and method == "POST" and matched[2]:
                    self._body()
                    return self._send(200, state.cancel(matched[1]))
                raise BridgeError(404, "NOT_FOUND", "接口不存在。")
            except BridgeError as error:
                self._send(error.status, {"error": {"code": error.code, "message": error.message}})
            except Exception:
                try:
                    self._send(503, {"error": {"code": "COLLECTOR_FAILED",
                                               "message": "本机助手暂时无法完成请求，请重启后重试。"}})
                except (OSError, ValueError):
                    self.close_connection = True

        def do_GET(self):
            self._run("GET")
        def do_POST(self):
            self._run("POST")
        def do_OPTIONS(self):
            self._run("OPTIONS")

    server = LimitedServer(("127.0.0.1", port), Handler)
    server.daemon_threads = True
    return server
