"""Pure native-menu panel/OCR tests. No desktop capture or mouse/keyboard use."""
import unittest
from unittest.mock import patch

from PIL import Image, ImageDraw

from voice_menu_ui import menu_panel, recognize_menu


def panel_image(color=(248, 248, 248), *, size=(240, 320)):
    image = Image.new("RGB", size, (110, 125, 140))
    ImageDraw.Draw(image).rectangle((20, 20, size[0] - 21, size[1] - 21), fill=color)
    return image


def ocr_line(text, *, x=30, y=10, width=120, height=20):
    return {"text": text, "bbox": {"x": x, "y": y, "width": width, "height": height}}


def recognized(image, *, conversion="语音转文字", supporting=("收藏", "多选")):
    lines = [ocr_line(conversion)]
    lines += [ocr_line(text, y=60 + 40 * index) for index, text in enumerate(supporting)]
    return {"width": image.width, "height": image.height, "lines": lines}


class MenuPanelTests(unittest.TestCase):
    def test_light_and_dark_opaque_panels_exclude_shadow(self):
        for color in ((248, 248, 248), (30, 30, 30), (57, 59, 58)):
            with self.subTest(color=color), panel_image(color) as image:
                # Text and an icon may punch holes in the flat background.
                ink = (20, 20, 20) if color[0] > 200 else (240, 240, 240)
                draw = ImageDraw.Draw(image)
                draw.rectangle((45, 42, 60, 57), fill=ink)
                draw.rectangle((85, 45, 160, 55), fill=ink)
                self.assertEqual(menu_panel(image), (21, 21, 219, 299))

    def test_invalid_size_or_no_panel_rejected(self):
        for size in ((99, 200), (200, 99), (1101, 200), (200, 1401)):
            with self.subTest(size=size), Image.new("RGB", size, (248, 248, 248)) as image:
                self.assertIsNone(menu_panel(image))
        for color in ((248, 248, 248), (30, 30, 30), (140, 110, 130)):
            with self.subTest(color=color), Image.new("RGB", (240, 320), color) as image:
                self.assertIsNone(menu_panel(image))

    def test_clipped_panel_and_small_inner_component_rejected(self):
        for bounds in ((0, 20, 219, 299), (20, 0, 219, 299), (20, 20, 239, 299),
                       (20, 20, 219, 319), (80, 80, 150, 220)):
            with self.subTest(bounds=bounds), Image.new("RGB", (240, 320), (100, 120, 140)) as image:
                ImageDraw.Draw(image).rectangle(bounds, fill=(248, 248, 248))
                self.assertIsNone(menu_panel(image))

    def test_two_comparable_panel_components_are_ambiguous(self):
        with Image.new("RGB", (320, 420), (140, 110, 130)) as image:
            draw = ImageDraw.Draw(image)
            draw.rectangle((20, 20, 229, 299), fill=(30, 30, 30))
            draw.rectangle((90, 100, 299, 399), fill=(235, 235, 235))
            draw.rectangle((90, 100, 159, 299), fill=(30, 30, 30))
            self.assertIsNone(menu_panel(image))


