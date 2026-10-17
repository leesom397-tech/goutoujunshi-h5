import unittest
from types import SimpleNamespace
from native_transcript import copy_transcript
from voice_ocr import parse_transcript_copy_menu


class Clipboard:
    def __init__(self):
        self.seq=5;self.pid=12;self.value='这是一段完整的虚构语音测试文字。';self.reads=0
    def sequence(self):return self.seq
    def owner(self):return self.pid
    def text(self):self.reads+=1;return self.value


class NativeTranscriptTests(unittest.TestCase):
    def setUp(self):
        self.clip=Clipboard();self.now=0;self.checks=0
    def verify(self):self.checks+=1
    def sleep(self,t):self.now+=t
    def run_copy(self,action=None,**kwargs):
        def convert(body):
            self.assertEqual(self.clip.reads,0,'Existing clipboard must never be read')
            if action:return action()
            self.clip.seq+=1
            return {'action':'copy-requested'}
        options=dict(process_id=12,verify=self.verify,visible_text='这是一段完整的虚构语音测试文字。',
            clipboard=self.clip,clock=lambda:self.now,sleep=self.sleep)
        options.update(kwargs)
        return copy_transcript(SimpleNamespace(convert=convert),{'x':1,'y':2,'width':100,'height':40},**options)
    def test_native_text_is_preserved_verbatim(self):
        result=self.run_copy()
        self.assertEqual(result['text'],self.clip.value)
        self.assertEqual(result['source'],'wechat-native-transcript-copy')
        self.assertEqual(self.clip.reads,1)
        self.assertGreaterEqual(self.checks,3)
    def test_old_clipboard_never_read_on_timeout(self):
        r=self.run_copy(action=lambda:{'action':'copy-requested'})
        self.assertEqual(r['reason'],'native-copy-timeout')
        self.assertEqual(self.clip.reads,0)
    def test_foreign_clipboard_update_never_read(self):
        self.clip.pid=99
        self.assertEqual(self.run_copy()['reason'],'clipboard-owner-changed')
        self.assertEqual(self.clip.reads,0)
    def test_change_during_read_rejects_text(self):
        def changed():self.clip.seq+=1;return self.clip.value
        self.clip.text=changed
        self.assertEqual(self.run_copy()['reason'],'clipboard-changed-during-read')
    def test_wrong_menu_does_not_read_clipboard(self):
        self.assertEqual(self.run_copy(action=lambda:{'reason':'wrong-menu'})['reason'],'wrong-menu')
        self.assertEqual(self.clip.reads,0)
    def test_unrelated_copied_words_rejected(self):
        self.clip.value='这是其他地方完全不相关的文字，不能混进本条语音。'
        self.assertEqual(self.run_copy()['reason'],'native-text-does-not-match-visible-body')
    def test_ocr_mistake_does_not_modify_native_words(self):
        r=self.run_copy(visible_text='这是一段完整的虚构语音测式文字。')
        self.assertEqual(r['status'],'ready')
        self.assertEqual(r['text'],self.clip.value)
    def test_loading_status_not_a_transcript(self):
        self.clip.value='正在转换'
        self.assertEqual(self.run_copy()['reason'],'native-text-unavailable')
    def test_verification_failure_prevents_read(self):
        def fail():raise RuntimeError('changed source')
        with self.assertRaises(RuntimeError):self.run_copy(verify=fail)
        self.assertEqual(self.clip.reads,0)


class CopyMenuTests(unittest.TestCase):
    def menu(self,labels):
        return {'width':230,'height':320,'lines':[{'text':t,'bbox':{'x':30,'y':20+i*40,'width':140,'height':20}} for i,t in enumerate(labels)]}
    def test_confirmed_transcript_menu(self):
        for labels in (['复制','翻译','收起文字','收藏'],['复制','放大阅读','翻译','收藏']):
            self.assertEqual(parse_transcript_copy_menu(self.menu(labels))['status'],'ready')
    def test_regular_text_or_ambiguous_copy_rejected(self):
        for labels in (['复制','收藏','删除'],['复制','放大阅读'],['复制','复制','放大阅读','翻译'],['不复制','放大阅读','翻译']):
            self.assertEqual(parse_transcript_copy_menu(self.menu(labels))['status'],'needs-review')


if __name__=='__main__':unittest.main()
