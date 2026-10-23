"""Real Mac Tk window checks with synthetic state; never captures WeChat pixels."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import time


def _widgets(widget):
    yield widget
    for child in widget.winfo_children():
        yield from _widgets(child)


def _text(widget):
    try:
        variable = widget.cget("textvariable")
        return str(widget.getvar(variable)) if variable else str(widget.cget("text"))
    except Exception:
        return ""


def _capture_own_window(output):
    """Respect TCC; filter window ownership before choosing screenshot target."""
    try:
        import Quartz as q
        if not q.CGPreflightScreenCaptureAccess():
            return {"captured": False, "reason": "screen-permission-not-granted"}
        windows = q.CGWindowListCopyWindowInfo(q.kCGWindowListOptionOnScreenOnly, q.kCGNullWindowID)
        own = [window for window in windows if int(window.get(q.kCGWindowOwnerPID, -1)) == os.getpid()
               and int(window.get(q.kCGWindowLayer, -1)) == 0]
        if len(own) != 1:
            return {"captured": False, "reason": "own-window-not-unique"}
        window_id = int(own[0][q.kCGWindowNumber])
        result = subprocess.run(["/usr/sbin/screencapture", "-x", "-l", str(window_id), str(output)],
                                capture_output=True, timeout=10)
        if result.returncode or not output.is_file():
            return {"captured": False, "reason": "capture-unavailable"}
        return {"captured": True, "file": output.name, "scope": "assistant-synthetic-window-only"}
    except Exception:
        return {"captured": False, "reason": "capture-unavailable"}


def check_visible_app(root, state, code_variable, output):
    began = time.monotonic()
    output = Path(output)
    result = {"ok": False, "mode": "macos-gui-self-test", "frozen": bool(getattr(sys, "frozen", False)),
              "platform": sys.platform, "architecture": platform.machine(), "macos": platform.mac_ver()[0],
              "userDataUsed": False, "wechatLoginUsed": False, "browserOpened": False,
              "pairingFixture": "synthetic", "checks": {}}
    checks = result["checks"]
    try:
        root.update_idletasks()
        root.update()
        assert root.winfo_ismapped(), "window-not-mapped"
        checks["windowMapped"] = True
        buttons = {_text(widget): widget for widget in _widgets(root) if widget.winfo_class() == "Button"}
        expected = {"首次设置 · 本机读取与语音", "打开网页并连接", "复制连接码", "停止本次采集", "断开并换连接码", "退出助手"}
        assert expected.issubset(buttons), "required-controls-missing"
        checks["windowSize"] = [root.winfo_width(), root.winfo_height()]
        result["controls"] = []
        for label in expected:
            widget = buttons[label]
            x, y = widget.winfo_rootx() - root.winfo_rootx(), widget.winfo_rooty() - root.winfo_rooty()
            result["controls"].append({"name": label, "frame": [x, y, widget.winfo_width(), widget.winfo_height()]})
            assert widget.winfo_ismapped() and x >= 0 and y >= 0, "control-hidden"
            assert x + widget.winfo_width() <= root.winfo_width() and y + widget.winfo_height() <= root.winfo_height(), "control-clipped"
        checks["allPrimaryControlsVisible"] = True
        buttons["复制连接码"].invoke()
        assert root.clipboard_get() == "00000000", "copy-failed"
        checks["copyCode"] = True
        buttons["断开并换连接码"].invoke()
        assert len(state.code) == 8 and state.code != "00000000" and not state.token and not state.jobs, "reset-failed"
        state.code = "00000000"
        code_variable.set(state.code)
        checks["resetConnection"] = True
        buttons["停止本次采集"].invoke()
        assert state.active is None and not state.jobs, "stop-failed"
        checks["stopIdleCapture"] = True
        buttons["打开网页并连接"].invoke()  # Explicit test mode keeps browser closed.
        assert not state.handoff_digest, "unexpected-browser-handoff"
        from macos_key_provider import probe_setup
        metadata = probe_setup()  # Bundle/dependency metadata only, never account data.
        result["officialClientProbe"] = {name: metadata[name] for name in
            ("status", "ready", "dependenciesReady", "wechatVersion", "wechatBuild", "initializationRequired") if name in metadata}
        assert not metadata.get("ready"), "unexpected-authorized-account"
        checks["uninitializedCaptureBlocked"] = True
        state.local_message = "自动界面检查通过 · 合成资料，无登录、无采集"
        root.update_idletasks()
        result["ok"] = True
    except Exception as error:
        result["errorType"] = type(error).__name__
        # Error messages may be native values; only our fixed assertion codes leave the VM.
        reason = str(error)
        result["reason"] = reason if isinstance(error, AssertionError) and reason.isascii() and len(reason) < 80 else "gui-check-failed"
    finally:
        output.parent.mkdir(parents=True, exist_ok=True)
        try:
            state.code = "00000000"
            code_variable.set(state.code)
            root.update_idletasks()
            result["screenshot"] = _capture_own_window(output.with_name("assistant-window.png"))
        except Exception:
            result["screenshot"] = {"captured": False, "reason": "window-unavailable"}
        result["elapsedMilliseconds"] = round((time.monotonic() - began) * 1000)
        output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", "utf-8")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--wechat-app", type=Path)
    args = parser.parse_args()
    if sys.platform != "darwin" or platform.machine() != "arm64":
        parser.error("requires native macOS arm64")
    executable = args.app.resolve() / "Contents/MacOS/ChengziWeChatCollector"
    if not executable.is_file():
        parser.error("expected app executable is missing")
    output = args.output_dir.resolve()
    output.mkdir(parents=True, exist_ok=True)
    receipt_path = output / "gui-self-test.json"
    receipt = {"ok": False, "mode": "frozen-mac-gui-run", "userDataUsed": False, "wechatLoginUsed": False}
    try:
        run = subprocess.run([str(executable), "--gui-self-test", "--probe-output", str(receipt_path)],
                             capture_output=True, timeout=45)
        receipt["exitCode"] = run.returncode
        detail = json.loads(receipt_path.read_text("utf-8")) if receipt_path.is_file() else {}
        receipt["gui"] = detail
        receipt["ok"] = run.returncode == 0 and detail.get("ok") is True and detail.get("frozen") is True
        if not detail:
            receipt["reason"] = "app-exited-before-receipt"
            receipt["bootstrapErrorTypes"] = [name for name in ("TclError", "ModuleNotFoundError", "ImportError", "RuntimeError")
                                                if name.encode() in run.stderr]
    except subprocess.TimeoutExpired:
        receipt["reason"] = "gui-timeout"
    except Exception as error:
        receipt["errorType"] = type(error).__name__
        receipt["reason"] = "gui-run-failed"
    (output / "receipt.json").write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n", "utf-8")
    print(json.dumps({"ok": receipt["ok"], "mode": receipt["mode"]}))
    raise SystemExit(0 if receipt["ok"] else 1)


if __name__ == "__main__":
    main()
