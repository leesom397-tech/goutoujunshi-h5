import { relationshipRiskReview, type RelationshipRiskReview, type RelationshipRiskSignal } from "./relationship-risk";

type Row = Record<string, any>;
export type PresentedReply = { text: string; style: string; reason: string; cost?: string; weight?: number; originalIndex: number | null; adjusted: boolean };
export type RiskAwarePresentation = {
  mode: "normal" | "safety" | "expectation"; review: RelationshipRiskReview; priority: RelationshipRiskSignal | null;
  title: string; judgment: string; evidence: string; nextStep: string; replyOptions: PresentedReply[]; viewReport: Row;
};
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.filter(item => item && typeof item === "object" && !Array.isArray(item)) : [];
type SafetyKind = "threat" | "credentials" | "privacy" | "money";

/** Only explicit, current requests already grounded by relationshipRiskReview get action priority. */
function directSafety(signal: RelationshipRiskSignal): SafetyKind | null {
  if (signal.kind !== "safety" || signal.level !== "警惕") return null;
  const quotes = [...signal.evidence.matchAll(/[“「『"‘']([^”」』"’']{3,420})[”」』"’']/g)].map(match => match[1]);
  const snippets = quotes.length ? quotes : [signal.evidence.replace(/^.*?[：:]/, "")];
  for (const value of snippets) {
    if (/(?:表情包|贴纸|电影台词|转发)|(?:朋友|同事|别人|他|她|你)(?:曾经|之前|以前)?(?:说|告诉)|(?:以前|过去|曾经|之前|上次|当年|昨天).{0,25}(?:遇到|有人|让我|要求我|骗)/.test(value)) continue;
    for (const part of value.split(/[，,。；;！!\n]/)) {
      if (/(?:不要|不用|别|不能|不会|不需要).{0,12}(?:转账|转给|打钱|验证码|短信码|密码|裸照|私密|保证金)|不(?:是|代表).{0,8}(?:骗|威胁)/.test(part)) continue;
      if (/(?:不.{0,12}就|否则|不然).{0,15}(?:曝光|发给你家人|公布|打你|伤害你)/.test(part)) return "threat";
      if (/(?:验证码|短信码|支付密码).{0,8}(?:发|给|告诉).{0,3}我|(?:把|将).{0,6}(?:验证码|密码).{0,8}(?:发|给|告诉)/.test(part)) return "credentials";
      if (/(?:裸照|私密照|私密视频).{0,6}(?:发给我|给我)|(?:给我|发我).{0,6}(?:裸照|私密照|私密视频)/.test(part)) return "privacy";
      // Routine shared expenses alone do not override useful replies.
      if (/AA|饭钱|餐费|票钱|车费|平摊|拼单|还款|还钱|报销/.test(value) && !/保证金|解冻|投资|炒币|稳赚|保本|验证|诚意/.test(value)) continue;
      if (/(?:先|马上|现在).{0,4}(?:转给我|给我转|打钱|交.{0,4}保证金|充值.{0,5}解冻)|(?:稳赚|保本|保证收益).{0,15}(?:投|赚|资金)|(?:跟我|带你).{0,8}(?:投资|炒币|赚钱).{0,12}(?:平台|充值|转账)/.test(part)) return "money";
    }
  }
  return null;
}

