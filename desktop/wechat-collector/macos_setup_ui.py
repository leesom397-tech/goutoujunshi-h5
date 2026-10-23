"""Visible, local Mac authorization and model preparation. No bridge endpoint."""
import threading
import queue
import time
import math


_AUTHORIZATION_PROGRESS = frozenset({
    "正在准备本机授权组件，原微信应用保持不变。",
    "请在临时微信窗口完成登录或系统授权，完成后会自动关闭临时窗口。",
    "授权完成，请重新打开原微信，然后回网页选择联系人。",
})


def _progress_message(*args, **kwargs):
    """Accept only our fixed authorization text or bounded model counters."""
    if args and isinstance(args[0], str) and args[0] in _AUTHORIZATION_PROGRESS:
        return args[0]
    value = args[0] if args and isinstance(args[0], dict) else kwargs
    stage = value.get("stage", "")
    stage = stage if isinstance(stage, str) else ""
    if stage == "voice-model-download":
        received, total = value.get("receivedBytes", 0), value.get("totalBytes", 0)
        if (type(received) in (int, float) and type(total) in (int, float)
                and math.isfinite(received) and math.isfinite(total) and total > 0):
            return f"准备本机语音模型 · {min(100, max(0, round(received * 100 / total)))}%"
    return ({"voice-model-install": "正在校验并安装本机语音模型…",
             "voice-model-ready": "本机语音模型已准备完成。",
             "voice-model-download-retry": "正在重新连接模型下载，已下载的部分会继续使用。"}.get(stage)
            or ("正在准备本机语音模型，可取消；已下载的部分下次继续。" if stage.startswith("voice-")
                else "正在完成本机读取授权；如微信副本提示登录，请在副本中完成。"))


def _authorize_local_reader(stop, publish, progress):
    """Freeze one logged-in account once, then cheaply wait for its normal exit."""
    from background_reader import BackgroundCaptureError
    import macos_key_provider as provider
    if stop.is_set():
        return
    proof = provider.current_account_proof()
    provider.prepare_authorized_access()  # Full official signature validation once.
    provider.verify_account_proof(proof)
    publish("已核对当前账号。请从微信菜单正常退出微信，助手会自动继续设置。")
    deadline = time.monotonic() + 300
    expected = [(proof["pid"], proof["started"])]
    while not stop.is_set():
        # This helper enumerates only the same user's exact official executable;
        # it does not scan memory, content or verify the entire app signature.
        processes = provider._processes()
        if not processes:
            break
        if processes != expected:
            raise BackgroundCaptureError("ACCOUNT_CHANGED", "微信已重开，请保持原账号登录后重新设置。")
        try:
            provider.verify_account_proof(proof)
        except BackgroundCaptureError:
            # A normal quit can close database handles between the two probes.
            if not provider._processes():
                break
            raise
        if time.monotonic() >= deadline:
            raise BackgroundCaptureError("MAC_WECHAT_MUST_CLOSE", "请从微信菜单正常退出微信，再重新设置。")
        stop.wait(1)
    if not stop.is_set():
        provider.initialize_authorized_access(consent=True, cancel=stop.is_set, progress=progress)


def install_setup_controls(tk, root, state):
    from tkinter import messagebox
    stop = threading.Event()
    alive = True
    running = False
    events = queue.SimpleQueue()
    frame = tk.Frame(root, bg="#fff8f1")
    frame.pack(pady=(8, 4))
    label = tk.StringVar(value="首次使用：授权本机读取并准备语音模型")
    status = tk.Label(frame, textvariable=label, wraplength=520,
                      bg="#fff8f1", fg="#756151")
    status.pack(pady=4)

    def publish(message):
        if alive and not stop.is_set():
            events.put(("progress", message))

    def progress(*args, **kwargs):
        publish(_progress_message(*args, **kwargs))

    def finish(error=None):
        nonlocal running
        running = False
        if not alive:
            return
        button.configure(state="normal")
        cancel_button.configure(state="disabled")
        if stop.is_set():
            label.set("已停止设置，可稍后继续。")
        elif error:
            label.set(error)
        else:
            label.set("设置完成。请重新打开日常使用的微信并登录同一账号，再到网页导入。")
            with state.lock:
                state.local_message = "Mac 本机读取已授权，语音模型已准备。请打开微信后在网页导入。"

    def prepare():
        nonlocal running
        if running:
            return
        with state.lock:
            if state.active:
                label.set("请先完成或停止正在进行的导入。")
                return
        accepted = messagebox.askokcancel("Mac 首次设置",
            "请先保持微信登录，以便核对当前账号；助手提示后再正常退出微信。\n\n"
            "助手会在你的用户目录创建隔离的微信副本，用于你授权的本机聊天读取；"
            "不会修改原微信程序或关闭 SIP。副本可能要求扫码登录。\n\n"
            "同时下载约 163 MB 的本机语音模型，之后转写在电脑上完成。"
            "设置完成后请重新打开日常使用的微信。", parent=root)
        if not accepted:
            return
        stop.clear()
        running = True
        button.configure(state="disabled")
        cancel_button.configure(state="normal")
        label.set("正在检查微信版本并准备本机读取授权…")

        def worker():
            error = None
            try:
                _authorize_local_reader(stop, publish, progress)
                if not stop.is_set():
                    from local_voice_transcriber import prepare_model
                    prepare_model(progress=progress, cancelled=stop.is_set)
            except Exception as exc:
                from background_reader import BackgroundCaptureError
                from local_voice_transcriber import TranscriptionError
                # Only our typed user-facing errors are safe to display.
                error = (str(getattr(exc, "message", "") or str(exc))[:500]
                         if isinstance(exc, (BackgroundCaptureError, TranscriptionError))
                         else "本机设置未完成。请检查微信版本与助手组件后重试。")
            if alive:
                events.put(("finish", error))
        threading.Thread(target=worker, daemon=True, name="chengzi-mac-setup").start()

    button = tk.Button(frame, text="首次设置 · 本机读取与语音", command=prepare,
                       bg="#ad6148", fg="white", padx=14, pady=7)
    button.pack(side="left", padx=5)
    def cancel_setup():
        stop.set()
        label.set("正在取消并清理本次授权组件，请稍候…")
        cancel_button.configure(state="disabled")
    cancel_button = tk.Button(frame, text="取消设置", state="disabled", command=cancel_setup)
    cancel_button.pack(side="left", padx=5)

    def poll_events():
        if not alive:
            return
        while not events.empty():
            kind, value = events.get()
            if kind == "finish":
                finish(value)
            elif not stop.is_set():
                label.set(value)
        root.after(200, poll_events)
    root.after(200, poll_events)

    def close():
        nonlocal alive
        alive = False
        stop.set()
        from macos_key_provider import clear_authorization
        clear_authorization()
    return close
