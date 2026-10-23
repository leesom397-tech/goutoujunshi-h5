import type { SemanticHistoryEvidence, SemanticHistoryFinding } from "./capture-semantic-history";
import { directedCommitment, sourceContextScope, unsupportedProductReframe } from "./conversation-context";

export const DECISION_INSIGHT_KINDS = ["attitude", "follow-through", "opening", "uncertainty"] as const;
export type DecisionInsight = {
  kind: typeof DECISION_INSIGHT_KINDS[number];
  scope: "interaction" | "public" | "cross-source";
  claim: string;
  observation: string;
  evidenceIds: string[];
  alternative: string;
  whatWouldChange: string;
  nextCheck: string;
};
export type ReportDecisionInsight = {
  question: string; answer: string; observation: string; alternative: string;
  verify: string; whatWouldChange: string; evidenceIds: string[];
  basis: "generated" | "saved-finding" | "saved-guidance";
};

/** This is part of the existing synthesis request, not an extra model pass.
 * Optional items are bounded so useful extra reasoning does not crowd out the
 * required judgment, risk state or actionable guidance. */
export const DECISION_INSIGHT_GUIDANCE = "decisionInsights可省略或[]，有足够依据才选最多3项真正改变决定的推断，优先2项；不凑数量、不追求惊人。每项{kind:'attitude'|'follow-through'|'opening'|'uncertainty',scope:'interaction'|'public'|'cross-source',claim,observation,evidenceIds,alternative,whatWouldChange,nextCheck}。分别回答对我态度与对外展示有何区别、同一事项说法与行动是否接上、什么切口适合这段互动、哪个未知最影响决定；同类只留最有价值一项。claim说明由具体组合推出的意义，不能复述summary或finding；observation是一段对应finding.evidence.quote的连续原文，evidenceIds引用支持判断的全部真实finding。alternative只写同组材料支持且会改变决定的不同解释，没有可为空，whatWouldChange写哪种新回应会削弱或撤回本判断，nextCheck给一次低成本、尊重边界的核实或观察；每项合计不超过180字，claim尽量60字内。公开动态不证明对你的态度，interaction必须含对方聊天，cross-source必须含聊天和动态；不能由图片推身份、财富、人格或隐秘心理。只有原话明确作出针对用户的承诺才讨论兑现，缺失后续不等于失约；不编造反证、喜欢概率或精准置信百分比。新拒绝优先于旧热情，核实不能靠冷落、吃醋或重复试探。summary/action仍直接回答用户眼前决定，不把推断另起一套矛盾建议。";

type Row = Record<string, any>;
const object = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const list = (value: unknown): any[] => Array.isArray(value) ? value : [];
const text = (value: unknown, limit = 180) => typeof value === "string" ? value.trim().slice(0, limit) : "";
const compact = (value: string) => value.replace(/[\s\p{P}\p{S}]/gu, "").toLowerCase();
const chat = (source: SemanticHistoryEvidence) => !source.basis && (!source.sourceKind || source.sourceKind === "chat");
const otherChat = (source: SemanticHistoryEvidence) => source.senderRole === "other" && chat(source);
const questions: Record<DecisionInsight["kind"], string> = {
  attitude: "对你的态度，能看出什么？",
  "follow-through": "说过的话，有没有接上行动？",
  opening: "从哪里接话更合适？",
  uncertainty: "哪个未知会改变你的下一步？",
};

function similar(left: string, right: string) {
  const a = compact(left).replace(/可能|似乎|目前|现阶段/g, ""), b = compact(right).replace(/可能|似乎|目前|现阶段/g, "");
  if (!a || !b) return false;
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 10) return false;
  if ((a.includes(b) || b.includes(a)) && Math.min(a.length, b.length) / Math.max(a.length, b.length) > .7) return true;
  const grams = (value: string) => new Set(Array.from({length: value.length - 1}, (_, i) => value.slice(i, i + 2)));
  const aa = grams(a), bb = grams(b);
  return 2 * [...aa].filter(item => bb.has(item)).length / (aa.size + bb.size) >= .82;
}