function compliesWithRisk(value: string, kind: SafetyKind | null, expectation: boolean) {
  if (expectation) return /(?:让你|等你|你会|总会|迟早|一定).{0,14}(?:改变|认真|承诺|爱上我|结婚)|只要我.{0,16}(?:改变|承诺|爱上)/.test(value);
  if (!kind) return false;
  // Unqualified assent to the current risky request is not a useful default.
  if (/^(?:好[的呀啊哦]?|行|可以[呀啊]?|没问题|当然可以|都听你的)[，,。！!～~\s]*$/.test(value)) return true;
  const actions = kind === "credentials" ? /验证码|短信码|密码|发给你|告诉你|给你发/ : kind === "privacy" ? /裸照|私密|发给你|给你拍|给你发/ : kind === "money" ? /转账|转给你|给你转|打钱|充值|保证金|投钱|付钱|付款|汇款/ : /别曝光|别公布|求你|都听你的|转给你|给你转|发给你|给你发/;
  return value.split(/[，,。；;！!\n]/).some(part => actions.test(part) && !/(?:不|没法|拒绝|别|暂缓|暂停).{0,10}(?:转|发|给|告诉|提供|付|交|充|投|公布|曝光)|(?:转账|验证码|密码|私密).{0,5}(?:不|不能|不会)/.test(part) && /(?:我|马上|现在|这就|会|愿意|可以|先|发给|转给|给你|求你|别曝光|别公布)/.test(part));
}

const safetyCopy: Record<SafetyKind, { title: string; nextStep: string; reply: string; reason: string }> = {
  credentials: { title: "先保护账户信息，再继续聊", nextStep: "先不提供验证码或密码，通过自己找到的官方渠道核实。可以回应普通话题，但不要用账户信息证明信任。", reply: "验证码和密码我不会提供。这件事我会通过官方渠道自己核实。", reason: "这句明确账户边界，不配合当前的凭证索取。" },
  privacy: { title: "先确认隐私边界", nextStep: "先不发送私密影像，明确自己是否愿意；不愿意时无需解释或用照片换取信任。", reply: "这类私密照片我不想发，希望你尊重我的决定。", reason: "先表达真实边界，再看对方是否尊重。" },
  threat: { title: "先处理威胁，暂缓继续互动", nextStep: "先保存威胁原话，不继续提供资金或私密资料；如担心现实安全，联系可信赖的人或当地紧急帮助。你不必回复。", reply: "我不接受这样的威胁。我会保留记录，先停止这段对话。", reason: "仅在确认回复不会增加风险、且你仍想回应时使用；不必回复，也不用继续争辩。" },
  money: { title: "先核实资金要求，再决定下一步", nextStep: "暂缓这笔转账或充值，通过独立可信的渠道核实用途与收款方。先处理这件事，再考虑增加关系投入。", reply: "这笔钱我先不转。我需要独立核实清楚，再决定。", reason: "先保留决定权，不用资金行动证明关系。" },
};

export function riskReplyAllowed(presentation: RiskAwarePresentation, reply: string): boolean {
  if (presentation.mode === "normal" || !presentation.priority) return true;
  return !compliesWithRisk(text(reply), presentation.mode === "safety" ? directSafety(presentation.priority) : null, presentation.mode === "expectation");
}