class MenuRecognitionTests(unittest.TestCase):
    def test_first_exact_menu_returns_popup_relative_coordinates(self):
        calls = []

        def engine(image, *, scale, timeout):
            calls.append((image.size, scale, timeout))
            return recognized(image)

        with panel_image() as image:
            result = recognize_menu(image, recognize=engine)
        self.assertEqual(result["status"], "ready")
        self.assertEqual(result["bbox"], {"x": 51.0, "y": 31.0, "width": 120.0, "height": 20.0})
        self.assertEqual(result["panel"], (21, 21, 219, 299))
        self.assertEqual(result["supportingCount"], 2)
        self.assertEqual(result["scale"], 2)
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][:2], ((198, 278), 2))

    def test_bounded_scale_retry_preserves_complete_label(self):
        calls = []

        def engine(image, *, scale, timeout):
            calls.append((image.size, scale, timeout))
            return recognized(image, conversion="语音转文字" if len(calls) == 2 else "涯音转文字")

        with panel_image() as image:
            result = recognize_menu(image, recognize=engine, timeout=10)
        self.assertEqual(result["status"], "ready")
        self.assertEqual([call[1] for call in calls], [2, 3])
        self.assertEqual([call[0] for call in calls], [(198, 278), (198, 278)])
        self.assertTrue(all(0 < call[2] <= 10 for call in calls))
        self.assertTrue(all(a[2] >= b[2] for a, b in zip(calls, calls[1:])))
        self.assertEqual(result["bbox"]["x"], 51)
        self.assertEqual(result["bbox"]["y"], 31)
        self.assertEqual(result["scale"], 3)

    def test_no_exact_conversion_or_two_distinct_supports_rejected(self):
        cases = (
            ("涯音转文字", ("收藏", "多选")),
            ("不转文字", ("收藏", "多选")),
            ("语音转文字？", ("收藏", "多选")),
            ("语音转文字", ("收藏",)),
            ("语音转文字", ("收藏", "收藏")),
            ("语音转文字", ("不收藏", "多选")),
        )
        for conversion, supporting in cases:
            calls = []

            def engine(image, *, scale, timeout):
                calls.append(scale)
                return recognized(image, conversion=conversion, supporting=supporting)

            with self.subTest(conversion=conversion, supporting=supporting), panel_image() as image:
                result = recognize_menu(image, recognize=engine)
                self.assertEqual(result["reason"], "menu-not-uniquely-readable")
                self.assertNotIn("bbox", result)
                self.assertEqual(len(calls), 2)

    def test_ambiguous_exact_conversion_rows_rejected(self):
        def engine(image, *, scale, timeout):
            data = recognized(image)
            data["lines"].append(ocr_line("转文字", y=150))
            return data

        with panel_image() as image:
            self.assertEqual(recognize_menu(image, recognize=engine)["reason"], "menu-not-uniquely-readable")

    def test_clipped_crop_label_cannot_pass_fallback(self):
        def engine(image, *, scale, timeout):
            data = recognized(image)
            data["lines"][0]["bbox"]["x"] = 0
            return data

        with panel_image() as image:
            self.assertEqual(recognize_menu(image, recognize=engine)["status"], "needs-review")

    def test_no_ocr_when_panel_missing_or_budget_exhausted(self):
        def forbidden_engine(*args, **kwargs):
            self.fail("OCR must not run without a valid panel/time budget")

        with Image.new("RGB", (240, 320), "white") as image:
            self.assertEqual(recognize_menu(image, recognize=forbidden_engine)["reason"], "panel-not-found")
        with panel_image() as image, patch("voice_menu_ui.time.monotonic", side_effect=[10, 11]):
            self.assertEqual(recognize_menu(image, recognize=forbidden_engine, timeout=1)["reason"], "menu-timeout")

    def test_deadline_is_shared_across_fallbacks(self):
        calls = []

        def engine(image, *, scale, timeout):
            calls.append(timeout)
            return recognized(image, conversion="无法识别")

        with panel_image() as image, patch("voice_menu_ui.time.monotonic", side_effect=[10, 10.1, 10.3, 10.4, 11.1]):
            result = recognize_menu(image, recognize=engine, timeout=1)
        self.assertEqual(result["reason"], "menu-timeout")
        self.assertEqual(len(calls), 2)
        self.assertAlmostEqual(calls[0], .9)
        self.assertAlmostEqual(calls[1], .6)

    def test_ocr_returning_exact_label_after_deadline_is_rejected(self):
        with panel_image() as image, patch("voice_menu_ui.time.monotonic", side_effect=[10, 10.1, 11.2]):
            result = recognize_menu(image, recognize=lambda img, **kw: recognized(img), timeout=1)
        self.assertEqual(result["reason"], "menu-timeout")

    def test_negative_prefix_is_never_cropped_into_legal_action(self):
        sizes = []
        def engine(image, **kwargs):
            sizes.append(image.size)
            return recognized(image, conversion="不转文字" if image.width == 198 else "转文字")
        with panel_image() as image:
            self.assertEqual(recognize_menu(image, recognize=engine)["status"], "needs-review")
        self.assertEqual(sizes, [(198, 278), (198, 278)])


if __name__ == "__main__":
    unittest.main(verbosity=2)
