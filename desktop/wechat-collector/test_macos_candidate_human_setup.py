"""Synthetic long-wait bounds and progress; never launches a real application."""
from collections import Counter
from contextlib import ExitStack
import json
import os
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

import macos_candidate_source as candidate
import macos_candidate_device_runtime as device
import test_macos_candidate_source as fixtures


class HumanSetupTests(unittest.TestCase):
    def test_default_stays_120_and_600_requires_explicit_human_mode(self):
        self.assertEqual(candidate.CandidateSession(Path("receipt")).authentication_seconds, 120)
        for human, auth, total, accepted in ((False,600,600,False),(True,600,600,True),
                                            (True,601,600,False),(True,600,601,False),
                                            (True,600,300,False),("yes",600,600,False)):
            with self.subTest(human=human,auth=auth,total=total), ExitStack() as stack:
                _, key, _, _, _, _ = fixtures.SessionLifecycleTests.setup_mock(self, stack)
                session = candidate.CandidateSession(Path("receipt"), human_setup=human,
                    authentication_seconds=auth, seconds=total)
                if accepted:
                    with session:
                        pass
                    key.launch_debug_copy_watchdog.assert_called_once()
                else:
                    with self.assertRaisesRegex(candidate.probe.Rejected, "source-duration-rejected"):
                        session.__enter__()
                    key.launch_debug_copy_watchdog.assert_not_called()

    def waiting(self, on_change, now):
        session = candidate.CandidateSession(Path("receipt"), human_setup=True, seconds=600,
            authentication_seconds=600, progress=on_change)
        session._setup._clock=lambda:now[0]
        session.shadow = Path("synthetic-candidate").absolute()
        session.debug,session.key,session.watcher,session.channel = Mock(),Mock(),Mock(),Mock()
        session.watcher.poll.return_value = None
        session.debug._exact_process_pids.return_value = [100]
        session.key.process_identity.return_value = (os.fsencode(session.executable.resolve()),1,2)
        session.reader = candidate.probe.CandidateReader()
        session.reader.counts = Counter(constructor=1,load=1,resolve_ok=1)
        session.deadline = 600
        session._setup_attempt = session._setup.begin()["attempt"]
        session._report_progress(launchRequested=True)
        return session

    def test_wait_hint_arrives_early_and_continue_polling_never_renew_deadline(self):
        now,events,continued = [0],[],[]
        session = None
        def changed(view):
            events.append(view)
            if session is not None and view["phase"] == "waiting-for-user" and not continued:
                continued.append(session._setup.continue_setup(view["attempt"]))
        with patch.object(candidate.time,"monotonic",side_effect=lambda:now[0]):
            session = self.waiting(changed,now)
            def sleep(_):
                now[0] += 5
                if now[0] >= 15:
                    raise KeyboardInterrupt()
            with patch.object(session.reader,"drain"), \
                    patch.object(candidate.probe,"process_account",side_effect=candidate.probe.Rejected("active-account-not-ready")), \
                    patch.object(candidate.time,"sleep",side_effect=sleep), \
                    patch.object(candidate.primitive,"effective_page_key") as crypto:
                with self.assertRaises(KeyboardInterrupt):
                    session._authenticate()
                crypto.assert_not_called()
        self.assertTrue(any(view["phase"]=="waiting-for-user" for view in events))
        self.assertEqual(session.deadline,600)
        self.assertEqual(session.authentication_seconds,600)
        self.assertEqual(continued[0]["action"],"recheck-current-attempt")
        self.assertFalse(continued[0]["renews_deadline"])
        public=json.dumps(events)
        for private in (str(session.executable),"active-account-not-ready","permission-denied","TCC"):
            self.assertNotIn(private,public)
        self.assertTrue(all(not view["authorization_granted"] for view in events))

    def test_human_wait_generation_recheck_rejects_before_user_hint(self):
        events=[]
        with patch.object(candidate.time,"monotonic",return_value=0):
            session=self.waiting(events.append,[0])
            first=(os.fsencode(session.executable.resolve()),1,2)
            session.key.process_identity.side_effect=[first,(first[0],3,4)]
            with patch.object(session.reader,"drain"), \
                    patch.object(candidate.probe,"process_account",side_effect=candidate.probe.Rejected("active-account-not-ready")):
                with self.assertRaisesRegex(candidate.probe.Rejected,"candidate-generation-changed"):
                    session._authenticate()
        self.assertFalse(any(view["phase"]=="waiting-for-user" for view in events))
        self.assertFalse(session.master or session.contact_key)

    def test_absolute_deadline_stops_repeated_not_ready_and_does_not_return_authentication(self):
        now=[0]
        with patch.object(candidate.time,"monotonic",side_effect=lambda:now[0]):
            session=self.waiting(lambda _:None,now)
            def sleep(_):now[0]+=200
            with patch.object(session.reader,"drain"), \
                    patch.object(candidate.probe,"process_account",side_effect=candidate.probe.Rejected("active-account-not-ready")), \
                    patch.object(candidate.time,"sleep",side_effect=sleep):
                with self.assertRaisesRegex(candidate.probe.Rejected,"candidate-source-authentication-timeout"):
                    session._authenticate()
        self.assertEqual(now[0],600)
        self.assertEqual(session.deadline,600)
        self.assertFalse(session.status["candidateAuthenticated"])

    def test_authenticated_phase_follows_final_scope_check(self):
        events=[]
        with patch.object(candidate.time,"monotonic",return_value=0):
            session=self.waiting(events.append,[0])
            identity=session.key.process_identity.return_value
            session.reader.feed(b"WXK1"+b"s"*32)
            session.reader.counts.update(call=1,match=1,write_ok=1)
            proof=(100,identity,Path("/synthetic-private-account"))
            def scope():
                self.assertFalse(session._setup._authenticated)
            with patch.object(session.reader,"drain"), \
                    patch.object(candidate.probe,"process_account",return_value=proof), \
                    patch.object(candidate.probe,"contact_header",return_value=(Path("/synthetic-private-account/contact.db"),b"header")), \
                    patch.object(candidate.primitive,"effective_page_key",return_value=b"k"*32), \
                    patch.object(session,"verify_scope",side_effect=scope):
                session._authenticate()
        self.assertTrue(session._setup._authenticated)
        session._report_progress(selectedReadStarted=True)
        self.assertEqual(session.status["setup"]["phase"],"reading-selected")
        self.assertNotIn("synthetic-private-account",json.dumps(events))
        session.reader.close()
        candidate._wipe(session.master);candidate._wipe(session.contact_key)

    def test_long_wait_failure_keeps_full_cleanup_restore_and_pending_continuation(self):
        events=[]
        with ExitStack() as stack:
            _,key,channel,_,original,_=fixtures.SessionLifecycleTests.setup_mock(self,stack)
            def timeout(owner):raise candidate.probe.Rejected("candidate-source-authentication-timeout")
            stack.enter_context(patch.object(candidate.CandidateSession,"_authenticate",timeout))
            session=candidate.CandidateSession(Path("receipt"),human_setup=True,authentication_seconds=600,
                                               seconds=600,progress=events.append)
            with self.assertRaisesRegex(candidate.probe.Rejected,"candidate-source-authentication-timeout"):
                session.__enter__()
        key.cleanup_debug_copy_bundle.assert_called_once()
        channel.close.assert_called_once()
        original.assert_called_once()
        self.assertTrue(session.status["runtimeCleanupComplete"] and session.status["originalRestored"])
        self.assertEqual(session.status["setup"]["phase"],"waiting-for-user")
        self.assertEqual(session.status["setup"]["continue_action"],"start-fresh-attempt")
        self.assertTrue(any(view["phase"]=="cleanup" for view in events))

    def test_progress_callback_failure_cannot_skip_timeout_cleanup(self):
        with ExitStack() as stack:
            _,_,_,_,original,_=fixtures.SessionLifecycleTests.setup_mock(self,stack,fail_auth=True)
            session=candidate.CandidateSession(Path("receipt"),human_setup=True,seconds=600,
                progress=Mock(side_effect=RuntimeError("private UI exception")))
            with self.assertRaises(candidate.probe.Rejected):session.__enter__()
        original.assert_called_once()
        self.assertTrue(session.status["ownedCandidateBuffersCleared"])
        self.assertNotIn("private UI exception",json.dumps(session.status))

    def test_cancel_before_launch_never_starts_candidate(self):
        with ExitStack() as stack:
            _,key,_,_,original,_=fixtures.SessionLifecycleTests.setup_mock(self,stack)
            session=candidate.CandidateSession(Path("receipt"),cancel=lambda:True)
            with self.assertRaisesRegex(candidate.probe.Rejected,"source-cancelled"):session.__enter__()
        key.launch_debug_copy_watchdog.assert_not_called()
        original.assert_not_called()
        self.assertTrue(session.status["ownedCandidateBuffersCleared"])

    def test_cancel_poll_ends_account_wait_without_reading_key(self):
        cancelled=[False]
        with patch.object(candidate.time,"monotonic",return_value=0):
            session=self.waiting(lambda _:None,[0]);session._cancel=lambda:cancelled[0]
            with patch.object(session.reader,"drain"), \
                    patch.object(candidate.probe,"process_account",side_effect=candidate.probe.Rejected("active-account-not-ready")), \
                    patch.object(candidate.time,"sleep",side_effect=lambda _:cancelled.__setitem__(0,True)), \
                    patch.object(candidate.primitive,"effective_page_key") as crypto:
                with self.assertRaisesRegex(candidate.probe.Rejected,"source-cancelled"):session._authenticate()
                crypto.assert_not_called()
        self.assertFalse(session.status["candidateAuthenticated"])

    def test_cancel_during_key_derivation_cannot_publish_authenticated(self):
        cancelled=[False]
        with patch.object(candidate.time,"monotonic",return_value=0):
            session=self.waiting(lambda _:None,[0]);session._cancel=lambda:cancelled[0]
            session.reader.feed(b"WXK1"+b"s"*32)
            proof=(100,session.key.process_identity.return_value,Path("/synthetic-private-account"))
            def derive(*_):cancelled[0]=True;return b"k"*32
            with patch.object(session.reader,"drain"), \
                    patch.object(candidate.probe,"process_account",return_value=proof), \
                    patch.object(candidate.probe,"contact_header",return_value=(Path("/synthetic/contact.db"),b"header")), \
                    patch.object(candidate.primitive,"effective_page_key",side_effect=derive), \
                    patch.object(session,"verify_scope") as verify:
                with self.assertRaisesRegex(candidate.probe.Rejected,"source-cancelled"):session._authenticate()
                verify.assert_not_called()
        self.assertFalse(session.status["candidateAuthenticated"])
        self.assertFalse(session.master or session.contact_key)
        session.reader.close()

    def test_cancel_after_launch_cleanup_remains_on_session_owner(self):
        cancelled=[False]
        with ExitStack() as stack:
            _,key,channel,_,original,_=fixtures.SessionLifecycleTests.setup_mock(self,stack)
            def authenticate(owner):cancelled[0]=True;owner._check_cancel()
            stack.enter_context(patch.object(candidate.CandidateSession,"_authenticate",authenticate))
            session=candidate.CandidateSession(Path("receipt"),cancel=lambda:cancelled[0])
            with self.assertRaisesRegex(candidate.probe.Rejected,"source-cancelled"):session.__enter__()
            session.close()
        key.cleanup_debug_copy_bundle.assert_called_once();channel.close.assert_called_once();original.assert_called_once()
        self.assertTrue(session.status["runtimeCleanupComplete"] and session.status["originalRestored"])
        self.assertTrue(session.status["ownedCandidateBuffersCleared"])


if __name__=="__main__":unittest.main()
