Source: https://github.com/fanyuantaier/wechatauto-replica/blob/62503d76a0db069171cb4e42e87090ad285db489/wechatauto/db.py

Apache-2.0. This derivative retains only directory discovery and read-only Windows key/page primitives. Removed account auto-selection, full history export, media/image access, persistent key caches, decrypted databases, logging, UI control, listeners, and networking. The caller bounds scanning and verifies exact account/contact identity.

Local changes: cross-process key discovery and persistent key caches are removed.
The login-config parser
uses bounded 8 MB reads, a deadline, a 512 MB module limit, bounded remote strings,
and a read-only mapped DLL search. It also returns an in-memory active root pointer
and encrypted-key fingerprint so callers can reject same-process account changes.
The root pointer is re-followed before each partial result; old cfg objects are
never accepted merely because their memory has not yet been cleared.

For newer WCDB versions, a scoped Config.Cipher fallback makes at most two
read-only memory passes over that same proven login PID. The caller limits reads
to 8 MB chunks, a shared 70 second deadline, and 8 GB per pass. Only keys that
authenticate required contact/message/media database headers in the uniquely
matched current account directory are returned. Keys remain in memory; no key
cache, decrypted database, or process memory dump is written. Candidate identity
includes explicit salt, and each candidate is checked against all required
database headers to support shared raw keys correctly.

Image format reference:
https://github.com/fanyuantaier/wechatauto-replica/blob/d322c4a9b1124228820bab363e5676016f188fc6/wechatauto/media.py

Apache-2.0. local_image_codec.py uses the documented Windows V2 container layout
and cfg-dword derivation. It does not include the upstream media downloader,
key acquisition, key persistence or UI automation. The existing authorized
database reader already returns this cfg value; an account-scoped context now
retains it only in derived form for selected-message image decoding and clears
its references when that database session closes. All segment bounds, PKCS7,
image structure and raster decoding are checked before a preview is returned.
