/** A read-only comparison of saved material. Never sends it to a model or records a guessed outcome. */
export type RelationshipSourceReport = { id: string; kind?: string; createdAt: number; report: Record<string, any>; entries?: Record<string, any>[] };
export type RelationshipQuote = { reportId: string; lineId?: string; date: string; label: string; text: string; kind: "recognized-text" | "extracted-content" | "profile-field" | "user-feedback" };
export type RelationshipEvidenceCard = { kind: "change" | "consistency" | "action" | "feedback"; title: string; reading: string; explanation: string; question: string; observe: string; sources: RelationshipQuote[] };
export type RelationshipEvidenceReview = { cards: RelationshipEvidenceCard[]; note: string };
const text = (value: unknown, max = 400) => typeof value === "string" ? value.trim().slice(0, max) : "";
const calendar = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + "T00:00:00Z")) && new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value ? value : "";
const dateIn = (value: unknown) => { const match = text(value).match(/(20\d{2})[年\/-](\d{1,2})[月\/-](\d{1,2})日?/); return match ? calendar(`${match[1]}-${match[2].padStart(2,"0")}-${match[3].padStart(2,"0")}`) : ""; };
const array = (value: unknown): any[] => Array.isArray(value) ? value : [];
const media = (value: string) => /^\s*[\[【](?:图片|照片|表情|贴纸|动图|视频|语音|sticker|image|gif)/i.test(value);
const relayed = (value: string) => /[“”「」『』"]|他说|她说|你说|你提到|听说|听人说|朋友说|别人说|假如|如果|假设|要是|梦见|有空.{0,10}就|(?:能|可以)的话/.test(value);
const oldTime = (value: string) => /以前|之前|曾经|原来|过去|去年|上个月/.test(value);
const cities = /北京|上海|广州|深圳|杭州|南京|成都|武汉|重庆|苏州|天津|西安|郑州|长沙|济南|青岛|合肥|厦门|福州|昆明|南宁|贵阳|沈阳|大连|哈尔滨|长春|石家庄|太原|宁波|无锡|佛山|东莞|珠海|海口|香港|澳门/;
type Field = "city" | "occupation" | "relationshipStatus";
function goal(value: string) {
  if (/不(?:想|会|打算|考虑)结婚|不婚/.test(value)) return "暂不考虑结婚";
  if (/只想(?:做朋友|交朋友|交友)|不想(?:谈恋爱|恋爱)/.test(value)) return "暂不发展恋爱";
  if (/只想(?:短期|玩玩)|不考虑长期|不想承诺/.test(value)) return "暂不承诺长期";
  if (/(?:想|希望|考虑|寻找|认真).{0,10}(?:结婚|婚姻)|以结婚为目的/.test(value)) return "考虑婚姻";
  if (/认真(?:地)?(?:谈恋爱|恋爱|交往)|长期关系|稳定关系/.test(value)) return "期待稳定交往";
  return "";
}
function claims(value: string): { field: Field; value: string }[] {
  if (relayed(value) || oldTime(value) || /[？?]/.test(value)) return [];
  const found: {field:Field;value:string}[] = [];
  const city = value.match(/(?:我(?:现在|目前|最近)?(?:常住|住在|定居在?|在)|现居(?:地)?[：:]?)([^，。；\n]{1,16})/);
  const place = city?.[1].match(cities)?.[0]; if (place && !/旅游|出差|路过|玩几天|度假|准备去|打算去/.test(value)) found.push({field:"city",value:place});
  const job=value.match(/我(?:现在|目前)?(?:是(?:一名|个)?|做(?:的是)?)(软件工程师|工程师|医生|护士|教师|老师|律师|设计师|程序员|会计|公务员|销售|产品经理|制片人|记者|学生|自由职业)/)?.[1];if(job)found.push({field:"occupation",value:job});
  const aim=goal(value);if(aim&&/我|只想|认真|不想|以结婚/.test(value))found.push({field:"relationshipStatus",value:aim});
  return found;
}
type Evidence = RelationshipQuote & { speaker: "self" | "other"; savedAt: number; claims: {field:Field;value:string}[] };
function extract(report: RelationshipSourceReport): Evidence[] {
  const rows: Evidence[] = [], entries = report.entries?.length ? report.entries : [report.report];
  for (const entry of entries) {
    if (!entry || entry.targetSelf === true || entry.target === "self") continue;
    let date = "";
    for (const line of array(entry.lines)) {
      const raw = text(line?.timestampRaw), explicit = dateIn(raw); if (explicit) date = explicit; else if (raw && !/^\s*(?:上午|下午|晚上|凌晨|早上)?\s*\d{1,2}[:：]\d{2}\s*$/.test(raw)) date = "";
      const quote = text(line?.text, 800); if (!["self","other"].includes(line?.speaker) || !quote || media(quote)) continue;
      rows.push({reportId:report.id,lineId:text(line.id,80),date,label:line.speaker==="other"?"对方聊天识别原文":"我方聊天识别原文",text:quote,kind:"recognized-text",speaker:line.speaker,savedAt:report.createdAt,claims:line.speaker==="other"?claims(quote):[]});
    }
    for (const post of array(entry.moments?.posts)) {
      const quote=text(post?.content,800);if(!quote)continue;
      // These saved captions can include a model's compact photo description, not the person's exact words.
      rows.push({reportId:report.id,date:dateIn(post.date),label:"已保存的动态内容摘录（含图片描述）",text:quote,kind:"extracted-content",speaker:"other",savedAt:report.createdAt,claims:[]});
    }
    for (const field of array(entry.profileBasics)) {
      if (!["city","occupation","relationshipStatus"].includes(field?.field) || !text(field.evidence)) continue;
      const value=text(field.value,120);if(!value)continue;
      const normalized=field.field==="relationshipStatus"?goal(value):field.field==="city"?value.match(cities)?.[0]||value:value;
      if (!normalized) continue;
      rows.push({reportId:report.id,date:"",label:"主页资料提取 · "+text(field.evidence,100),text:value,kind:"profile-field",speaker:"other",savedAt:report.createdAt,claims:[{field:field.field,value:normalized}]});
    }
  }
  return rows;
}
const quoteOf = ({reportId,lineId,date,label,text,kind}: Evidence): RelationshipQuote => ({reportId,lineId,date,label,text,kind});
function action(value: string) {
  if (relayed(value)) return "";
  const denied = /并非|不是(?:说|不)|没(?:有)?(?:说|讲|表达|要求|让)|没有不想|不代表/.test(value);
  if (!denied && !/[？?]/.test(value) && /(?:别再联系|不要再联系)(?:我|我们)(?:了|吧|[，。；！!,;\s]|$)|(?:^|[，。；\s])我?不想(?:和|跟)你继续(?:联系|交往|发展|聊|下去|了|[，。；！!\s]|$)/.test(value)) return "boundary";
  if (!/[？?]|没|未|不|取消|本来|原本|下次|明天|后天|下周/.test(value) && /(?:昨天|昨晚|刚才|上次).{0,16}(?:和你|跟你|见到你|见面)|(?:今天)?见到你.{0,8}(?:开心|高兴)|今天.{0,12}见面.{0,10}(?:开心|愉快)/.test(value)) return "recap";
  if (/不见|没约|取消|没空|改天再说|(?:不想|不打算|不方便|不愿意|不一定|不准备|不太想|不能|不会|不要|没想|未打算|还没|未能|无法).{0,24}(?:见|约|来|接|吃饭|喝咖啡|看展|订|买)/.test(value)) return "";
  if (!/[？?]|(?:吗|么|呢)[。！!\s]*$/.test(value) && /(?:周[一二三四五六日天]|明天|后天|\d{1,2}点|[一二三四五六七八九十]点).{0,22}(?:见|来|接你|吃饭|喝咖啡|看展)|(?:我订了|我买了).{0,10}(?:票|餐厅)/.test(value)) return "arrangement";
  if (!/不想见|不见|别见/.test(value) && /想见你|想和你见面|想跟你见面|要不要.{0,12}(?:见面|喝咖啡|吃饭|看展)|下次.{0,12}(?:见面|一起)/.test(value)) return "invitation";
  return "";
}
export function relationshipEvidenceReview(data: Record<string, unknown>, subjectId: string, focusId: string, reports: RelationshipSourceReport[] = []): RelationshipEvidenceReview {
  const empty = { cards: [] as RelationshipEvidenceCard[], note: "只对照已保存材料中的表达；来源不完整时保留待核实，不推断行动已经执行。" };
  const usable = reports.filter(row => row && text(row.id) && Number.isFinite(row.createdAt) && row.report && !row.report.targetSelf && (!row.report.subjectId || row.report.subjectId===subjectId)).sort((a,b)=>a.createdAt-b.createdAt);
  const focus = focusId ? usable.find(row=>row.id===focusId||array(row.entries).some(entry=>entry?.id===focusId)) : usable.at(-1); if(!focus)return empty;
  const available=usable.filter(row=>row.createdAt<=focus.createdAt), all=available.flatMap(extract), current=all.filter(row=>row.reportId===focus.id), earlier=all.filter(row=>row.reportId!==focus.id);
  const cards:RelationshipEvidenceCard[]=[], publicOther=(items:Evidence[])=>items.filter(row=>row.speaker==='other'&&row.kind!=='extracted-content');
  const sourcePair=(a:Evidence,b:Evidence)=>[quoteOf(a),quoteOf(b)];
  const oldInvite=publicOther(earlier).reverse().find(row=>action(row.text)==='invitation'||action(row.text)==='arrangement');
  const fresh=publicOther(current).find(row=>action(row.text)==='boundary')||publicOther(current).find(row=>action(row.text)==='recap')||publicOther(current).find(row=>action(row.text)==='arrangement');
  if(fresh&&(!oldInvite||fresh.text!==oldInvite.text)) {
    const kind=action(fresh.text),ordered=!!oldInvite?.date&&!!fresh.date&&oldInvite.date<fresh.date;
    if(kind==='boundary')cards.push({kind:'change',title:'本次出现了明确停止联系的表达',reading:'先尊重这条边界，不继续用邀约检验态度。',explanation:'这是一条当前可见的明确表达，不需要靠互动分数决定是否尊重。',question:'',observe:'停止主动推进；不要反复追问或试探。',sources:[quoteOf(fresh)]});
    else if(oldInvite)cards.push({kind:'action',title:kind==='recap'?'出现见面回顾线索，仍需核对是否对应原邀约':'从见面意愿，到更具体的安排线索',reading:ordered?'较晚日期的材料出现了新的具体表达，可以接着核对落实情况。':'两份材料可分别核对，但日期不足以确认先后或属于同一次约定。',explanation:kind==='recap'?'聊天在回顾见面，不等于系统已确认赴约；也不能把变化归因于之前的建议。':'提出时间、买票或订位比单纯说想见面更具体，但仍不代表已经赴约。',question:kind==='recap'?'你说的这次见面，是之前约的那一次吗？':'那我们把具体时间和地点确认一下，你看方便吗？',observe:'核对是不是同一件事，再看双方是否确认、如期发生；不把缺少后续材料当成爽约。',sources:sourcePair(oldInvite,fresh)});
  }
  const labels={city:'所在地',occupation:'职业',relationshipStatus:'关系目标'};
  for(const field of ['city','occupation','relationshipStatus'] as const) {
    const latest=publicOther(current).reverse().find(row=>row.claims.some(claim=>claim.field===field));if(!latest)continue;
    const value=latest.claims.find(claim=>claim.field===field)!.value;
    const prior=publicOther(earlier).reverse().find(row=>row.claims.some(claim=>claim.field===field&&claim.value!==value&&!claim.value.includes(value)&&!value.includes(claim.value)));if(!prior)continue;
    if(field==='occupation'){const a=prior.claims.find(claim=>claim.field===field)!.value;const compatible=[/老师|教师/,/工程师|程序员/];if(compatible.some(group=>group.test(a)&&group.test(value)))continue;}
    if(field==='relationshipStatus'){const a=prior.claims.find(claim=>claim.field===field)!.value;if(['期待稳定交往','考虑婚姻'].includes(a)&&['期待稳定交往','考虑婚姻'].includes(value))continue;}
    const explanations={city:'可能涉及搬家、出差或主页更新较慢，先区分常住地与临时所在地。',occupation:'可能是兼任、转岗或对职业的不同概括；两处表述不同本身不能证明隐瞒。',relationshipStatus:'期待可能随时间变化，也可能一个说恋爱、一个说婚姻；先核对现在的想法。'};
    const questions={city:'你现在主要在哪个城市生活？之前提到的那个地方是工作还是短住呀？',occupation:'你现在主要做哪方面工作？之前提到的也是目前一起在做的吗？',relationshipStatus:'你现在更希望怎样的关系？我想确认一下我们对这件事的理解。'};
    cards.push({kind:'consistency',title:`两处${labels[field]}表述不同，值得自然核实`,reading:'把来源放在一起看；这里标记需要核对的差异，不判断谁在说谎。',explanation:explanations[field],question:questions[field],observe:'先听具体解释，后续结合自然互动核对；资料更新时间未明确时不判定前后矛盾。',sources:sourcePair(prior,latest)});
  }
  const feedback=array(data.actionFeedback).filter(row=>row&&typeof row.reportId==='string'&&available.some(report=>report.id===row.reportId||array(report.entries).some(entry=>entry?.id===row.reportId))&&Number.isFinite(row.recordedAt)&&(!focusId||row.recordedAt<=focus.createdAt)).sort((a,b)=>a.recordedAt-b.recordedAt);
  const latest=feedback.at(-1);
  if(latest&&text(latest.note)&&['positive','alternative','declined','uncomfortable','waiting','not_done'].includes(latest.outcome))cards.push({kind:'feedback',title:latest.outcome==='not_done'?'还没有执行，不把它解释为建议失效':'你补充了新经过，可据此调整下一步',reading:latest.outcome==='not_done'?'目前没有执行后的结果可判断。':'这是你主动记录的实际反馈，不是系统猜测的结果。',explanation:'新经过可以修正对现状的理解，但不能证明变化是某条建议造成的，也不证明对方的真实动机。',question:'',observe:latest.outcome==='uncomfortable'?'先照顾自己的不适和边界，再决定是否继续。':'结合这次发生的事与新的聊天继续判断，无需每次另填反馈表。',sources:[{reportId:latest.reportId,date:calendar(latest.eventDate),label:'你确认的经历',text:text(latest.note,500),kind:'user-feedback'}]});
  return {...empty,cards:cards.slice(0,5)};
}
