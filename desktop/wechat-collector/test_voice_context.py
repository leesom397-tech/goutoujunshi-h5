import unittest
from voice_context import text_anchors, match_voice, match_voice_sequence

def text(id, value):
    return {'localId':id,'kind':'text','text':value}
def voice(id):
    return {'localId':id,'kind':'other','senderRole':'self','text':'语音6"秒','source':{'mediaKind':'voice'}}
def line(text,y):
    return {'text':text,'bbox':{'x':20,'y':y,'width':100,'height':10}}

class ContextTests(unittest.TestCase):
    def setUp(self):
        self.rows=[text('a','我们明天早上在哪里见面'),voice('v'),text('b','好的我会提前十分钟到达')]
        self.lines=[line('我们 明天早上 在哪里见面',10),line('好的我会提前十分钟到达',90)]
        self.c={'bubbleBbox':{'y':40,'height':20},'side':'self','durationSeconds':6}
    def test_unique_two_sided(self):
        result=match_voice(self.rows,text_anchors(self.rows,self.lines),self.c)
        self.assertEqual(result['record']['localId'],'v')
        self.assertEqual(result['matchedAnchors'],['a','b'])
    def test_repeated_duration_rejected(self):
        self.rows.insert(2,voice('v2'))
        self.assertIsNone(match_voice(self.rows,text_anchors(self.rows,self.lines),self.c))
    def test_one_anchor_rejected(self):
        self.assertIsNone(match_voice(self.rows,text_anchors(self.rows,self.lines[:1]),self.c))
    def test_repeated_text_rejected(self):
        self.rows.append(text('repeat',self.rows[0]['text']))
        self.assertIsNone(match_voice(self.rows,text_anchors(self.rows,self.lines),self.c))
    def test_wrong_side_rejected(self):
        self.c['side']='other'
        self.assertIsNone(match_voice(self.rows,text_anchors(self.rows,self.lines),self.c))
    def test_partial_text_rejected(self):
        self.lines[0]['text']='明天早上在哪里见面'
        self.assertIsNone(match_voice(self.rows,text_anchors(self.rows,self.lines),self.c))
    def test_unique_short_anchor_requires_both_sides(self):
        self.rows[0]['text']='要和他谈事';self.lines[0]['text']='要 和 他 谈 事'
        self.assertEqual(match_voice(self.rows,text_anchors(self.rows,self.lines),self.c)['record']['localId'],'v')
        self.assertIsNone(match_voice(self.rows,text_anchors(self.rows,self.lines[:1]),self.c))
    def test_other_duration_in_interval_cannot_be_filtered_out(self):
        other=voice('different');other['source']['durationSeconds']=9
        self.rows.insert(2,other)
        self.assertIsNone(match_voice(self.rows,text_anchors(self.rows,self.lines),self.c))
    def test_unknown_duration_cannot_bind(self):
        self.c.pop('durationSeconds')
        self.assertIsNone(match_voice(self.rows,text_anchors(self.rows,self.lines),self.c))