/** A read-time projection only: original reports and quoted evidence remain untouched. */
export function riskAwarePresentation(report: Row | null | undefined): RiskAwarePresentation {
  const original = report || {}, decision = original.decision || {}, social = original.moments || original;
  const review = relationshipRiskReview(original), chat = Array.isArray(original.lines) || !!original.decision;
  const originalOptions: Row[] = chat ? rows(decision.replyOptions).map((row, originalIndex) => ({ ...row, originalIndex })) : rows(social.starters).map((row, originalIndex) => ({ ...row, text: row.message, style: row.topic, originalIndex }));
  if (!originalOptions.length && text(chat ? decision.replyDraft : original.questions?.[0])) originalOptions.push({ text: text(chat ? decision.replyDraft : original.questions[0]), originalIndex: null } as any);
  const replies: PresentedReply[] = originalOptions.filter(row => text(row.text)).map(row => ({ ...row, text: text(row.text), style: text(row.style), reason: text(row.reason), adjusted: false } as PresentedReply)).sort((a, b) => (b.weight ?? -1) - (a.weight ?? -1));
  // Historical excerpts can be old or subsequently resolved. Keep them visible
  // for verification without projecting one old request into today's reply.
  if(original.analysisScope==="fullHistory"||original.captureFormat==="full-history")return {mode:"normal",review,priority:null,title:text(decision.interactionInsight?.label),judgment:text(decision.judgment||original.summary),evidence:text(decision.evidence),nextStep:text(decision.nextStep),replyOptions:replies,viewReport:original};
  const safetyOrder = { threat: 0, credentials: 1, privacy: 1, money: 2 };
  const safeSignal = review.signals.filter(signal => directSafety(signal)).sort((a, b) => safetyOrder[directSafety(a)!] - safetyOrder[directSafety(b)!])[0];
  const expectation = review.signals.find(signal => signal.kind === "expectation");
  const priority = safeSignal || expectation || null, kind = safeSignal ? directSafety(safeSignal) : null;
  const mode = kind ? "safety" : expectation ? "expectation" : "normal";
  const originalTitle = text(decision.interactionInsight?.label), originalJudgment = text(chat ? decision.judgment || decision.possibleIntent : social.summary || original.summary);
  const originalEvidence = text(chat ? decision.evidence || decision.observation : rows(social.hypotheses).find(row => text(row.evidence))?.evidence || rows(original.visibleFacts).find(row => text(row.evidence))?.evidence);
  const originalNext = text(chat ? decision.nextStep : social.approach?.attitude || original.approach?.attitude || rows(social.hypotheses).find(row => text(row.verify))?.verify || replies[0]?.reason);
  if (mode === "normal" || !priority) return { mode: "normal", review, priority: null, title: originalTitle, judgment: originalJudgment, evidence: originalEvidence, nextStep: originalNext, replyOptions: replies, viewReport: original };
  const copy = kind ? safetyCopy[kind] : { title: "先确认双方现在的关系期待", nextStep: "尊重对方已经表达的关系取向，再说清你自己的期待。方向一致再继续了解；不同就商量边界，不把未来可能改变当成承诺。", reply: "明白你的想法了。我也想说清自己的期待，我们确认一下现在希望怎样相处。", reason: "这句用于对齐双方期待。短期、交友或暂不恋爱本身不代表品德问题。" };
  const first: PresentedReply = { text: copy.reply, style: kind ? "先确认边界" : "先对齐期待", reason: copy.reason, originalIndex: null, adjusted: true };
  const replyOptions = [first, ...replies.filter(row => row.text !== first.text && !compliesWithRisk(row.text, kind, mode === "expectation"))];
  const judgment = kind ? `${priority.title}。先处理这条明确要求，再结合其余互动判断。` : `${priority.title}。先确认你们是否希望同一种相处方式，再决定投入节奏。`;
  const approach = { attitude: copy.nextStep, emotion: kind ? "先表达边界，不必用迎合换取理解。" : "认可对方愿意说清想法，也坦诚表达自己的期待。", pace: kind ? "核实或边界明确前，暂缓涉及资金、隐私或额外承诺的行动。" : "根据双方已经说清的期待决定联系和见面节奏。", avoid: kind ? "不转发账户凭证，不用资金或私密资料证明信任。" : "不劝对方改变，也不替自己许下尚未想清的承诺。", adjustWhen: kind ? "要求撤回并独立核实后，再决定是否继续；出现施压可以停止互动。" : "一方期待变化时，重新说明和确认。", evidence: priority.evidence };
  const starters = replyOptions.map(option => ({ topic: option.style || "自然回应", message: option.text, reason: option.reason, evidence: option.adjusted ? priority.evidence : "" }));
  const viewReport = chat ? { ...original, decision: { ...decision, judgment, evidence: priority.evidence, nextStep: copy.nextStep, replyDraft: first.text, replyOptions, interactionInsight: decision.interactionInsight ? { ...decision.interactionInsight, label: copy.title } : undefined } } : { ...original, summary: judgment, approach, starters, ...(original.moments ? { moments: { ...original.moments, summary: judgment, approach, starters } } : {}) };
  return { mode, review, priority, title: copy.title, judgment, evidence: priority.evidence, nextStep: copy.nextStep, replyOptions, viewReport };
}
