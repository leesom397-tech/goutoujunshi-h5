"""Synthetic selected-author SNS fixtures; no real databases or UI are opened."""
from dataclasses import FrozenInstanceError
import json
import sqlite3
import unittest
from unittest.mock import Mock, patch
from xml.sax.saxutils import escape

from macos_candidate_database_probe import Rejected
import macos_sns_inspection as sns


OWNER, TARGET, ALIAS = "synthetic-owner", "synthetic-target", "synthetic-alias"
CAPTION, TOKEN, KEY = "PRIVATE selected caption", "PRIVATE_TOKEN", "123456789"
URL = "https://mmsns.qpic.cn/PRIVATE_PATH/0"


def xml(*, author=TARGET, source_id="101", content=CAPTION, media=True, extra=""):
    item = (f'<ContentObject><mediaList><media><id>PRIVATE_MEDIA_ID</id><type>2</type>'
        f'<url key="{KEY}" token="{TOKEN}" md5="' + "a" * 32 + f'">{URL}</url>'
        '<thumb key="0">https://mmsns.qpic.cn/PRIVATE_THUMB/150</thumb>'
        '<enc key="987654321"/><PRIVATE_ATTRIBUTE_TAG>PRIVATE_VALUE</PRIVATE_ATTRIBUTE_TAG>'
        '</media></mediaList></ContentObject>') if media else ""
    return (f'<SnsDataItem><TimelineObject><id>{source_id}</id><username>{escape(author)}</username>'
        f'<createTime>1790343042</createTime><contentDesc>{escape(content)}</contentDesc><isTop>1</isTop>'
        f'{item}{extra}</TimelineObject><LocalExtraInfo><comment_user_list>PRIVATE_COMMENTER</comment_user_list>'
        '</LocalExtraInfo></SnsDataItem>')


class Source:
    account_id = self_username = OWNER

    def __init__(self, *, schema=True, author_index=True):
        self.connection = sqlite3.connect(":memory:")
        self.connection.execute("CREATE TABLE contact(username TEXT,nick_name TEXT,remark TEXT,alias TEXT)")
        self.connection.executemany("INSERT INTO contact VALUES(?,?,?,?)", [
            (OWNER, "Owner", "", "owner-alias"), (TARGET, "Same display", "", ALIAS),
            ("unselected", "Same display", "", "unselected-alias")])
        if schema:
            self.connection.execute("CREATE TABLE SnsTimeLine(tid INTEGER,content TEXT" +
                (",user_name TEXT)" if author_index else ")"))
        self.exists = True
        self.closed = False
        self.checks = 0
        self.callback = None

    def add(self, tid=101, author=TARGET, content=None):
        self.connection.execute("INSERT INTO SnsTimeLine VALUES(?,?,?)", (tid, xml() if content is None else content, author))

    def contacts(self):
        return self.connection

    def assert_unchanged(self):
        self.checks += 1
        if self.callback:
            self.callback()

    def database_exists(self, path):
        assert path == "sns/sns.db"
        return self.exists

    def open_database(self, path):
        assert path == "sns/sns.db"
        return self.connection

    def close(self):
        self.closed = True


def inspect(source, **kwargs):
    return sns.inspect_selected_sns_from_source(source, ALIAS, by_alias=True, **kwargs)


