"""Loopback bridge. No filesystem resource endpoints, body logs, or arbitrary commands."""
import hashlib
import hmac
import json
import math
import multiprocessing as mp
import re
import secrets
import socket
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from socketserver import TCPServer
from urllib.parse import urlsplit

from normalize import VERSION
from background_reader import (MAX_ROWS as BACKGROUND_MAX_ROWS, MAX_PAGE_SIZE,
                               HISTORY_FIELDS, BackgroundCaptureError, _validate_request)
from pairing import CONNECTION_PAGE, HANDOFF_TTL, SESSION_TTL, WEB_ORIGIN
from capture_transport import partial_message, expand_partial

PORT = 17863
ORIGINS = frozenset([WEB_ORIGIN] + [f"http://{host}:{port}" for host in ("localhost", "127.0.0.1") for port in (3000, 5173, 4173)])
MAX_BODY = 64 * 1024
MAX_RESULT = 32 * 1024 * 1024
JOB_TTL = 15 * 60
JOB_TIMEOUT = 180
BACKGROUND_JOB_TIMEOUT = 20 * 60
WORKER_START_TIMEOUT = 30
BACKGROUND_READER_IDLE_TIMEOUT = 120
MOMENTS_IDLE_TIMEOUT = 90
VOICE_WORKER_IDLE_TIMEOUT = 60


class BridgeError(Exception):
    def __init__(self, status, code, message):
        self.status, self.code, self.message = status, code, message


def _voice_scope(request):
    if (request.get("mode") == "background" and request.get("voiceOnly") is True
            and request.get("includeVoice") is True and request.get("accountKey") and request.get("contactId")):
        return request["accountKey"], request["contactId"], request["friend"]
    return None


def _job_active(job):
    # A terminal result is not externally complete until process cleanup and
    # foreground restoration finish. Keep that handoff owned by this job.
    return job["status"] == "running" or job.get("_settled") is False


class _JobConnection:
    """Per-job output envelope; close never closes the worker's private pipe."""
    def __init__(self, pipe, job_id):
        self.pipe, self.job_id = pipe, job_id
        self.completed = False
        self.failed = False

    def send(self, message):
        if self.completed or self.failed:
            raise ValueError("JOB_ALREADY_FINISHED")
        self.pipe.send({**message, "workerJobId": self.job_id})
        self.completed = message.get("type") == "result"
        self.failed = message.get("type") == "error"

    def close(self):
        pass


def _voice_worker_process(pipe, capture_target, scope):
    """Reuse only the public ASR runtime; every request creates fresh DB state."""
    try:
        # Parent owns the exact idle deadline. Give its timer/send a margin so
        # an about-to-expire child cannot win the next-batch handoff race.
        while pipe.poll(VOICE_WORKER_IDLE_TIMEOUT + 5):
            command = pipe.recv()
            request, job_id = command.get("request"), command.get("jobId")
            if not isinstance(request, dict) or not isinstance(job_id, str) or _voice_scope(request) != scope:
                return
            connection = _JobConnection(pipe, job_id)
            authorization = command.pop("authorization", None)
            if authorization is None:
                capture_target(connection, request)
            else:
                capture_target(connection, request, worker_authorization=authorization)
            if not connection.completed or connection.failed:
                return
            from local_voice_transcriber import configure_transcriber
            configure_transcriber()  # Release the completed job's progress callback.
            # Drop request, transcript and partial closures before becoming idle.
            # capture_background closes its authenticated source in a finally.
            del connection, request, command, job_id, authorization
    except (EOFError, OSError):
        pass
    finally:
        pipe.close()


