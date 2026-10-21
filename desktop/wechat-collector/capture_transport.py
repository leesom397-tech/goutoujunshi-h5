"""Compact immutable capture progress on the private process pipe."""


IDENTITY_FIELDS = ("version", "kind", "account", "friend")
ROW_SOURCE_FIELDS = ("accountId", "sessionId", "messageShard", "messageId", "localId")


def _same_row(left, right):
    return (isinstance(left, dict) and isinstance(right, dict)
            and isinstance(left.get("id"), str) and bool(left["id"])
            and isinstance(left.get("source"), dict) and isinstance(right.get("source"), dict)
            and all(left.get(key) == right.get(key) for key in ("id", "at", "sender", "senderRole"))
            and all(left.get("source", {}).get(key) == right.get("source", {}).get(key)
                    for key in ROW_SOURCE_FIELDS))


def partial_message(previous, batch):
    """Send only new rows when the verified source and old prefix are identical."""
    if (isinstance(previous, dict) and batch.get("kind") == "moments"
            and all(previous.get(key) == batch.get(key) for key in IDENTITY_FIELDS)):
        before, current = previous.get("records", []), batch.get("records", [])
        if len(current) >= len(before) and all(left == right for left, right in zip(before, current)):
            return {"type": "partial-delta", "offset": len(before),
                    "partial": {**batch, "records": current[len(before):]}}
    if (isinstance(previous, dict) and batch.get("kind") == "chat"
            and all(previous.get(key) == batch.get(key) for key in IDENTITY_FIELDS)):
        before, current = previous.get("records", []), batch.get("records", [])
        # Transcription changes a row, not its identity or position. Avoid
        # serializing every unchanged image again after each completed voice.
        if (len(before) == len(current) and all(_same_row(left, right) for left, right in zip(before, current))
                and len({row["id"] for row in current}) == len(current)):
            return {"type": "partial-patch", "count": len(current),
                    "updates": [{"index": index, "record": right} for index, (left, right)
                                in enumerate(zip(before, current)) if left != right],
                    "partial": {**batch, "records": []}}
    return {"type": "partial", "partial": batch}


def expand_partial(previous, message):
    batch = message["partial"]
    if message.get("type") == "partial-patch":
        count, updates = message.get("count"), message.get("updates")
        if (not isinstance(previous, dict) or type(count) is not int
                or count != len(previous.get("records", [])) or batch.get("kind") != "chat"
                or batch.get("records") != [] or not isinstance(updates, list)
                or len(updates) > count
                or any(previous.get(key) != batch.get(key) for key in IDENTITY_FIELDS)):
            raise ValueError("PARTIAL_SOURCE_CHANGED")
        records, changed = list(previous["records"]), set()
        for update in updates:
            index = update.get("index") if isinstance(update, dict) else None
            if (type(index) is not int or not 0 <= index < count or index in changed
                    or not _same_row(records[index], update.get("record"))):
                raise ValueError("PARTIAL_SOURCE_CHANGED")
            changed.add(index)
            records[index] = update["record"]
        return {**batch, "records": records}
    if message.get("type") != "partial-delta":
        return batch
    offset = message.get("offset")
    if (not isinstance(previous, dict) or type(offset) is not int
            or offset != len(previous.get("records", []))
            or batch.get("kind") != "moments"
            or any(previous.get(key) != batch.get(key) for key in IDENTITY_FIELDS)):
        raise ValueError("PARTIAL_SOURCE_CHANGED")
    return {**batch, "records": previous["records"] + batch.get("records", [])}
