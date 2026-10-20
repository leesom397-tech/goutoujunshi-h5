"""Compact immutable Moments progress on the private process pipe."""


def partial_message(previous, batch):
    """Send only new rows when the verified source and old prefix are identical."""
    if (isinstance(previous, dict) and batch.get("kind") == "moments"
            and all(previous.get(key) == batch.get(key) for key in ("version", "kind", "account", "friend"))):
        before, current = previous.get("records", []), batch.get("records", [])
        if len(current) >= len(before) and all(left == right for left, right in zip(before, current)):
            return {"type": "partial-delta", "offset": len(before),
                    "partial": {**batch, "records": current[len(before):]}}
    return {"type": "partial", "partial": batch}


def expand_partial(previous, message):
    batch = message["partial"]
    if message.get("type") != "partial-delta":
        return batch
    offset = message.get("offset")
    if (not isinstance(previous, dict) or type(offset) is not int
            or offset != len(previous.get("records", []))
            or batch.get("kind") != "moments"
            or any(previous.get(key) != batch.get(key) for key in ("version", "kind", "account", "friend"))):
        raise ValueError("PARTIAL_SOURCE_CHANGED")
    return {**batch, "records": previous["records"] + batch.get("records", [])}
