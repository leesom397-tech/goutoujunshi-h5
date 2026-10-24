"""Synthetic selected voice SQL/IPC/inference only; never opens actual WeChat."""
from dataclasses import replace
import json
from pathlib import Path
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import macos_candidate_voice_probe as probe
import macos_candidate_voice_worker as worker
from test_background_reader import Source
from test_local_voice_transcriber import framed_voice


def record(message="101", *, duration=5, role="other", **changes):
    source = {"method": "wechat-local-db", "mediaKind": "voice", "senderVerified": True,
        "accountId": "test-account", "sessionId": "target-user", "messageShard": "message_0.db",
        "messageId": message, "localId": "1", "durationSeconds": duration, **changes}
    return {"senderRole": role, "source": source}


def reference():
    return probe.VoiceReference("test-account", "target-user", "message_0.db", "101", "1", 5.)


def measurement(index=0):
    return {"index": index, "decoded": True, "inferred": True, "sampleCount": 80000,
        "decodedSeconds": 5., "framedSeconds": 5., "textLength": 12, "inferenceMs": 20, "elapsedMs": 25, "reason": ""}


def packet(nonce="a" * 64):
    return {"protocol": worker.PROTOCOL, "nonce": nonce, "status": "voice-inference-probed", "modelVerified": True,
        "items": [measurement()], "contentIncluded": False, "audioSaved": False, "transcriptSaved": False, "networkUsed": False}


class CollectorTests(unittest.TestCase):
    def test_keeps_only_two_private_incoming_verified_refs_without_text(self):
        collector = probe.VoiceReferenceCollector()
        collector({"records": [record("101"), record("102"), record("103")]})
        self.assertEqual([ref.message_id for ref in collector.references], ["103", "102"])
        self.assertNotIn("target-user", repr(collector.references))

    def test_unknown_duration_allowed_only_for_later_actual_silk_duration_check(self):
        collector = probe.VoiceReferenceCollector()
        collector({"records": [record(duration=None)]})
        self.assertIsNone(collector.references[0].duration)

    def test_wrong_speaker_unknown_sender_nonvoice_invalid_ids_and_overlong_skipped(self):
        collector = probe.VoiceReferenceCollector()
        collector({"records": [record(role="self"), record(senderVerified=False), record(mediaKind="image"),
            record(duration=61), record(messageShard="../../private.db"), record(message="private-text")]})
        self.assertEqual(collector.references, ())


