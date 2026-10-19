"""Lossless ordering and honest provenance for UI-derived records. No message IDs invented."""
from datetime import datetime, timezone
import hashlib
import json

VERSION = "1.2.11"
UPSTREAM_COMMIT = "8589baa049bb91d3a500602c167f07b2f8397a13"


def normalized_capture(kind, friend, account, rows, warnings=None):
    if kind not in ("chat", "moments") or not isinstance(rows, list):
        raise ValueError("unsupported capture")
    if not isinstance(account, str) or not account.strip():
        raise ValueError("account identity is required")
    records = []
    ordered = list(enumerate(rows))
    if kind == "chat":
        ordered.reverse()
    for index, (ui_index, row) in enumerate(ordered):
        text = row.get("text", "")
        if not isinstance(text, str):
            raise ValueError("record text must be a string")
        if len(text) > 20000:
            raise ValueError("single record too large")
        at = row.get("at") or ""
        if not isinstance(at, str):
            raise ValueError("record time must be the original text")
        item_kind = row.get("kind", "other")
        if item_kind not in ("text", "image", "sticker", "post", "other"):
            item_kind = "other"
        source = {
            "label": f"电脑微信 · {friend} · {'聊天' if kind == 'chat' else '朋友圈'} · 界面第 {ui_index + 1} 条",
            "method": "uia", "index": index, "uiIndex": ui_index, "atRaw": at,
            "order": "oldest-first" if kind == "chat" else "newest-first", "idStability": "unavailable",
            "upstreamCommit": UPSTREAM_COMMIT,
            **row.get("source", {}),
        }
        # A fingerprint is diagnostic only. It is deliberately NOT record.id:
        # repeated identical short messages must survive incremental overlap matching.
        raw = json.dumps([kind, row.get("sender", ""), at, text, item_kind], ensure_ascii=False, separators=(",", ":"))
        source["contentFingerprint"] = hashlib.sha256(raw.encode("utf-8")).hexdigest()
        record = {
            "id": "", "kind": item_kind, "sender": row.get("sender", ""),
            "senderRole": row.get("senderRole", "unknown"), "at": at, "text": text, "source": source,
        }
        if row.get("images"):
            record["images"] = row["images"]
        records.append(record)
    return {"version": 1, "kind": kind, "friend": friend, "account": account.strip(),
            "capturedAt": datetime.now(timezone.utc).isoformat(), "records": records,
            "warnings": list(dict.fromkeys(warnings or []))}