const generic = (value: string) => /^(?:需要|建议|可以|还要|仍需|应当|要)?(?:进一步了解|继续观察|结合实际行动(?:判断|核对)?|结合后续行动(?:判断|核对)?|多沟通|保持沟通|尊重彼此|了解对方|看后续表现)[。！!\s]*$/.test(value);
const positiveClauses = (value: string) => value.split(/[。；;，,\n]|但是|不过|但/).filter(clause => !/不能|无法|不代表|不等于|不足以|尚不能|没(?:有|有足够).{0,6}(?:证据|依据)|未能/.test(clause));
function unsafeInference(value: string, publicOnly: boolean) {
  if (/(?:\d+(?:\.\d+)?\s*[%％]|百分之[一二三四五六七八九十百零\d]+|喜欢概率|成功率|准确率|置信概率)/.test(value)) return true;
  if (/内心其实|内心真正|真实心理|隐藏的真相|惊人真相|欲擒故纵|口是心非|嘴硬心软/.test(value)) return true;
  return publicOnly && positiveClauses(value).some(clause => /(?:对你|对用户|喜欢你|爱上你|暗恋|恋爱意愿|浪漫意愿|向你示好|吸引你)/.test(clause));
}
function appearanceInference(value: string) {
  return positiveClauses(value).some(clause => /(?:照片|自拍|穿搭|长相|颜值|外貌|五官|妆容|服装|豪车|名牌|奢侈品|酒店|旅行).{0,22}(?:说明|证明|体现|可见|看出|意味着|暗示|所以|因此).{0,22}(?:职业|身份|收入|有钱|财富|经济|阶层|家境|性格|人格|依恋|缺爱|虚荣|学历|婚姻)|(?:典型|属于|就是).{0,8}(?:回避型|焦虑型|控制型|自恋型)/.test(clause));
}
function manipulativeCheck(value: string) {
  return positiveClauses(value).some(clause => /(?:故意|刻意).{0,5}(?:冷落|不回|吃醋)|(?:制造|让.{0,3})吃醋|反复试探|偷偷(?:查看|登录|翻)|查(?:手机|定位)/.test(clause));
}

function unsupportedAttribute(value: string, evidence: readonly SemanticHistoryEvidence[]) {
  const domains = [
    /财力|收入|有钱|经济实力|经济条件|家境|资产|阶层|财务/,
    /人格|性格|虚荣|自恋|依恋|控制欲|缺爱|回避型|焦虑型/,
    /职业|身份|任职|从事|从业|高管|医生|律师|公务员|程序员|教师|老板/,
  ];
  const assertions = positiveClauses(value);
  // Adding an unrelated caption alongside an expensive-looking image is not
  // evidence about wealth or occupation. Require text about that actual topic.
  return domains.some(domain => assertions.some(clause => domain.test(clause)) && !evidence.some(source => source.basis !== "visual" && domain.test(source.quote)));
}

function datedOtherEvents(evidence: readonly SemanticHistoryEvidence[]) {
  return [...new Map(evidence.filter(otherChat).filter(source => {
    const parts = source.at.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (!parts) return false;
    const day = `${parts[1]}-${parts[2].padStart(2, "0")}-${parts[3].padStart(2, "0")}`, date = Date.parse(day + "T00:00:00Z");
    return Number.isFinite(date) && new Date(date).toISOString().slice(0, 10) === day && Number.isFinite(Date.parse(source.at.replaceAll("/", "-")));
  })
    .map(source => [JSON.stringify([source.libraryId, source.sourceId]), source])).values()];
}

/** Structural/source guards only: they cannot certify a model's psychological
 * interpretation. Bad optional items are omitted, never a reason to rerun or
 * mark an otherwise complete report as failed. */
export function validatedDecisionInsights(input: unknown, findings: readonly SemanticHistoryFinding[], summary = ""): DecisionInsight[] {
  const byId = new Map(findings.map(item => [item.id, item]));
  const output: DecisionInsight[] = [];
  for (const value of list(input).slice(0, 8)) {
    const row = object(value), kind = row.kind, scope = row.scope;
    const claim = text(row.claim, 140), observation = text(row.observation), alternative = text(row.alternative), whatWouldChange = text(row.whatWouldChange), nextCheck = text(row.nextCheck);
    const references = list(row.evidenceIds);
    if (!DECISION_INSIGHT_KINDS.includes(kind) || !["interaction", "public", "cross-source"].includes(scope) || references.length < 1 || references.length > 6 || references.some(id => typeof id !== "string" || !byId.has(id))) continue;
    if ([claim, observation, whatWouldChange, nextCheck].some(item => compact(item).length < 4 || generic(item)) || alternative && (compact(alternative).length < 4 || generic(alternative))) continue;
    const evidenceIds = [...new Set(references as string[])], selected = evidenceIds.map(id => byId.get(id)!), evidence = selected.flatMap(item => item.evidence);
    const observed = evidence.filter(item => item.quote.replace(/\s+/g, "").includes(observation.replace(/\s+/g, "")));
    if (!observed.length || !evidence.some(item => item.basis !== "visual")) continue;
    const targetChat = evidence.filter(otherChat), moments = evidence.filter(item => item.sourceKind === "moments");
    if (scope === "interaction" && (!targetChat.length || !observed.some(otherChat))) continue;
    if (scope === "public" && (!moments.length || !observed.some(item => item.sourceKind === "moments"))) continue;
    if (scope === "cross-source" && (!targetChat.length || !moments.length)) continue;
    // A public post may support a conversation topic, not a private attitude.
    if (kind === "attitude" && !targetChat.length) continue;
    if (kind === "follow-through" && !targetChat.some(item => directedCommitment(item.quote))) continue;
    const reading = [claim, nextCheck].join("；");
    if (unsafeInference(reading, scope === "public") || appearanceInference(reading) || unsupportedAttribute(claim, evidence) || manipulativeCheck(nextCheck) || unsupportedProductReframe(reading, evidence)) continue;
    if (kind === "follow-through" && positiveClauses(claim).some(clause => /已(?:经)?兑现|失约|食言|失信|撒谎|说谎/.test(clause))) {
      const events = datedOtherEvents(evidence);
      if (!events.some(before => directedCommitment(before.quote) && events.some(after => Date.parse(after.at.replaceAll("/", "-")) > Date.parse(before.at.replaceAll("/", "-"))))) continue;
    }
    if (similar(claim, observation) || similar(claim, summary) || selected.some(item => similar(claim, item.claim)) || similar(claim, alternative) || similar(claim, whatWouldChange)) continue;
    if (output.some(item => item.kind === kind || similar(item.claim, claim))) continue;
    output.push({kind, scope, claim, observation, evidenceIds, alternative, whatWouldChange, nextCheck});
    if (output.length === 3) break;
  }
  return output;
}

