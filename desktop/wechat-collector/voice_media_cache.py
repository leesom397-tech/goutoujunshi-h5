"""Scoped hints for previously requested voice rows; no audio or plaintext.

Hints are used only for the exact database revision, then every positive row is
queried again with both contact and server-id predicates. A miss/corruption
falls back to the original full selected-id query. Writes occur after sealing.
"""
import hashlib
import json
import os
from pathlib import Path
import tempfile

MAX_ENTRIES = 4096
MAX_FILE_BYTES = 2 * 1024 * 1024


def _hash(value):
    return hashlib.sha256(str(value).encode("utf-8")).hexdigest()


class VoiceMediaCache:
    def __init__(self, account, session, shard, revision, *, root=None):
        if root is None:
            from local_voice_transcriber import _storage_root
            root = _storage_root() / "media-locators"
        scope = _hash(json.dumps([account, session, shard], ensure_ascii=False))
        self.path = Path(root) / scope[:2] / (scope + ".json")
        self.revision = _hash(json.dumps(revision, sort_keys=True))
        self.entries = {}
        try:
            if self.path.stat().st_size <= MAX_FILE_BYTES:
                data = json.loads(self.path.read_text("utf-8"))
                if data.get("version") == 1 and data.get("revision") == self.revision and isinstance(data.get("entries"), dict):
                    self.entries = dict(list(data["entries"].items())[-MAX_ENTRIES:])
        except (OSError, ValueError, TypeError, AttributeError):
            pass

    def lookup(self, wanted):
        result = {}
        for server_id in wanted:
            rows = self.entries.get(_hash(server_id))
            if not isinstance(rows, list) or len(rows) > 2000:
                return None
            for row in rows:
                if (not isinstance(row, list) or len(row) != 2 or type(row[0]) is not int or row[0] <= 0
                        or row[1] is not None and (type(row[1]) is not int or row[1] < 0)):
                    return None
            result[str(server_id)] = rows
        return result

    def stage(self, wanted, rows):
        additions = {_hash(server_id): [] for server_id in wanted}
        for rowid, server_id, length, _ in rows:
            key = _hash(server_id)
            if key in additions:
                additions[key].append([rowid, length])
        def save():
            temporary = None
            try:
                self.entries.update(additions)
                self.entries = dict(list(self.entries.items())[-MAX_ENTRIES:])
                self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                body = json.dumps({"version": 1, "revision": self.revision, "entries": self.entries}, separators=(",", ":"))
                if len(body.encode("utf-8")) > MAX_FILE_BYTES:
                    return
                with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=self.path.parent, delete=False) as output:
                    temporary = Path(output.name)
                    output.write(body)
                os.replace(temporary, self.path)
            except OSError:
                pass
            finally:
                if temporary is not None:
                    try:
                        temporary.unlink(missing_ok=True)
                    except OSError:
                        pass
        return save