class ProbeTests(unittest.TestCase):
    def source(self, *, blob=None, duration=5000, sender=2):
        source = Source()
        shard = source.shard("message_0.db")
        source.add(shard, 1, 101, mtype=34, sender=sender, text=f'<msg><voicemsg voicelength="{duration}"/></msg>')
        if blob is not None:
            source.add_audio(101, blob)
        return source

    def session(self, source):
        session = Mock()
        session.deadline = time.monotonic() + 100
        final_source = Source()
        session.open_source.side_effect = [source, final_source]
        return session

    def run_probe(self, source, **options):
        session = self.session(source)
        result = probe.probe_selected_voice(session, "target-user", references=[reference()],
            voice_python="unused", model_root="unused", **options)
        return session, result

    def test_actual_production_message_and_audio_queries_keep_blob_in_memory_and_close_before_asr(self):
        blob = framed_voice()
        source = self.source(blob=blob)
        def measured(blobs, **kwargs):
            self.assertTrue(source.closed)
            self.assertEqual(blobs, [blob])
            self.assertTrue(callable(kwargs["verify_scope"]))
            return packet()
        session, result = self.run_probe(source, worker=measured)
        self.assertEqual(result["voiceReadCount"], 1)
        self.assertEqual(result["audioBytes"], len(blob))
        self.assertEqual((result["decodedCount"], result["inferenceCount"], result["transcriptCharacters"]), (1, 1, 12))
        self.assertGreaterEqual(session.verify_scope.call_count, 2)
        output = json.dumps(result)
        for private in ("target-user", "test-account", "message_0.db", "synthetic-silk"):
            self.assertNotIn(private, output)
        self.assertFalse(result["contentIncluded"] or result["audioSaved"] or result["transcriptSaved"] or result["networkUsed"])

    def test_sql_caps_blob_before_copy_and_oversized_audio_never_starts_worker(self):
        source = self.source(blob=b"x" * (probe.MAX_AUDIO_BYTES + 1))
        measured = Mock()
        _, result = self.run_probe(source, worker=measured)
        measured.assert_not_called()
        self.assertEqual(result["oversizedAudioCount"], 1)
        self.assertEqual(result["audioBytes"], 0)
        self.assertTrue(source.closed)

    def test_other_contact_media_with_same_server_id_cannot_be_read(self):
        source = self.source()
        source.add_audio(101, framed_voice(), session="other-user")
        measured = Mock()
        _, result = self.run_probe(source, worker=measured)
        self.assertEqual(result["missingAudioCount"], 1)
        measured.assert_not_called()

    def test_media_session_equality_does_not_inherit_nocase_collation(self):
        source = self.source()
        source.add_audio(101, framed_voice(), session="TARGET-USER")
        connection = source.media[0][1]
        connection.execute("ALTER TABLE Name2Id RENAME TO OldName2Id")
        connection.execute("CREATE TABLE Name2Id(user_name TEXT COLLATE NOCASE)")
        connection.execute("INSERT INTO Name2Id(rowid,user_name) VALUES(17,'TARGET-USER')")
        measured = Mock()
        _, result = self.run_probe(source, worker=measured)
        self.assertEqual(result["missingAudioCount"], 1)
        measured.assert_not_called()

    def test_wrong_selected_reference_or_changed_fresh_message_sender_never_runs_audio(self):
        source = self.source(blob=framed_voice(), sender=7)
        with self.assertRaisesRegex(probe.VoiceProbeError, "voice-message-unverified"):
            self.run_probe(source, worker=Mock())
        self.assertTrue(source.closed)
        source = self.source(blob=framed_voice())
        with self.assertRaisesRegex(probe.VoiceProbeError, "voice-selected-contact-changed"):
            probe.probe_selected_voice(self.session(source), "target-user", references=[replace(reference(), contact_id="another")],
                voice_python="unused", model_root="unused", worker=Mock())
        self.assertTrue(source.closed)

    def test_duration_over_60s_is_rejected_before_media_read(self):
        source = self.source(blob=framed_voice(), duration=61000)
        with self.assertRaisesRegex(probe.VoiceProbeError, "voice-message-unverified"):
            self.run_probe(source, worker=Mock())
        self.assertTrue(source.closed)

    def test_scope_changed_after_inference_prevents_result_return(self):
        source = self.source(blob=framed_voice())
        session = self.session(source)
        session.verify_scope.side_effect = [None, RuntimeError("scope-revoked")]
        with self.assertRaisesRegex(RuntimeError, "scope-revoked"):
            probe.probe_selected_voice(session, "target-user", references=[reference()], voice_python="unused",
                model_root="unused", worker=Mock(return_value=packet()))

    def test_unexpected_query_shape_cannot_copy_unbounded_voice_blob(self):
        with self.assertRaisesRegex(probe.VoiceProbeError, "voice-query-shape-rejected"):
            probe._AudioConnection(Mock()).execute("SELECT voice_data FROM VoiceInfo", ())

    def test_private_result_rejects_body_fields_wrong_nonce_and_forged_counts(self):
        good = packet()
        self.assertEqual(probe._worker_result(good, nonce="a" * 64, count=1), good)
        for changed in ({**good, "transcript": "PRIVATE_TEXT"}, {**good, "nonce": "b" * 64},
                        {**good, "items": [{**measurement(), "textLength": 9000}]},
                        {**good, "items": [{**measurement(), "decodedSeconds": 61}]},
                        {**good, "items": [{**measurement(), "inferred": True, "decoded": False}]}):
            with self.subTest(keys=list(changed)), self.assertRaises(probe.VoiceProbeError):
                probe._worker_result(changed, nonce="a" * 64, count=1)


