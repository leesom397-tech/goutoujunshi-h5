"""Parse an already-visible Weixin voice transcript; never operates UI or transcribes audio.

The caller must provide the selected message's actual UI class and body label
after removing its sender and trailing timestamp. The three headers below match
pywechat127 1.9.8 / pyweixin.Uielements.Regex_Patterns.Audio_pattern exactly.
Only the tail after that voice-duration header can become readable text.
"""
import re


VOICE_CLASS = "mmui::ChatVoiceItemView"
_HEAD = re.compile(r'^(?:(?:语音|語音)\d{1,5}"秒|Audio\d{1,5}"sec)')
_PATTERNS = (
    re.compile(r'(?<=语音)\d+"秒(.*)$', re.S),
    re.compile(r'(?<=語音)\d+"秒(.*)$', re.S),
    re.compile(r'(?<=Audio)\d+"sec(.*)$', re.S),
)
_CONTROLS = frozenset(("转文字", "转为文字", "语音转文字", "轉文字", "轉為文字", "語音轉文字", "convert to text", "transcribe", "translate", "播放", "暂停", "播放语音", "播放語音", "play", "pause", "未播放", "已播放", "unplayed", "played"))
_PENDING = re.compile(r'^(?:正在)?(?:转文字|转为文字|转写|转换|转换文字|识别|轉文字|轉為文字|轉寫|轉換|轉換文字|識別)(?:中|中请稍候|中請稍候)?$|^(?:transcribing|converting(?: to text)?|recognizing)(?: in progress)?$', re.I)
_FAILED = re.compile(r'^(?:(?:语音|語音)?(?:转文字|转为文字|转换|转写|识别|轉文字|轉為文字|轉換|轉寫|識別)(?:失败|失敗)|(?:无法|未能|無法)(?:转文字|转为文字|转换|转写|识别|轉文字|轉為文字|轉換|轉寫|識別)|(?:未识别到|未識別到|没有识别到|沒有識別到)(?:语音|語音|文字|内容|內容)|(?:语音|語音)(?:太短|无法识别|無法識別)|(?:转文字|轉文字)(?:暂不可用|暫不可用))(?:(?:请|請)(?:稍后|稍後|重新)(?:再试|再試|重试|重試))?$|^(?:transcription failed|conversion failed|unable to transcribe|unable to convert(?: to text)?|no speech detected|could not transcribe)$', re.I)
_DURATION = re.compile(r'^\d{1,5}\s*(?:["″]?\s*(?:秒|sec(?:onds?)?|s)|["″])$', re.I)


def _ui_word(value):
    return re.sub(r'\s+', ' ', value).strip(' \t\r\n[]【】()（）.:：。!！…').casefold()


def _status(value):
    word = _ui_word(value)
    if not word or word in _CONTROLS or _DURATION.fullmatch(word):
        return "not-visible"
    status_word = re.sub(r'(?:[,，。:：;；\s]+)?(?:请稍候|請稍候|请稍后(?:重试|再试)|請稍後(?:重試|再試)|请重试|請重試|点击重试|點擊重試|please wait|please try again|try again|retry)$', '', word, flags=re.I).rstrip(' ,，。:：;；')
    if _FAILED.fullmatch(status_word):
        return "failed"
    if _PENDING.fullmatch(status_word) or word in ('请稍候', '請稍候', 'please wait'):
        return "pending"
    return None


def parse_voice_transcript(raw_label, audio_pattern=None, *, ui_class):
    """Return a voice row patch, or None for a non-voice message.

    Non-visible/pending/failed results deliberately have an empty ``text``.
    The adapter may separately retain an ``[语音]`` placeholder as kind=other.
    No title, duration, action-button label or failed conversion is speech.
    """
    if ui_class != VOICE_CLASS:
        return None
    source = {"mediaKind": "voice", "transcriptionStatus": "not-visible"}
    result = {"kind": "other", "text": "", "source": source}
    if not isinstance(raw_label, str):
        return result
    body = raw_label.strip()
    head = _HEAD.match(body)
    if not head:
        source["transcriptionStatus"] = _status(body) or "not-visible"
        return result
    source["rawMediaLabel"] = head.group(0)
    source["durationSeconds"] = int(re.search(r'\d+', head.group(0)).group(0))
    patterns = _PATTERNS
    if audio_pattern is not None:
        # Preserve the fixed library pattern, enabling multiline visible words.
        try:
            patterns = (re.compile(audio_pattern.pattern, audio_pattern.flags | re.S),)
        except (AttributeError, TypeError, re.error):
            return result
    match = next((found for pattern in patterns if (found := pattern.search(body)) is not None), None)
    if match is None or not match.lastindex:
        return result
    tail = match.group(1).strip()
    state = _status(tail)
    if state:
        source["transcriptionStatus"] = state
        return result
    lines = tail.splitlines()
    states = [_status(line) for line in lines]
    # An in-progress/failed result is not a complete transcript even if it has
    # partial visible words. Do not turn those labels or partial words into speech.
    if "failed" in states or "pending" in states:
        source["transcriptionStatus"] = "failed" if "failed" in states else "pending"
        return result
    while lines and _status(lines[0]) == "not-visible":
        lines.pop(0)
    while lines and _status(lines[-1]) == "not-visible":
        lines.pop()
    text = "\n".join(lines).strip()
    if not text or _status(text):
        return result
    source["transcriptionStatus"] = "visible-text"
    return {"kind": "text", "text": text, "source": source}
