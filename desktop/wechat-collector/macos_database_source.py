"""Mac selected-account reader using the existing authenticated in-memory VFS.

No plaintext database files, background key extraction or account guessing.
The source is usable only after the local helper's explicit initialization.
"""
from pathlib import Path
import re
import threading

from background_reader import BackgroundCaptureError
from local_database_source import EncryptedSnapshot, LocalDatabaseSource, open_encrypted_connection
import sqlcipher_primitives as primitive
import macos_key_provider as authorization


def _fail(code, message):
    return BackgroundCaptureError(code, message)


def probe_authorized_source():
    return authorization.probe_setup()


def _self_username(account, contact_key):
    """Use only the current process's account path, confirmed in its own DB."""
    name = Path(account).name
    candidates = {name}
    if "_" in name:
        candidates.add(name.rsplit("_", 1)[0])
    candidates = sorted(value for value in candidates if re.fullmatch(r"[A-Za-z0-9_.@-]{1,128}", value))
    if not candidates:
        raise _fail("ACCOUNT_IDENTITY_UNVERIFIED", "当前 Mac 微信账号无法核对。")
    snapshot = EncryptedSnapshot(Path(account) / "db_storage/contact/contact.db", contact_key, primitives=primitive)
    conn = vfs = None
    try:
        conn, vfs = open_encrypted_connection(snapshot)
        placeholders = ",".join("?" for _ in candidates)
        rows = list(conn.execute(f"SELECT username FROM contact WHERE username IN ({placeholders}) LIMIT 3", candidates))
        snapshot.assert_unchanged()
        if len(rows) != 1 or not rows[0][0]:
            raise _fail("ACCOUNT_IDENTITY_UNVERIFIED", "当前 Mac 微信账号无法唯一核对，未读取聊天。")
        return str(rows[0][0])
    finally:
        if conn is not None:
            conn.close()
        if vfs is not None:
            vfs.unregister()
        snapshot.close()


class MacOSDatabaseSource(LocalDatabaseSource):
    def __init__(self, account, contact_key, master, proof, username):
        self.mac_proof = dict(proof)
        super().__init__(account, contact_key, {"username": username}, master)

    def _key_for(self, relative):
        if relative in self.keys:
            return self.keys[relative]
        with self._path(relative).open("rb") as handle:
            page1 = handle.read(4096)
        key = primitive.effective_page_key(self.master, page1)
        if key is None:
            raise _fail("DATABASE_KEY_UNAVAILABLE", "这部分 Mac 微信资料尚无法读取，请完成同步后重试。")
        self.keys[relative] = key
        return key

    def _open(self, relative):
        if relative not in self.connections:
            snapshot = EncryptedSnapshot(self._path(relative), self._key_for(relative), primitives=primitive)
            try:
                connection, vfs = open_encrypted_connection(snapshot)
            except BaseException:
                snapshot.close()
                raise
            self.snapshots[relative], self.connections[relative], self.vfs[relative] = snapshot, connection, vfs
            # A prior contact-only check cannot seal a database opened later.
            self.sealed = False
        return self.connections[relative]

    def open_database(self, relative):
        if not re.fullmatch(r"(?:contact/contact|message/(?:message|media)_\d+|sns/sns)\.db", relative):
            raise _fail("SOURCE_INVALID", "不支持的本机资料类型。")
        authorization.verify_account_proof(self.mac_proof)
        return self._open(relative)

    def database_exists(self, relative):
        if relative != "sns/sns.db":
            return False
        try:
            self._path(relative)
            return True
        except BackgroundCaptureError:
            return False

    def moments_shards(self):
        if self.database_exists("sns/sns.db"):
            yield "sns/sns.db", self.open_database("sns/sns.db")

    def assert_unchanged(self):
        authorization.verify_account_proof(self.mac_proof)
        if not self.sealed:
            for snapshot in self.snapshots.values():
                snapshot.assert_unchanged()
            self.sealed = True
        else:
            # Moments performs identity checks before/during its scan. Unlike
            # chat's post-read seal before slow ASR, those checks do not mean all
            # SNS rows have been copied. Revalidate SNS through publication.
            for relative, snapshot in self.snapshots.items():
                if relative == "sns/sns.db":
                    snapshot.assert_unchanged()
        with self._path("contact/contact.db").open("rb") as handle:
            page1 = handle.read(4096)
        if not primitive._verify_enc_key(self.keys["contact/contact.db"], page1):
            raise _fail("ACCOUNT_CHANGED", "Mac 微信账号已变化，本次读取已停止。")

    def close(self):
        super().close()
        self.mac_proof = {}


def open_authorized_source(*, contacts_only=False):
    proof = authorization.current_account_proof()
    master = authorization.get_authorized_key(proof["account"])
    _, page1 = authorization._read_contact_header(proof["account"])
    contact_key = primitive.effective_page_key(master, page1)
    if contact_key is None:
        raise _fail("MAC_AUTHORIZATION_REQUIRED", "Mac 微信读取授权已失效，请在助手窗口重新授权。")
    username = _self_username(proof["account"], contact_key)
    authorization.verify_account_proof(proof)
    source = MacOSDatabaseSource(proof["account"], contact_key, master, proof, username)
    try:
        source.assert_unchanged()
        source.sealed = False
        return source
    except BaseException:
        source.close()
        raise


class ContactSourceCache:
    """Keep only the query lock. Every contact request rechecks the live account."""
    def __init__(self):
        self.lock = threading.RLock()

    def clear(self):
        pass

    def run(self, read, *, refresh=False):
        with self.lock:
            source = open_authorized_source(contacts_only=True)
            try:
                result = read(source)
                source.assert_unchanged()
                return result
            finally:
                source.close()