def _capture_process(conn, request, worker_authorization=None, recovery_guard=None):
    # Third-party debug prints may contain names or messages; never write these
    # to console/logs. Results travel only over the private process pipe.
    import contextlib
    import os
    with open(os.devnull, "w") as sink, contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
        try:
            if recovery_guard is not None:
                from qt_accessibility_recovery import bind_transaction_guard
                bind_transaction_guard(recovery_guard)
            # An immediate private handshake distinguishes frozen-process
            # startup from database preparation. Previously an alive child that
            # never reached Python could leave the UI at zero for 20 minutes.
            conn.send({"type": "progress", "progress": 0, "phase": "initializing",
                       "message": "本机读取已启动，正在核对微信数据。"})
            from platform_runtime import import_worker_authorization, capture_function
            import_worker_authorization(worker_authorization)
            capture = capture_function(request)
            previous_partial = None
            def partial(batch):
                nonlocal previous_partial
                message = partial_message(previous_partial, batch)
                if len(json.dumps(message, ensure_ascii=False).encode("utf-8")) > MAX_RESULT:
                    raise ValueError("RESULT_TOO_LARGE")
                conn.send(message)
                previous_partial = {**batch, "records": list(batch.get("records", []))}
            def emit_progress(value, message, **meta):
                conn.send({"type": "progress", "progress": value, "message": message, **meta})
            result = capture(request, emit_progress, on_partial=partial)
            if len(json.dumps(result, ensure_ascii=False).encode("utf-8")) > MAX_RESULT:
                raise ValueError("RESULT_TOO_LARGE")
            conn.send({"type": "result", "result": result})
        except Exception as error:
            if sys.platform == "darwin":
                CaptureError = ()
            else:
                from adapter import CaptureError
            try:
                from background_reader import BackgroundCaptureError
            except ImportError:
                BackgroundCaptureError = ()
            if CaptureError and isinstance(error, CaptureError) or BackgroundCaptureError and isinstance(error, BackgroundCaptureError):
                code, message = error.code, error.message
            else:
                code = "CAPTURE_FAILED"
                message = ("后台读取未完成，已完成的材料会保留。请确认电脑微信已登录后重试。"
                           if request.get("mode") == "background" else
                           "微信界面未能读取完整。请将微信放到前台、关闭弹窗后重试；未上传任何内容。")
            conn.send({"type": "error", "error": {"code": code, "message": message}})
        finally:
            if recovery_guard is not None:
                bind_transaction_guard(None)
            from platform_runtime import clear_worker_authorization
            clear_worker_authorization()
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
        self._default_capture_target = capture_target is None
        self.local_message = "等待网页连接"
        self.closing = False
        self._voice_worker = None
        from platform_runtime import contact_cache
        self.contact_cache = contact_cache()

    def _discard_voice_worker(self, worker=None):
        worker = worker or self._voice_worker
        if worker is None:
            return
        if self._voice_worker is worker:
            self._voice_worker = None
        if worker.get("timer") is not None:
            worker["timer"].cancel()
        if worker["process"].is_alive():
            worker["process"].terminate()
        worker["process"].join(timeout=1)
        worker["pipe"].close()

    def _expire_voice_worker(self, worker, deadline):
        with self.lock:
            if (self._voice_worker is not worker or any(
                    _job_active(job) and job.get("_voiceWorker") is worker
                    for job in self.jobs.values())
                    or worker.get("idleDeadline") != deadline):
                return
            remaining = deadline - time.monotonic()
            if remaining > 0:
                # Timers may wake early on Windows. Keep the same deadline;
                # an old callback must not replace a newer job's idle timer.
                worker["timer"] = threading.Timer(max(.01, remaining), self._expire_voice_worker, (worker, deadline))
                worker["timer"].daemon = True
                worker["timer"].start()
                return
            self._discard_voice_worker(worker)

    def health(self, background_only=False):
        from platform_runtime import compatibility_probe, default_capabilities
        # A background page/voice batch does not depend on UIA. Probing the
        # whole window here under the job lock stalls status/session requests
        # and is repeated for every page. The worker still verifies the live
        # account and selected contact before any database data is returned.
        health = (self.health_provider() if self.health_provider else
                  {} if background_only else compatibility_probe())
        background = {}
        if not self.health_provider:
            try:
                from background_reader import probe_background
                background = probe_background()
            except (ImportError, OSError, RuntimeError):
                pass
        capabilities = {**health.get("capabilities", {}), "deferredVoice": True,
                        **default_capabilities()}
        if background:
            capabilities.update(backgroundChat=bool(background.get("ready")),
                                backgroundVoice=bool(background.get("voiceReady")),
                                backgroundVoiceById=bool(background.get("voiceReady")),
                                backgroundContacts=bool(background.get("ready")))
        capabilities["backgroundHistory"] = bool(capabilities.get("backgroundChat"))
        capabilities["backgroundImagesById"] = (bool(capabilities.get("backgroundChat"))
                                                   and sys.platform != "darwin")
        capabilities["contactPagination"] = True
        capabilities["jobProgressRevision"] = True
        capabilities["parallelMediaMoments"] = sys.platform == "win32" and bool(capabilities.get("backgroundChat"))
        result = {"version": VERSION, "protocol": 1, "platform": sys.platform, **health, "capabilities": capabilities}
        ui_message = health.get("message")
        ui_message = ui_message.strip()[:500] if isinstance(ui_message, str) else ""
        result.update(uiReady=bool(health.get("ready")),
                      uiMessage=ui_message or "微信界面当前不可读取，请显示微信窗口后重试。",
                      momentsMessage=ui_message if health.get("ready") else
                      ui_message or "朋友圈需要可读取的微信界面，后台聊天组件就绪不代表朋友圈可采集。")
        result["message"] = result["uiMessage"]
        result["backgroundMaxRows"] = BACKGROUND_MAX_ROWS if capabilities.get("backgroundChat") else 0
        result["backgroundPageSize"] = MAX_PAGE_SIZE if capabilities["backgroundHistory"] else 0
        result["momentsMaxRows"] = 2000
        if background:
            result["backgroundModelReady"] = bool(background.get("modelReady"))
            result["backgroundStatus"] = str(background.get("status") or "unavailable")[:80]
            result["backgroundMessage"] = str(background.get("message") or "")[:300]
            if background.get("ready") and health.get("ready"):
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
            self.contact_cache.clear()
            self._discard_voice_worker()

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
                if remaining <= 0:
                    self.contact_cache.clear()
                    self.cancel_active()
                raise BridgeError(401, "PAIR_REQUIRED", "请先连接本机助手。")
            if not isinstance(authorization, str) or not hmac.compare_digest(authorization.encode("utf-8"), ("Bearer " + self.token).encode("ascii")):
                raise BridgeError(401, "TOKEN_INVALID", "连接已失效，请重新连接本机助手。")
            return {"connected": True, "expiresIn": math.ceil(remaining), "version": VERSION}

    def _prune(self):
        now = time.monotonic()
        self.jobs = {key: job for key, job in self.jobs.items() if _job_active(job) or now - job["updated"] < JOB_TTL}
        completed = sorted((job for job in self.jobs.values() if not _job_active(job)), key=lambda job: job["updated"])
        for job in completed[:-3]:
            self.jobs.pop(job["jobId"], None)

    def _refresh_active(self):
        # Legacy desktop status/close guards still use one representative ID.
        # Keep it set until every independent lane has finished.
        active = [(key, job) for key, job in self.jobs.items() if _job_active(job)]
        self.active = active[0][0] if active else None
        if any(job.get("mode") != "background" for _, job in active):
            self.local_message = "采集中，请暂时不要操作微信；可随时停止"
        elif active:
            self.local_message = "正在后台导入，可以继续使用电脑；可随时停止"

    def search_contacts(self, query, offset=0, account_key=None, refresh=False):
        from background_reader import validate_contact_search
        try:
            validate_contact_search(query, offset, account_key, refresh)
        except BackgroundCaptureError as error:
            raise BridgeError(400, error.code, error.message) from None
        try:
            from background_reader import search_contacts
            return search_contacts(query, offset, account_key, cache=self.contact_cache, refresh=refresh)
        except BackgroundCaptureError as error:
            raise BridgeError(409, error.code, error.message) from None
        except Exception:
            raise BridgeError(503, "CONTACT_SEARCH_FAILED", "本机联系人目录暂时无法读取，请确认电脑微信已登录后重试。") from None

    def start(self, request):
        if not isinstance(request, dict) or set(request) - ({"kind", "friend", "contactId", "accountKey", "limit", "includeVoice", "mode", "allVisible", "voiceOnly", "voiceIds", "imageOnly", "imageIds"} | HISTORY_FIELDS):
            raise BridgeError(400, "INVALID_REQUEST", "仅接受采集类型、好友完整备注、数量和语音补全选项。")
        paged = bool(HISTORY_FIELDS.intersection(request))
        selected = "contactId" in request or "accountKey" in request
        kind, friend, limit = request.get("kind"), request.get("friend"), request.get("limit", MAX_PAGE_SIZE if paged else None)
        include_voice = request.get("includeVoice", False)
        voice_only = request.get("voiceOnly", False)
        mode = request.get("mode", "ui")
        all_visible = request.get("allVisible", False)
        if type(all_visible) is not bool or all_visible and kind != "moments":
            raise BridgeError(400, "INVALID_REQUEST", "完整可见范围仅支持朋友圈。")
        if mode not in ("ui", "background") or mode == "background" and kind != "chat":
            raise BridgeError(400, "INVALID_MODE", "后台读取仅支持聊天记录。")
        if paged and mode != "background":
            raise BridgeError(400, "INVALID_MODE", "完整历史分页仅支持后台聊天读取。")
        if selected and mode != "background" and kind != "moments":
            raise BridgeError(400, "INVALID_MODE", "选择联系人后请使用后台聊天导入。")
        if type(include_voice) is not bool:
            raise BridgeError(400, "INVALID_REQUEST", "语音补全选项必须明确为是或否。")
        if type(voice_only) is not bool:
            raise BridgeError(400, "INVALID_REQUEST", "语音补全范围必须明确。")
        if voice_only and (kind != "chat" or mode != "background" or not include_voice):
            raise BridgeError(400, "INVALID_REQUEST", "定向语音补全仅支持后台聊天读取。")
        if kind not in ("chat", "moments") or not isinstance(friend, str) or not friend.strip() or len(friend) > 100 or re.search(r"[\x00-\x1f]", friend):
            raise BridgeError(400, "INVALID_REQUEST", "请填写完整的好友备注。")
        maximum = BACKGROUND_MAX_ROWS if mode == "background" else (500 if kind == "chat" else 2000)
        if type(limit) is not int or not 1 <= limit <= maximum:
            raise BridgeError(400, "INVALID_LIMIT", "后台聊天每次最多1000条，界面聊天最多500条，朋友圈单次最多2000条可见动态。")
        if paged or selected or voice_only or "voiceIds" in request or "imageOnly" in request or "imageIds" in request:
            try:
                if request.get("imageOnly") and kind != "chat":
                    raise BackgroundCaptureError("INVALID_REQUEST", "定向图片补全仅支持后台聊天读取。")
                validation = ({**request, "kind": "chat", "limit": 1} if kind == "moments" else dict(request))
                validation.pop("allVisible", None)
                _validate_request(validation)
            except BackgroundCaptureError as error:
                raise BridgeError(400, error.code, error.message) from None
        with self.lock:
            self._prune()
            lane = "background" if mode == "background" else "moments" if kind == "moments" else "ui"
            identity = (self.token, self.origin, request.get("accountKey"), request.get("contactId"))
            running = [job for job in self.jobs.values() if _job_active(job)]
            if running and not (sys.platform == "win32" and self.token and selected
                    and all(identity) and len(running) == 1
                    and {lane, running[0].get("_lane")} == {"background", "moments"}
                    and running[0].get("_identity") == identity):
                raise BridgeError(409, "CAPTURE_BUSY", "已有同类或不同联系人的采集任务，请等完成或先停止。")
            health = self.health(background_only=mode == "background")
            capable = health.get("capabilities", {})
            if mode == "background" and not capable.get("backgroundChat"):
                raise BridgeError(409, "BACKGROUND_NOT_READY", health.get("backgroundMessage") or "当前助手暂不能后台读取聊天。")
            if mode == "background" and include_voice and not capable.get("backgroundVoice"):
                raise BridgeError(409, "BACKGROUND_VOICE_NOT_READY", "后台语音组件尚未就绪，请更新或重启本机助手。")
            # /health is a read-only snapshot. A tray/minimized window may
            # become readable after the explicitly requested worker restores
            # it. That worker must recheck UIA before reading account/contact.
            job_id = secrets.token_urlsafe(18)
            ctx = mp.get_context("spawn")
            payload = {"kind": kind, "friend": friend.strip(), "limit": limit, "includeVoice": include_voice, "mode": mode}
            if kind == "moments":
                payload["allVisible"] = all_visible
            payload.update({key: request[key] for key in HISTORY_FIELDS if key in request})
            payload.update({key: request[key] for key in ("contactId", "accountKey", "voiceOnly", "voiceIds", "imageOnly", "imageIds") if key in request})
            scope = _voice_scope(payload) if self.token else None
            capture_target = self.capture_target
            worker_authorization = None
            recovery_guard = None
            if sys.platform == "win32" and self._default_capture_target and mode == "ui" and kind == "moments":
                from functools import partial
                recovery_guard = ctx.Lock()
                capture_target = partial(capture_target, recovery_guard=recovery_guard)
            if sys.platform == "darwin" and self._default_capture_target:
                # The secret travels only through multiprocessing's private IPC.
                # It is never part of the browser request, job result or health.
                from functools import partial
                from platform_runtime import export_worker_authorization
                try:
                    worker_authorization = export_worker_authorization()
                except BackgroundCaptureError as error:
                    raise BridgeError(409, error.code, error.message) from None
                if scope is None:
                    capture_target = partial(_capture_process, worker_authorization=worker_authorization)
            # Foreground Moments must never discard or reuse the background
            # speech process; it can be actively transcribing at this point.
            worker = self._voice_worker if scope is not None else None
            child, new_process = None, True
            if worker is not None and (scope is None or worker["scope"] != (self.token, self.origin, scope)
                                       or not worker["process"].is_alive()
                                       or time.monotonic() >= worker.get("idleDeadline", 0) - 1):
                self._discard_voice_worker(worker)
                worker = None
            if scope is not None:
                if worker is None:
                    parent, child = ctx.Pipe(duplex=True)
                    proc = ctx.Process(target=_voice_worker_process, args=(child, capture_target, scope), daemon=True)
                    worker = {"process": proc, "pipe": parent, "scope": (self.token, self.origin, scope), "timer": None}
                    self._voice_worker = worker
                else:
                    parent, proc, new_process = worker["pipe"], worker["process"], False
                    if worker.get("timer") is not None:
                        worker["timer"].cancel()
                        worker["timer"] = None
            else:
                parent, child = ctx.Pipe(duplex=False)
                proc = ctx.Process(target=capture_target, args=(child, payload), daemon=True)
            from browser_return import capture_browser_window
            browser_window = capture_browser_window() if mode != "background" else None
            job = {"jobId": job_id, "mode": mode, "kind": kind, "allVisible": all_visible,
                   "_lane": lane, "_identity": identity, "_settled": False, "_recoveryGuard": recovery_guard,
                   "textOnly": mode == "background" and not include_voice and not request.get("imageOnly"),
                   "browserWindow": browser_window, "_voiceWorker": worker,
                   "status": "running", "progress": 0, "partialRevision": 0,
                   "phase": "preparing", "recordCount": 0, "pinnedCount": 0,
                   "lastAction": "start",
                   "message": ("正在补齐选定聊天图片" if request.get("imageOnly") else
                               "正在检查本机聊天与语音" if mode == "background" else "正在连接微信界面"), "updated": time.monotonic(), "process": proc}
            self.jobs[job_id] = job
            self._refresh_active()
            try:
                if new_process:
                    proc.start()
                if worker is not None:
                    command = {"jobId": job_id, "request": payload}
                    if worker_authorization is not None:
                        command["authorization"] = worker_authorization
                    parent.send(command)
            except Exception:
                self.jobs.pop(job_id, None)
                self._refresh_active()
                message = "采集任务未能启动，请重启本机助手后重试。"
                if self.active is None:
                    self.local_message = message
                if self._voice_worker is worker:
                    self._voice_worker = None
                if proc.pid is not None:
                    if proc.is_alive():
                        proc.terminate()
                    proc.join(timeout=1)
                parent.close()
                if child is not None:
                    child.close()
                raise BridgeError(503, "CAPTURE_START_FAILED", message) from None
            finally:
                if worker_authorization is not None:
                    worker_authorization.close()
            if child is not None:
                child.close()
            threading.Thread(target=self._monitor, args=(job_id, parent), daemon=True).start()
            return {"jobId": job_id}

    def _monitor(self, job_id, pipe):
        began = time.monotonic()
        timeout = BACKGROUND_JOB_TIMEOUT if self.jobs[job_id].get("mode") == "background" else JOB_TIMEOUT
        all_moments = self.jobs[job_id].get("kind") == "moments" and self.jobs[job_id].get("allVisible")
        last_event = began
        received_event = False
        try:
            while time.monotonic() - (last_event if all_moments else began) < (MOMENTS_IDLE_TIMEOUT if all_moments else timeout):
                with self.lock:
                    job = self.jobs.get(job_id)
                    if job and job.get("_cancelRequested"):
                        self.cancel(job_id)
                    if not job or job["status"] != "running":
                        return
                    alive = job["process"].is_alive()
                if pipe.poll(0.15):
                    msg = pipe.recv()
                    last_event = time.monotonic()
                    received_event = True
                    with self.lock:
                        if job.get("_cancelRequested"):
                            self.cancel(job_id)
                            if job["status"] == "running":
                                continue  # Drain events without undoing queued cancellation.
                        if job["status"] != "running":
                            return
                        if job.get("_voiceWorker") is not None and msg.get("workerJobId") != job_id:
                            message = "语音处理结果与当前任务不一致，已停止并保留此前完成的文字。"
                            job.update(status="failed", message=message,
                                       error={"code": "WORKER_JOB_MISMATCH", "message": message})
                            return
                        job["updated"] = time.monotonic()
                        if msg.get("type") == "progress":
                            job.update(progress=max(0, min(99, int(msg.get("progress", 0)))),
                                       phase=str(msg.get("phase") or job.get("phase") or "working")[:50],
                                       recordCount=int(msg.get("recordCount", job.get("recordCount", 0)) or 0),
                                       pinnedCount=int(msg.get("pinnedCount", job.get("pinnedCount", 0)) or 0),
                                       lastAction=str(msg.get("lastAction") or job.get("lastAction") or "")[:80],
                                       message=str(msg.get("message", ""))[:100])
                        elif msg.get("type") in ("partial", "partial-delta", "partial-patch"):
                            try:
                                partial = expand_partial(job.get("partial"), msg)
                            except (ValueError, KeyError, TypeError):
                                message = "采集进度来源不一致，已保留先前原文，请重新连接后继续。"
                                job.update(status="failed", message=message,
                                           error={"code": "PARTIAL_SOURCE_CHANGED", "message": message})
                                return
                            coverage = partial.get("coverage", {}) or {}
                            job.update(partial=partial, partialRevision=job.get("partialRevision", 0) + 1,
                                       phase=str(coverage.get("phase") or job.get("phase") or "reading")[:50],
                                       recordCount=int(coverage.get("recordCount", len(partial.get("records", []))) or 0),
                                       pinnedCount=int(coverage.get("pinnedCount", job.get("pinnedCount", 0)) or 0),
                                       lastAction=str(coverage.get("lastAction") or job.get("lastAction") or "")[:80],
                                       message=(f"已读取 {len(partial.get('records', []))} 条朋友圈，继续查找更早动态…"
                                                if job.get("kind") == "moments" else "文字已导入，正在补全语音…可随时停止。"))
                        elif msg.get("type") == "result":
                            if job.get("kind") == "moments" and not msg["result"].get("records"):
                                message = "本次没有采集到朋友圈内容。请检查微信是否显示该好友的动态后重试；没有生成新的分析材料。"
                                job.update(status="failed", message=message,
                                           error={"code": "NO_VISIBLE_MOMENTS", "message": message})
                                return
                            coverage = msg["result"].get("coverage", {})
                            message = (f"已读到当前账号可见末尾，共 {len(msg['result'].get('records', []))} 条朋友圈。"
                                       if job.get("kind") == "moments" and coverage.get("complete") else
                                       "本次朋友圈采集已结束，已读取内容可查看；未确认全部可见范围。"
                                       if job.get("kind") == "moments" else "已采集，请在网页确认导入")
                            job.update(status="completed", progress=100, message=message, result=msg["result"])
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
                elif ((not received_event and time.monotonic() - began >= WORKER_START_TIMEOUT)
                      or (received_event and job.get("textOnly") and
                          time.monotonic() - last_event >= BACKGROUND_READER_IDLE_TIMEOUT)):
                    with self.lock:
                        if job["status"] == "running":
                            code = "CAPTURE_START_TIMEOUT" if not received_event else "CHAT_READER_STALLED"
                            message = ("本机读取未能启动，已停止等待。请重新连接本机助手后继续导入。"
                                       if not received_event else
                                       "本机聊天读取长时间没有新进展，已停止等待。已导入的聊天会保留，可继续导入。")
                            job.update(status="failed", message=message, updated=time.monotonic(),
                                       error={"code": code, "message": message})
                    return
            with self.lock:
                if job["status"] == "running":
                    message = (f"朋友圈采集在{job.get('phase', '当前阶段')}阶段长时间没有新进展，已停止；已读取 {job.get('recordCount', 0)} 条动态，仍可导入，请检查微信窗口后重试。" if job.get("kind") == "moments" else
                               "本次语音补全已到时限，已核对的文字仍可导入。" if job.get("partial") else
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
            self._finish_job(job_id, pipe)

    def _finish_job(self, job_id, pipe):
        """Release lane ownership only after worker and foreground handoff."""
        job = None
        settled = True
        try:
            with self.lock:
                job = self.jobs.get(job_id)
                reusable = False
                if job:
                    proc = job["process"]
                    worker = job.get("_voiceWorker")
                    reusable = (worker is not None and self._voice_worker is worker
                                and job["status"] == "completed" and proc.is_alive()
                                and worker["scope"][:2] == (self.token, self.origin))
                    if reusable:
                        worker["idleDeadline"] = time.monotonic() + VOICE_WORKER_IDLE_TIMEOUT
                        worker["timer"] = threading.Timer(VOICE_WORKER_IDLE_TIMEOUT, self._expire_voice_worker,
                                                          (worker, worker["idleDeadline"]))
                        worker["timer"].daemon = True
                        worker["timer"].start()
                    elif worker is not None:
                        self._discard_voice_worker(worker)
                    else:
                        if not self._stop_process(job):
                            settled = False
                            self._schedule_finish(job_id, pipe)
                            return
                if not reusable:
                    pipe.close()
            if job and job.get("status") == "completed" and job.get("browserWindow"):
                from browser_return import return_to_browser
                try:
                    return_to_browser(job["browserWindow"])
                except (OSError, AttributeError):
                    pass  # Browser focus must never change the capture result.
        finally:
            with self.lock:
                if settled and job is not None and self.jobs.get(job_id) is job:
                    job["_settled"] = True
                self._refresh_active()
                if self.active is None:
                    self.local_message = "采集结束；原文仅暂存在本机内存，等待网页操作"

    def get(self, job_id, after_revision=None):
        with self.lock:
            self._prune()
            if job_id not in self.jobs:
                raise BridgeError(404, "JOB_NOT_FOUND", "任务不存在或已过期。")
            job = self.jobs[job_id]
            result = {key: value for key, value in job.items() if not key.startswith("_") and key not in ("process", "updated", "browserWindow")}
            if job.get("_cancelRequested"):
                result["cancelRequested"] = True
            if job.get("_settled") is False and job["status"] != "running":
                # A polling client can immediately submit the next voice batch
                # when it sees completed. Do not publish that state too early.
                result.update(status="running", progress=min(99, result.get("progress", 0)))
                result.pop("result", None)
                result.pop("error", None)
            if after_revision is not None:
                if type(after_revision) is not int or not 0 <= after_revision <= 1_000_000:
                    raise BridgeError(400, "INVALID_REVISION", "采集进度编号无效。")
                # The browser ACKs only after saving the partial. Old clients
                # retain their full snapshot contract; a reconnect starts at 0.
                if after_revision == job.get("partialRevision", 0) or job.get("result") is not None:
                    result.pop("partial", None)
            return result

    def _stop_process(self, job):
        """Never wait on a transaction while holding the shared job-state lock."""
        proc, guard = job["process"], job.get("_recoveryGuard")
        # A dead process may have abandoned its semaphore. No write can still
        # be in flight, so cleanup must not wait forever for that semaphore.
        if not proc.is_alive():
            proc.join(timeout=1)
            return True
        acquired = guard is not None and guard.acquire(False)
        if guard is not None and not acquired:
            return False
        try:
            if proc.is_alive():
                proc.terminate()
            proc.join(timeout=1)
            return not proc.is_alive()
        finally:
            if acquired:
                guard.release()

    def _schedule_finish(self, job_id, pipe):
        job = self.jobs.get(job_id)
        if not job or job.get("_finishTimer") is not None:
            return
        def retry():
            with self.lock:
                current = self.jobs.get(job_id)
                if current is job:
                    current["_finishTimer"] = None
            self._finish_job(job_id, pipe)
        timer = threading.Timer(.1, retry)
        timer.daemon = True
        job["_finishTimer"] = timer
        timer.start()

    def _schedule_cancel(self, job_id, job):
        if job.get("_cancelTimer") is not None:
            return
        def retry():
            with self.lock:
                if self.jobs.get(job_id) is job:
                    job["_cancelTimer"] = None
                    if job.get("_cancelRequested") and _job_active(job):
                        self.cancel(job_id)
        timer = threading.Timer(.1, retry)
        timer.daemon = True
        job["_cancelTimer"] = timer
        timer.start()

    def cancel(self, job_id):
        with self.lock:
            job = self.jobs.get(job_id)
            if not job:
                raise BridgeError(404, "JOB_NOT_FOUND", "任务不存在。")
            if _job_active(job):
                if not self._stop_process(job):
                    job.update(_cancelRequested=True, _settled=False, status="running", phase="cancelling",
                               message="正在安全停止，界面连接完成后会自动暂停；已保存的资料保留。", updated=time.monotonic())
                    self._schedule_cancel(job_id, job)
                    return {"jobId": job_id, "status": "running", "cancelRequested": True,
                            "message": job["message"], "partialRevision": job.get("partialRevision", 0),
                            **({"partial": job["partial"]} if "partial" in job else {})}
                job.update(status="cancelled", message=("朋友圈采集已停止，已读取的动态仍可查看。" if job.get("kind") == "moments" and job.get("partial") else
                           "已停止语音补全，已核对的文字仍可导入。" if job.get("partial") else "已停止，未上传内容"), updated=time.monotonic())
                job.pop("_cancelRequested", None)
                timer = job.pop("_cancelTimer", None)
                if timer is not None:
                    timer.cancel()
                if job.get("_voiceWorker") is not None:
                    self._discard_voice_worker(job["_voiceWorker"])
                job["_settled"] = True
                self._refresh_active()
            job.pop("result", None)
            return {"jobId": job_id, "status": job["status"], "partialRevision": job.get("partialRevision", 0),
                    **({"partial": job["partial"]} if "partial" in job else {})}

    def cancel_active(self):
        with self.lock:
            for job_id, job in list(self.jobs.items()):
                if _job_active(job):
                    self.cancel(job_id)
            self._discard_voice_worker()
            if any(_job_active(job) for job in self.jobs.values()):
                raise BridgeError(409, "CAPTURE_STOPPING", "正在安全停止采集，请稍后再切换连接。")


def server_for(state, port=PORT):
    class LimitedServer(ThreadingHTTPServer):
        def server_bind(self):
            if sys.platform == "win32":
                # Windows SO_REUSEADDR permits two live listeners on one port.
                # A second helper must never report ready while its handoff is
                # being sent to the first process. Set exclusivity before bind;
                # Unix retains HTTPServer's normal restart/reuse behaviour.
                self.allow_reuse_address = False
                self.allow_reuse_port = False
                self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
            # This listener is always the literal loopback address. HTTPServer's
            # default getfqdn() performs an unnecessary reverse-DNS lookup which
            # can stall first startup on macOS for tens of seconds.
            TCPServer.server_bind(self)
            self.server_name = "localhost"
            self.server_port = self.server_address[1]

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
                    if "query" not in body or set(body) - {"query", "offset", "accountKey", "refresh"}:
                        raise BridgeError(400, "INVALID_REQUEST", "联系人搜索参数无效。")
                    result = state.search_contacts(body["query"], **{
                        {"offset": "offset", "accountKey": "account_key", "refresh": "refresh"}[key]: body[key]
                        for key in ("offset", "accountKey", "refresh") if key in body})
                    state.authorize(self.origin, self.headers.get("Authorization"))
                    return self._send(200, result)
                if method == "POST" and path == "/capture":
                    return self._send(202, state.start(self._body()))
                matched = re.fullmatch(r"/jobs/([A-Za-z0-9_-]{24})(/cancel)?", path)
                if matched and method == "GET" and not matched[2]:
                    return self._send(200, state.get(matched[1]))
                progress = re.fullmatch(r"/jobs/([A-Za-z0-9_-]{24})/since/([0-9]{1,7})", path)
                if progress and method == "GET":
                    return self._send(200, state.get(progress[1], int(progress[2])))
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
