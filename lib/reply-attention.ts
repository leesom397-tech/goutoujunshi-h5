/** Observable reply behavior. No inferred read receipts, motives or invented messages. */
export type ReplyAttentionRow = {
  localId?: string; sourceId?: string; id?: string; senderRole?: string; speaker?: string;
  text: string; at?: string; timestampRaw?: string; sequence?: number; libraryId?: string;
  sourceKind?: string; kind?: string; basis?: string; source?: Record<string, unknown>;
};
export type ReplyAttentionScope = 'full-history' | 'recent-window' | 'evidence-only';
export type ReplyAttentionEvidence = { sourceId: string; libraryId?: string; at: string; text: string; role: 'self' | 'other' | 'unknown' };
export type ReplyAttentionQuestion = {
  question: ReplyAttentionEvidence; responses: ReplyAttentionEvidence[];
  status: 'answered' | 'bypassed' | 'unclear' | 'cutoff' | 'unread-context';
  label: string; reading: string; elapsedMinutes: number | null;
};
type Window = { from: string; to: string; questions: number; answered: number; bypassed: number; unclear: number; cutoff: number; unread: number; observedResponses: number };
export const REPLY_ATTENTION_RULES_VERSION = 3;
export type ReplyAttentionSummary = {
  version: 1; rulesVersion: number; scope: ReplyAttentionScope; cutoffAt: string; status: 'ready' | 'insufficient';
  messages: number; questionCount: number; headline: string; reading: string;
  questions: ReplyAttentionQuestion[]; recent: Window | null; previous: Window | null;
  comparison: { status: 'changed' | 'similar' | 'insufficient'; text: string };
  initiations: Array<{ attempts: number; messages: number; from: string; to: string; laterReply: ReplyAttentionEvidence | null; evidence: ReplyAttentionEvidence[]; reading: string }>;
  limitations: string[];
};
const DAY = 86_400_000;
const plain = (v: unknown) => typeof v === 'string' ? v.trim() : '';
const normal = (v: string) => v.replace(/[\s，。！？,.!?~～]/g, '');
function timestamp(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  const result = Date.parse(value); return Number.isFinite(result) ? result : null;
}
type Item = { row: ReplyAttentionRow; evidence: ReplyAttentionEvidence; time: number | null; order: number; opaque: boolean; conflict: boolean };
function item(row: ReplyAttentionRow, order: number): Item {
  const role = row.senderRole || row.speaker;
  const source = row.source || {};
  const at = source.timestampOrigin === 'captured-at' ? '' : plain(row.at || row.timestampRaw);
  const unavailable = row.kind === 'image' || row.kind === 'sticker' || row.kind === 'other'
    || source.mediaKind === 'voice' && source.transcriptionStatus !== 'visible-text'
    || /^\s*[\[【](?:图片|语音|视频|表情|文件)[\]】]\s*$/.test(row.text);
  return { row, order, time: source.timestampOrigin === 'captured-at' ? null : timestamp(at), opaque: unavailable, conflict: false,
    evidence: { sourceId: plain(row.sourceId || row.localId || row.id), ...(row.libraryId ? {libraryId: row.libraryId} : {}), at,
      text: plain(row.text).slice(0, 700), role: role === 'self' || role === 'other' ? role : 'unknown' } };
}
/** Deliberately excludes rhetorical/quoted questions; ambiguity is never a rejection. */
function colloquialTimeQuestion(text: string): boolean {
  // A direct spoken invitation can ask for a time without a question mark.
  // Anchor at the address/question itself: reported speech and "我不知道…"
  // are not requests directed at the other person.
  if (!/^(?:(?:对了|那|话说)[，,\s]*)?(?:(?:你|咱们|我们)[，,\s]*)?(?:啥时候|啥时|哪会儿)[，,\s]*(?:(?:你|咱们|我们)[，,\s]*)?(?:能|可以)?(?:有空|有时间|方便|来|到|去|走|出发|回来|回去|见面|见一面|见|开始|结束|下班|忙完)/u.test(text)) return false;
  // These give a conditional arrangement or leave timing open; do not turn
  // "啥时候有空再说" into an unanswered request for a concrete time.
  return !/(?:再说|再聊|再约|再看|都(?:行|可以|方便)|还(?:不|没)知道|(?:就|到时)(?:再)?(?:告诉|联系|通知)|不重要|无所谓)/u.test(text);
}
const openTimeSlot = /(?:什么时候|啥时候|啥时|哪会儿|哪天)/u;
export function isDirectReplyQuestion(value: string): boolean {
  const text = plain(value);
  if (!text || text.length > 500 || /^(?:[“「『">]|转发|引用)/.test(text) || /(?:难道|谁知道|怎么说呢|何必|又能怎样|这还用问|不是.*吗[？?]?$)/.test(text)) return false;
  if (/^(?:哈哈+|啊+|嗯+|哦+|好吧|是吧)[？?]?$/.test(text)) return false;
  return /[？?]/.test(text) || /(?:吗|么|呢)[呀啊吧]?[。！!]?$/u.test(text)
    || /(?:你|咱们|我们).{0,22}(?:能不能|可不可以|要不要|有没有|想不想|去不去|什么时候|几点|在哪|哪里|怎么样)/.test(text)
    || colloquialTimeQuestion(text);
}
function explicitAnswer(question: string, text: string): boolean {
  const q = normal(question), answer = normal(text).toLowerCase();
  if (!answer || isDirectReplyQuestion(text)) return false;
  // A yes/no acknowledgment does not fill an open time/place/choice slot.
  const openQuestion=openTimeSlot.test(q)||/(?:几[点时天]|多久|在哪|哪里|哪儿|哪个|哪种|为什么|为何|怎么|多少|什么|还是)/.test(q);
  // An explicit closed-question answer can introduce a separate explanation.
  // Require a clause boundary: “对了…” / “可以的话…” are not confirmations.
  if (!openQuestion && /^(?:yes|no|yeah|yep|nope|nah|ok|okay|sure|好的|好呀|行|可以|不可以|不行|是的|不是|是|没有|有|嗯嗯|嗯|对|不对|愿意|不愿意)[呀啊吧呢哒哦噢哈]*[\s，,。.!！；;]/i.test(text.trim())) return true;
  if (!openQuestion&&(/^(?:yes|no|yeah|yep|nope|nah|ok|okay|sure)$/.test(answer)
    || /^(?:好(?:的|呀|啊)?|行(?:啊|呀)?|可以|不可以|不行|不去|去|不来|来|不了|不用|不要|要|想|不想|是|不是|有|没有|没|有空|没空|不方便|没时间|嗯|嗯嗯|对|不对|愿意|不愿意)[呀啊吧呢哒哦噢哈]*$/.test(answer))) return true;
  const clockAnswer=/(?:[0-9一二三四五六七八九十两]+点(?:半|[0-9一二三四五六七八九十]+分?)?|\d{1,2}[:：]\d{2})/.test(answer);
  const calendarAnswer=/(?:[0-9一二三四五六七八九十两]+[号日]|周[一二三四五六日天末]|星期[一二三四五六日天]|明天|后天|今天|今晚|下周)/.test(answer);
  const timeUndecided=/(?:不知道|不确定|不清楚|没定|待定|再说|再看)/.test(answer);
  // "今天没事" gives no clock time; "可以" gives neither time nor date.
  if (/(?:几点|几时)/.test(q) && clockAnswer&&!timeUndecided) return true;
  if (openTimeSlot.test(q) && (clockAnswer||calendarAnswer)&&!timeUndecided) return true;
  if (!openQuestion&&/(?:周[一二三四五六日天]|有空|时间|一起|约|吃饭|见面)/.test(q)
    && (clockAnswer||calendarAnswer||/(?:没空|有空|没时间|不方便|可以|不行)/.test(answer))) return true;
  if (/(?:在哪|哪里|哪儿)/.test(q)
    && /^(?:(?:我|我们)?(?:现在|目前|还|已经|就)?在)?(?:家(?:里)?|公司|学校|路上|图书馆|办公室|宿舍|机场|车站|地铁站|商场)[呢呀啊]*$/.test(answer)) return true;
  if (/(?:为什么|怎么了|咋了)/.test(q) && /(?:因为|刚才|主要是|所以|没事|没什么)/.test(answer)) return true;
  if (/(?:你觉得|怎么看|怎么样)/.test(q) && /(?:我觉得|我认为|挺好|不错|不太|一般|喜欢|不喜欢)/.test(answer)) return true;
  return false;
}
const evidence = (i: Item) => i.evidence;
function windowStats(questions: ReplyAttentionQuestion[], start: number, end: number): Window {
  const items = questions.filter(q => { const at = timestamp(q.question.at); return at !== null && at >= start && at < end; });
  return { from: new Date(start).toISOString(), to: new Date(end - 1).toISOString(), questions: items.length,
    answered: items.filter(q => q.status === 'answered').length, bypassed: items.filter(q => q.status === 'bypassed').length,
    unclear: items.filter(q => q.status === 'unclear').length, cutoff: items.filter(q => q.status === 'cutoff').length,
    unread: items.filter(q => q.status === 'unread-context').length, observedResponses: items.filter(q => q.responses.length > 0).length };
}
export function computeReplyAttention(input: readonly ReplyAttentionRow[], options: {scope: ReplyAttentionScope; cutoffAt?: string}): ReplyAttentionSummary {
  const result: ReplyAttentionSummary = {version:1, rulesVersion:REPLY_ATTENTION_RULES_VERSION, scope:options.scope, cutoffAt:'', status:'insufficient', messages:0, questionCount:0,
    headline:'近期回应尚不能核对', reading:'需要连续的原始聊天，才能看清问题后发生了什么。', questions:[], recent:null, previous:null,
    comparison:{status:'insufficient',text:'尚无两个可比较的近期时间段。'}, initiations:[], limitations:[]};
  if (options.scope === 'evidence-only') { result.limitations.push('报告精选引用并非连续聊天，不能用引用间的空白判断未回复。'); return result; }
  const candidates = input.filter(row => row && typeof row.text === 'string' && row.sourceKind !== 'moments' && row.kind !== 'post' && !row.basis && !['screen-capture','video-import'].includes(String(row.source?.method)));
  const contexts = new Set(candidates.map(row => row.source?.sessionId ? JSON.stringify([row.libraryId||'',row.source.accountId,row.source.sessionId]) : row.libraryId||'').filter(Boolean));
  if (contexts.size > 1) { result.limitations.push('含多份会话，须分别核对，不能把不同人的消息接成一次回应。'); return result; }
  const unique = new Map<string, Item>();
  candidates.forEach((row, i) => {
    const next = item(row, i), key = next.evidence.sourceId || `unidentified:${i}`;
    const prior = unique.get(key);
    if (!prior) unique.set(key,next);
    else if (prior.evidence.role !== next.evidence.role || prior.evidence.at !== next.evidence.at || prior.evidence.text !== next.evidence.text) {
      if (prior.opaque && !next.opaque && prior.evidence.role === next.evidence.role && prior.evidence.at === next.evidence.at) unique.set(key,next);
      else prior.conflict = true;
    }
  });
  const items = [...unique.values()];
  const allTime = items.length > 0 && items.every(row => row.time !== null);
  const allSequence = items.length > 0 && items.every(row => Number.isInteger(row.row.sequence));
  if (allSequence) items.sort((a,b)=>a.row.sequence!-b.row.sequence! || a.order-b.order);
  else if (allTime) items.sort((a,b)=>a.time!-b.time! || a.order-b.order);
  // Caller must supply a continuous window in message order. Missing timestamps
  // do not acquire fake dates or a response duration.
  result.messages=items.length;
  const lastTime=items.reduce<number|null>((last,row)=>row.time===null?last:Math.max(last??row.time,row.time),null);
  const requestedCutoff=timestamp(options.cutoffAt), cutoff=requestedCutoff!==null&&lastTime!==null&&requestedCutoff>=lastTime?requestedCutoff:lastTime;
  result.cutoffAt=cutoff===null?'':new Date(cutoff).toISOString();
  if (!allTime) result.limitations.push('部分消息没有可靠时间；仅按保存顺序核对，不计算这些消息的等待时长。');
  if (options.scope === 'recent-window') result.limitations.push('这里只核对所展示的近期连续片段，不代表完整聊天。');
  // Linear pre-index: a long unanswered self-only tail must not rescan itself
  // for every question and stall report rendering.
  const nextOther=new Array<number>(items.length+1).fill(items.length), blockers=[0], selfQuestions=[0];
  for(let i=items.length-1;i>=0;i--)nextOther[i]=items[i].evidence.role==='other'?i:nextOther[i+1];
  for(let i=0;i<items.length;i++){
    const row=items[i],gap=allSequence&&i>0&&row.row.sequence!>items[i-1].row.sequence!+1;
    blockers.push(blockers[i]+Number(row.conflict||row.evidence.role==='unknown'||gap));
    selfQuestions.push(selfQuestions[i]+Number(row.evidence.role==='self'&&isDirectReplyQuestion(row.evidence.text)));
  }
  for (let index=0;index<items.length;index++) {
    const current=items[index];
    if(current.evidence.role!=='self'||current.opaque||current.conflict||!current.evidence.sourceId||!isDirectReplyQuestion(current.evidence.text))continue;
    const following:Item[]=[],first=nextOther[index+1];
    let last=first;
    while(last<items.length&&items[last].evidence.role==='other'&&following.length<4)following.push(items[last++]);
    const laterQuestion=selfQuestions[first]-selfQuestions[index+1]>0;
    const barrier=blockers[Math.min(last,items.length)]-blockers[index+1]>0
      || following.some(row=>row.time!==null&&current.time!==null&&row.time===current.time);
    const responses=following.map(evidence), joined=responses.map(r=>r.text).join(' ');
    const elapsed=following[0]?.time!==null&&following[0]?.time!==undefined&&current.time!==null?Math.max(0,Math.round((following[0].time-current.time)/60000)):!following.length&&current.time!==null&&cutoff!==null?Math.max(0,Math.round((cutoff-current.time)/60000)):null;
    let status:ReplyAttentionQuestion['status']='unclear',label='有后续消息，答案不明确',reading='对方随后发了消息，但未识别出对这句问题的明确答复。展开原话核对，不能直接等同于拒绝。';
    if(!following.length) { status='cutoff'; label='材料到这里，后续未知'; reading='保存的聊天在你的提问之后结束，无法确认对方之后是否回复。'; }
    else if(barrier||following.some(row=>row.opaque)) {status='unread-context';label='后续含未读内容，暂不能判断';reading='问题后存在未转写语音、图片或缺失上下文，不能把不可读内容当作没有回答。';}
    else if(laterQuestion){reading='你在对方回复前又提出了新问题，暂不能确定后续回复对应哪一句。';}
    else if(/(?:先不(?:说|聊|谈|讨论)这个|不(?:想|要)?(?:回答|聊|谈|说)这个|换个话题|跳过这个|别问了|不告诉你|不想说|不想回答)/.test(joined)) {status='bypassed';label='对方明确跳过了问题';reading='对方的原话明确表示不回答或换话题；这次问题没有得到答复，是需要关注的回应方式。';}
    else if(explicitAnswer(current.evidence.text,joined)){status='answered';label='有明确回应';reading='后续原话包含可以对应这次提问的答复；是否兑现还要看之后的行动。';}
    else if(responses.every(r=>/^(?:哈+|呵+|嘿+|笑死|[😂🤣😅🤭😊🙂]+|\[.*?\])+$/.test(normal(r.text)))) {label='只接了话，没给出答案';reading='后续只有笑声或表情文字，这次提问尚未得到明确答案。不要把接话本身算成安排已经谈妥。';}
    result.questions.push({question:evidence(current),responses,status,label,reading,elapsedMinutes:elapsed});
  }
  result.questionCount=result.questions.length;
  // Separate episodes inside an uninterrupted self-only stretch. Sending three
  // bubbles at once is one attempt, never "three unanswered initiations".
  for(let start=0;start<items.length;) {
    if(items[start].evidence.role!=='self'){start++;continue;}
    let end=start+1;while(end<items.length&&items[end].evidence.role==='self')end++;
    const run=items.slice(start,end), attempts=[run[0]];
    for(let i=1;i<run.length;i++)if(run[i].time!==null&&run[i-1].time!==null&&run[i].time!-run[i-1].time!>=6*3_600_000)attempts.push(run[i]);
    const sequenceGap=allSequence&&run.some((row,i)=>i>0&&row.row.sequence!>run[i-1].row.sequence!+1);
    if(attempts.length>=2&&!sequenceGap&&!run.some(row=>row.conflict)&&run.every(row=>row.time!==null)) {
      const later=items[end]?.evidence.role==='other'?items[end]:null;
      result.initiations.push({attempts:attempts.length,messages:run.length,from:run[0].evidence.at,to:run.at(-1)!.evidence.at,
        laterReply:later?evidence(later):null,evidence:attempts.map(evidence),reading:later?`你跨 ${attempts.length} 轮发起后，材料中才出现对方的新消息。期间联系由你维持。`:`材料末尾是你跨 ${attempts.length} 轮连续发起，未见后续对方消息；材料截止后的回应未知。`});
    }
    start=end;
  }
  if(cutoff!==null) {
    const end=cutoff+1;
    result.recent=windowStats(result.questions,end-14*DAY,end);result.previous=windowStats(result.questions,end-28*DAY,end-14*DAY);
    const a=result.recent,b=result.previous;
    if(a.questions>=3&&b.questions>=3&&a.cutoff===0&&b.cutoff===0&&a.unread===0&&b.unread===0&&a.unclear===0&&b.unclear===0) {
      const delta=a.answered/a.questions-b.answered/b.questions;
      result.comparison={status:Math.abs(delta)>=0.25?'changed':'similar',text:`最近 14 天 ${a.questions} 次直接提问中，${a.answered} 次见明确答复；此前 14 天为 ${b.answered}/${b.questions}。${delta<=-0.25?'近期问题被明确接住的比例下降，不能用早期的热络抵消。':delta>=0.25?'近期明确答复增多。':'两段材料中的明确答复比例接近。'}`};
    }else result.comparison={status:'insufficient',text:`最近 14 天有 ${a.questions} 次直接提问，此前 14 天 ${b.questions} 次${a.cutoff||b.cutoff?'；末尾仍有后续未知的问题':a.unread||b.unread?'；存在不可读的后续消息':a.unclear||b.unclear?'；有回复仍需结合原话核对':''}，暂不计算变化比例。`};
  }
  const last=result.questions.at(-1),latestRun=result.initiations.at(-1);
  if(last||latestRun){
    result.status='ready';
    if(latestRun&&!latestRun.laterReply&&last?.status==='cutoff'){
      result.headline=`最近 ${latestRun.attempts} 轮联系，材料中都未见对方回应`;
      result.reading='这段材料里，近期联系持续由你维持，问题也没有出现可核对的后续答复。当前不适合继续增加邀约或投入；先给对方主动接续的空间。这里不能确认已读状态，也不能仅凭未回应确定对方的动机。';
    }else{result.headline=last?last.label:'联系最近主要由你发起';result.reading=last?last.reading:latestRun!.reading;}
  }
  else if(items.length){result.reading='这段连续材料中没有识别到需要单独核对的直接提问或跨轮连续发起。';}
  // Keep recent questions prominent; full counts remain above. Bound the saved
  // summary instead of duplicating thousands of private messages into reports.
  result.questions=result.questions.slice(-8).reverse();result.initiations=result.initiations.slice(-3).reverse();
  return result;
}

export function replyAttentionPrompt(summary: ReplyAttentionSummary): string {
  if(summary.status!=='ready')return '';
  return JSON.stringify({scope:summary.scope,cutoffAt:summary.cutoffAt,headline:summary.headline,reading:summary.reading,questions:summary.questions.slice(0,4),initiations:summary.initiations,comparison:summary.comparison,
    rule:'优先解释近期具体回应，不用长期平均掩盖近期变化。cutoff只是材料结束，不能写成真实未回、已读不回或拒绝；bypassed有明确跳过原话，unclear只说明答案不明确。等待时长截至输入材料，不截至现在。'});
}
