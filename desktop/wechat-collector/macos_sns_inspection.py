"""Selected-author SNS inspection through a caller-owned authenticated source.

No native/UI actions, network requests, media decoding or files are used here.
Private IDs/captions/URLs/tokens can reach only explicit local callbacks. The return
value contains fixed schema names and aggregate counts, never database values.
An exhausted cache is always incomplete as an album.
"""
from __future__ import annotations

from dataclasses import dataclass
import re
import time
from urllib.parse import urlsplit
from xml.etree import ElementTree

from background_reader import BackgroundCaptureError
from macos_moments import MAX_XML_BYTES, parse_moment_xml

MAX_ROWS = 100_000
MAX_RECORDS = 1000
MAX_TOTAL_XML_BYTES = 32 * 1024 * 1024
MAX_SECONDS = 20
KNOWN_COLUMNS = frozenset(("tid", "content", "user_name", "is_top", "create_time", "type"))
KNOWN_MEDIA_CHILDREN = frozenset(("id", "type", "title", "description", "url", "thumb", "size", "enc"))
KNOWN_REFERENCE_ATTRIBUTES = frozenset(("key", "token", "md5", "type", "videomd5", "enc_idx", "fileformat"))


class SnsInspectionError(RuntimeError):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def _fail(code):
    raise SnsInspectionError(code) from None


def _text(element, path):
    node = element.find(path)
    return "" if node is None or node.text is None else node.text.strip()


def _bounded(value, maximum=16384):
    if not isinstance(value, str) or len(value) > maximum or any(ord(char) < 32 for char in value):
        _fail("sns-reference-format-rejected")
    return value


def _known_cdn(url):
    try:
        parsed = urlsplit(url)
        host = (parsed.hostname or "").lower()
        return (parsed.scheme in ("http", "https") and parsed.username is None and parsed.password is None
                and parsed.port in (None, 80, 443)
                and any(host == suffix or host.endswith("." + suffix)
                        for suffix in ("qpic.cn", "video.qq.com", "tc.qq.com")))
    except ValueError:
        return False


@dataclass(frozen=True, repr=False)
class SnsMediaReference:
    """Raw selected-post metadata; extraction does not authorize URL fetching."""
    media_index: int
    media_id: str
    media_type: str
    field: str
    url: str
    url_key: str
    enc_key: str
    token: str
    md5: str


@dataclass(frozen=True, repr=False)
class SelectedSnsRecord:
    account_id: str
    contact_id: str
    source_id: str
    source_id_origin: str
    author: str
    at: str
    text: str
    pinned: bool
    declared_media_count: int
    references: tuple[SnsMediaReference, ...]


def _selected_record(account_id, target, tid, content):
    metadata = parse_moment_xml(content)
    if metadata["author"] != target:
        return None, None
    raw = content.encode("utf-8") if isinstance(content, str) else content
    source_id = metadata["source_id"]
    origin = "xml-id"
    if not source_id:
        source_id = str(tid) if type(tid) in (str, int) else ""
        origin = "database-tid"
    if not re.fullmatch(r"-?[0-9]{1,20}", source_id):
        _fail("sns-source-id-unavailable")
    root = ElementTree.fromstring(raw)
    timeline = root.find("TimelineObject") if root.tag == "SnsDataItem" else root
    object_node = timeline.find("ContentObject")
    references, child_names, attribute_names = [], set(), set()
    unknown_children = unknown_attributes = 0
    # Do not interpret Finder/notes as ordinary photo media. Their source count
    # is preserved by parse_moment_xml, but this first inspection reports their
    # unhandled reference count rather than inventing a download mapping.
    media_nodes = [] if object_node is None else object_node.findall("mediaList/media")
    for index, media in enumerate(media_nodes):
        for child in media:
            if child.tag in KNOWN_MEDIA_CHILDREN:
                child_names.add(child.tag)
            else:
                unknown_children += 1
        media_id = _bounded(_text(media, "id"), 500)
        media_type = _bounded(_text(media, "type"), 100)
        enc = media.find("enc")
        enc_key = _bounded(enc.get("key", ""), 256) if enc is not None else ""
        for field in ("url", "thumb"):
            node = media.find(field)
            if node is None:
                continue
            for name in node.attrib:
                if name in KNOWN_REFERENCE_ATTRIBUTES:
                    attribute_names.add(name)
                else:
                    unknown_attributes += 1
            url = _bounded((node.text or "").strip())
            if not url:
                continue
            references.append(SnsMediaReference(index, media_id, media_type, field, url,
                _bounded(node.get("key", ""), 256), enc_key,
                _bounded(node.get("token", ""), 8192), _bounded(node.get("md5", ""), 256)))
    record = SelectedSnsRecord(account_id, target, source_id, origin, metadata["author"], metadata["at"],
        metadata["text"], metadata["pinned"], metadata["media_count"], tuple(references))
    shape = {"mediaChildren": child_names, "referenceAttributes": attribute_names,
             "unknownMediaChildCount": unknown_children, "unknownReferenceAttributeCount": unknown_attributes,
             "ordinaryMediaCount": len(media_nodes)}
    return record, shape


