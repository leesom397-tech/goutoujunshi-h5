"""Generated images and fake sessions only; no real WeChat data or memory."""
import base64
import hashlib
import io
import json
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import Mock, patch

from cryptography.hazmat.primitives import padding
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from PIL import Image

from background_reader import _build_batch, _validate_request, capture_from_source, BackgroundCaptureError
from local_chat_images import LocalChatImages, _preview
from local_database_source import LocalDatabaseSource, open_authorized_source
from local_image_codec import ImageKeyContext, V1_MAGIC, V2_MAGIC, decode_versioned_dat, ImageDecodeError


def raster(fmt="PNG"):
    result = io.BytesIO()
    Image.new("RGB", (64, 48), "#428768").save(result, format=fmt)
    return result.getvalue()


def encrypted_image(plain, magic=V2_MAGIC, key=b"0123456789abcdef", xor_key=0xA3,
                    aes_size=32, xor_size=20, bad_padding=False):
    head = plain[:aes_size]
    padder = padding.PKCS7(128).padder()
    padded = padder.update(head) + padder.finalize()
    if bad_padding:
        padded = padded[:-1] + b"\0"
    encryptor = Cipher(algorithms.AES(key), modes.ECB()).encryptor()
    coded = encryptor.update(padded) + encryptor.finalize()
    end = len(plain) - xor_size
    return (magic + struct.pack("<II", aes_size, xor_size) + b"\0" + coded +
            plain[aes_size:end] + bytes(byte ^ xor_key for byte in plain[end:]))


class VersionedImageTests(unittest.TestCase):
    def test_v1_fixed_aes_does_not_need_account_key_for_png_or_jpeg(self):
        for fmt in ("PNG", "JPEG"):
            with self.subTest(fmt=fmt):
                expected = raster(fmt)
                data = encrypted_image(expected, V1_MAGIC, b"cfcd208495d565ef")
                self.assertEqual(decode_versioned_dat(data), expected)
                preview, status = _preview(data)
                self.assertEqual(status, "preview")
                with Image.open(io.BytesIO(base64.b64decode(preview["data"]))) as image:
                    self.assertEqual(image.size, (64, 48))

    def test_v1_without_xor_tail_and_v2_with_account_material(self):
        for fmt in ("PNG", "JPEG", "WEBP", "GIF"):
            with self.subTest(fmt=fmt):
                plain = raster(fmt)
                v1 = encrypted_image(plain, V1_MAGIC, b"cfcd208495d565ef", xor_size=0)
                self.assertEqual(decode_versioned_dat(v1), plain)
                v2 = encrypted_image(plain)
                self.assertEqual(decode_versioned_dat(v2, (b"0123456789abcdef", 0xA3)), plain)
                self.assertEqual(_preview(v2, (b"0123456789abcdef", 0xA3))[1], "preview")

    def test_missing_wrong_aes_wrong_xor_and_bad_padding_fail_closed(self):
        valid = encrypted_image(raster())
        self.assertEqual(_preview(valid)[1], "image-key-unavailable")
        for data, keys in (
            (valid, (b"fedcba9876543210", 0xA3)),
            (valid, (b"0123456789abcdef", 0xA4)),
            (encrypted_image(raster(), bad_padding=True), (b"0123456789abcdef", 0xA3)),
        ):
            with self.subTest(keys=keys is not None):
                preview, status = _preview(data, keys)
                self.assertIsNone(preview)
                self.assertEqual(status, "invalid-image-container")

    def test_truncated_oversized_overlapping_segments_and_unpadded_length(self):
        valid = encrypted_image(raster())
        cases = [valid[:14], valid[:40],
                 valid[:6] + struct.pack("<II", 0xFFFFFFFF, 20) + valid[14:],
                 valid[:6] + struct.pack("<II", 32, 0xFFFFFFFF) + valid[14:],
                 valid[:6] + struct.pack("<II", 31, 20) + valid[14:],
                 valid[:-1]]
        for data in cases:
            with self.subTest(length=len(data)):
                with self.assertRaises(ImageDecodeError):
                    decode_versioned_dat(data, (b"0123456789abcdef", 0xA3))

    def test_valid_aes_with_corrupt_png_crc_is_not_a_readable_image(self):
        plain = bytearray(raster())
        plain[29] ^= 1  # corrupt IHDR CRC; container and padding remain valid.
        preview, status = _preview(encrypted_image(bytes(plain)), (b"0123456789abcdef", 0xA3))
        self.assertIsNone(preview)
        self.assertEqual(status, "invalid-image")

    def test_png_verify_syntax_error_is_contained_per_image(self):
        plain = bytearray(raster())
        offset = 8
        while plain[offset + 4:offset + 8] != b"IDAT":
            offset += 12 + struct.unpack_from(">I", plain, offset)[0]
        crc_at = offset + 8 + struct.unpack_from(">I", plain, offset)[0]
        plain[crc_at] ^= 1
        with Image.open(io.BytesIO(plain)) as check:
            with self.assertRaises(SyntaxError):
                check.verify()
        preview, status = _preview(encrypted_image(bytes(plain)), (b"0123456789abcdef", 0xA3))
        self.assertIsNone(preview)
        self.assertEqual(status, "invalid-image")

    def test_wxgf_is_not_silently_reported_as_readable_picture(self):
        payload = b"wxgf" + b"\x13" * 100
        preview, status = _preview(encrypted_image(payload), (b"0123456789abcdef", 0xA3))
        self.assertIsNone(preview)
        self.assertEqual(status, "unsupported-image-format")

    def test_only_small_known_container_footer_is_accepted(self):
        payload = raster("JPEG")
        self.assertEqual(decode_versioned_dat(encrypted_image(payload + b"x" * 24),
                                             (b"0123456789abcdef", 0xA3)), payload)
        with self.assertRaises(ImageDecodeError):
            decode_versioned_dat(encrypted_image(payload + b"x" * 33), (b"0123456789abcdef", 0xA3))

    def test_other_v1_named_format_is_not_confused_with_ascii_v1(self):
        image, status = _preview(b"\x07\x08\x05\x56\x02\x05" + b"x" * 100)
        self.assertIsNone(image)
        self.assertEqual(status, "unsupported-encryption")


