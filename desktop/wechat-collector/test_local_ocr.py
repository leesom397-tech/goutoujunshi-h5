"""Synthetic-only offline OCR checks; never captures a screen or opens WeChat."""
import json
import math
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image, ImageDraw, ImageFont
import local_ocr as ocr


def response(**changes):
    value = {"ok": True, "language": "zh-Hans-CN", "text": "", "textAngle": 0, "lines": []}
    value.update(changes)
    return value


class OcrSafetyTests(unittest.TestCase):
    def test_png_path_spaces_unicode_and_cleanup(self):
        seen = []
        def invoke(arguments, timeout):
            temporary = Path(arguments[1])
            self.assertTrue(temporary.is_file())
            self.assertEqual(arguments[2:], ["-Language", "zh-Hans-CN"])
            with Image.open(temporary) as img:
                self.assertEqual(img.size, (80, 40))
                self.assertEqual(img.getpixel((0, 0)), (255, 255, 255))
            seen.append(temporary)
            return response()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "合成 图片.png"
            with Image.new("RGBA", (40, 20), (0, 0, 0, 0)) as image:
                image.save(path)
            with patch.object(ocr, "_invoke", side_effect=invoke):
                result = ocr.recognize_image(path, scale=2)
            self.assertEqual((result["width"], result["height"]), (40, 20))
            self.assertTrue(path.is_file())
        self.assertTrue(seen)
        self.assertFalse(seen[0].exists())

    def test_input_pil_unchanged_and_scale_coordinates(self):
        image = Image.new("RGB", (100, 80), "white")
        original = image.tobytes()
        payload = response(text="合成", lines=[{"text": "合成", "words": [
            {"text": "合成", "bbox": {"x": 20, "y": 40, "width": 40, "height": 20}}
        ]}])
        with patch.object(ocr, "_invoke", return_value=payload):
            result = ocr.recognize_image(image, scale=2)
        self.assertEqual(image.tobytes(), original)
        self.assertEqual(result["lines"][0]["bbox"], {"x": 10, "y": 20, "width": 20, "height": 10})
        image.close()

    def test_text_angle_rotates_back_to_image_pixels(self):
        box = ocr._box({"x": 50, "y": 50, "width": 20, "height": 10}, 100, 100, 1, 1, 90)
        for key, value in {"x": 40, "y": 50, "width": 10, "height": 20}.items():
            self.assertAlmostEqual(box[key], value)
        box = ocr._box({"x": -10, "y": -20, "width": 30, "height": 40}, 100, 100, 1, 1)
        self.assertEqual(box, {"x": 0, "y": 0, "width": 20, "height": 20})

    def test_rejects_invalid_boxes(self):
        for value in [{"x": math.nan, "y": 1, "width": 2, "height": 3},
                      {"x": 1, "y": 1, "width": -1, "height": 3}, {}]:
            with self.assertRaises(ocr.LocalOCRError) as error:
                ocr._box(value, 10, 10, 1, 1)
            self.assertEqual(error.exception.code, "OCR_INVALID_RESULT")

    def test_timeout_cleanup_and_no_false_result(self):
        temporary = []
        def invoke(arguments, timeout):
            temporary.append(Path(arguments[1]))
            raise ocr.LocalOCRError("OCR_TIMEOUT", "synthetic timeout")
        with Image.new("RGB", (10, 10), "white") as image:
            with patch.object(ocr, "_invoke", side_effect=invoke):
                with self.assertRaises(ocr.LocalOCRError):
                    ocr.recognize_image(image)
        self.assertFalse(temporary[0].exists())

    @unittest.skipUnless(os.name == "nt", "Windows subprocess flags")
    def test_only_system_powershell_hidden_argv_no_shell(self):
        completed = subprocess.CompletedProcess([], 0, json.dumps(response()), "")
        with patch.object(ocr.subprocess, "run", return_value=completed) as run:
            ocr._invoke(["-ImagePath", "C:/temporary/a $x.png", "-Language", "zh-Hans-CN"], 8)
        command = run.call_args.args[0]
        kwargs = run.call_args.kwargs
        self.assertTrue(command[0].lower().endswith("/powershell.exe") or command[0].lower().endswith("\\powershell.exe"))
        self.assertIn("WindowsPowerShell", command[0])
        self.assertIn("-File", command)
        self.assertIn("C:/temporary/a $x.png", command)
        self.assertFalse(kwargs["shell"])
        self.assertEqual(kwargs["creationflags"], subprocess.CREATE_NO_WINDOW)
        self.assertEqual(kwargs["startupinfo"].wShowWindow, subprocess.SW_HIDE)
        self.assertEqual(kwargs["timeout"], 8)

    @unittest.skipUnless(os.name == "nt", "Windows subprocess flags")
    def test_subprocess_timeout_converted(self):
        with patch.object(ocr.subprocess, "run", side_effect=subprocess.TimeoutExpired("synthetic", 1)):
            with self.assertRaises(ocr.LocalOCRError) as error:
                ocr._invoke(["-Languages"], 1)
        self.assertEqual(error.exception.code, "OCR_TIMEOUT")

    @unittest.skipUnless(os.name == "nt", "Windows subprocess flags")
    def test_invalid_bridge_json_rejected(self):
        for text in ["invalid", "[]", "null"]:
            with patch.object(ocr.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, text, "")):
                with self.assertRaises(ocr.LocalOCRError) as error:
                    ocr._invoke(["-Languages"], 1)
            self.assertEqual(error.exception.code, "OCR_BRIDGE_FAILED")

    def test_validation_before_execution(self):
        with Image.new("RGB", (10, 10)) as image:
            with patch.object(ocr, "_invoke") as invoke:
                for scale in [0, 4, math.nan]:
                    with self.assertRaises(ValueError):
                        ocr.recognize_image(image, scale=scale)
                with self.assertRaises(ValueError):
                    ocr.recognize_image(image, language="zh;Invoke-Expression")
                with patch.object(ocr, "MAX_PIXELS", 50):
                    with self.assertRaises(ocr.LocalOCRError) as error:
                        ocr.recognize_image(image)
                    self.assertEqual(error.exception.code, "OCR_IMAGE_TOO_LARGE")
                invoke.assert_not_called()

    def test_bad_and_missing_png(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "bad.png"
            path.write_bytes(b"not an image")
            with self.assertRaises(ocr.LocalOCRError) as error:
                ocr.recognize_image(path)
            self.assertEqual(error.exception.code, "OCR_INVALID_IMAGE")
            with self.assertRaises(ocr.LocalOCRError) as error:
                ocr.recognize_image(Path(directory) / "missing.png")
            self.assertEqual(error.exception.code, "OCR_IMAGE_MISSING")
            with Image.new("RGB", (10, 10)) as image:
                image.save(path, format="JPEG")
            with self.assertRaises(ocr.LocalOCRError) as error:
                ocr.recognize_image(path)
            self.assertEqual(error.exception.code, "OCR_INVALID_IMAGE")


@unittest.skipUnless(os.name == "nt", "Windows built-in OCR integration")
class WindowsOcrSyntheticTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.languages = ocr.available_languages()
        if not any(item["tag"] == "zh-Hans-CN" for item in cls.languages):
            raise unittest.SkipTest("Installed Simplified Chinese OCR required; no downloads attempted.")
        cls.font_path = Path("C:/Windows/Fonts/msyh.ttc")
        if not cls.font_path.is_file():
            raise unittest.SkipTest("Microsoft YaHei required to draw synthetic Chinese.")

    def test_installed_language_utf8(self):
        item = next(value for value in self.languages if value["tag"] == "zh-Hans-CN")
        self.assertIn("中文", item["displayName"])
        self.assertNotIn("\ufffd", item["displayName"])

    def test_chinese_menu_and_transcript_bbox(self):
        with Image.new("RGB", (680, 280), "white") as image:
            draw = ImageDraw.Draw(image)
            font = ImageFont.truetype(str(self.font_path), 28)
            expected = ["转文字", "语音转文字", "这是一张合成测试图片。"]
            for index, line in enumerate(expected):
                draw.text((40, 20 + index * 70), line, fill="black", font=font)
            result = ocr.recognize_image(image, scale=2)
            self.assertEqual((result["width"], result["height"]), image.size)
            self.assertEqual(["".join(line["text"].split()) for line in result["lines"]], expected)
            for index, line in enumerate(result["lines"]):
                box = line["bbox"]
                drawn = draw.textbbox((40, 20 + index * 70), expected[index], font=font)
                self.assertLess(abs(box["x"] - drawn[0]), 7)
                self.assertLess(abs(box["y"] - drawn[1]), 7)
                self.assertGreater(len(line["words"]), 0)
                for word in line["words"]:
                    self.assertGreater(word["bbox"]["width"], 0)
                    self.assertGreaterEqual(word["bbox"]["x"], 0)
                    self.assertLessEqual(word["bbox"]["x"] + word["bbox"]["width"], image.width)

    def test_small_menu_pixels_are_not_scaled_coordinates(self):
        with Image.new("RGB", (680, 280), "white") as image:
            draw = ImageDraw.Draw(image)
            font = ImageFont.truetype(str(self.font_path), 16)
            for index, line in enumerate(["转文字", "语音转文字", "这是一张合成测试图片。"]):
                draw.text((40, 20 + index * 70), line, fill="black", font=font)
            result = ocr.recognize_image(image, scale=2)
            first = result["lines"][0]
            self.assertEqual("".join(first["text"].split()), "转文字")
            self.assertGreater(first["bbox"]["x"], 34)
            self.assertLess(first["bbox"]["x"], 46)
            self.assertLess(first["bbox"]["width"], 60)

    def test_blank_has_no_invented_text(self):
        with Image.new("RGB", (200, 160), "white") as image:
            result = ocr.recognize_image(image)
        self.assertEqual(result["text"].strip(), "")
        self.assertEqual(result["lines"], [])

    def test_missing_language_fails_without_fallback(self):
        with Image.new("RGB", (100, 60), "white") as image:
            with self.assertRaises(ocr.LocalOCRError) as error:
                ocr.recognize_image(image, language="zz-ZZ")
        self.assertEqual(error.exception.code, "OCR_LANGUAGE_UNAVAILABLE")


if __name__ == "__main__":
    unittest.main(verbosity=2)
