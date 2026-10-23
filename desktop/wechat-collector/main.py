"""Visible, stoppable local helper. Launch never captures messages or uploads data."""
import argparse
import json
import multiprocessing
import sys
from pathlib import Path
import threading
from bridge import BridgeError, CollectorState, server_for
from pairing import open_connection_page


def _button(tk, parent, **options):
    if sys.platform == "darwin":
        from macos_setup_ui import native_button
        return native_button(tk, parent, **options)
    return tk.Button(parent, **options)


def _show_macos_window(root):
    """Lock the final laid-out size, never Aqua's initial 200x200 placeholder."""
    root.update_idletasks()
    width = max(590, root.winfo_reqwidth())
    height = max(680, root.winfo_reqheight())
    root.minsize(width, height)
    root.geometry(f"{width}x{height}")
    root.resizable(False, False)
    root.deiconify()
    root.update_idletasks()
    root.lift()


def connection_code_controls(tk, root, state):
    """A local copy action must never rotate pairing or touch an active capture."""
    row = tk.Frame(root, bg="#fff8f1")
    row.pack(pady=6)
    code = tk.StringVar(value=state.code)
    copy_text = tk.StringVar(value="复制连接码")
    reset_timer = None

    def reset_feedback():
        nonlocal reset_timer
        if reset_timer is not None:
            root.after_cancel(reset_timer)
            reset_timer = None
        copy_text.set("复制连接码")

    def copy_code(_event=None):
        nonlocal reset_timer
        reset_feedback()
        with state.lock:
            current = state.code
        code.set(current)
        try:
            root.clipboard_clear()
            root.clipboard_append(current)
            root.update_idletasks()
        except tk.TclError:
            copy_text.set("未复制，请重试")
        else:
            copy_text.set("已复制")
        reset_timer = root.after(1800, reset_feedback)
        return "break"

    value = tk.Label(row, textvariable=code, font=("Menlo" if sys.platform == "darwin" else "Consolas", 24, "bold"),
                     bg="#fff8f1", fg="#ad6148", cursor="hand2", takefocus=True,
                     highlightthickness=1, highlightbackground="#fff8f1", highlightcolor="#ad6148")
    value.pack(side="left", padx=(0, 14))
    value.bind("<Button-1>", copy_code)
    value.bind("<Return>", copy_code)
    value.bind("<space>", copy_code)
    _button(tk, row, textvariable=copy_text, command=copy_code,
              font=("PingFang SC" if sys.platform == "darwin" else "Microsoft YaHei UI", 11), bg="#fff8f1", fg="#944b34",
              activebackground="#fae4d8", activeforeground="#703822",
              padx=12, pady=6, width=14).pack(side="left")
    return code, reset_feedback


