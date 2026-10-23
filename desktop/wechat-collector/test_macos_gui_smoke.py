"""Loopback smoke uses real bridge requests with synthetic credentials only."""
import threading
import unittest

from bridge import CollectorState, server_for
from macos_gui_smoke import _check_local_pairing, _session_request


class FrozenGuiPairingTest(unittest.TestCase):
    def setUp(self):
        def forbidden(*args, **kwargs):
            raise AssertionError("GUI pairing must not access WeChat")
        self.state = CollectorState(health_provider=forbidden, capture_target=forbidden)
        self.state.code = "00000000"
        self.server = server_for(self.state, port=0)
        self.worker = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.worker.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.worker.join(2)

    def test_pairing_and_rotation_use_real_http_without_capture(self):
        token = _check_local_pairing(self.server.server_port, self.state.code)
        self.assertEqual(self.state.jobs, {})
        self.assertIsNone(self.state.active)
        self.state.rotate()
        self.assertEqual(_session_request(self.server.server_port, "GET", "/session", token=token)[0], 401)
        self.assertFalse(self.state.token)

    def test_wrong_code_does_not_start_or_authorize_capture(self):
        status, result = _session_request(self.server.server_port, "POST", "/pair", body={"code": "00000001"})
        self.assertEqual(status, 401)
        self.assertFalse(self.state.token)
        self.assertEqual(self.state.jobs, {})
        self.assertEqual(_session_request(self.server.server_port, "GET", "/session")[0], 401)


if __name__ == "__main__":
    unittest.main()