class ImageAccountIsolationTests(unittest.TestCase):
    def test_invalid_cfg_is_unavailable_and_context_repr_does_not_disclose_material(self):
        for cfg in (None, 0, -1, True, 0x100000000, "123"):
            context = ImageKeyContext(".", "synthetic-self", cfg)
            self.assertIsNone(context.for_account(".", "synthetic-self"))
        context = ImageKeyContext(".", "synthetic-self", 123456)
        self.assertNotIn("123456", repr(context))
        self.assertNotIn("synthetic-self", repr(context))
        self.assertEqual(repr(context), "<ImageKeyContext redacted>")

    def test_account_and_directory_must_both_match_and_close_revokes_material(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            context = ImageKeyContext(root / "one", "self-one", 123456)
            self.assertIsNotNone(context.for_account(root / "one", "self-one"))
            self.assertIsNone(context.for_account(root / "two", "self-one"))
            self.assertIsNone(context.for_account(root / "one", "self-two"))
            context.close()
            self.assertIsNone(context.for_account(root / "one", "self-one"))

    def test_selected_v2_batch_uses_memory_only_context_and_never_serializes_keys(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            photos = root / "msg/attach"
            photos.mkdir(parents=True)
            account = "synthetic-self"
            context = ImageKeyContext(root, account, 123456)
            aes, xor = context.for_account(root, account)
            xml = '<img md5="' + "a" * 32 + '"/>'
            (photos / ("a" * 32 + ".dat")).write_bytes(encrypted_image(raster(), key=aes, xor_key=xor))
            # A different unselected message is never decoded.
            (photos / ("b" * 32 + ".dat")).write_bytes(b"unrelated private image")
            source = Mock(account_id=account, self_username=account, account_dir=root, image_key_context=context)
            rows = [{"type": 3, "timestamp": 1750000000, "sender": "friend", "content": xml,
                     "shard": "message_0.db", "serverId": 1, "localId": 1}]
            batch = _build_batch(source, "合成好友", "friend", rows, {})
            self.assertEqual(len(batch["records"][0]["images"]), 1)
            serialized = json.dumps(batch)
            self.assertNotIn(aes.decode(), serialized)
            self.assertNotIn("cfg_dword", serialized)
            self.assertNotIn("image_key", serialized)
            wrong = LocalChatImages(root, [xml], account_id="different-account", image_key_context=context)
            self.assertEqual(wrong.resolve(xml), (None, "image-key-unavailable"))

    def test_source_creates_context_only_after_identity_check_and_revokes_on_close(self):
        contact = Mock()
        contact.execute.return_value = [("synthetic-self", "本人")]
        proof = {"username": "synthetic-self"}
        with patch.object(LocalDatabaseSource, "contacts", return_value=contact):
            source = LocalDatabaseSource(".", b"synthetic", proof, None, image_cfg_dword=123456)
        context = source.image_key_context
        self.assertIsNotNone(context.for_account(".", "synthetic-self"))
        source.close()
        self.assertIsNone(context.for_account(".", "synthetic-self"))
        contact.execute.return_value = []
        with patch.object(LocalDatabaseSource, "contacts", return_value=contact), \
             patch("local_image_codec.ImageKeyContext") as constructor:
            with self.assertRaises(Exception):
                LocalDatabaseSource(".", b"synthetic", proof, None, image_cfg_dword=123456)
            constructor.assert_not_called()

    def test_authorized_provider_passes_existing_cfg_without_extra_discovery(self):
        with tempfile.TemporaryDirectory() as temporary:
            account = Path(temporary) / "synthetic-self"
            account.mkdir()
            contact = account / "contact.db"
            contact.write_bytes(b"synthetic" * 512)
            primitive = Mock()
            primitive.auto_detect_db_dir.return_value = temporary
            primitive.extract_master_key_from_cfg.return_value = (
                "01" * 32, 123456, "synthetic-self", 9000, b"fake-proof", 8000)
            primitive._pbkdf2.return_value = b"fake-db-key"
            primitive._verify_enc_key.return_value = True
            with patch("local_database_source.probe_authorized_source", return_value={"ready": True}), \
                 patch("local_database_source._primitives", return_value=primitive), \
                 patch("local_database_source._running_processes", return_value=[(123, 456)]), \
                 patch("local_database_source._contact_files", return_value=[(account, contact, None)]), \
                 patch("local_database_source._verify_login"), \
                 patch("local_database_source.LocalDatabaseSource") as constructor:
                open_authorized_source()
            primitive.extract_master_key_from_cfg.assert_called_once()
            self.assertEqual(constructor.call_args.kwargs, {"image_cfg_dword": 123456})


class TargetedImageRepairTests(unittest.TestCase):
    def test_repairs_selected_old_image_without_history_audio_or_unselected_shard(self):
        from test_background_reader import Source, REQUEST
        with tempfile.TemporaryDirectory() as temporary:
            source = Source()
            source.account_dir = Path(temporary)
            source.image_key_context = ImageKeyContext(temporary, source.account_id, 123456)
            keys = source.image_key_context.for_account(temporary, source.account_id)
            photos = Path(temporary) / "msg/attach"
            photos.mkdir(parents=True)
            xml = '<img md5="' + "a" * 32 + '"/>'
            # 4.2's local DAT name differs from the content MD5 in the XML.
            (photos / ("b" * 32 + ".dat")).write_bytes(encrypted_image(raster(), key=keys[0], xor_key=keys[1]))
            selected = source.shard("message_0.db")
            source.add(selected, 1, 101, mtype=3, text=xml)
            source.add(selected, 2, 102, mtype=1, text="不可回扫的文字")
            source.add(selected, 3, 103, mtype=34, text="不可重复转写的语音")
            other = source.shard("message_1.db")
            source.add(other, 1, 104, mtype=3, text=xml)
            selected[0].execute(f'ALTER TABLE "{selected[1]}" ADD COLUMN packed_info_data BLOB')
            selected[0].execute(f'UPDATE "{selected[1]}" SET packed_info_data=? WHERE server_id=101',
                (b"\x08\x01\x10\x02\x1a\x22\x22\x20" + b"b" * 32 + b"\x58\x01",))
            source.selected_message_shards = Mock(return_value=iter([("message_0.db", selected[0])]))
            source.message_shards = Mock(side_effect=AssertionError("all shards"))
            events = []
            with patch("background_reader._read_history_page", side_effect=AssertionError("history scan")), \
                 patch("background_reader._read_messages", side_effect=AssertionError("chat scan")), \
                 patch("background_reader._read_audio", side_effect=AssertionError("audio lookup")):
                batch = capture_from_source(
                    {**REQUEST, "mode": "background", "limit": 16, "imageOnly": True,
                     "imageIds": [{"messageShard": "message_0.db", "messageId": "101", "localId": "1"}]},
                    events.append, None, source)
            self.assertTrue(source.closed)
            source.selected_message_shards.assert_called_once_with({"message_0.db"})
            self.assertEqual(len(batch["records"]), 1)
            self.assertEqual(batch["records"][0]["source"]["messageId"], "101")
            self.assertEqual(batch["records"][0]["kind"], "image")
            self.assertTrue(batch["records"][0]["images"])
            self.assertTrue(batch["history"]["complete"])
            self.assertIn("图片消息", events[-1]["message"])

    def test_repair_ref_validation_does_not_mix_voice_or_replay_cursor(self):
        from test_background_reader import REQUEST
        ref = {"messageShard": "message_0.db", "messageId": "101"}
        base = {**REQUEST, "mode": "background", "imageOnly": True, "imageIds": [ref]}
        for extra in ({"since": "old"}, {"cursor": "old"}, {"includeVoice": True},
                      {"voiceOnly": True}, {"voiceIds": [ref]}, {"imageOnly": "yes"},
                      {"imageIds": [ref, ref]}, {"imageIds": []},
                      {"imageIds": [{"messageShard": "message_0.db", "messageId": str(i)} for i in range(101)]},
                      {"imageIds": [{**ref, "localId": "../other"}]}):
            with self.subTest(extra=list(extra)), self.assertRaises(BackgroundCaptureError):
                _validate_request({**base, **extra})

    def test_repair_cannot_read_voice_text_other_contact_or_wrong_local_reference(self):
        from test_background_reader import Source, REQUEST
        for message_id, local_id in (("102", None), ("103", None), ("101", "99"), ("104", None)):
            source = Source()
            shard = source.shard("message_0.db")
            source.add(shard, 1, 101, mtype=3)
            source.add(shard, 2, 102, mtype=1)
            source.add(shard, 3, 103, mtype=34)
            other_table = "Msg_" + hashlib.md5(b"different-person").hexdigest()
            shard[0].execute(f'CREATE TABLE "{other_table}" AS SELECT * FROM "{shard[1]}" WHERE local_id=1')
            shard[0].execute(f'UPDATE "{other_table}" SET server_id=104')
            ref = {"messageShard": "message_0.db", "messageId": message_id}
            if local_id is not None:
                ref["localId"] = local_id
            with self.subTest(message_id=message_id), self.assertRaises(BackgroundCaptureError) as error:
                capture_from_source({**REQUEST, "mode": "background", "imageOnly": True, "imageIds": [ref]},
                                    lambda event: None, None, source)
            self.assertEqual(error.exception.code, "IMAGE_MESSAGE_MISSING")
            self.assertTrue(source.closed)

    def test_bridge_declares_capability_and_forwards_only_valid_repair_request(self):
        from bridge import CollectorState, BridgeError
        from test_background_reader import REQUEST
        health = lambda: {"ready": True, "capabilities": {"backgroundChat": True}}
        state = CollectorState(health_provider=health)
        self.assertTrue(state.health()["capabilities"]["backgroundImagesById"])
        invalid = {**REQUEST, "mode": "background", "imageOnly": True, "imageIds": []}
        with self.assertRaises(BridgeError):
            state.start(invalid)
        self.assertIsNone(state.active)
        refs = [{"messageShard": "message_0.db", "messageId": "101", "localId": "1"}]
        ctx = Mock()
        parent, child = Mock(), Mock()
        ctx.Pipe.return_value = parent, child
        with patch("bridge.mp.get_context", return_value=ctx), patch("bridge.threading.Thread"):
            result = state.start({**REQUEST, "limit": 16, "mode": "background",
                                  "imageOnly": True, "imageIds": refs})
        payload = ctx.Process.call_args.kwargs["args"][1]
        self.assertEqual(payload["imageIds"], refs)
        self.assertTrue(payload["imageOnly"])
        self.assertFalse(payload["includeVoice"])
        self.assertEqual(state.jobs[result["jobId"]]["message"], "正在补齐选定聊天图片")


if __name__ == "__main__":
    unittest.main()