def main():
    parser = argparse.ArgumentParser(description="成子电脑微信采集助手")
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument("--desktop-service", action="store_true", help="仅供成子桌面应用使用的本机服务")
    modes.add_argument("--probe", action="store_true", help="仅检查依赖、版本及窗口类，不读取正文")
    modes.add_argument("--voice-self-test", action="store_true", help="仅用本机合成音频检查语音运行库及已有模型，不联网或采集")
    modes.add_argument("--database-self-test", action="store_true", help="仅用自建临时数据库检查加密与只读组件，不读取微信")
    modes.add_argument("--runtime-self-test", action="store_true", help="检查 Mac 运行库及合成材料，不读取微信或请求系统权限")
    modes.add_argument("--prepare-voice-model", action="store_true", help="显式下载并校验本机语音模型，不读取用户语音")
    modes.add_argument("--mac-diagnostics", action="store_true", help="仅检查 Mac 版本、依赖及匿名辅助功能元数据")
    modes.add_argument("--gui-self-test", action="store_true", help="Mac 合成界面检查，不打开网页或读取微信资料")
    parser.add_argument("--probe-output", type=Path, help="仅与 --probe 或本机 --*-self-test 一起使用，写入检查结果")
    args = parser.parse_args()
    if args.probe_output is not None and not (args.probe or args.voice_self_test or args.database_self_test or args.runtime_self_test or args.mac_diagnostics or args.gui_self_test):
        parser.error("--probe-output requires --probe, --voice-self-test or --database-self-test")
    if args.gui_self_test and (sys.platform != "darwin" or args.probe_output is None):
        parser.error("--gui-self-test requires macOS and --probe-output")
    if args.desktop_service:
        from desktop_service import main as desktop_service_main
        raise SystemExit(desktop_service_main())
    if args.prepare_voice_model:
        from local_voice_transcriber import prepare_model
        prepare_model()
        print(json.dumps({"ok": True, "mode": "prepare-voice-model", "userAudioUsed": False}))
        return
    if args.mac_diagnostics:
        from macos_accessibility import probe_accessibility
        metadata = probe_accessibility(prompt=False, include_tree=True)
        result = json.dumps(metadata, ensure_ascii=False)
        if args.probe_output is not None:
            args.probe_output.write_text(result, encoding="utf-8")
        print(result)
        return
    if args.voice_self_test or args.database_self_test or args.runtime_self_test:
        if args.voice_self_test:
            from voice_runtime_self_test import run_voice_self_test
            metadata = run_voice_self_test()
        elif args.runtime_self_test:
            from macos_runtime_self_test import run_runtime_self_test
            metadata = run_runtime_self_test()
        else:
            from database_runtime_self_test import run_database_self_test
            metadata = run_database_self_test()
        result = json.dumps(metadata, ensure_ascii=False)
        if args.probe_output is not None:
            args.probe_output.write_text(result, encoding="utf-8")
        print(result)
        if not metadata.get("ok"):
            raise SystemExit(1)
        return
    state = CollectorState()
    if args.gui_self_test:
        state.code = "00000000"  # Public, synthetic GUI fixture; no real pairing.
        state.local_message = "自动界面检查 · 合成资料，不连接网页、不采集微信"
    if args.probe:
        result = json.dumps(state.health(), ensure_ascii=False)
        if args.probe_output is not None:
            args.probe_output.write_text(result, encoding="utf-8")
        print(result)
        return
    import tkinter as tk
    from tkinter import messagebox
    root = tk.Tk()
    is_macos = sys.platform == "darwin"
    font_family = "PingFang SC" if is_macos else "Microsoft YaHei UI"
    if is_macos:
        root.withdraw()
    try:
        if sys.platform == "darwin":
            root._brand_icon = tk.PhotoImage(file=str(Path(__file__).resolve().with_name('chengzi-fluted-chat-v1.png')))
            root.iconphoto(True, root._brand_icon)
        else:
            root.iconbitmap(str(Path(__file__).resolve().with_name('chengzi-fluted-chat-v1.ico')))
    except tk.TclError:
        pass
    root.title("成子 · 电脑微信采集助手")
    if not is_macos:
        root.geometry("570x540")
        root.resizable(False, False)
    root.configure(bg="#fff8f1")
    try:
        server = server_for(state, port=0) if args.gui_self_test else server_for(state)
    except OSError:
        messagebox.showerror("助手已启动", "本机17863端口已被占用。请查看是否已有成子助手，再重试。")
        root.destroy()
        return
    threading.Thread(target=server.serve_forever, daemon=True).start()
    tk.Label(root, text="连接你的网页", font=(font_family, 21, "bold"), bg="#fff8f1", fg="#322921").pack(pady=(26, 6))
    setup_close = None
    if sys.platform == "darwin":
        from macos_setup_ui import install_setup_controls
        setup_close = install_setup_controls(tk, root, state)
    tk.Label(root, text="正在打开网页并连接；若未打开，可点击下方按钮", font=(font_family, 12), bg="#fff8f1", fg="#756151").pack()
    def connect():
        if args.gui_self_test:
            return False
        try:
            return open_connection_page(state)
        except BridgeError as error:
            with state.lock:
                state.local_message = error.message
            return False
    connect_button = _button(tk, root, text="打开网页并连接", command=connect,
                               font=(font_family, 13, "bold"), bg="#ad6148", fg="white",
                               activebackground="#94513c", activeforeground="white", padx=30, pady=10)
    connect_button.pack(pady=(18, 6))
    tk.Label(root, text="备用连接码 · 网页未自动连接时使用", font=(font_family, 10), bg="#fff8f1", fg="#756151").pack(pady=(8, 0))
    code, reset_copy_feedback = connection_code_controls(tk, root, state)
    status = tk.StringVar(value=state.local_message)
    tk.Label(root, textvariable=status, wraplength=500, font=(font_family, 11), bg="#fff8f1", fg="#322921").pack(pady=8)
    instructions = ("首次设置后重新打开微信，在网页选择联系人。\n聊天与语音在本机读取和转写。\n当前 Mac 预览版朋友圈只读取已加载缓存，未自动扫描全量。\n分析前会请你确认导入的材料。"
                    if sys.platform == "darwin" else
                    "手机记录可先通过微信「导出到电脑」同步指定聊天。\n连接成功后，在网页选择联系人并点击导入。\n后台聊天与语音不占用微信窗口；朋友圈仍需微信前台。\n分析前会请你确认导入的材料。")
    tk.Label(root, text=instructions, justify="left", font=(font_family, 10), bg="#fff8f1", fg="#756151").pack(pady=12)
    buttons = tk.Frame(root, bg="#fff8f1")
    buttons.pack(pady=10)
    def rotate():
        state.rotate()
        reset_copy_feedback()
        code.set(state.code)
    def cancel():
        with state.lock:
            state.cancel_active()
            state.local_message = "已停止采集，可重新开始"
    def close():
        if setup_close:
            setup_close()
        with state.lock:
            state.cancel_active()
            state.jobs.clear()
            state.token = ""
            state.revoke_handoff()
        server.shutdown()
        server.server_close()
        root.destroy()
    _button(tk, buttons, text="停止本次采集", command=cancel, padx=12, pady=6).pack(side="left", padx=5)
    _button(tk, buttons, text="断开并换连接码", command=rotate, padx=12, pady=6).pack(side="left", padx=5)
    _button(tk, buttons, text="退出助手", command=close, padx=12, pady=6).pack(side="left", padx=5)
    def tick():
        with state.lock:
            state._prune()
            connect_button.configure(state="disabled" if state.active else "normal",
                                     text="导入中 · 完成后可重新连接" if state.active else "打开网页并连接")
        if code.get() != state.code:
            reset_copy_feedback()
            code.set(state.code)
        status.set(state.local_message)
        root.after(500, tick)
    root.protocol("WM_DELETE_WINDOW", close)
    tick()
    if is_macos:
        _show_macos_window(root)
    def connect_at_startup():
        if connect() and sys.platform != "darwin":
            root.iconify()
    # server_for has bound the loopback socket, and serve_forever has started.
    # Wait for Tk's event loop so the browser handoff is a startup action, not a capture.
    if args.gui_self_test:
        from macos_gui_smoke import check_visible_app
        gui_result = {}
        def check_gui():
            try:
                gui_result.update(check_visible_app(root, state, code, args.probe_output,
                                                    server_port=server.server_port))
            finally:
                close()
        root.after(650, check_gui)
    else:
        root.after(250, connect_at_startup)
    root.mainloop()
    if args.gui_self_test and not gui_result.get("ok"):
        raise SystemExit(1)


if __name__ == "__main__":
    multiprocessing.freeze_support()
    main()
