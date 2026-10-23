"""Synthetic cached images, never real WeChat or database keys."""
import base64
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image
from local_chat_images import LocalChatImages, image_reference, readable_image_bytes, packed_image_reference
from background_reader import _build_batch


def image_bytes(fmt="PNG", size=(40, 40)):
    output = io.BytesIO()
    Image.new("RGB", size, "orange").save(output, format=fmt)
    return output.getvalue()


class ImageTests(unittest.TestCase):
    def test_packed_reference_requires_complete_unique_local_filename_field(self):
        name = b"b" * 32
        nested = b"\x22\x20" + name
        packed = b"\x08\x01\x10\x02\x1a\x22" + nested + b"\x58\x01"
        self.assertEqual(packed_image_reference(packed), "b" * 32)
        self.assertEqual(packed_image_reference(packed.replace(name, name.upper())), "b" * 32)
        for value in (None, "wrong-type", b"x" * 4097, name, packed[:-1], packed + b"\x80",
                      b"\x1a\x21" + nested, b"\x1a\x22\x2a\x20" + name,
                      b"\x1a\x44" + nested + nested,
                      b"\x1a\x22" + nested + b"\x1a\x22" + nested,
                      b"\x1a\x22\x22\x20" + b"/" * 32):
            with self.subTest(size=len(value) if value is not None else None):
                self.assertEqual(packed_image_reference(value), "")

    def test_local_filename_differs_from_xml_and_cache_keeps_each_message_identity(self):
        xml = '<img md5="' + "a" * 32 + '"/>'
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "msg/attach"
            root.mkdir(parents=True)
            (root / ("b" * 32 + "_t.dat")).write_bytes(image_bytes("PNG", (40, 40)))
            (root / ("c" * 32 + "_t.dat")).write_bytes(image_bytes("PNG", (80, 40)))
            reader = LocalChatImages(temporary, [xml, xml], file_references=["b" * 32, "c" * 32])
            self.assertEqual(reader.resolve(xml), (None, "missing-local"))
            for name, width in (("b" * 32, 40), ("c" * 32, 80)):
                preview, status = reader.resolve(xml, file_reference=name)
                self.assertEqual(status, "preview")
                with Image.open(io.BytesIO(base64.b64decode(preview["data"]))) as actual:
                    self.assertEqual(actual.size, (width, 40))
            self.assertEqual(reader.resolve(xml, file_reference="../../other"), (None, "missing-local"))

    def test_newest_and_history_readers_map_local_filename_without_serializing_packed_blob(self):
        from background_reader import _read_messages, _read_history_page
        from test_background_reader import Source
        for mode in ("newest", "history"):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as temporary:
                source = Source()
                source.account_dir = Path(temporary)
                root = source.account_dir / "msg/attach"
                root.mkdir(parents=True)
                (root / ("b" * 32 + "_t.dat")).write_bytes(image_bytes())
                shard = source.shard("message_0.db")
                source.add(shard, 1, 101, mtype=3, text='<img md5="' + "a" * 32 + '"/>')
                shard[0].execute(f'ALTER TABLE "{shard[1]}" ADD COLUMN packed_info_data BLOB')
                packed = b"\x08\x01\x10\x02\x1a\x22\x22\x20" + b"b" * 32 + b"\x58\x01"
                shard[0].execute(f'UPDATE "{shard[1]}" SET packed_info_data=?', (packed,))
                try:
                    rows = (_read_messages(source, "target-user", 20) if mode == "newest" else
                            _read_history_page(source, "target-user", {"cursor":None, "since":None, "direction":"backward", "size":20})[0])
                    batch = _build_batch(source, "合成好友", "target-user", rows, {})
                    self.assertEqual(len(rows), 1)
                    self.assertEqual(rows[0]["imageFileReference"], "b" * 32)
                    self.assertEqual(batch["records"][0]["source"]["mediaAvailability"], "preview")
                    self.assertTrue(batch["records"][0]["images"])
                    self.assertNotIn("imageFileReference", json.dumps(batch))
                    self.assertNotIn("b" * 32, json.dumps(batch))
                finally:
                    source.close()

    def test_plain_and_old_xor_formats_are_validated_then_previewed(self):
        for fmt in ("PNG", "JPEG", "WEBP", "GIF"):
            data = image_bytes(fmt)
            for key in (0, 0x65):
                coded = bytes(byte ^ key for byte in data)
                self.assertEqual(readable_image_bytes(coded), data)
                with tempfile.TemporaryDirectory() as temporary:
                    root = Path(temporary) / "msg" / "attach"
                    root.mkdir(parents=True)
                    (root / ("a" * 32 + ".dat")).write_bytes(coded)
                    image, status = LocalChatImages(temporary, ['<img md5="' + "a" * 32 + '"/>']).resolve('<img md5="' + "a" * 32 + '"/>')
                    self.assertEqual(status, "preview")
                    with Image.open(io.BytesIO(base64.b64decode(image["data"]))) as actual:
                        self.assertEqual(actual.size, (40, 40))

    def test_index_passes_400_unrelated_files_and_accepts_large_real_image(self):
        xml = '<msg><img md5="' + "a" * 32 + '"/></msg>'
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "FileStorage" / "Image"
            root.mkdir(parents=True)
            for index in range(430):
                (root / f"unrelated-{index}.dat").write_bytes(b"unrelated")
            image = Image.effect_noise((800, 800), 100).convert("RGB")
            image.save(root / ("a" * 32 + ".png"))
            self.assertGreater((root / ("a" * 32 + ".png")).stat().st_size, 180_000)
            image.close()
            reader = LocalChatImages(temporary, [xml])
            self.assertTrue(reader.complete)
            preview, status = reader.resolve(xml)
            self.assertEqual(status, "preview")
            self.assertLessEqual(len(base64.b64decode(preview["data"])), 750_000)

    def test_missing_unknown_encryption_and_incomplete_scan_are_distinct(self):
        xml = '<img md5="' + "a" * 32 + '"/>'
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "msg" / "attach"
            root.mkdir(parents=True)
            self.assertEqual(LocalChatImages(temporary, [xml]).resolve(xml)[1], "missing-local")
            (root / ("a" * 32 + ".dat")).write_bytes(b"\x07\x08V1" + b"encrypted" * 20)
            self.assertEqual(LocalChatImages(temporary, [xml]).resolve(xml)[1], "unsupported-encryption")
            reader = LocalChatImages(temporary, [xml], max_entries=0)
            self.assertFalse(reader.complete)
            self.assertEqual(reader.resolve(xml)[1], "scan-incomplete")
            self.assertEqual(reader.resolve('<!DOCTYPE img><img md5="' + "a" * 32 + '"/>')[1], "message-reference-missing")
            self.assertEqual(image_reference('<img md5="../../other"/>'), "")

    def test_batch_has_no_eight_photo_cutoff_and_counts_unavailable(self):
        from types import SimpleNamespace
        source = SimpleNamespace(account_id="test-account", self_username="self", account_dir="synthetic")
        rows = [{"type": 3, "timestamp": 1750000000 + index, "sender": "friend", "content": '<img md5="' + "a" * 32 + '"/>',
                 "shard": "message_0.db", "serverId": index + 1, "localId": index + 1} for index in range(12)]
        preview = {"mime": "image/jpeg", "name": "synthetic.jpg", "data": base64.b64encode(image_bytes("JPEG")).decode("ascii")}
        with patch("local_chat_images.LocalChatImages") as reader:
            reader.return_value.complete = True
            reader.return_value.resolve.side_effect = [(preview, "preview")] * 11 + [(None, "unsupported-encryption")]
            batch = _build_batch(source, "好友", "friend", rows, {})
        self.assertEqual(sum(bool(row.get("images")) for row in batch["records"]), 11)
        self.assertEqual(batch["records"][-1]["source"]["previewUnavailable"], "unsupported-encryption")
        self.assertIn("12 条图片消息已取得 11 张", " ".join(batch["warnings"]))

    def test_encoded_batch_budget_is_explicit_not_an_invisible_cutoff(self):
        from types import SimpleNamespace
        source = SimpleNamespace(account_id="test-account", self_username="self", account_dir="synthetic")
        rows = [{"type": 3, "timestamp": 1750000000 + index, "sender": "friend", "content": "x", "shard": "message_0.db", "serverId": index + 1, "localId": index + 1} for index in range(2)]
        preview = {"mime": "image/jpeg", "name": "synthetic.jpg", "data": "a" * (11 * 1024 * 1024)}
        with patch("local_chat_images.LocalChatImages") as reader:
            reader.return_value.complete = True
            reader.return_value.resolve.return_value = preview, "preview"
            batch = _build_batch(source, "好友", "friend", rows, {})
        self.assertTrue(batch["records"][0].get("images"))
        self.assertEqual(batch["records"][1]["source"]["previewUnavailable"], "batch-image-budget")


if __name__ == "__main__":
    unittest.main()