/** Old reports use their existing findings verbatim. Matching current action
 * references are prioritized after a guidance edit, but the old interpretation
 * is still explicitly labeled saved-finding, never a newly verified judgment. */
export function projectReportDecisionInsights(input: unknown): ReportDecisionInsight[] {
  const report = object(input), semantic = object(report.semanticHistory || object(report.relationshipDiagnosis).semanticHistory || input);
  const findings = list(semantic.findings).filter(item => text(item?.id) && text(item?.claim)).map(item => ({...item,
    evidence: list(item.evidence).filter(source => text(source?.quote)).map(source => ({...source, at: text(source.at, 80)})),
  })).filter(item => item.evidence.length) as SemanticHistoryFinding[];
  const generated = validatedDecisionInsights(semantic.decisionInsights, findings, text(semantic.summary, 400));
  if (generated.length && !report.guidanceUpdatedAt) return generated.map(item => ({question: questions[item.kind], answer: item.claim, observation: item.observation, alternative: item.alternative, verify: item.nextCheck, whatWouldChange: item.whatWouldChange, evidenceIds: item.evidenceIds, basis: "generated"}));
  const steps = list(object(semantic.actionPlan).steps), actionIds = [...new Set([...steps.flatMap(step => list(step?.evidenceIds)), ...list(semantic.actionEvidenceIds)])];
  const priority = (finding: SemanticHistoryFinding) => { const index = actionIds.indexOf(finding.id); return index < 0 ? actionIds.length : index; };
  const candidates = [...findings].sort((a, b) => priority(a) - priority(b));
  const selected: ReportDecisionInsight[] = [];
  const topics = new Set<string>();
  for (const finding of candidates) {
    const quote = finding.evidence.find(otherChat) || finding.evidence.find(item => item.basis !== "visual");
    if (!quote || unsafeInference(finding.claim, !finding.evidence.some(otherChat)) || appearanceInference(finding.claim) || unsupportedProductReframe(finding.claim, finding.evidence)) continue;
    const action = steps.find(step => list(step?.evidenceIds).includes(finding.id));
    const scope = sourceContextScope(finding.evidence);
    const topic = scope === "product_feedback" ? "product" : /拒绝|不要|别再|边界|隐私|资料|测试|停止/.test(finding.claim + quote.quote) ? "boundary" : /承诺|答应|兑现|安排|邀约|约会|见面/.test(finding.claim) ? "follow-through" : /主动|回应|回复|延续|提问/.test(finding.claim) ? "interaction" : /工作|职业|项目|业务/.test(finding.claim) ? "work" : /旅行|旅游|度假|出游/.test(finding.claim) ? "travel" : /生活|兴趣|爱好|看展|运动/.test(finding.claim) ? "interests" : quote.sourceKind === "moments" ? "public" : "other";
    const actionReferences = list(action?.evidenceIds);
    const updated = !!report.guidanceUpdatedAt && text(action?.why) && actionReferences.length && actionReferences.every(id => findings.some(row => row.id === id));
    const answer = updated ? text(action.why, 300) : text(finding.claim, 300);
    if (topics.has(topic) || selected.some(item => similar(item.answer, answer))) continue;
    topics.add(topic);
    const question: Record<string, string> = {product: "这段话在评价什么？", boundary: "现在需要尊重什么界限？", "follow-through": "说法之外，有什么可核对的行动？", interaction: "谁在延续这段交流？", work: "工作话题里有什么具体线索？", travel: "旅行话题里有什么具体线索？", interests: "有什么已经出现的聊天切口？", public: "公开展示能说明什么？", other: "这一步有什么原话依据？"};
    selected.push({question: question[topic], answer, observation: text(quote.quote), alternative: updated ? "" : text(finding.alternative), verify: text(action?.action), whatWouldChange: "", evidenceIds: updated ? [...new Set(actionReferences as string[])] : [finding.id], basis: updated ? "saved-guidance" : "saved-finding"});
    if (selected.length === 3) break;
  }
  return selected;
}