class Samples(list):
    def fill(self, value):
        self[:] = [value] * len(self)


class WorkerTests(unittest.TestCase):
    def voice(self, samples):
        return SimpleNamespace(MODEL_ID="synthetic-model", SAMPLE_RATE=10,
            _verify_files=Mock(return_value=True), _validate_silk=Mock(return_value=5.), _decode_silk=Mock(return_value=samples),
            prepare_model=Mock(side_effect=AssertionError("download")), _write_cache=Mock(side_effect=AssertionError("write")))

    def recognizer(self, *, text="<|en|>PRIVATE_TRANSCRIPT"):
        return SimpleNamespace(create_stream=Mock(return_value=SimpleNamespace(accept_waveform=Mock(), result=SimpleNamespace(text=text))),
            decode_stream=Mock())

    def test_decoder_model_and_inference_are_actual_calls_but_only_lengths_escape_and_pcm_zeroed(self):
        samples = Samples([1] * 50)
        voice = self.voice(samples)
        recognizer = self.recognizer()
        factory = Mock(return_value=recognizer)
        with tempfile.TemporaryDirectory() as path:
            result = worker.infer_audio([framed_voice()], Path(path).resolve(), voice, factory=factory, deadline=time.monotonic() + 5)
        self.assertEqual(result["items"][0]["textLength"], len("PRIVATE_TRANSCRIPT"))
        self.assertTrue(result["items"][0]["decoded"] and result["items"][0]["inferred"])
        self.assertEqual(set(samples), {0})
        self.assertNotIn("PRIVATE_TRANSCRIPT", json.dumps(result))
        voice._decode_silk.assert_called_once()
        recognizer.decode_stream.assert_called_once()
        self.assertEqual(factory.call_args.kwargs["provider"], "cpu")
        self.assertFalse(factory.call_args.kwargs["debug"])
        voice.prepare_model.assert_not_called()
        voice._write_cache.assert_not_called()

    def test_model_missing_or_corrupt_never_downloads_or_decodes(self):
        voice = self.voice(Samples([1] * 50))
        voice._verify_files.return_value = False
        with tempfile.TemporaryDirectory() as path, self.assertRaisesRegex(worker.VoiceWorkerError, "model-integrity-failed"):
            worker.infer_audio([framed_voice()], Path(path).resolve(), voice, factory=Mock(), deadline=time.monotonic() + 5)
        voice._decode_silk.assert_not_called()
        voice.prepare_model.assert_not_called()

    def test_actual_silk_duration_over_60s_never_decodes_or_infers(self):
        voice = self.voice(Samples([1] * 50))
        voice._validate_silk.return_value = 61
        factory = Mock()
        with tempfile.TemporaryDirectory() as path:
            result = worker.infer_audio([framed_voice()], Path(path).resolve(), voice, factory=factory, deadline=time.monotonic() + 5)
        self.assertEqual(result["items"][0]["reason"], "voice-duration-bound")
        self.assertFalse(result["items"][0]["inferred"])
        voice._decode_silk.assert_not_called()
        factory.assert_not_called()

    def test_source_hash_is_pinned_and_transcriber_module_never_downloaded(self):
        source = Path(__file__).with_name("local_voice_transcriber.py")
        module = worker.load_transcriber(source.resolve())
        self.assertEqual(module.SAMPLE_RATE, 16000)
        with tempfile.TemporaryDirectory() as path:
            other = Path(path) / "transcriber.py"
            other.write_text("PRIVATE source", encoding="utf-8")
            with self.assertRaisesRegex(worker.VoiceWorkerError, "transcriber-source-rejected"):
                worker.load_transcriber(other.resolve())

    def test_cancelled_or_expired_call_never_spawns_child(self):
        with self.assertRaisesRegex(probe.VoiceProbeError, "voice-probe-cancelled"):
            probe.probe_selected_voice(Mock(), "target-user", references=[reference()], voice_python="unused",
                model_root="unused", cancelled=lambda: True)


if __name__ == "__main__":
    unittest.main()
