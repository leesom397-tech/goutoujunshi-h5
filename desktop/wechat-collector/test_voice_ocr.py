"""Only synthetic OCR data/images; no Weixin interaction."""
import os
from pathlib import Path
import unittest

from voice_ocr import menu_supporting_labels, normalize_ocr_spacing, parse_voice_menu, parse_voice_transcript


def line(text, x=12, y=10, width=130, height=18):
    return {"text": text, "bbox": {"x": x, "y": y, "width": width, "height": height}}


def page(*lines):
    return {"width": 400, "height": 180, "text": "unused page text", "lines": list(lines)}


def icon_line(label="语 音 转 文 字", icon="囡", gap=18, y=10):
    words = [line(icon, x=12, y=y, width=14)]
    x = 26 + gap
    for text in label.split():
        width = max(14, len(text) * 10)
        words.append(line(text, x=x, y=y, width=width))
        x += width + 2
    value = line(icon + " " + label, x=12, y=y, width=x - 14)
    value["words"] = words
    return value


class VoiceOcrTests(unittest.TestCase):
    def test_unique_exact_menu(self):
        result = parse_voice_menu(page(line("收 藏"), line("语 音 转 文 字", y=45), line("删 除", y=80)))
        self.assertEqual(result["status"], "ready")
        self.assertEqual(result["label"], "语音转文字")
        self.assertEqual(result["bbox"]["y"], 45)
        self.assertEqual(result["rawOcrText"], "语 音 转 文 字")

    def test_two_exact_menus_are_ambiguous(self):
        result = parse_voice_menu(page(line("转文字"), line("语音转文字", y=50)))
        self.assertEqual(result["reason"], "ambiguous-menu")
        self.assertIsNone(result["bbox"])

    def test_no_fuzzy_or_substring_menu(self):
        for text in ("语音转文子", "取消语音转文字", "转文字 删除", "语音转文字？", "删除", "传文字", "不转文字", "删转文字", "不语音转文字", "囡语音转文字"):
            with self.subTest(text=text):
                result = parse_voice_menu(page(line(text)))
                self.assertEqual(result["status"], "needs-review")
                self.assertIsNone(result["bbox"])

    def test_native_qt_icon_prefix_is_accepted(self):
        result = parse_voice_menu(page(icon_line(), line("收 藏", y=60)))
        self.assertEqual(result["status"], "ready")
        self.assertEqual(result["label"], "语音转文字")
        self.assertEqual(result["bbox"]["x"], 44)
        self.assertEqual(result["bbox"]["width"], 78)

    def test_semantic_prefix_is_rejected_even_with_separate_words(self):
        for prefix in ("不", "删", "勿", "再", "可", "A"):
            with self.subTest(prefix=prefix):
                self.assertEqual(parse_voice_menu(page(icon_line(icon=prefix)))["status"], "needs-review")

    def test_small_rotated_ocr_box_overlap_is_tolerated(self):
        value = icon_line()
        value["words"][1]["bbox"]["width"] = 17.2
        self.assertEqual(parse_voice_menu(page(value))["status"], "ready")

    def test_icon_needs_distinct_column_and_complete_word_geometry(self):
        for gap in (0, 2, 100):
            with self.subTest(gap=gap):
                self.assertEqual(parse_voice_menu(page(icon_line(gap=gap)))["status"], "needs-review")
        for mutation in ("missing", "mismatch", "out-of-line", "overlap", "different-row"):
            value = icon_line()
            if mutation == "missing":
                value["words"][0].pop("bbox")
            elif mutation == "mismatch":
                value["words"][0]["text"] = "★"
            elif mutation == "out-of-line":
                value["words"][0]["bbox"]["x"] = 0
            elif mutation == "overlap":
                value["words"][2]["bbox"]["x"] = value["words"][1]["bbox"]["x"]
            else:
                value["bbox"]["height"] = 50
                value["words"][0]["bbox"]["y"] = 35
            with self.subTest(mutation=mutation):
                self.assertEqual(parse_voice_menu(page(value))["status"], "needs-review")

    def test_english_and_traditional_canonical_labels(self):
        for text, canonical in (("Convert   to Text", "convert to text"), ("TRANSCRIBE", "transcribe"),
                                ("語 音 轉 文 字", "語音轉文字"), ("轉 文 字", "轉文字")):
            with self.subTest(text=text):
                self.assertEqual(parse_voice_menu(page(line(text)))["label"], canonical)
        result = parse_voice_menu(page(icon_line("Convert to Text", icon="★")))
        self.assertEqual(result["label"], "convert to text")
        for text in ("Converttotext", "Convert totext", "Do not convert to text", "Transcribe?", "ReTranscribe"):
            self.assertEqual(parse_voice_menu(page(line(text)))["status"], "needs-review")

    def test_large_or_multiple_prefix_is_rejected(self):
        for text in ("图标 语音转文字", "甲乙丙语音转文字"):
            with self.subTest(text=text):
                self.assertEqual(parse_voice_menu(page(line(text)))["status"], "needs-review")

    def test_menu_scope_ignores_outside_exact_label(self):
        result = parse_voice_menu(page(line("转文字"), line("语音转文字", y=70)),
                                  menu_region={"x": 0, "y": 50, "width": 200, "height": 90})
        self.assertEqual(result["status"], "ready")
        self.assertEqual(result["bbox"]["y"], 70)

    def test_menu_clipped_and_edge_touching_rejected(self):
        region = {"x": 0, "y": 50, "width": 200, "height": 90}
        result = parse_voice_menu(page(line("语音转文字", y=40)), menu_region=region)
        self.assertEqual(result["reason"], "clipped-region")
        result = parse_voice_menu(page(line("语音转文字", y=50)), menu_region=region)
        self.assertEqual(result["reason"], "touches-region-edge")
        self.assertEqual(parse_voice_menu(page(icon_line(), line("Transcribe", y=65)))["reason"], "ambiguous-menu")

    def test_supporting_labels_require_same_menu_region(self):
        ocr = page(line("收藏", y=10), line("多选", y=40), line("删除", y=90), line("Quote", y=120))
        region = {"x": 0, "y": 70, "width": 200, "height": 90}
        self.assertEqual(menu_supporting_labels(ocr, menu_region=region), {"删除", "引用"})
        self.assertEqual(menu_supporting_labels(ocr, menu_region={"x": 0, "y": 30, "width": 900, "height": 90}), set())
        self.assertEqual(menu_supporting_labels(ocr, menu_region={"x": 0, "y": 45, "width": 200, "height": 100}), set())
        self.assertEqual(menu_supporting_labels(None), set())

    def test_supporting_labels_use_exact_words_or_separate_icon(self):
        self.assertEqual(menu_supporting_labels(page(icon_line("收 藏", icon="★"), line("DELETE", y=60), line("多 選", y=100))),
                         {"收藏", "删除", "多选"})
        for text in ("不收藏", "删收藏", "不删除", "X引用", "取消提醒", "已多选", "囡收藏"):
            with self.subTest(text=text):
                self.assertEqual(menu_supporting_labels(page(line(text))), set())
        self.assertEqual(menu_supporting_labels(page(icon_line("删 除", icon="不"))), set())

    def test_transcript_all_lines_sorted_raw_preserved(self):
        result = parse_voice_transcript(page(line("下 午 见 。", y=50), line("合 成 正 文 第 一 行", y=10)))
        self.assertEqual(result["status"], "ready")
        self.assertEqual(result["text"], "合成正文第一行\n下午见。")
        self.assertEqual(result["rawOcrText"], "合 成 正 文 第 一 行\n下 午 见 。")
        self.assertTrue(result["requiresVerification"])
        self.assertNotIn("confidence", result)

    def test_english_word_spaces_and_numbers_preserved(self):
        value = "我 在 New York 开 会 。"
        self.assertEqual(normalize_ocr_spacing(value), "我在 New York 开会。")
        result = parse_voice_transcript(page(line("Meet at 5 pm"), line("明 天 去 New York", y=50)))
        self.assertEqual(result["text"], "Meet at 5 pm\n明天去 New York")

    def test_pending_refuses_partial_text(self):
        for status in ("正 在 转 文 字…", "转换中...", "正在转换，请稍候"):
            result = parse_voice_transcript(page(line("已出部分正文"), line(status, y=50)))
            self.assertEqual(result["reason"], "pending")
            self.assertEqual(result["text"], "")

    def test_failed_refuses_partial_text(self):
        for status in ("转 文 字 失 败", "转换失败，请稍后再试", "未识别到文字"):
            result = parse_voice_transcript(page(line("已出部分正文"), line(status, y=50)))
            self.assertEqual(result["reason"], "failed")
            self.assertEqual(result["text"], "")

    def test_actual_speech_mentioning_failure_not_discarded(self):
        text = "刚刚转文字失败了，所以我重新说一遍，电脑明天下午取。"
        result = parse_voice_transcript(page(line(text, width=360)))
        self.assertEqual(result["status"], "ready")
        self.assertEqual(result["text"], text)

    def test_placeholder_and_control_not_speech(self):
        for text in ('语音12"秒', "转文字", "播放语音", "12秒", "[语音]"):
            result = parse_voice_transcript(page(line(text)))
            self.assertNotEqual(result["status"], "ready", text)
            self.assertEqual(result["text"], "")

    def test_body_region_excludes_neighboring_messages(self):
        result = parse_voice_transcript(page(line("上方邻居", y=10), line("合 成 正 文", y=60), line("下方邻居", y=120)),
                                        body_region={"x": 0, "y": 45, "width": 250, "height": 55})
        self.assertEqual(result["text"], "合成正文")
        self.assertNotIn("邻居", result["rawOcrText"])

    def test_partial_line_and_touching_edge_need_review(self):
        result = parse_voice_transcript(page(line("不能截掉半行", y=40)),
                                        body_region={"x": 0, "y": 45, "width": 250, "height": 55})
        self.assertEqual(result["reason"], "clipped-region")
        result = parse_voice_transcript(page(line("边缘可能缺字", x=0)))
        self.assertEqual(result["reason"], "touches-region-edge")
        self.assertEqual(result["text"], "")

    def test_same_row_fragments_require_review(self):
        result = parse_voice_transcript(page(line("片段一", x=10, width=80), line("片段二", x=200, y=11, width=80)))
        self.assertEqual(result["reason"], "ambiguous-line-order")
        self.assertEqual(result["text"], "")

    def test_empty_bad_bounds_and_decode_replacement(self):
        self.assertEqual(parse_voice_transcript(page())["reason"], "empty")
        self.assertEqual(parse_voice_menu(page(line("转文字", x=-10)))["reason"], "invalid-ocr-result")
        self.assertEqual(parse_voice_transcript(page(line("合成\ufffd正文")))["reason"], "unreadable-characters")
        self.assertEqual(parse_voice_transcript(page(line("合成")), body_region={"x": 0, "y": 0, "width": 900, "height": 180})["reason"], "invalid-region")


