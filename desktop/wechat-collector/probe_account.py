"""Explicit local account-popup check. Never opens a friend or prints account data."""
import contextlib
import io
import json

result = {"accountReadable": False, "nicknameReadable": False, "code": "PROFILE_UI_UNAVAILABLE"}
with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
    try:
        from pyweixin import Navigator
        from adapter import _account
        account, nickname = _account(Navigator)
        result = {"accountReadable": bool(account), "nicknameReadable": bool(nickname), "code": "OK"}
        del account, nickname
    except Exception as error:
        result["code"] = getattr(error, "code", "PROFILE_UI_UNAVAILABLE")
print(json.dumps(result))
