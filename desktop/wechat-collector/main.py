"""Visible, stoppable local helper. Launch never captures messages or uploads data."""
import argparse
import json
import multiprocessing
import threading
from bridge import CollectorState, server_for


def main():
    parser = argparse.ArgumentParser(description="成子电脑微信采集助手")
    parser.add_argument("--probe", action="store_true", help="仅检查依赖、版本及窗口类，不读取正文")
    args = parser.parse_args()
    state = CollectorState()
    if args.probe:
        print(json.dumps(state.health(), ensure_ascii=False))
        return
    import tkinter as tk
    from tkinter import messagebox
    root = tk.Tk()
    root.title("成子 · 电脑微信采集助手")
    root.geometry("570x465")
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
    tk.Label(root, text="在成子网页版输入下方连接码", font=("Microsoft YaHei UI", 12), bg="#fff8f1", fg="#756151").pack()
    code = tk.StringVar(value=state.code)
    tk.Label(root, textvariable=code, font=("Consolas", 32, "bold"), bg="#fff8f1", fg="#ad6148").pack(pady=18)
    status = tk.StringVar(value=state.local_message)
    tk.Label(root, textvariable=status, wraplength=500, font=("Microsoft YaHei UI", 11), bg="#fff8f1", fg="#322921").pack(pady=8)
    tk.Label(root, text="打开并登录电脑微信，再到网页选择好友和采集范围。\n采集会打开相应界面，聊天可能标为已读。\n仅在你点击采集后读取；关闭本窗口即断开连接。\n原文暂存在本机内存，由网页预览、确认后再导入或分析。", justify="left", font=("Microsoft YaHei UI", 10), bg="#fff8f1", fg="#756151").pack(pady=12)
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
        server.shutdown()
        server.server_close()
        root.destroy()
    tk.Button(buttons, text="停止本次采集", command=cancel, padx=12, pady=6).pack(side="left", padx=5)
    tk.Button(buttons, text="断开并换连接码", command=rotate, padx=12, pady=6).pack(side="left", padx=5)
    tk.Button(buttons, text="退出助手", command=close, padx=12, pady=6).pack(side="left", padx=5)
    def tick():
        with state.lock:
            state._prune()
        code.set(state.code)
        status.set(state.local_message)
        root.after(500, tick)
    root.protocol("WM_DELETE_WINDOW", close)
    tick()
    root.mainloop()


if __name__ == "__main__":
    multiprocessing.freeze_support()
    main()