class VoiceSequenceTests(unittest.TestCase):
    def setUp(self):
        self.rows=[text('a','我们明天早上在哪里见面'),voice('v1'),voice('v2'),text('b','好的我会提前十分钟到达')]
        self.anchors=text_anchors(self.rows,[line(self.rows[0]['text'],10),line(self.rows[-1]['text'],130)])
        self.candidates=[self.candidate(40),self.candidate(80)]
    def candidate(self,y,seconds=6,side='self'):
        return {'bubbleBbox':{'x':40,'y':y,'width':100,'height':20},'side':side,'durationSeconds':seconds}
    def match(self):
        return match_voice_sequence(self.rows,self.anchors,self.candidates)
    def test_same_duration_consecutive_voices_bind_by_complete_order(self):
        result=self.match()
        self.assertEqual([m['record']['localId'] for m in result],['v1','v2'])
        self.assertIs(result[0]['candidate'],self.candidates[0])
        self.assertEqual([m['matchedAnchors'] for m in result],[['a','b'],['a','b']])
    def test_unique_four_character_anchor_supports_complete_sequence(self):
        self.rows[0]['text']='是不是啊'
        self.anchors=text_anchors(self.rows,[line('是不是啊',10),line(self.rows[-1]['text'],130)])
        self.assertEqual([m['record']['localId'] for m in self.match()],['v1','v2'])
    def test_repeated_four_character_anchor_is_rejected(self):
        self.rows[0]['text']='是不是啊'
        self.rows.append(text('duplicate','是不是啊'))
        self.anchors=text_anchors(self.rows,[line('是不是啊',10),line(self.rows[3]['text'],130)])
        self.assertEqual(self.match(),[])
    def test_duplicate_visible_four_character_anchor_is_rejected(self):
        self.rows[0]['text']='是不是啊'
        self.anchors=text_anchors(self.rows,[line('是不是啊',10),line('是不是啊',25),line(self.rows[-1]['text'],130)])
        self.assertEqual(self.match(),[])
    def test_candidate_input_order_is_sorted_by_visible_position(self):
        self.candidates.reverse()
        self.assertEqual([m['record']['localId'] for m in self.match()],['v1','v2'])
    def test_missing_voice_rejects_entire_interval(self):
        self.candidates.pop()
        self.assertEqual(self.match(),[])
    def test_extra_voice_rejects_entire_interval(self):
        self.candidates.append(self.candidate(105))
        self.assertEqual(self.match(),[])
    def test_duration_conflict_rejects_entire_interval(self):
        self.candidates[1]['durationSeconds']=9
        self.assertEqual(self.match(),[])
    def test_swapped_distinct_durations_rejects_entire_interval(self):
        self.rows[2]['source']['durationSeconds']=9
        self.candidates[0]['durationSeconds']=9
        self.assertEqual(self.match(),[])
    def test_mixed_sides_require_exact_correspondence(self):
        self.rows[2]['senderRole']='other'
        self.assertEqual(self.match(),[])
        self.candidates[1]['side']='other'
        self.assertEqual(len(self.match()),2)
    def test_unreadable_text_inside_interval_is_not_silently_ignored(self):
        self.rows.insert(2,text('hidden','中间还有一段不能忽略的文字'))
        self.anchors[-1]['index']+=1
        self.assertEqual(self.match(),[])
    def test_overlapping_candidate_rejects_interval(self):
        self.candidates[1]['bubbleBbox']['y']=55
        self.assertEqual(self.match(),[])
    def test_candidate_clipped_by_anchor_rejects_interval(self):
        self.candidates[1]['bubbleBbox']['y']=120
        self.assertEqual(self.match(),[])
    def test_marked_clipped_candidate_rejects_interval(self):
        self.candidates[1]['clipped']=True
        self.assertEqual(self.match(),[])
    def test_missing_second_anchor_rejects_interval(self):
        self.anchors.pop()
        self.assertEqual(self.match(),[])
    def test_out_of_order_anchors_reject(self):
        self.anchors[0]['top']=150;self.anchors[0]['bottom']=160
        self.assertEqual(self.match(),[])
    def test_duplicate_anchor_rejects(self):
        self.anchors.append(dict(self.anchors[0]))
        self.assertEqual(self.match(),[])
    def test_unknown_or_invalid_duration_rejects(self):
        for value in (None,True,0,61,'6'):
            with self.subTest(value=value):
                self.candidates[1]['durationSeconds']=value
                self.assertEqual(self.match(),[])
    def test_invalid_geometry_rejects(self):
        for value in (float('nan'),float('inf'),None):
            with self.subTest(value=value):
                self.candidates[1]['bubbleBbox']['y']=value
                self.assertEqual(self.match(),[])
    def test_separate_complete_interval_survives_an_incomplete_interval(self):
        self.rows.extend([voice('v3'),voice('v4'),text('c','结束后我们再商量下一步安排')])
        self.anchors.append({'index':6,'top':240,'bottom':250,'localId':'c'})
        self.candidates.append(self.candidate(180))
        self.assertEqual([m['record']['localId'] for m in self.match()],['v1','v2'])
    def test_no_inputs_are_mutated(self):
        import copy
        before=copy.deepcopy((self.rows,self.anchors,self.candidates))
        self.match()
        self.assertEqual(before,(self.rows,self.anchors,self.candidates))
    def test_explicit_image_between_voices_preserves_order(self):
        self.rows.insert(2,{'localId':'picture','kind':'image','source':{'uiClass':'mmui::ChatBubbleReferItemView'}})
        self.anchors[-1]['index']+=1
        self.assertEqual([m['record']['localId'] for m in self.match()],['v1','v2'])
    def test_unknown_attachment_between_voices_is_rejected(self):
        self.rows.insert(2,{'localId':'unknown','kind':'image','source':{'uiClass':'unknown'}})
        self.anchors[-1]['index']+=1
        self.assertEqual(self.match(),[])

if __name__=='__main__':unittest.main()
