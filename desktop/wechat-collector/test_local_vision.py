import threading
import unittest
from unittest.mock import patch

from PIL import Image

import local_vision
from local_ocr import LocalOCRError


class LocalVisionTests(unittest.TestCase):
    def setUp(self):
        self.image = Image.new("RGB", (100, 50), "white")

    def tearDown(self):
        self.image.close()

    def test_coordinates_are_original_pixels_and_low_confidence_is_omitted(self):
        result = [
            [[[20, 10], [180, 10], [180, 80], [20, 80]], "sample", 0.9],
            [[[0, 0], [10, 0], [10, 10], [0, 10]], "uncertain", 0.79],
        ]
        with patch.object(local_vision, "_run", return_value=result):
            actual = local_vision.recognize_image(self.image, scale=2)
        self.assertEqual((actual["width"], actual["height"], actual["textAngle"]), (100, 50, 0))
        self.assertEqual(actual["text"], "sample")
        self.assertEqual(actual["lines"][0]["bbox"], {"x": 10, "y": 5, "width": 80, "height": 35})

    def test_exact_duration_and_minimum_confidence(self):
        for value in ('3″', '1"', '60”', ' 12 ＂ '):
            with self.subTest(value=value), patch.object(local_vision, "_run", return_value=[[value, 0.6176]]):
                self.assertEqual(local_vision.recognize_duration(self.image)["status"], "ready")

    def test_duration_rejects_text_without_double_quote_or_out_of_range(self):
        for value in ('3', '3秒', '3\'', '0″', '61″', '03″', '13″ other', '文字3″', 'O3″'):
            with self.subTest(value=value), patch.object(local_vision, "_run", return_value=[[value, 0.99]]):
                self.assertEqual(local_vision.recognize_duration(self.image)["status"], "needs-review")

    def test_ambiguous_or_low_confidence_duration_is_rejected(self):
        for result in ([], [['3″', .599]], [['3″', float('nan')]], [['3″', .9], ['4″', .9]]):
            with self.subTest(result=result), patch.object(local_vision, "_run", return_value=result):
                self.assertEqual(local_vision.recognize_duration(self.image)["status"], "needs-review")

    def test_timeout_does_not_allow_engine_overlap_or_late_results(self):
        release = threading.Event()
        entered = threading.Event()

        def engine(*args, **kwargs):
            entered.set()
            release.wait(2)
            return [], None

        try:
            with patch.object(local_vision, "_engine", return_value=engine):
                with self.assertRaises(LocalOCRError) as error:
                    local_vision.recognize_image(self.image, timeout=.05)
                self.assertEqual(error.exception.code, "OCR_TIMEOUT")
                self.assertTrue(entered.wait(1))
                with self.assertRaises(LocalOCRError) as error:
                    local_vision.recognize_duration(self.image, timeout=.01)
                self.assertEqual(error.exception.code, "OCR_TIMEOUT")
                release.set()
                self.assertTrue(local_vision._RUN_LOCK.acquire(timeout=2))
                local_vision._RUN_LOCK.release()
        finally:
            release.set()

    def test_missing_packaged_model_stops_without_initializing_engine(self):
        with patch.object(local_vision, "_ENGINE", None), patch.object(local_vision.importlib.util, "find_spec", return_value=None):
            with self.assertRaises(LocalOCRError) as error:
                local_vision._engine()
        self.assertEqual(error.exception.code, "OCR_UNAVAILABLE")

    def test_invalid_dimensions_and_scale_are_rejected(self):
        with self.assertRaises(ValueError):
            local_vision.recognize_image(self.image, scale=4)
        with Image.new("RGB", (10001, 1)) as wide:
            with self.assertRaises(LocalOCRError) as error:
                local_vision.recognize_image(wide)
        self.assertEqual(error.exception.code, "OCR_IMAGE_TOO_LARGE")


if __name__ == "__main__":
    unittest.main()