@unittest.skipUnless(os.name == "nt", "Windows OCR integration")
class WindowsVoiceOcrTests(unittest.TestCase):
    def test_real_local_engine_to_menu_and_body_parser(self):
        from PIL import Image, ImageDraw, ImageFont
        from local_ocr import available_languages, recognize_image
        if not any(value["tag"] == "zh-Hans-CN" for value in available_languages()):
            self.skipTest("No installed Chinese OCR; no download.")
        font_path = Path("C:/Windows/Fonts/msyh.ttc")
        if not font_path.is_file():
            self.skipTest("Synthetic Chinese font unavailable.")
        with Image.new("RGB", (400, 200), "white") as image:
            draw = ImageDraw.Draw(image)
            font = ImageFont.truetype(str(font_path), 20)
            for index, text in enumerate(("复制", "语音转文字", "删除")):
                draw.text((36, 20 + 50 * index), text, font=font, fill="black")
            parsed = parse_voice_menu(recognize_image(image, scale=2))
            self.assertEqual(parsed["status"], "ready")
            self.assertEqual(parsed["label"], "语音转文字")
            self.assertGreater(parsed["bbox"]["y"], 65)
            self.assertLess(parsed["bbox"]["y"], 85)
        with Image.new("RGB", (680, 150), "white") as image:
            draw = ImageDraw.Draw(image)
            font = ImageFont.truetype(str(font_path), 28)
            draw.text((40, 20), "这是一张合成测试图片。", font=font, fill="black")
            draw.text((40, 80), "明天下午见。", font=font, fill="black")
            recognized = recognize_image(image, scale=2)
            parsed = parse_voice_transcript(recognized)
            self.assertEqual(parsed["status"], "ready")
            self.assertEqual(len(parsed["lines"]), 2)
            self.assertEqual(parsed["text"], "\n".join(normalize_ocr_spacing(line["text"]) for line in recognized["lines"]))


if __name__ == "__main__":
    unittest.main(verbosity=2)
