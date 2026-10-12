"""Loopback bridge. No filesystem resource endpoints, body logs, or arbitrary commands."""
import hmac
import json
import multiprocessing as mp
import re
import secrets
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

from normalize import VERSION

PORT = 17863
ORIGINS = frozenset(["https://coach.lovetalk.love"] + [f"http://{host}:{port}" for host in ("localhost", "127.0.0.1") for port in (3000, 5173, 4173)])
MAX_BODY = 4096
MAX_RESULT = 32 * 1024 * 1024
JOB_TTL = 15 * 60
JOB_TIMEOUT = 180


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
            from adapter import capture
            result = capture(request, lambda progress, message: conn.send({"type": "progress", "progress": progress, "message": message}))
            if len(json.dumps(result, ensure_ascii=False).encode("utf-8")) > MAX_RESULT:
                raise ValueError("RESULT_TOO_LARGE")
            conn.send({"type": "result", "result": result})
        except Exception as error:
            from adapter import CaptureError
            if isinstance(error, CaptureError):
                code, message = error.code, error.message
            else:
                code, message = "CAPTURE_FAILED", "微信界面未能读取完整。请将微信放到前台、关闭弹窗后重试；未上传任何内容。"
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
        self.pair_failures = []
        self.jobs = {}
        self.active = None
        self.health_provider = health_provider
        self.capture_target = capture_target or _capture_process
        self.local_message = "等待网页连接"
        self.closing = False

    def health(self):
        from compatibility import compatibility_probe
        return {"version": VERSION, "protocol": 1, **(self.health_provider or compatibility_probe)()}

    def rotate(self):
        with self.lock:
            self.cancel_active()
            self.token, self.origin = "", ""
            self.jobs.clear()
            self.code = secrets.token_hex(4).upper()
            self.code_created = time.monotonic()
            self.local_message = "已断开网页，请使用新连接码"

    def pair(self, origin, code):
        with self.lock:
            now = time.monotonic()
            self.pair_failures = [t for t in self.pair_failures if now - t < 60]
            if len(self.pair_failures) >= 5:
                raise BridgeError(429, "PAIR_RATE_LIMIT", "连接码尝试过多，请一分钟后重试。")
            if now - self.code_created > 600:
                raise BridgeError(410, "PAIR_CODE_EXPIRED", "连接码已过期，请在本机助手刷新连接码。")
            if not isinstance(code, str) or not hmac.compare_digest(code.strip().upper(), self.code):
                self.pair_failures.append(now)
                raise BridgeError(401, "PAIR_INVALID", "连接码不正确。")
            self.cancel_active()
            self.jobs.clear()
            self.token = secrets.token_urlsafe(32)
            self.origin, self.token_created = origin, now
            self.code = secrets.token_hex(4).upper()  # successful codes cannot be replayed
            self.code_created = now
            self.local_message = "网页已连接；采集仅在你点击开始后运行"
            return {"token": self.token, "expiresIn": 28800, "version": VERSION}

    def authorize(self, origin, authorization):
        with self.lock:
            if not self.token or time.monotonic() - self.token_created > 28800 or origin != self.origin:
                raise BridgeError(401, "PAIR_REQUIRED", "请先连接本机助手。")
            if not isinstance(authorization, str) or not hmac.compare_digest(authorization, "Bearer " + self.token):
                raise BridgeError(401, "TOKEN_INVALID", "连接已失效，请重新连接本机助手。")

    def _prune(self):
        now = time.monotonic()
        self.jobs = {key: job for key, job in self.jobs.items() if key == self.active or now - job["updated"] < JOB_TTL}
        completed = sorted((job for job in self.jobs.values() if job["jobId"] != self.active), key=lambda job: job["updated"])
        for job in completed[:-3]:
            self.jobs.pop(job["jobId"], None)

    def start(self, request):
        if not isinstance(request, dict) or set(request) - {"kind", "friend", "limit"}:
            raise BridgeError(400, "INVALID_REQUEST", "仅接受采集类型、好友完整备注和数量。")
        kind, friend, limit = request.get("kind"), request.get("friend"), request.get("limit")
        if kind not in ("chat", "moments") or not isinstance(friend, str) or not friend.strip() or len(friend) > 100 or re.search(r"[\x00-\x1f]", friend):
            raise BridgeError(400, "INVALID_REQUEST", "请填写完整的好友备注。")
        if type(limit) is not int or not 1 <= limit <= (500 if kind == "chat" else 50):
            raise BridgeError(400, "INVALID_LIMIT", "聊天每次最多500条，朋友圈最多50条。")
        with self.lock:
            self._prune()
            if self.active:
                raise BridgeError(409, "CAPTURE_BUSY", "已有采集任务，请等完成或先停止。")
            if not self.health().get("ready"):
                raise BridgeError(409, "WECHAT_NOT_READY", "请打开并登录兼容的电脑版微信，再重试。")
            job_id = secrets.token_urlsafe(18)
            ctx = mp.get_context("spawn")
            parent, child = ctx.Pipe(duplex=False)
            proc = ctx.Process(target=self.capture_target, args=(child, {"kind": kind, "friend": friend.strip(), "limit": limit}), daemon=True)
            job = {"jobId": job_id, "status": "running", "progress": 0, "message": "正在连接微信界面", "updated": time.monotonic(), "process": proc}
            self.jobs[job_id], self.active = job, job_id
            self.local_message = "采集中，请暂时不要操作微信；可随时停止"
            proc.start()
            child.close()
            threading.Thread(target=self._monitor, args=(job_id, parent), daemon=True).start()
            return {"jobId": job_id}

    def _monitor(self, job_id, pipe):
        began = time.monotonic()
        try:
            while time.monotonic() - began < JOB_TIMEOUT:
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
                        elif msg.get("type") == "result":
                            job.update(status="completed", progress=100, message="已采集，请在网页确认导入", result=msg["result"])
                            return
                        elif msg.get("type") == "error":
                            job.update(status="failed", error=msg["error"], message=msg["error"]["message"])
                            return
                elif not alive:
                    break
            with self.lock:
                if job["status"] == "running":
                    job.update(status="failed", error={"code": "CAPTURE_TIMEOUT", "message": "微信界面未在三分钟内完成读取，请确认窗口可见后重试。"})
        except (EOFError, OSError):
            with self.lock:
                if job and job["status"] == "running":
                    job.update(status="failed", error={"code": "CAPTURE_INTERRUPTED", "message": "采集已中断，没有上传内容。"})
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
                job.update(status="cancelled", message="已停止，未上传内容", updated=time.monotonic())
                if job["process"].is_alive():
                    job["process"].terminate()
                    job["process"].join(timeout=1)
                if self.active == job_id:
                    self.active = None
            job.pop("result", None)
            return {"jobId": job_id, "status": job["status"]}

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
                if len(self.headers.get_all("Authorization", [])) != 1:
                    raise BridgeError(401, "PAIR_REQUIRED", "请先连接本机助手。")
                state.authorize(self.origin, self.headers.get("Authorization"))
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
