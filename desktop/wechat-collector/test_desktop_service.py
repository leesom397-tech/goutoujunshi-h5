"""Synthetic stdio + real loopback transport; no WeChat, browser or accounts."""
import errno
import http.client
import io
import json
import queue
import socket
import sys
import threading
import unittest
from unittest.mock import Mock, patch
from urllib.parse import parse_qs, urlsplit

import desktop_service
from bridge import CollectorState, server_for
from pairing import CONNECTION_PAGE, WEB_ORIGIN


class InputPipe:
    def __init__(self):
        self.lines = queue.Queue()

    def readline(self, _limit):
        return self.lines.get(timeout=5)

    def send(self, command, request_id=1):
        self.lines.put(json.dumps({"id": request_id, "command": command}) + "\n")


class OutputPipe:
    def __init__(self):
        self.lines = queue.Queue()

    def write(self, line):
        self.lines.put(json.loads(line))

    def flush(self):
        pass

    def receive(self):
        return self.lines.get(timeout=5)


class DesktopServiceTest(unittest.TestCase):
    def setUp(self):
        self.capture = Mock(side_effect=AssertionError("Never collect on startup/IPC"))
        self.health = Mock(side_effect=AssertionError("Never inspect accounts on IPC"))
        self.state = CollectorState(health_provider=self.health, capture_target=self.capture)
        self.authorization_cleanup = patch("platform_runtime.clear_worker_authorization")
        self.clear_authorization = self.authorization_cleanup.start()
        self.addCleanup(self.authorization_cleanup.stop)

    def start_service(self):
        incoming, outgoing = InputPipe(), OutputPipe()
        result = []
        thread = threading.Thread(target=lambda: result.append(desktop_service.run_service(
            incoming, outgoing, port=0, state_factory=lambda: self.state)), daemon=True)
        def finish():
            incoming.lines.put("")
            thread.join(timeout=5)
            self.assertFalse(thread.is_alive(), "service did not stop")
        self.addCleanup(finish)
        thread.start()
        ready = outgoing.receive()
        self.assertEqual(ready["event"], "ready")
        return incoming, outgoing, thread, result, ready["port"]

    def test_loopback_startup_never_waits_for_reverse_dns(self):
        with patch("socket.getfqdn", side_effect=AssertionError("No DNS needed for loopback")) as lookup:
            incoming, outgoing, thread, result, _port = self.start_service()
            incoming.send("status", "check")
            self.assertTrue(outgoing.receive()["ok"])
            incoming.send("shutdown", "done")
            self.assertTrue(outgoing.receive()["ok"])
            thread.join(timeout=3)
            self.assertEqual(result, [0])
            lookup.assert_not_called()

    def http(self, port, method, path, body=None, headers=None):
        conn = http.client.HTTPConnection("127.0.0.1", port, timeout=3)
        try:
            conn.request(method, path, body=json.dumps(body) if body is not None else None,
                         headers={"Origin": WEB_ORIGIN, "Content-Type": "application/json", **(headers or {})})
            response = conn.getresponse()
            return response.status, json.loads(response.read())
        finally:
            conn.close()

    def test_real_pairing_and_shutdown_never_capture_or_probe(self):
        incoming, outgoing, thread, result, port = self.start_service()
        incoming.send("connect", "open")
        response = outgoing.receive()
        self.assertEqual(response["id"], "open")
        self.assertTrue(response["handoffUrl"].startswith(CONNECTION_PAGE + "#connect="))
        handoff = parse_qs(urlsplit(response["handoffUrl"]).fragment)["connect"][0]
        code, session = self.http(port, "POST", "/pair/handoff", {"handoff": handoff})
        self.assertEqual(code, 200)
        self.assertIn("token", session)
        incoming.send("status", "status")
        status = outgoing.receive()
        self.assertTrue(status["connected"])
        self.assertFalse(status["busy"])
        self.assertFalse(status["setupAvailable"])
        self.assertNotIn(session["token"], json.dumps(status))
        self.assertNotIn(handoff, json.dumps(status))
        incoming.send("shutdown", "close")
        self.assertEqual(outgoing.receive(), {"id": "close", "ok": True})
        thread.join(timeout=3)
        self.assertEqual(result, [0])
        self.assertEqual(self.state.token, "")
        self.assertEqual(self.state.handoff_digest, b"")
        self.assertEqual(self.state.jobs, {})
        self.assertTrue(self.state.closing)
        self.clear_authorization.assert_called_once()
        self.capture.assert_not_called()
        self.health.assert_not_called()
        with self.assertRaises(OSError):
            socket.create_connection(("127.0.0.1", port), timeout=.2)

    def test_eof_clears_ticket_and_stops_server(self):
        incoming, outgoing, thread, result, _port = self.start_service()
        incoming.send("connect")
        self.assertTrue(outgoing.receive()["ok"])
        self.assertTrue(self.state.handoff_digest)
        incoming.lines.put("")
        thread.join(timeout=3)
        self.assertEqual(result, [0])
        self.assertEqual(self.state.handoff_digest, b"")
        self.clear_authorization.assert_called_once()

    def test_unknown_and_malformed_commands_cannot_become_capture_requests(self):
        incoming, outgoing, _thread, _result, _port = self.start_service()
        for line in ('{"id":1,"command":"capture"}\n',
                     '{"id":1,"command":"connect","url":"https://evil.invalid"}\n',
                     '{"id":true,"command":"status"}\n',
                     '{"command":"status"}\n', '[1,2]\n', 'private-synthetic-text\n'):
            incoming.lines.put(line)
            response = outgoing.receive()
            self.assertFalse(response["ok"])
            self.assertNotIn("private-synthetic-text", json.dumps(response))
        self.capture.assert_not_called()
        self.health.assert_not_called()

    def test_occupied_port_reports_error_without_stopping_owner(self):
        with socket.socket() as owner:
            owner.bind(("127.0.0.1", 0))
            owner.listen()
            port = owner.getsockname()[1]
            output = io.StringIO()
            code = desktop_service.run_service(io.StringIO(""), output, port=port,
                                               state_factory=lambda: self.state)
            self.assertEqual(code, 2)
            self.assertEqual(json.loads(output.getvalue())["error"]["code"], "PORT_IN_USE")
            with socket.create_connection(("127.0.0.1", port), timeout=1):
                pass
        self.clear_authorization.assert_called_once()

    @unittest.skipUnless(sys.platform == "win32", "Windows permits SO_REUSEADDR listener sharing")
    def test_old_reusable_listener_cannot_be_shared_by_new_service(self):
        # Reproduce an already-running older HTTPServer helper, whose inherited
        # SO_REUSEADDR would otherwise let another Windows listener bind too.
        with socket.socket() as owner:
            owner.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            owner.bind(("127.0.0.1", 0))
            owner.listen()
            port = owner.getsockname()[1]
            output = io.StringIO()
            code = desktop_service.run_service(io.StringIO(""), output, port=port,
                                               state_factory=lambda: self.state)
            self.assertEqual(code, 2)
            events = [json.loads(line) for line in output.getvalue().splitlines()]
            self.assertEqual(len(events), 1)
            self.assertEqual(events[0]["event"], "error")
            self.assertEqual(events[0]["error"]["code"], "PORT_IN_USE")
            self.assertFalse(any(event["event"] == "ready" for event in events))
            with socket.create_connection(("127.0.0.1", port), timeout=1):
                connection, _address = owner.accept()
                connection.close()
        self.capture.assert_not_called()
        self.health.assert_not_called()

    @unittest.skipUnless(sys.platform == "win32", "Windows exclusive binding socket option")
    def test_new_bridge_exclusively_owns_loopback_port(self):
        server = server_for(self.state, port=0)
        self.addCleanup(server.server_close)
        self.assertEqual(server.socket.getsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE), 1)
        self.assertEqual(server.socket.getsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR), 0)
        self.assertFalse(server.allow_reuse_address)
        self.assertFalse(server.allow_reuse_port)
        with socket.socket() as contender:
            contender.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            with self.assertRaises(OSError):
                contender.bind(server.server_address)
                contender.listen()
        with socket.create_connection(server.server_address, timeout=1):
            connection, _address = server.socket.accept()
            connection.close()

    def test_other_bind_errors_are_not_misreported_as_occupied(self):
        output = io.StringIO()
        with patch("desktop_service.server_for", side_effect=OSError(errno.EACCES, "sensitive path")):
            result = desktop_service.run_service(io.StringIO(""), output, state_factory=lambda: self.state)
        self.assertEqual(result, 2)
        self.assertEqual(json.loads(output.getvalue())["error"]["code"], "SERVICE_START_FAILED")
        self.assertNotIn("sensitive", output.getvalue())

    def test_setup_is_explicitly_unavailable_without_starting_gui_or_granting_access(self):
        incoming, outgoing, _thread, _result, _port = self.start_service()
        incoming.send("setup")
        self.assertEqual(outgoing.receive()["error"]["code"], "SETUP_UNAVAILABLE")
        self.capture.assert_not_called()
        self.health.assert_not_called()

    def test_exception_is_sanitized_and_cleanup_always_runs(self):
        self.state.create_handoff = Mock(side_effect=RuntimeError("private synthetic secret"))
        output = io.StringIO()
        code = desktop_service.run_service(io.StringIO('{"id":1,"command":"connect"}\n'), output,
                                           port=0, state_factory=lambda: self.state)
        self.assertEqual(code, 1)
        self.assertNotIn("private synthetic secret", output.getvalue())
        self.assertTrue(self.state.closing)
        self.clear_authorization.assert_called_once()

    def test_oversized_command_closes_cleanly(self):
        output = io.StringIO()
        result = desktop_service.run_service(io.StringIO("x" * (desktop_service.MAX_LINE + 2)),
                                             output, port=0, state_factory=lambda: self.state)
        self.assertEqual(result, 2)
        self.assertEqual(json.loads(output.getvalue().splitlines()[-1])["error"]["code"], "INVALID_REQUEST")
        self.assertTrue(self.state.closing)


if __name__ == "__main__":
    unittest.main()
