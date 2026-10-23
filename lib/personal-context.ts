/** Shared, deterministic personalization. No model call and no profile writes. */
export type PersonalEvidence = {
  id: string; side: "self" | "other";
  source: "self-profile" | "subject-profile" | "chat" | "moments" | "social-profile";
  label: string; quote: string; field?: string; reportId?: string; lineId?: string;
  sourceId?: string; subjectId?: string; recordedAt?: number;
  basis?: "statement" | "observation";
};
export type PersonalInsight = {
  id: string; title: string; reading: string; kind: "supported" | "inference";
  evidenceIds: string[]; alternative?: string; action: string; reply?: string;
};
export type PersonalConnection = {
  version: 1; status: "ready" | "limited" | "insufficient" | "self";
  summary: string; commonPoints: PersonalInsight[]; differences: PersonalInsight[];
  entryPoints: PersonalInsight[]; missing: string[]; sources: PersonalEvidence[];
};
type AnyRecord = Record<string, any>;
const object = (value: unknown): AnyRecord => value && typeof value === "object" && !Array.isArray(value) ? value as AnyRecord : {};
const list = (value: unknown): any[] => Array.isArray(value) ? value : [];
const text = (value: unknown, limit = 500) => typeof value === "string" ? value.trim().replace(/1[3-9]\d{9}/g, "[手机号]").replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[邮箱]").slice(0, limit) : "";
const normalized = (value: string) => value.replace(/[\s，。！？、：；“”‘’"'.,!?:;]/g, "").toLocaleLowerCase();
const sourceTypes = new Set(["self-profile", "subject-profile", "chat", "moments", "social-profile"]);
function stableId(value: string) { let hash = 2166136261; for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619); return (hash >>> 0).toString(36); }

/** Repeated screenshots and cross-source copies do not become extra evidence. */
export function uniquePersonalEvidence(values: unknown[]): PersonalEvidence[] {
  const seen = new Set<string>();
  return values.flatMap(value => {
    const item = object(value), quote = text(item.quote), source = text(item.source);
    if (!quote || !["self", "other"].includes(item.side) || !sourceTypes.has(source)) return [];
    // Media annotations and past model conclusions are not personal statements.
    if (/^【(?:表情包|图片|照片|未识别)|^\[(?:图片|照片|表情|动画|视频|语音)/.test(quote)) return [];
    const key = item.side + ":" + normalized(quote);
    if (seen.has(key)) return []; seen.add(key);
    return [{ id: text(item.id, 160) || "personal-" + stableId(key), side: item.side,
      source: source as PersonalEvidence["source"], label: text(item.label, 160) || (item.side === "self" ? "你的明确表达" : "对方的明确表达"), quote,
      ...(text(item.field, 80) ? { field: text(item.field, 80) } : {}),
      ...(text(item.reportId, 100) ? { reportId: text(item.reportId, 100) } : {}),
      ...(text(item.lineId, 160) ? { lineId: text(item.lineId, 160) } : {}),
      ...(text(item.sourceId, 180) ? { sourceId: text(item.sourceId, 180) } : {}),
      ...(text(item.subjectId, 100) ? { subjectId: text(item.subjectId, 100) } : {}),
      ...(typeof item.recordedAt === "number" && Number.isFinite(item.recordedAt) ? { recordedAt: item.recordedAt } : {}),
      basis: item.basis === "observation" ? "observation" : "statement" } as PersonalEvidence];
  }).sort((a,b)=>Number(PERSONAL_TOPICS.some(topic=>topicStance(b,topic.match)!=="unknown"))-Number(PERSONAL_TOPICS.some(topic=>topicStance(a,topic.match)!=="unknown"))).slice(0, 160);
}

/** Only raw, attributed text. Never use summaries, hypotheses, personality tags or photos. */
export function reportPersonalEvidence(input: unknown, options: { reportId?: string; subjectId?: string; recordedAt?: number } = {}): PersonalEvidence[] {
  const report = object(input), reportId = text(options.reportId || report.reportId || report.id, 100), subjectId = text(options.subjectId || report.subjectId, 100);
  const meta = { ...(reportId ? { reportId } : {}), ...(subjectId ? { subjectId } : {}), ...(options.recordedAt ? { recordedAt: options.recordedAt } : {}) };
  const evidence: PersonalEvidence[] = [];
  // Full-history reports keep selected, attributed profile evidence separately
  // from the new-upload-only sentence annotations.
  if (report.analysisScope === "fullHistory") evidence.push(...uniquePersonalEvidence(list(report.profileEvidence)).filter(item => item.source === "chat" && (!item.subjectId || item.subjectId === subjectId)));
  for (const [index, item] of list(report.lines).entries()) {
    const line = object(item);
    // The parser's canonical mapping is self/other. Unknown, raw left/right or an
    // unverified "user" role must never be guessed to mean the account owner.
    if (line.speaker !== "self" && line.speaker !== "other") continue;
    const quote = text(line.text);
    if (!quote || line.kind && line.kind !== "text" || /^【表情包/.test(quote)) continue;
    evidence.push({ ...meta, id: `chat:${reportId}:${text(line.id, 160) || index}`, side: line.speaker, source: "chat", label: `${reportId ? "聊天原话 · " : ""}第 ${index + 1} 句 · ${line.speaker === "self" ? "我" : "对方"}`, quote, lineId: text(line.id, 160), ...(text(line.sourceId, 180) ? { sourceId: text(line.sourceId, 180) } : {}), basis: "statement" });
  }
  // Older full reports may have omitted these lines from profileEvidence.
  // Reuse only attributed original excerpts, never the model's finding claim.
  const semantic=object(report.semanticHistory||object(report.relationshipDiagnosis).semanticHistory);
  for(const finding of list(semantic.findings))for(const item of list(object(finding).evidence)){
    const source=object(item),quote=text(source.quote),sourceId=text(source.sourceId,180);
    if(!quote||!sourceId||!["self","other"].includes(source.senderRole)||source.basis==="visual")continue;
    const moments=source.sourceKind==="moments";
    if(!moments&&source.sourceKind&&source.sourceKind!=="chat")continue;
    if(source.basis&&source.basis!=="caption"||!moments&&source.basis)continue;
    evidence.push({...meta,id:`semantic:${reportId}:${source.libraryId||""}:${sourceId}`,side:source.senderRole,source:moments?"moments":"chat",label:`${text(source.at,50)||"已保存原话"} · ${source.senderRole==="self"?"你":"对方"}`,quote,sourceId,basis:"statement"});
  }
  // targetSelf is set only by the confirmed material ownership, never by a model
  // assigning a post's author to "self" (which means that post's own author).
  const side: PersonalEvidence["side"] = report.targetSelf === true ? "self" : "other";
  for (const [index, item] of list(report.profileBasics).entries()) {
    const row = object(item), value = text(row.value), quote = text(row.evidence);
    if (!value || !quote) continue;
    evidence.push({ ...meta, id: `profile:${reportId}:${text(row.field, 60) || index}`, side, source: "social-profile", label: quote, quote: value, field: text(row.field, 60), basis: "statement" });
  }
  const moments = object(report.moments || (report.posts ? report : null));
  for (const [index, item] of list(moments.posts).entries()) {
    const post = object(item), content = text(post.content), label = text(post.evidence, 160);
    if (!content || !label) continue;
    // A post's content can contain a model's photo description. Prefer an exact
    // quoted caption; unquoted scene descriptions remain observations, never goals.
    const quoted = [...(label + " " + content).matchAll(/[“「]([^”」]{2,160})[”」]/g)].map(match => match[1]);
    const quote = quoted[0] || content;
    const observation = /(?:转发|引用|他说|她说|朋友说|同事说)/.test(content) || !quoted.length && /(?:照片|配图|画面|可见|截图|图中|九宫格|展示|疑似|看起来|似乎)/.test(content);
    evidence.push({ ...meta, id: `moments:${reportId}:${text(post.sourceId, 180) || index}`, side, source: "moments", label: `${label}${text(post.date, 32) ? " · " + text(post.date, 32) : ""}`, quote, ...(text(post.sourceId, 180) ? { sourceId: text(post.sourceId, 180) } : {}), basis: observation ? "observation" : "statement" });
  }
  for (const entry of list(report.entries)) evidence.push(...reportPersonalEvidence(entry, { subjectId: subjectId || undefined, recordedAt: options.recordedAt }));
  return uniquePersonalEvidence(evidence);
}

export const PERSONAL_TOPICS = [
  { id: "photography", label: "摄影与拍照", match: /摄影|拍照|拍摄|胶片|相机|街拍/ },
  { id: "art", label: "艺术与审美", match: /看展|画展|展览|这场展|艺术|美术|设计|审美|博物馆|美术馆/ },
  { id: "career", label: "事业与成长", match: /职业规划|事业|创业|工作室|做项目|做产品|工作目标|提升自己|学习新技能/ },
  { id: "technology", label: "产品与开发", match: /写代码|编程|开发软件|做产品|写程序|AI工具|代码|开发.{0,4}(?:程序|软件)/i },
  { id: "travel", label: "旅行", match: /旅行|旅游|自驾|出游|穷游/ },
  { id: "outdoors", label: "户外活动", match: /徒步|登山|爬山|露营|潜水|滑雪|骑行|户外|散步/ },
  { id: "exercise", label: "运动", match: /跑步|健身|游泳|瑜伽|网球|篮球|羽毛球|攀岩|运动/ },
  { id: "music", label: "音乐", match: /音乐|演唱会|音乐节|乐队|吉他|钢琴|唱歌/ },
  { id: "reading", label: "阅读", match: /读书|阅读|小说|书店|文学|读完/ },
  { id: "film", label: "电影与剧集", match: /电影|看剧|话剧|戏剧|纪录片/ },
  { id: "food", label: "美食与做饭", match: /美食|做饭|烘焙|下厨|做菜|甜品|探店/ },
  { id: "coffee", label: "咖啡与茶", match: /咖啡|喝茶|茶馆|手冲/ },
  { id: "pets", label: "宠物话题", match: /养猫|养狗|我家.{0,3}[猫狗]|我的.{0,3}[猫狗]|宠物|猫咪|狗狗|猫窝|猫粮|撸猫|遛狗/ },
  { id: "games", label: "游戏", match: /游戏|桌游|剧本杀/ },
  { id: "craft", label: "手作", match: /手工|手作|陶艺|插花|拼模型|乐高/ },
  { id: "quiet", label: "安静与独处", match: /独处|安静|自己的空间|个人空间|独立空间/ },
  { id: "honesty", label: "真诚与沟通", match: /真诚|诚实|坦诚|坦率沟通|直接表达|好好沟通/ },
  { id: "growth", label: "共同成长", match: /共同成长|一起成长|共同进步|一起进步|互相支持/ },
  { id: "planning", label: "提前安排", match: /提前(?:约|安排|说|告诉|计划)|约好时间|确定时间/ },
] as const;

/** Scan the whole archive for explicit personal statements. Keep a bounded set
 * per topic and speaker, rather than taking the latest N messages as a profile. */
export function capturePersonalEvidence(rows: readonly {localId: string; senderRole: string; text: string; at: string}[], subjectId?: string | null, reportId?: string): PersonalEvidence[] {
  const buckets = new Map<string, PersonalEvidence[]>();
  for (const row of rows) {
    if (!["self", "other"].includes(row.senderRole)) continue;
    const source:PersonalEvidence={id:`archive-profile:${row.localId}`,side:row.senderRole as "self"|"other",source:"chat",label:`${row.at||"日期未知"} · ${row.senderRole==="self"?"你的原话":"对方原话"}`,quote:row.text,sourceId:row.localId,...(subjectId?{subjectId}:{}),...(reportId?{reportId}:{}),basis:"statement"};
    const topics = PERSONAL_TOPICS.filter(topic => topicStance(source,topic.match)!=="unknown").map(topic => topic.id as string);
    if (/我.{0,12}(?:期待|希望|想要|不能接受|不接受|不喜欢|联系频率|长期关系|结婚|谈恋爱)/.test(row.text)) topics.push("expectations");
    for (const topic of topics) {
      const key = row.senderRole + ":" + topic;
      const values = buckets.get(key) || [];
      values.push(source);
      buckets.set(key, values.slice(-2));
    }
  }
  return uniquePersonalEvidence([...buckets.values()].flat());
}

function topicStance(item: PersonalEvidence, match: RegExp): "yes" | "no" | "unknown" {
  if (item.basis === "observation") return "unknown";
  const clauses = (item.quote.match(/[^。！？!?；;\n，,]+[。！？!?；;\n，,]?/g)||[]).filter(clause => match.test(clause));
  let yes = false, no = false;
  for (const clause of clauses) {
    // A question, quotation about someone else, hypothetical or negated preference
    // is not this speaker's positive interest.
    if (/[?？]|(?:[他她它]说|朋友说|同事说|朋友喜欢|同事喜欢|听说|你喜欢|你爱|你会|你经常|你.{0,5}去|如果|假如|假设|可能|也许|不是不|不一定|以前|曾经|转发|引用|开玩笑)/.test(clause)) continue;
    const prefix=clause.slice(0,clause.search(match));
    // Mentioning a colleague's activity is not the speaker participating in it.
    // Keep explicit joint participation, while a later 他/她 switches the actor.
    const thirdParty=/(?:同事|朋友|老板|妈妈|爸爸|爸妈|别人|他|她)/.test(prefix);
    const together=/(?:我(?:们)?(?:最近|平时|周末|今天|昨天|刚刚|通常)?(?:跟|和|与|陪).{0,10}(?:同事|朋友|老板|妈妈|爸爸|爸妈|他|她)|(?:同事|朋友|老板|妈妈|爸爸|爸妈|他|她)(?:跟|和|与)我(?:们)?)(?:一起|一块|都)[^他她]*$/.test(prefix);
    if(/^\s*[“「"]/.test(clause)||/^\s*你/.test(prefix)||thirdParty&&!together)continue;
    const at = clause.search(match), before = clause.slice(Math.max(0, at - 14), at);
    if (/不喜欢|不爱|讨厌|不感兴趣|不愿|从不|不想|不太喜欢|不怎么喜欢/.test(before)||/(?:不喜欢|不感兴趣|不想去)[。！!，,]?$/.test(clause.slice(at))) no = true;
    else if (!/没.{0,3}$|不.{0,3}$/.test(before) && (item.source.endsWith("profile") || /我|喜欢|热爱|爱好|常去|经常|周末|今天|昨天|刚|一起|计划|想去|去了|最近|刚刚|正在|又去|去过|在做|在写|好看|好听|好喝|好玩|很有意思|很舒服/.test(clause))) yes = true;
  }
  return yes && no ? "unknown" : no ? "no" : yes ? "yes" : "unknown";
}

function goal(item: PersonalEvidence): "serious" | "casual" | null {
  if (item.basis === "observation") return null;
  if (item.source === "chat" && !/我/.test(item.quote)) return null;
  const quote = item.quote;
  if (/你想|他说|她说|如果|可能|以前|曾经/.test(quote)) return null;
  if (/只想.{0,8}(短期|随意|玩玩)|不想.{0,5}(承诺|长期关系|认真恋爱|结婚)|不考虑.{0,4}(长期|结婚)/.test(quote)) return "casual";
  if (/(?:想|希望|寻找|打算|期待|目标|认真).{0,8}(?:长期关系|稳定关系|认真恋爱|结婚)|认真(?:地)?(?:谈恋爱|恋爱)|以结婚为目的/.test(quote) && !/不想|不考虑|不是|不希望/.test(quote)) return "serious";
  return null;
}

function topicExcerpt(item:PersonalEvidence,match:RegExp){
  return text((item.quote.match(/[^。！？!?；;\n，,]+[。！？!?；;\n，,]?/g)||[]).find(part=>match.test(part)&&topicStance({...item,quote:part},match)==="yes")||item.quote,80).replace(/[，,。]$/,"");
}
function topicReply(id:string,quote:string,term:string):string{
  const replies:Record<string,string>={
    photography:/拍了|拍完|这次拍的/.test(quote)?"这次拍的里面，你最喜欢哪张？":"你平时更爱拍人还是拍景？",
    art:/看展|画展|展览|这场展|博物馆|美术馆/.test(quote)?/看了|看完|去了|去过/.test(quote)?"那个展里，有哪件让你印象特别深？":"最近有哪个展是你想去看的？":/设计|审美/.test(quote)?"最近看到哪个设计让你觉得很有意思？":"最近哪件作品让你印象最深？",
    career:/项目|产品|工作室/.test(quote)?"你刚说的这个，现在做到哪一步了？":"最近最想做成的是哪件事？",
    technology:/代码|编程|开发|程序|做产品/.test(quote)?"你现在最想先把哪个功能做出来？":"最近哪个工具用着最顺手？",
    outdoors:term==="散步"?"你散步的时候一般往哪边走？":`你${term}一般喜欢去哪儿？`,
    exercise:`${term}你一般怎么安排？`,
    travel:/去了|回来|去过|这趟|那趟/.test(quote)?"那趟最让你想再去一次的是哪里？":"下一次最想去哪里？",
    music:/演唱会|音乐节/.test(quote)&&/去了|看了|回来|现场/.test(quote)?"现场哪首最戳你？":"最近有哪首歌一直循环？",
    reading:"最近有读到让你一直记着的一段吗？",
    film:/看了|看完/.test(quote)?"哪一幕让你印象最深？":"最近有哪部是你想看的？",
    food:/做饭|下厨|做菜|烘焙/.test(quote)?"你最拿手的是哪一道？":"最近吃到最想再去一次的是哪家？",
    coffee:term.includes("茶")?"你平时最常喝哪种茶？":"你平时喜欢喝哪种咖啡？",
    pets:/我家.{0,3}[猫狗]|我的.{0,3}[猫狗]|养了.{0,4}[猫狗]|养着.{0,4}[猫狗]/.test(quote)?"你家那只最近有干什么好玩的事吗？":"你最喜欢它们哪一点？",
    games:"最近最常玩的是哪个？",
    craft:"你最喜欢做哪一类？",
    quiet:"你一个人待着的时候，一般喜欢做什么？",
    honesty:"你说的直接沟通，有没有哪种说法会让你不舒服？",
    growth:"你最近最想学会的是什么？",
    planning:"你一般习惯提前多久约？",
  };
  return replies[id]||`你说的${term}，最喜欢哪一点？`;
}

function buildConnection(sources: PersonalEvidence[], targetSelf = false): PersonalConnection {
  if (targetSelf) return { version: 1, status: "self", summary: "这是你的资料，保留为了解自己的线索。", commonPoints: [], differences: [], entryPoints: [], missing: [], sources: [] };
  const mine = sources.filter(item => item.side === "self"), other = sources.filter(item => item.side === "other");
  const commonPoints: PersonalInsight[] = [], differences: PersonalInsight[] = [], entryPoints: PersonalInsight[] = [];
  for (const topic of PERSONAL_TOPICS) {
    const own = mine.find(item => topicStance(item, topic.match) === "yes"), theirs = other.find(item => topicStance(item, topic.match) === "yes");
    const ownNo = mine.find(item => topicStance(item, topic.match) === "no"), theirNo = other.find(item => topicStance(item, topic.match) === "no");
    if (own && theirs && !ownNo && !theirNo) {
      const ids = [own.id, theirs.id];
      const ownText=topicExcerpt(own,topic.match),theirText=topicExcerpt(theirs,topic.match);
      const ownTerm=ownText.match(topic.match)?.[0]||topic.label,theirTerm=theirText.match(topic.match)?.[0]||topic.label;
      const title=ownTerm===theirTerm?`都聊过${ownTerm}`:`${topic.label}：${ownTerm} / ${theirTerm}`;
      const reply=topicReply(topic.id,theirText,theirTerm);
      commonPoints.push({ id: `common-${topic.id}`, title, reading:`你说「${topicExcerpt(own,topic.match)}」，对方说「${topicExcerpt(theirs,topic.match)}」。这是实际出现的话题交集，具体偏好还要接着聊。`, kind: "supported", evidenceIds: ids, alternative:"提到同一主题不代表偏好完全一致，也不证明对彼此的好感。", action:`先接对方这段原话，问一个具体细节；对方愿意展开再顺着聊，没展开就结束这一轮。`,reply });
    } else if ((own && theirNo || ownNo && theirs) && !differences.some(item => item.id === `difference-${topic.id}`)) {
      const a = ownNo || own!, b = theirNo || theirs!;
      differences.push({ id: `difference-${topic.id}`, title: `${topic.label}偏好不同`, reading: "一方提到兴趣，另一方明确表达不喜欢，安排活动时可能需要另找双方都愿意的选项。", kind: "inference", evidenceIds: [a.id, b.id], alternative: "不喜欢的可能是某种具体形式；这些表达也可能来自不同时间。", action: "尊重明确的不喜欢，从双方都愿意的活动开始，不用说服对方改变兴趣。" });
    } else if (theirs) {
      const theirText=topicExcerpt(theirs,topic.match),term=theirText.match(topic.match)?.[0]||topic.label;
      entryPoints.push({ id: `topic-${topic.id}`, title: `聊聊${term}`, reading:`对方说「${theirText}」。这是对方提过的话题，目前还不能算作你们的共同点。`, kind: "inference", evidenceIds: [theirs.id], alternative: "一次提到或发布不代表长期爱好。", action:"没经历过也可以直接好奇地问，不必说‘我也喜欢’；对方接着聊再追一个细节。",reply:topicReply(topic.id,theirText,term) });
    }
  }
  const ownGoal = mine.find(item => goal(item)), otherGoal = other.find(item => goal(item));
  if (ownGoal && otherGoal) {
    if (goal(ownGoal) !== goal(otherGoal)) differences.unshift({ id: "expectation", title: "关系期待需要先对齐", reading: "你们明确表达的长期/短期期待存在差异，可能影响投入节奏。", kind: "inference", evidenceIds: [ownGoal.id, otherGoal.id], alternative: "这里只比较这两次表达，偏好是否已变化尚未确认。", action: "可自然说明自己的期待，确认双方是否愿意朝同一方向了解；不用靠增加投入换取承诺。" });
    else commonPoints.push({ id: "common-expectation", title: "关系期待有交集", reading: "这两段自述表达了相近的关系方向；不等于已经对彼此作出承诺。", kind: "supported", evidenceIds: [ownGoal.id, otherGoal.id], action: "在后续具体相处中看双方行动是否与各自的表达一致。" });
  }
  // One side may be complete while no overlap is supported: say that directly.
  const missing: string[] = [];
  if (!mine.length) missing.push("这份材料还没有能确认属于你的喜好或需求；会优先复用已授权的本人资料和你在聊天中的明确表达。");
  if (!other.length) missing.push("当前没有可核对的对方文字，照片外观不能替代兴趣与相处需求。");
  if (mine.length && other.length && !commonPoints.length) missing.push("现有双方表达暂未形成明确交集；没有共同点证据不等于不合适。");
  const common = commonPoints.slice(0, 8), different = differences.slice(0, 3);
  const entries = entryPoints.slice(0, 6);
  const used = new Set([...common, ...different, ...entries].flatMap(item => item.evidenceIds));
  const status = !mine.length || !other.length ? "insufficient" : common.length || different.length ? "ready" : "limited";
  const kept = [...sources.filter(item => used.has(item.id)), ...sources.filter(item => !used.has(item.id))].slice(0,64);
  return { version: 1, status, summary: common.length ? `你们有 ${common.length} 个有双方依据的交集，可以从最熟悉的一项聊起。` : !mine.length ? "先保留对方的可聊话题，找到你的明确表达后再判断共同点。" : "已结合你们的可用材料，先看具体表达与可能的相处差异。", commonPoints: common, differences: different, entryPoints: entries, missing, sources: kept };
}

/** Old reports work from their own raw text; stored server results keep their provenance. */
export function personalConnection(input: unknown, options: { evidence?: PersonalEvidence[]; rebuild?: boolean } = {}): PersonalConnection {
  const report = object(input);
  if (report.targetSelf === true) return buildConnection([], true);
  const saved = object(report.personalConnection);
  // Saved summaries must not hide additional raw evidence in the same report.
  // Server rebuilds intentionally exclude old external sources after a consent
  // revocation or profile edit; only the freshly authorized context is used.
  if (saved.version === 1 && !options.rebuild && !options.evidence){
    const retained=uniquePersonalEvidence(list(saved.sources)).filter(item=>!report.subjectId||!item.subjectId||item.subjectId===report.subjectId);
    return buildConnection(uniquePersonalEvidence([...retained,...reportPersonalEvidence(report)]));
  }
  return buildConnection(uniquePersonalEvidence([...reportPersonalEvidence(report), ...(options.evidence || [])]));
}

export type QuickSelfDraft = { draft: Partial<import("./profile").SelfData>; evidence: Array<{ field: string; quote: string }>; notes: string[]; method: "local" };
/** A free local draft. Only first-person declarations, never implied traits. */
export function extractQuickSelfProfile(input: string): QuickSelfDraft {
  const sentences = text(input, 3000).split(/[。！？!?；;\n]/).map(value => value.trim()).filter(Boolean);
  const draft: QuickSelfDraft["draft"] = {}, evidence: QuickSelfDraft["evidence"] = [];
  const take = (field: keyof QuickSelfDraft["draft"], quote: string, value = quote) => { if (!draft[field]) { (draft as AnyRecord)[field] = value.slice(0, 800); evidence.push({ field, quote }); } };
  for (const sentence of sentences) {
    if (!/(?:^|[，,])\s*我(?:的|自己|本人|平时|周末|现在|目前|最近|是|在|住|现居|定居|喜欢|爱|希望|想|不|重视|比较|习惯|更|需要|做|从事|倾向|今年|已经)/.test(sentence) || /他说|她说|朋友说|同事说|替.{0,3}介绍|帮.{0,3}介绍/.test(sentence)) continue;
    const age = sentence.match(/我(?:今年|现在|已经)?\s*(\d{2})\s*岁/); if (age && +age[1] >= 18 && +age[1] <= 100) take("ageRange", age[0], age[1] + "岁");
    const city = sentence.match(/我(?:目前|现在)?(?:住在|居住在|现居|定居)\s*([\u4e00-\u9fff]{2,8})(?:，|,|$)/) || sentence.match(/我(?:目前|现在)?在\s*([\u4e00-\u9fff]{2,8})(?:生活|工作|定居)(?:，|,|$)/); if (city) take("city", city[0], city[1]);
    if (/我(?:平时|周末|最近|很|也|比较|特别)?(?:喜欢|爱好|热爱|常去|经常)/.test(sentence)) {
      const topics = PERSONAL_TOPICS.filter(topic => topicStance({ id: "draft", side: "self", source: "chat", label: "本人介绍", quote: sentence }, topic.match) === "yes");
      if (topics.length) { const prior = typeof draft.interests === "string" ? draft.interests + "；" : ""; draft.interests = (prior + sentence).slice(0, 800); evidence.push({ field: "interests", quote: sentence }); }
    }
    if (/我.{0,8}(?:说话|聊天|表达|沟通).{0,16}(?:喜欢|习惯|偏好|直接|慢热|简短)|我(?:更|比较)?(?:喜欢|习惯).{0,12}(?:沟通|聊天|表达)/.test(sentence)) take("communicationStyle", sentence);
    if (/我(?:希望|想|期待|寻找|需要).{0,20}(?:关系|恋爱|伴侣|结婚|认真了解|慢慢了解)|我(?:的)?(?:婚恋|关系)?目标/.test(sentence)) take("preferredRelationship", sentence);
    if (/我(?:很|更|比较)?(?:重视|看重|在乎)/.test(sentence)) take("values", sentence);
    if (/我(?:不接受|不能接受|不喜欢|需要).{0,24}(?:催促|隐私|空间|越界|欺骗|撒谎|联系|催婚)/.test(sentence)) take("boundaries", sentence);
  }
  return { draft, evidence, method: "local", notes: [evidence.length ? "已按你的原话整理，确认后才保存；没有补写未提到的信息。" : "暂未识别到足够明确的本人陈述；可以直接使用已有资料，不必填完整问卷。"] };
}