class SelectedSnsTests(unittest.TestCase):
    def test_private_callback_gets_exact_author_id_reference_fields_public_has_only_aggregates(self):
        source = Source()
        source.add()
        private = []
        result = inspect(source, on_record=private.append)
        self.assertEqual(result["selectedRecords"], 1)
        self.assertEqual(result["xmlIdRecords"], 1)
        self.assertEqual(result["mediaReferenceCount"], 2)
        self.assertEqual(result["knownCdnReferenceCount"], 2)
        self.assertEqual(result["referencesWithKey"], 1)
        self.assertEqual(result["referencesWithEncKey"], 2)
        self.assertEqual(result["referencesWithToken"], 1)
        self.assertEqual(result["referencesWithMd5"], 1)
        self.assertFalse(result["complete"] or result["contentIncluded"] or result["mediaRead"])
        record = private[0]
        self.assertEqual((record.account_id, record.author, record.contact_id, record.source_id), (OWNER, TARGET, TARGET, "101"))
        self.assertEqual(record.text, CAPTION)
        reference = record.references[0]
        self.assertEqual((reference.url, reference.url_key, reference.token), (URL, KEY, TOKEN))
        self.assertNotIn("PRIVATE_COMMENTER", repr(record))
        self.assertFalse(hasattr(record, "raw_xml"))
        output = json.dumps(result, ensure_ascii=True)
        for value in (OWNER, TARGET, ALIAS, CAPTION, URL, TOKEN, KEY, "PRIVATE_ATTRIBUTE_TAG", "PRIVATE_VALUE", "PRIVATE_COMMENTER"):
            self.assertNotIn(value, output)
            self.assertNotIn(value, repr(record))
            self.assertNotIn(value, repr(reference))
        self.assertEqual(result["unknownMediaChildCount"], 1)

    def test_author_index_is_binary_and_xml_author_is_independently_verified(self):
        source = Source()
        source.add()
        source.add(102, "unselected", xml(author="unselected", source_id="102", content="PRIVATE_UNSELECTED"))
        source.add(103, TARGET, xml(author="unselected", source_id="103", content="PRIVATE_WRONG_XML"))
        source.add(104, TARGET.upper(), xml(author=TARGET.upper(), source_id="104", content="PRIVATE_CASE"))
        source.add(105, TARGET.encode(), xml(source_id="105"))
        private = []
        with patch.object(sns, "parse_moment_xml", wraps=sns.parse_moment_xml) as parse:
            result = inspect(source, on_record=private.append)
        self.assertEqual(result["scannedRows"], 3)
        self.assertEqual(result["selectedRecords"], 2)
        self.assertEqual(result["xmlAuthorMismatchRows"], 1)
        self.assertEqual(parse.call_count, 3)
        self.assertEqual([record.source_id for record in private], ["101", "105"])
        self.assertFalse(any("PRIVATE_UNSELECTED" in record.text or "PRIVATE_WRONG_XML" in record.text for record in private))

    def test_missing_author_column_returns_schema_only_without_reading_xml(self):
        source = Source(author_index=False)
        source.connection.execute("INSERT INTO SnsTimeLine VALUES(?,?)", (101, xml(author="unselected")))
        with patch.object(sns, "parse_moment_xml") as parse:
            result = inspect(source)
        self.assertEqual(result["status"], "selected-sns-schema-unavailable")
        self.assertFalse(result["schemaSupported"])
        self.assertEqual(result["scannedRows"], 0)
        parse.assert_not_called()

    def test_unknown_schema_names_are_only_given_to_explicit_local_callback(self):
        source = Source()
        source.connection.execute('ALTER TABLE SnsTimeLine ADD COLUMN "PRIVATE_COLUMN" TEXT')
        private = []
        result = inspect(source, on_schema=private.append)
        self.assertIn("PRIVATE_COLUMN", private[0])
        self.assertEqual(result["unknownColumnCount"], 1)
        self.assertNotIn("PRIVATE_COLUMN", json.dumps(result))

    def test_missing_database_or_table_does_not_claim_an_empty_or_complete_album(self):
        for source in (Source(), Source(schema=False)):
            if source.connection.execute("PRAGMA table_info(SnsTimeLine)").fetchall():
                source.exists = False
            result = inspect(source)
            self.assertFalse(result["complete"] or result["schemaSupported"])
            self.assertEqual(result["selectedRecords"], 0)

    def test_duplicate_source_ids_are_counted_distinct_identical_captions_are_preserved(self):
        source = Source()
        source.add()
        source.add(101)
        source.add(102, content=xml(source_id="102"))
        private = []
        result = inspect(source, on_record=private.append)
        self.assertEqual(result["duplicateSourceIdRows"], 1)
        self.assertEqual(result["distinctSourceIds"], 2)
        self.assertEqual(len(private), 2)

    def test_numeric_database_tid_is_a_source_id_fallback_never_caption_hash(self):
        source = Source()
        source.add(-109, content=xml(source_id=""))
        private = []
        result = inspect(source, on_record=private.append)
        self.assertEqual(private[0].source_id, "-109")
        self.assertEqual(private[0].source_id_origin, "database-tid")
        self.assertEqual(result["databaseTidRecords"], 1)
        self.assertNotIn("-109", json.dumps(result))

    def test_invalid_or_oversized_xml_is_counted_without_callback(self):
        source = Source()
        for index, content in enumerate(("<broken", "<!DOCTYPE x><TimelineObject/>", b"bad", None)):
            source.add(index, content=content if content is not None else "<bad/>")
        callback = Mock()
        result = inspect(source, on_record=callback)
        self.assertEqual(result["unparsedRows"], 4)
        callback.assert_not_called()
        source = Source()
        source.add(content=xml(content="x" * 2000))
        with patch.object(sns, "MAX_XML_BYTES", 200):
            self.assertEqual(inspect(source)["unparsedRows"], 1)

    def test_media_free_and_finder_media_are_not_invented_as_downloadable_photos(self):
        source = Source()
        source.add(content=xml(media=False, extra="<ContentObject><finderFeed><mediaList><media/></mediaList></finderFeed></ContentObject>"))
        private = []
        result = inspect(source, on_record=private.append)
        self.assertEqual(result["declaredMediaCount"], 1)
        self.assertEqual(result["unhandledMediaCount"], 1)
        self.assertEqual(private[0].references, ())
        self.assertFalse(result["mediaRead"])

    def test_non_cdn_reference_is_retained_locally_without_network_or_unsupported_host_claim(self):
        source = Source()
        source.add(content=xml().replace(URL, "https://mmsns.qpic.cn.attacker.invalid/PRIVATE_PATH"))
        result = inspect(source)
        self.assertEqual(result["mediaReferenceCount"], 2)
        self.assertEqual(result["knownCdnReferenceCount"], 1)

    def test_callback_receives_immutable_fields_and_cannot_change_coverage(self):
        source = Source()
        source.add()
        def change(record):
            with self.assertRaises(FrozenInstanceError):
                record.source_id = "another"
            with self.assertRaises(FrozenInstanceError):
                record.references[0].url = "another"
        result = inspect(source, on_record=change)
        self.assertEqual(result["selectedRecords"], 1)
        self.assertFalse(result["complete"])

    def test_scope_checked_before_callback_and_after_callback(self):
        source = Source()
        source.add()
        def receive(record):
            def changed():
                raise Rejected("active-account-changed")
            source.callback = changed
        with self.assertRaisesRegex(Rejected, "active-account-changed"):
            inspect(source, on_record=receive)

    def test_alias_reassigned_by_callback_cannot_return_result(self):
        source = Source()
        source.add()
        def receive(record):
            source.connection.execute("PRAGMA query_only=OFF")
            source.connection.execute("UPDATE contact SET alias='old' WHERE username=?", (TARGET,))
            source.connection.execute("UPDATE contact SET alias=? WHERE username='unselected'", (ALIAS,))
        with self.assertRaisesRegex(sns.SnsInspectionError, "sns-selected-contact-changed"):
            inspect(source, on_record=receive)

    def test_record_byte_row_and_local_time_limits_remain_partial(self):
        for option in ("records", "bytes", "rows", "time"):
            source = Source()
            source.add()
            source.add(102, content=xml(source_id="102"))
            if option == "records":
                result = inspect(source, maximum_records=1)
            elif option == "bytes":
                with patch.object(sns, "MAX_TOTAL_XML_BYTES", 1):
                    result = inspect(source)
            elif option == "rows":
                with patch.object(sns, "MAX_ROWS", 1):
                    result = inspect(source)
            else:
                clock = Mock(side_effect=[0, 30])
                result = inspect(source, clock=clock)
            self.assertTrue(result["scanLimited"])
            self.assertFalse(result["complete"])

    def test_wrapper_closes_lease_before_final_session_guard_even_when_callback_fails(self):
        source = Source()
        source.add()
        session = Mock()
        session.open_source.return_value = source
        session.verify_scope.side_effect = lambda: self.assertTrue(source.closed)
        result = sns.inspect_selected_sns(session, ALIAS, by_alias=True)
        self.assertEqual(result["selectedRecords"], 1)
        self.assertTrue(source.closed)
        source = Source()
        source.add()
        session.open_source.return_value = source
        with self.assertRaisesRegex(RuntimeError, "callback-failed"):
            sns.inspect_selected_sns(session, ALIAS, by_alias=True, on_record=Mock(side_effect=RuntimeError("callback-failed")))
        self.assertTrue(source.closed)


if __name__ == "__main__":
    unittest.main()