def inspect_selected_sns_from_source(source, selector, *, by_alias=False, on_record=None, on_schema=None,
                                     maximum_records=MAX_RECORDS, clock=time.monotonic):
    """Borrow one verified source; all returned/private material is selected-only.

    on_record(SelectedSnsRecord) receives an immutable, memory-only record after
    live source validation. on_schema(tuple[str, ...]) may inspect raw schema
    names locally. Neither callback's values are serialized or retained here.
    The wrapper below owns source.close(); direct callers retain ownership.
    """
    from macos_candidate_source import selected_request
    if (type(maximum_records) is not int or not 1 <= maximum_records <= MAX_RECORDS
            or type(by_alias) is not bool or on_record is not None and not callable(on_record)
            or on_schema is not None and not callable(on_schema)):
        _fail("sns-inspection-request-rejected")
    deadline = clock() + MAX_SECONDS
    source.assert_unchanged()
    selected = selected_request(source, selector, by_alias=by_alias)
    target, account = selected["contactId"], source.account_id
    aggregate = {"status": "selected-sns-cache-missing", "selectedContactVerified": True,
        "knownColumns": [], "unknownColumnCount": 0, "schemaSupported": False,
        "scannedRows": 0, "selectedRecords": 0, "distinctSourceIds": 0, "duplicateSourceIdRows": 0,
        "xmlIdRecords": 0, "databaseTidRecords": 0, "xmlAuthorMismatchRows": 0,
        "unparsedRows": 0, "sourceIdUnavailableRows": 0, "timestampRecords": 0,
        "captionRecords": 0, "pinnedRecords": 0, "declaredMediaCount": 0,
        "ordinaryMediaCount": 0, "unhandledMediaCount": 0, "mediaReferenceCount": 0,
        "knownCdnReferenceCount": 0, "referencesWithKey": 0, "referencesWithEncKey": 0,
        "referencesWithToken": 0, "referencesWithMd5": 0, "knownMediaChildren": [],
        "knownReferenceAttributes": [], "unknownMediaChildCount": 0, "unknownReferenceAttributeCount": 0,
        "scanLimited": False, "stopReason": "cache-missing", "scope": "local-cache",
        "complete": False, "contentIncluded": False, "mediaRead": False,
        "captureCompatibilityValidated": False}
    if source.database_exists("sns/sns.db"):
        connection = source.open_database("sns/sns.db")
        columns = tuple(str(row[1]) for row in connection.execute('PRAGMA table_info("SnsTimeLine")'))
        aggregate.update(knownColumns=sorted(set(columns) & KNOWN_COLUMNS),
                         unknownColumnCount=len(set(columns) - KNOWN_COLUMNS),
                         status="selected-sns-schema-unavailable", stopReason="schema-unavailable")
        source.assert_unchanged()
        if on_schema is not None:
            on_schema(columns)
            source.assert_unchanged()
        if {"tid", "content", "user_name"} <= set(columns):
            aggregate.update(schemaSupported=True, status="selected-sns-inspected", stopReason="cache-scan-ended")
            cursor = connection.execute('SELECT "tid",CASE WHEN length(CAST("content" AS BLOB)) <= ? '
                'THEN "content" ELSE NULL END FROM "SnsTimeLine" '
                'WHERE "user_name" COLLATE BINARY IN (?,?) LIMIT ?',
                (MAX_XML_BYTES, target, target.encode("utf-8"), MAX_ROWS + 1))
            seen, total_bytes, children, attributes = set(), 0, set(), set()
            for tid, content in cursor:
                if aggregate["scannedRows"] >= MAX_ROWS or clock() >= deadline:
                    aggregate.update(scanLimited=True, stopReason="inspection-limit")
                    break
                aggregate["scannedRows"] += 1
                if aggregate["scannedRows"] % 50 == 0:
                    source.assert_unchanged()
                size = len(content.encode("utf-8")) if isinstance(content, str) else len(content) if isinstance(content, bytes) else 0
                if total_bytes + size > MAX_TOTAL_XML_BYTES:
                    aggregate.update(scanLimited=True, stopReason="xml-byte-limit")
                    break
                total_bytes += size
                try:
                    record, shape = _selected_record(account, target, tid, content)
                except ValueError:
                    aggregate["unparsedRows"] += 1
                    continue
                except SnsInspectionError as error:
                    aggregate["sourceIdUnavailableRows" if error.code == "sns-source-id-unavailable" else "unparsedRows"] += 1
                    continue
                if record is None:
                    aggregate["xmlAuthorMismatchRows"] += 1
                    continue
                if record.source_id in seen:
                    aggregate["duplicateSourceIdRows"] += 1
                    continue
                seen.add(record.source_id)
                aggregate["selectedRecords"] += 1
                aggregate["xmlIdRecords" if record.source_id_origin == "xml-id" else "databaseTidRecords"] += 1
                aggregate["timestampRecords"] += bool(record.at)
                aggregate["captionRecords"] += bool(record.text)
                aggregate["pinnedRecords"] += record.pinned
                aggregate["declaredMediaCount"] += record.declared_media_count
                aggregate["ordinaryMediaCount"] += shape["ordinaryMediaCount"]
                aggregate["unhandledMediaCount"] += max(0, record.declared_media_count - shape["ordinaryMediaCount"])
                aggregate["mediaReferenceCount"] += len(record.references)
                aggregate["knownCdnReferenceCount"] += sum(_known_cdn(ref.url) for ref in record.references)
                aggregate["referencesWithKey"] += sum(bool(ref.url_key and ref.url_key != "0") for ref in record.references)
                aggregate["referencesWithEncKey"] += sum(bool(ref.enc_key and ref.enc_key != "0") for ref in record.references)
                aggregate["referencesWithToken"] += sum(bool(ref.token) for ref in record.references)
                aggregate["referencesWithMd5"] += sum(bool(re.fullmatch(r"[a-fA-F0-9]{32}", ref.md5)) for ref in record.references)
                aggregate["unknownMediaChildCount"] += shape["unknownMediaChildCount"]
                aggregate["unknownReferenceAttributeCount"] += shape["unknownReferenceAttributeCount"]
                children.update(shape["mediaChildren"])
                attributes.update(shape["referenceAttributes"])
                if on_record is not None:
                    source.assert_unchanged()
                    on_record(record)
                    source.assert_unchanged()
                if len(seen) >= maximum_records:
                    aggregate.update(scanLimited=True, stopReason="record-limit")
                    break
            aggregate.update(distinctSourceIds=len(seen), knownMediaChildren=sorted(children),
                             knownReferenceAttributes=sorted(attributes))
    source.assert_unchanged()
    current = selected_request(source, selector, by_alias=by_alias)
    if current["contactId"] != target or source.account_id != account:
        _fail("sns-selected-contact-changed")
    source.assert_unchanged()
    return aggregate


def inspect_selected_sns(session, selector, **options):
    """Own a fresh source within its still-live CandidateSession lease."""
    source = session.open_source()
    try:
        result = inspect_selected_sns_from_source(source, selector, **options)
    finally:
        source.close()
    session.verify_scope()
    return result
