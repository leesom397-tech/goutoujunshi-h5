"""Six-stage orchestration with synthetic records and injected guarded sources."""
import io
import json
from types import SimpleNamespace
import unittest
from unittest.mock import Mock,patch

from macos_candidate_contact_selection import PrivateContactSelection
from macos_candidate_database_probe import Rejected
import macos_candidate_selected_pipeline as pipeline
import test_macos_sns_inspection as sns_fixtures


class PipelineTests(unittest.TestCase):
    def select(self,*args,on_diagnostics=None,on_stage=None,**kwargs):
        on_diagnostics({"exactAliasRows":0,"exactUsernameRows":1,"contentIncluded":False})
        return PrivateContactSelection("synthetic-owner","synthetic-target")

    def test_history_failure_does_not_swallow_valid_sns_and_no_refs_honestly_skip_voice(self):
        session=Mock()
        collector=Mock();collector.references=()
        voice=SimpleNamespace(VoiceReferenceCollector=Mock(return_value=collector),probe_selected_voice=Mock())
        with patch.object(pipeline,"diagnose_and_select",side_effect=self.select), \
                patch.object(pipeline,"capture_selected_history",side_effect=RuntimeError("PRIVATE_CHAT_BODY")), \
                patch.object(pipeline,"inspect_selected_sns",return_value={"selectedRecords":3,"contentIncluded":False}) as sns, \
                patch.object(pipeline,"_moments",return_value={"recordCount":3,"contentIncluded":False}) as moments:
            result=pipeline.run_selected_pipeline(session,"synthetic-visible-id",voice_module=voice,voice_options={})
        self.assertEqual(set(result["stages"]),set(pipeline.STAGES))
        self.assertEqual(result["stages"]["history"]["status"],"failed")
        self.assertEqual(result["stages"]["snsInspection"]["status"],"completed")
        self.assertEqual(result["stages"]["voice"]["reason"],"no-eligible-voice-reference")
        self.assertEqual(sns.call_args.args[1],"synthetic-target")
        self.assertFalse(sns.call_args.kwargs["by_alias"])
        moments.assert_called_once();voice.probe_selected_voice.assert_not_called()
        self.assertNotIn("PRIVATE_CHAT_BODY",json.dumps(result))
        self.assertNotIn("synthetic-target",json.dumps(result))

    def test_scope_failure_stops_following_data_stages(self):
        session=Mock();calls=[0]
        def scope():
            calls[0]+=1
            if calls[0]>=2:raise Rejected("active-account-changed")
        session.verify_scope.side_effect=scope
        with patch.object(pipeline,"diagnose_and_select",side_effect=self.select), \
                patch.object(pipeline,"capture_selected_history",side_effect=RuntimeError("failed")), \
                patch.object(pipeline,"inspect_selected_sns") as sns,patch.object(pipeline,"_moments") as moments:
            result=pipeline.run_selected_pipeline(session,"synthetic-visible-id")
        self.assertFalse(result["scopeValid"])
        self.assertEqual(result["stages"]["snsInspection"]["reason"],"source-scope-unavailable")
        sns.assert_not_called();moments.assert_not_called()

    def test_collision_prevents_all_history_sns_and_voice_reads(self):
        session=Mock()
        with patch.object(pipeline,"diagnose_and_select",side_effect=Rejected("selected-visible-identifier-collision")), \
                patch.object(pipeline,"capture_selected_history") as history, \
                patch.object(pipeline,"inspect_selected_sns") as sns,patch.object(pipeline,"_moments") as moments:
            result=pipeline.run_selected_pipeline(session,"synthetic-visible-id")
        self.assertEqual(result["stages"]["contactSelection"]["reason"],"selected-visible-identifier-collision")
        self.assertTrue(all(result["stages"][stage]["status"]=="skipped" for stage in pipeline.STAGES[2:]))
        history.assert_not_called();sns.assert_not_called();moments.assert_not_called()

    def test_production_moments_reader_only_returns_counts_and_coverage(self):
        source=sns_fixtures.Source()
        source.add(content=sns_fixtures.xml())
        session=Mock();session.open_source.return_value=source
        result=pipeline._moments(session,sns_fixtures.TARGET)
        self.assertTrue(source.closed)
        self.assertEqual(result["recordCount"],1)
        self.assertEqual(result["stablePostIdCount"],1)
        self.assertEqual(result["cachedMediaCount"],1)
        self.assertEqual(result["imageReadCount"],0)
        self.assertFalse(result["coverage"]["complete"])
        public=json.dumps(result)
        for private in (sns_fixtures.OWNER,sns_fixtures.TARGET,sns_fixtures.CAPTION,sns_fixtures.URL,sns_fixtures.TOKEN):
            self.assertNotIn(private,public)
        source.connection.close()

    def test_stdin_configuration_never_echoes_unknown_private_fields(self):
        with patch.object(pipeline.sys,"stdin",io.StringIO(json.dumps({"visibleId":"PRIVATE_SELECTOR","receipt":"/PRIVATE/PATH","unknown":"PRIVATE"}))) :
            with self.assertRaisesRegex(Rejected,"pipeline-config-rejected"):
                pipeline.main()


if __name__=="__main__":unittest.main()
