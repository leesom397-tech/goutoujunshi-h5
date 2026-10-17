"""Visible, stoppable local helper. Launch never captures messages or uploads data."""
import argparse
import json
import multiprocessing
from pathlib import Path
import threading
from bridge import BridgeError, CollectorState, server_for
from pairing import open_connection_page


def main():
    parser = argparse.ArgumentParser(description="成子电脑微信采集助手")
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument("--probe", action="store_true", help="仅检查依赖、版本及窗口类，不读取正文")
    modes.add_argument("--voice-self-test", action="store_true", help="仅用本机合成音频检查语音运行库及已有模型，不联网或采集")
    modes.add_argument("--database-self-test", action="store_true", help="仅用自建临时数据库检查加密与只读组件，不读取微信")
    parser.add_argument("--probe-output", type=Path, help="仅与 --probe 或本机 --*-self-test 一起使用，写入检查结果")
    args = parser.parse_args()
    if args.probe_output is not None and not (args.probe or args.voice_self_test or args.database_self_test):
        parser.error("--probe-output requires --probe, --voice-self-test or --database-self-test")
    if args.voice_self_test or args.database_self_test:
        if args.voice_self_test:
            from voice_runtime_self_test import run_voice_self_test
            metadata = run_voice_self_test()
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
    if args.probe:
        result = json.dumps(state.health(), ensure_ascii=False)
        if args.probe_output is not None:
            args.probe_output.write_text(result, encoding="utf-8")
        print(result)
        return
    import tkinter as tk
    from tkinter import messagebox
    root = tk.Tk()
    root.title("成子 · 电脑微信采集助手")
    root.geometry("570x540")
    root.resizable(False, False)
    root.configure(bg="#fff8f1")
    try:
        server = server_for(state)
    except OSError:
        messagebox.showerror("助手已启动", "本机17863端口已被占用。请查看是否已有成子助手，再重试。")
        root.destroy()
        return
    threading.Thread(target=server.serve_forever, daemon=True).start()
    tk.Label(root, text="连接你的网页", font=("Microsoft YaHei UI", 21, "bold"), bg="#fff8f1", fg="#322921").pack(pady=(26, 6))
    tk.Label(root, text="正在打开网页并连接；若未打开，可点击下方按钮", font=("Microsoft YaHei UI", 12), bg="#fff8f1", fg="#756151").pack()
    def connect():
        try:
            return open_connection_page(state)
        except BridgeError as error:
            with state.lock:
                state.local_message = error.message
            return False
    connect_button = tk.Button(root, text="打开网页并连接", command=connect,
                               font=("Microsoft YaHei UI", 13, "bold"), bg="#ad6148", fg="white",
                               activebackground="#94513c", activeforeground="white", padx=30, pady=10)
    connect_button.pack(pady=(18, 6))
    tk.Label(root, text="备用连接码 · 网页未自动连接时使用", font=("Microsoft YaHei UI", 10), bg="#fff8f1", fg="#756151").pack(pady=(8, 0))
    code = tk.StringVar(value=state.code)
    tk.Label(root, textvariable=code, font=("Consolas", 24, "bold"), bg="#fff8f1", fg="#ad6148").pack(pady=6)
    status = tk.StringVar(value=state.local_message)
    tk.Label(root, textvariable=status, wraplength=500, font=("Microsoft YaHei UI", 11), bg="#fff8f1", fg="#322921").pack(pady=8)
    tk.Label(root, text="手机记录可先通过微信「导出到电脑」同步指定聊天。\n连接成功后，在网页选择联系人并点击导入。\n后台聊天与语音不占用微信窗口；朋友圈仍需微信前台。\n分析前会请你确认导入的材料。", justify="left", font=("Microsoft YaHei UI", 10), bg="#fff8f1", fg="#756151").pack(pady=12)
    buttons = tk.Frame(root, bg="#fff8f1")
    buttons.pack(pady=10)
    def rotate():
        state.rotate()
        code.set(state.code)
    def cancel():
        with state.lock:
            state.cancel_active()
            state.local_message = "已停止采集，可重新开始"
    def close():
        with state.lock:
            state.cancel_active()
            state.jobs.clear()
            state.token = ""
            state.revoke_handoff()
        server.shutdown()
        server.server_close()
        root.destroy()
    tk.Button(buttons, text="停止本次采集", command=cancel, padx=12, pady=6).pack(side="left", padx=5)
    tk.Button(buttons, text="断开并换连接码", command=rotate, padx=12, pady=6).pack(side="left", padx=5)
    tk.Button(buttons, text="退出助手", command=close, padx=12, pady=6).pack(side="left", padx=5)
    def tick():
        with state.lock:
            state._prune()
            connect_button.configure(state="disabled" if state.active else "normal",
                                     text="导入中 · 完成后可重新连接" if state.active else "打开网页并连接")
        code.set(state.code)
        status.set(state.local_message)
        root.after(500, tick)
    root.protocol("WM_DELETE_WINDOW", close)
    tick()
    def connect_at_startup():
        if connect():
            root.iconify()
    # server_for has bound the loopback socket, and serve_forever has started.
    # Wait for Tk's event loop so the browser handoff is a startup action, not a capture.
    root.after(250, connect_at_startup)
    root.mainloop()


if __name__ == "__main__":
    multiprocessing.freeze_support()
    main()
