import type { RelationshipEvidenceCard, RelationshipQuote, RelationshipSourceReport } from "./relationship-evidence";

type Row = RelationshipQuote & { speaker: "self" | "other"; segment: string; position: number; key: string };
const clean = (value: unknown, max = 800) => typeof value === "string" ? value.trim().slice(0, max) : "";
const list = (value: unknown): Record<string, any>[] => Array.isArray(value) ? value : [];
const normalize = (value: string) => value.replace(/[\s\p{P}\p{S}]/gu, "");
const media = /^\s*[\[【](?:图片|照片|表情|贴纸|动图|视频|语音|sticker|image|gif)/i;
const indirect = /[“”「」『』"]|(?:他|她|朋友|同事|别人|客户).{0,6}(?:说|写|告诉)|听说|转发|引用|假如|假设|如果|要是|开玩笑|反讽|台词/;
function dateIn(value: unknown) {
  const match = clean(value).match(/(20\d{2})[年\/-](\d{1,2})[月\/-](\d{1,2})日?/);
  if (!match) return "";
  const day = `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  const date = new Date(day + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day ? day : "";
}
const quote = ({ reportId, lineId, date, label, text, kind }: Row): RelationshipQuote => ({ reportId, lineId, date, label, text, kind });

/** Only retained dialogue is usable here. A model summary or image caption is
 * never counted as a new interaction. Upload timestamps are not event dates. */
function rowsFrom(reports: RelationshipSourceReport[]) {
  const rows: Row[] = [], seen = new Map<string,string>(), conflicts = new Set<string>();
  for (const report of [...reports].sort((a, b) => a.createdAt - b.createdAt)) {
    for (const [entryIndex, entry] of (report.entries?.length ? report.entries : [report.report]).entries()) {
      if (entry.targetSelf === true || entry.target === "self") continue;
      let day = "";
      for (const [position, line] of list(entry.lines).entries()) {
        const rawDate = clean(line.sourceAt || line.timestampRaw), explicit = dateIn(rawDate);
        if (explicit) day = explicit;
        else if (rawDate && !/^\s*(?:上午|下午|晚上|凌晨|早上)?\s*\d{1,2}[:：]\d{2}\s*$/.test(rawDate)) day = "";
        const text = clean(line.text);
        if (!["self", "other"].includes(line.speaker) || !text || media.test(text)) continue;
        const sourceId = clean(line.sourceId || line.sourceRecordId, 200);
        // An undated repeated sentence cannot prove a separate episode.
        const key = sourceId ? `source:${sourceId}:${line.speaker}` : `text:${day}:${line.speaker}:${normalize(text)}`;
        if (seen.has(key)) { if (seen.get(key)!==normalize(text)) conflicts.add(key); continue; }
        seen.set(key,normalize(text));
        rows.push({ reportId: report.id, lineId: clean(line.id, 80), date: day,
          label: line.speaker === "self" ? "我的聊天原话" : "对方聊天原话", text, kind: "recognized-text",
          speaker: line.speaker, segment: `${report.id}:${entryIndex}`, position, key });
      }
    }
  }
  return rows.filter(row=>!conflicts.has(row.key));
}

const forward = (a: Row, b: Row) => a.segment === b.segment ? b.position > a.position : !!a.date && !!b.date && b.date > a.date;
const closeAfter = (a: Row, b: Row, distance: number) => a.segment === b.segment && b.position > a.position && b.position <= a.position + distance;
function concern(value: string) {
  return !indirect.test(value) && !/我(?:并|也|其实)?不介意|我没(?:有)?(?:生气|不舒服)|不代表|没(?:有)?说/.test(value)
    && /我.{0,8}(?:介意|不舒服|不开心|难过|不同意)|(?:说好|约好).{0,14}(?:却|但是|又|怎么|没|不)|你.{0,10}(?:又|总是).{0,10}(?:加价|迟到|改期|失约|催|打断)|这次.{0,10}(?:又加价|又迟到|又改期)/.test(value);
}
function communicationResponse(value: string) {
  if (indirect.test(value) || /[？?]|不是|并非|没(?:有)?说|不代表/.test(value)) return "";
  if (/(?:现在|今天|暂时).{0,8}(?:不方便|没空|累|忙)|(?:晚点|晚上|明天|等我|过一会).{0,12}(?:聊|谈|说)|不要再联系|别再联系/.test(value)) return "";
  if (/(?:没什么|没必要|没啥)好?(?:谈|聊|解释)|(?:别再|不要再)(?:说|提|聊)(?:这个|这件事)|你(?:就是)?(?:太敏感|想太多)/.test(value)) return "closed";
  if (/我(?:愿意|想|会).{0,6}(?:听你说|听你的想法|解释|好好聊)|(?:我们|我和你).{0,6}(?:把这件事说清|好好聊|一起商量)|你先说.{0,6}(?:我听|听着)/.test(value)) return "open";
  return "";
}
function concreteArrangement(value: string) {
  return !indirect.test(value) && !/[？?]|不|没|未|取消|改天|可能|也许/.test(value)
    && /(?:周[一二三四五六日天]|明天|后天|\d{1,2}点|[一二三四五六七八九十]点).{0,20}(?:见|过来|到店|送到|来取|上门)|(?:我订了|我买了).{0,10}(?:票|餐厅)/.test(value);
}

function repeatedCards(rows: Row[], focusId: string): RelationshipEvidenceCard[] {
  const occurrences: { category: "closed" | "open" | "arrangement"; sources: Row[]; row: Row }[] = [];
  for (const row of rows) {
    if (row.speaker !== "other" || !row.date) continue;
    const prior = rows.find(item => item.segment === row.segment && item.position === row.position - 1 && item.speaker === "self");
    const response = prior && concern(prior.text) ? communicationResponse(row.text) : "";
    if (response) occurrences.push({ category: response, row, sources: [prior!, row] });
    else if (concreteArrangement(row.text)) occurrences.push({ category: "arrangement", row, sources: [row] });
  }
  const cards: RelationshipEvidenceCard[] = [];
  for (const category of ["closed", "open", "arrangement"] as const) {
    const candidates = occurrences.filter(item => item.category === category);
    const byDay = new Map<string, typeof candidates[number]>();
    for (const item of candidates) byDay.set(item.row.date, item);
    const distinct = [...byDay.values()].sort((a, b) => a.row.date.localeCompare(b.row.date));
    if (distinct.length < 2 || new Set(distinct.map(item => item.row.reportId)).size < 2 || !distinct.some(item => item.row.reportId === focusId)) continue;
    const title = category === "closed" ? "提出不适后，类似的打断回应不止一次" : category === "open" ? "面对分歧，多次表达愿意听或商量" : "多次把沟通落到具体时间安排";
    const sources = distinct.slice(-3).flatMap(item => item.sources.map(quote));
    cards.push({ kind: "pattern", title,
      reading: `在 ${new Set(distinct.map(item => item.row.reportId)).size} 份报告、${distinct.length} 个不同日期的原话中出现了相近表达。${category === "closed" ? "这比孤立一句更值得留意，但仍不能据此给对方定性。" : category === "open" ? "能看到沟通意愿重复出现，是否真正听进去仍要看回应内容。" : "这是可观察的安排习惯，维修、工作或朋友来往也会如此，不能直接解释成好感。"}`,
      explanation: "只统计保留下来的独立聊天片段；同一消息重复导入不算新的出现。缺失的聊天可能改变整体判断。",
      question: "", observe: category === "closed" ? "留意具体问题有没有得到回应；如果再次被打断，可以先明确边界，不必重复证明自己的感受。" : category === "open" ? "接着看是否回应了问题本身，以及商量好的做法有没有落实。" : "把约定和后续落实对照；有安排不等于已经发生。", sources });
  }
  return cards;
}

type Issue = "fees" | "timing" | "pressure" | "listening";
const issueLabels: Record<Issue, string> = { fees: "费用与约定", timing: "时间与赴约", pressure: "催促与边界", listening: "倾听与表达" };
function issue(value: string): Issue | null {
  if (/加价|报价|收费|费用|多收|退费/.test(value)) return "fees";
  if (/迟到|失约|爽约|改期|没来|没提前|约好|说好的时间/.test(value)) return "timing";
  if (/催|逼|施压|不尊重|拒绝|边界/.test(value)) return "pressure";
  if (/打断|不让我说|不听|不回应|骂|贬低/.test(value)) return "listening";
  return null;
}
function apologyOrRepair(value: string) {
  return !indirect.test(value) && !/[？?]|不(?:会|想|用|必|需要)道歉|没(?:有)?错|凭什么|你也有错/.test(value)
    && /对不起|抱歉|是我(?:疏忽|没做好|不对|的问题)|我错了|我会.{0,12}(?:改|提前|确认|退|补)|以后.{0,12}(?:不会|不再|先确认|提前)/.test(value);
}
function acknowledgement(value: string) {
  if (indirect.test(value) || /[？?]/.test(value)) return "";
  if (/还(?:是|有).{0,8}(?:介意|不舒服|问题)|不接受|不能接受|没(?:有)?解决|没有改变/.test(value)) return "disputed";
  if (/^(?:好|好的|可以|行|嗯)[。！!，,\s]*$|我接受.{0,5}(?:道歉|解释)|没关系|愿意再.{0,5}(?:聊|谈|试)/.test(value)) return "acknowledged";
  return "";
}
function followThrough(value: string, topic: Issue) {
  if (indirect.test(value) || /[？?]|准备|打算|明天|下次|以后|如果|希望|会再|没有|还没|尚未/.test(value)) return false;
  const expressions: Record<Issue, RegExp> = {
    fees: /(?:这次|刚才|已经).{0,12}(?:按.{0,10}(?:确认|说好|约定|原来).{0,6}(?:价|费用)|退(?:回|了))|退(?:回|还)的.{0,8}(?:收到了|已收到)/,
    timing: /(?:这次|今天|刚才).{0,10}(?:准时到了|按时到了|提前告诉我|提前说明)/,
    pressure: /(?:这次|今天).{0,10}(?:尊重了|留了空间|让我自己决定)/,
    listening: /(?:这次|刚才).{0,12}(?:听我说完了|把问题说清楚了|回应了我的问题)/,
  };
  return expressions[topic].test(value);
}

function repairCards(rows: Row[], focusId: string): RelationshipEvidenceCard[] {
  const candidates: RelationshipEvidenceCard[] = [];
  for (const problem of rows) {
    const topic = issue(problem.text);
    if (!topic || !concern(problem.text)) continue;
    const attempts = rows.filter(row => row.speaker !== problem.speaker && forward(problem, row) && apologyOrRepair(row.text) && (!issue(row.text)||issue(row.text)===topic)
      && (closeAfter(problem, row, 3) || row.date&&problem.date&&row.date>problem.date&&row.date<=new Date(Date.parse(problem.date)+7*86400000).toISOString().slice(0,10)&&issue(row.text) === topic));
    const attempt = attempts.find(row => row.segment === problem.segment) || attempts.sort((a, b) => a.date.localeCompare(b.date))[0];
    if (!attempt) continue;
    const responses = rows.filter(row => row.speaker === problem.speaker && forward(attempt, row)
      && (closeAfter(attempt, row, 3) || row.date&&attempt.date&&row.date>attempt.date&&row.date<=new Date(Date.parse(attempt.date)+7*86400000).toISOString().slice(0,10)&&issue(row.text) === topic));
    const response = responses.find(row => acknowledgement(row.text) || followThrough(row.text, topic));
    const recurrence = rows.find(row => row.key !== problem.key && row.speaker === problem.speaker && row.date && attempt.date && row.date > attempt.date
      && concern(row.text) && issue(row.text) === topic && (!response || forward(response, row)));
    const sources = [problem, attempt, response, recurrence].filter((row): row is Row => !!row);
    if (!sources.some(row => row.reportId === focusId)) continue;
    const implemented = !!response && followThrough(response.text, topic), accepted = response ? acknowledgement(response.text) : "";
    const steps = [
      { label: "出现分歧", status: "observed" as const, detail: issueLabels[topic] },
      { label: "修复尝试", status: "observed" as const, detail: "有致歉或调整做法的表达" },
      { label: "后续回应", status: response ? "observed" as const : "unknown" as const, detail: implemented ? "有后续落实的自述" : accepted === "disputed" ? "仍表达不适或不同意" : response ? "有回应，尚不代表问题解决" : "当前材料未见明确回应" },
      { label: "是否再出现", status: recurrence ? "reappeared" as const : "unknown" as const, detail: recurrence ? "较晚日期又提到同类问题" : "后续材料不足，不能判断未复发" },
    ];
    candidates.push({ kind: "repair", title: recurrence ? "修复尝试后，同类问题又被提起" : "这次分歧，修复走到哪一步",
      reading: recurrence ? "原话显示有过修复尝试，之后又出现相近问题的反馈。需要核对是否同一约定或同类情境。" : implemented ? "能看到修复尝试与后续落实的自述；这次改善能否保持，需要后续材料。" : "能看到致歉或调整的表达；仅凭道歉、答应或一句“好”，不能判定已经修复。",
      explanation: "这里串联的是可见原话及其先后。不同事情可能有相似措辞，表态、接受道歉和实际改变分别呈现。",
      question: "", observe: recurrence ? "先核对具体约定与实际发生的事，再决定要不要继续合作或相处；不需要再次接受空泛保证。" : "接着看约定的改变有没有发生，以及相同问题是否继续出现。无需另填反馈，新的聊天会继续对照。",
      sources: sources.map(quote), steps });
  }
  return candidates.slice(-1);
}

/** Adds grounded observations to the existing report/archive cards. No model
 * request, invented event, score, diagnosis, or new user-input task. */
export function relationshipPatternCards(reports: RelationshipSourceReport[], focusId: string): RelationshipEvidenceCard[] {
  const rows = rowsFrom(reports);
  return [...repairCards(rows, focusId), ...repeatedCards(rows, focusId)].slice(0, 3);
}
