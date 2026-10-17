"""Synthetic label-only tests. No UI, microphone, network or real chat reads."""
import re
import unittest
from voice_transcript import VOICE_CLASS, parse_voice_transcript


ZH = re.compile(r'(?<=语音)\d+"秒(.*)$')
TW = re.compile(r'(?<=語音)\d+"秒(.*)$')
EN = re.compile(r'(?<=Audio)\d+"sec(.*)$')


def parse(label, pattern=ZH):
    return parse_voice_transcript(label, pattern, ui_class=VOICE_CLASS)


class VisibleVoiceTest(unittest.TestCase):
    def test_visible_words_are_exact_tail_and_keep_voice_provenance(self):
        result = parse('语音12"秒 明天下午我到店里拿电脑。')
        self.assertEqual(result['kind'], 'text')
        self.assertEqual(result['text'], '明天下午我到店里拿电脑。')
        self.assertEqual(result['source'], {'mediaKind':'voice', 'transcriptionStatus':'visible-text', 'rawMediaLabel':'语音12"秒', 'durationSeconds':12})

    def test_locale_patterns_and_multiline_words(self):
        for label, pattern, expected in [('語音7"秒\n明天下午見。', TW, '明天下午見。'), ('Audio8"sec\nI will arrive tomorrow.\nPlease keep the receipt.', EN, 'I will arrive tomorrow.\nPlease keep the receipt.'), ('语音3"秒\n第一行\n第二行', ZH, '第一行\n第二行')]:
            with self.subTest(locale=pattern.pattern):
                self.assertEqual(parse(label, pattern)['text'], expected)

    def test_plain_text_that_mentions_audio_is_never_reclassified(self):
        self.assertIsNone(parse_voice_transcript('语音12"秒 这只是一段文本', ZH, ui_class='mmui::ChatTextItemView'))
        self.assertIsNone(parse_voice_transcript('语音12"秒 转文字', ZH, ui_class='mmui::ChatImageItemView'))

    def test_playback_status_is_not_transcription_but_full_speech_survives(self):
        for status in ('未播放', '已播放', 'Unplayed', 'Played'):
            result = parse('语音5"秒 ' + status)
            self.assertEqual(result['kind'], 'other')
            self.assertEqual(result['text'], '')
            self.assertEqual(result['source']['transcriptionStatus'], 'not-visible')
        self.assertEqual(parse('语音5"秒\n未播放\n明天我过来拿电脑。\n已播放')['text'], '明天我过来拿电脑。')
        self.assertEqual(parse('语音5"秒 未播放你刚发的录音，晚点听。')['text'], '未播放你刚发的录音，晚点听。')

    def test_durations_buttons_and_unrecognized_labels_are_not_speech(self):
        for label in ['语音12"秒', '语音12"秒\n转文字', '语音12"秒 转为文字', '语音12"秒\n[转文字]', '语音12"秒 12秒', '语音12"秒 12"', '语音12"秒\n播放语音', '语音消息', '语音 12 秒 不能猜这是转写', '昵称\n语音12"秒 不能从未清洗整条标题读取']:
            with self.subTest(label=label):
                result = parse(label)
                self.assertEqual(result['text'], '')
                self.assertEqual(result['kind'], 'other')
                self.assertEqual(result['source']['transcriptionStatus'], 'not-visible')

    def test_pending_and_failed_are_explicit_empty_states(self):
        for suffix in ['正在转文字…', '转换中...', '正在识别', '转写中', '正在转换，请稍候']:
            result=parse('语音4"秒\n'+suffix)
            self.assertEqual((result['text'],result['source']['transcriptionStatus']), ('','pending'))
        for suffix in ['转文字失败', '转换失败', '无法识别', '未识别到文字', '语音太短', '转文字失败，点击重试', '转换失败，请稍后再试']:
            result=parse('语音4"秒\n'+suffix)
            self.assertEqual((result['text'],result['source']['transcriptionStatus']), ('','failed'))
        for label,pattern,state in [('Audio4"sec\nTranscribing...',EN,'pending'), ('Audio4"sec\nTranscription failed',EN,'failed'), ('語音4"秒\n轉文字失敗',TW,'failed')]:
            result=parse(label,pattern)
            self.assertEqual((result['text'],result['source']['transcriptionStatus']), ('',state))

    def test_real_sentence_mentioning_a_failed_conversion_is_retained(self):
        text='刚刚转文字失败了，所以我重新说一遍，电脑明天下午取。'
        self.assertEqual(parse('语音12"秒 '+text)['text'],text)

    def test_status_controls_do_not_become_extra_sentences(self):
        self.assertEqual(parse('语音3"秒\n转文字\n这是已显示的正文。\n播放')['text'],'这是已显示的正文。')
        result=parse('语音3"秒\n这是部分显示的文字\n转换中...')
        self.assertEqual((result['text'],result['source']['transcriptionStatus']), ('','pending'))

    def test_wrong_pattern_or_missing_label_fails_closed(self):
        for label,pattern in [('语音3"秒 正文',EN),(None,ZH),('语音3"秒 正文',object())]:
            self.assertEqual(parse(label,pattern)['text'],'')


if __name__ == '__main__':
    unittest.main()
