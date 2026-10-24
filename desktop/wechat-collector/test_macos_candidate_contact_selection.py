"""Generated contact metadata only; no real contacts, messages, account or keys."""
import json
import sqlite3
import unittest
from unittest.mock import Mock

from macos_candidate_database_probe import Rejected
from macos_candidate_source import selected_request
import macos_candidate_contact_selection as contacts


SECRET_ID="SYNTHETIC_SECRET_ID"
DISPLAY="Synthetic private display"


class Source:
    account_id=self_username="synthetic-owner"
    def __init__(self,rows):
        self.db=sqlite3.connect(":memory:")
        self.db.execute("CREATE TABLE contact(username TEXT COLLATE NOCASE,nick_name TEXT,remark TEXT,alias TEXT COLLATE NOCASE)")
        self.db.executemany("INSERT INTO contact VALUES(?,?,?,?)",[(self.account_id,"Owner","","owner-alias"),*rows])
        self.checks=0;self.closed=False
    def contacts(self):return self.db
    def assert_unchanged(self):self.checks+=1
    def close(self):self.closed=True;self.db.close()


class ContactSelectionTests(unittest.TestCase):
    def source(self,rows):
        source=Source(rows)
        self.addCleanup(lambda:None if source.closed else source.close())
        return source

    def test_legacy_username_with_empty_alias_resolves_without_changing_alias_contract(self):
        source=self.source([(SECRET_ID,DISPLAY,"","")])
        result=contacts.diagnose_selector_from_source(source,SECRET_ID,display=DISPLAY)
        self.assertEqual(result["exactAliasRows"],0)
        self.assertEqual(result["exactUsernameRows"],1)
        self.assertEqual(result["displayCandidateRows"],1)
        self.assertTrue(result["displayCandidates"][0]["aliasEmpty"])
        self.assertEqual(result["displayCandidates"][0]["aliasBytes"],0)
        self.assertTrue(result["displayCandidates"][0]["usernameEqualsExpected"])
        with self.assertRaisesRegex(Rejected,"selected-contact-unverified"):
            selected_request(source,SECRET_ID,by_alias=True)
        request=selected_request(source,SECRET_ID,by_visible_identifier=True)
        self.assertEqual(request["contactId"],SECRET_ID)
        self.assertFalse(result["selectedContactVerified"])
        for private in (SECRET_ID,DISPLAY,source.account_id):self.assertNotIn(private,json.dumps(result))

    def test_alias_and_same_row_username_match_is_one_identity(self):
        source=self.source([(SECRET_ID,DISPLAY,"",SECRET_ID)])
        self.assertEqual(contacts.resolve_visible_identifier(source,SECRET_ID)[0],SECRET_ID)
        result=contacts.diagnose_selector_from_source(source,SECRET_ID)
        self.assertEqual((result["exactAliasRows"],result["exactUsernameRows"],result["visibleIdentifierMatchRows"]),(1,1,1))

    def test_alias_to_username_collision_across_two_people_rejects(self):
        source=self.source([("other-internal",DISPLAY,"",SECRET_ID),(SECRET_ID,"Other","","")])
        with self.assertRaisesRegex(Rejected,"selected-visible-identifier-collision"):
            contacts.resolve_visible_identifier(source,SECRET_ID)

    def test_nickname_exact_only_is_diagnostic_never_selection(self):
        source=self.source([("other-internal",SECRET_ID,"","")])
        result=contacts.diagnose_selector_from_source(source,SECRET_ID,display=SECRET_ID)
        self.assertEqual(result["displayNickExactRows"],1)
        self.assertEqual(result["visibleIdentifierMatchRows"],0)
        with self.assertRaisesRegex(Rejected,"selected-visible-identifier-unverified"):
            contacts.resolve_visible_identifier(source,SECRET_ID)

    def test_case_variants_count_but_nocase_schema_never_auto_selects(self):
        source=self.source([("target-internal",DISPLAY,"",SECRET_ID.lower())])
        result=contacts.diagnose_selector_from_source(source,SECRET_ID,display=DISPLAY)
        self.assertEqual(result["aliasCaseVariantRows"],1)
        self.assertEqual(result["exactAliasRows"],0)
        self.assertTrue(result["displayCandidates"][0]["aliasCaseVariantOnly"])
        with self.assertRaises(Rejected):contacts.resolve_visible_identifier(source,SECRET_ID)

    def test_exact_utf8_blob_alias_is_byte_exact_and_storage_diagnosed(self):
        source=self.source([("target-internal",DISPLAY,"",SECRET_ID.encode())])
        result=contacts.diagnose_selector_from_source(source,SECRET_ID,display=DISPLAY)
        self.assertEqual((result["exactAliasTextRows"],result["exactAliasBlobRows"]),(0,1))
        self.assertEqual(result["displayCandidates"][0]["aliasStorage"],"blob")
        self.assertTrue(result["displayCandidates"][0]["aliasEqualsExpected"])
        self.assertEqual(contacts.resolve_visible_identifier(source,SECRET_ID)[0],"target-internal")

    def test_display_candidate_metadata_is_bounded_and_never_queries_chat(self):
        source=self.source([(f"synthetic-{i}",DISPLAY,"","a"*(i+1)) for i in range(25)])
        queries=[];source.db.set_trace_callback(queries.append)
        result=contacts.diagnose_selector_from_source(source,SECRET_ID,display=DISPLAY)
        self.assertEqual(result["displayCandidateRows"],25)
        self.assertEqual(len(result["displayCandidates"]),20)
        self.assertTrue(result["displayCandidatesTruncated"])
        self.assertFalse(any("Msg_" in query or "message_content" in query for query in queries))

    def test_same_session_wrapper_closes_source_before_final_guard_and_private_id_not_repr(self):
        source=self.source([(SECRET_ID,DISPLAY,"","")])
        session=Mock();session.open_source.return_value=source
        session.verify_scope.side_effect=lambda:self.assertTrue(source.closed)
        diagnostics=[];stages=[]
        selected=contacts.diagnose_and_select(session,SECRET_ID,display=DISPLAY,
                                              on_diagnostics=diagnostics.append,on_stage=stages.append)
        self.assertEqual(selected.contact_id,SECRET_ID)
        self.assertNotIn(SECRET_ID,repr(selected))
        self.assertNotIn(SECRET_ID,json.dumps(selected.public()))
        self.assertEqual(len(stages),4)
        self.assertTrue(all(set(stage)=={"stage","elapsedSeconds","stageSeconds"} for stage in stages))

    def test_changed_scope_cannot_return_selection_and_collision_still_closes(self):
        source=self.source([("other",DISPLAY,"",SECRET_ID),(SECRET_ID,"Other","","")])
        session=Mock();session.open_source.return_value=source
        with self.assertRaises(Rejected):contacts.diagnose_and_select(session,SECRET_ID)
        self.assertTrue(source.closed)
        source=self.source([(SECRET_ID,DISPLAY,"","")]);session.open_source.return_value=source
        session.verify_scope.side_effect=Rejected("active-account-changed")
        with self.assertRaisesRegex(Rejected,"active-account-changed"):
            contacts.diagnose_and_select(session,SECRET_ID)
        self.assertTrue(source.closed)


if __name__=="__main__":unittest.main()
