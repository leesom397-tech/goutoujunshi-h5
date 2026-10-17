import chat from "./public-chat-case.json";
import { publicMomentsCase, publicSocialCase } from "./public-social-cases";
import { publicPersonalConnection } from "@/components/web-analysis/report-data";
import type { Json } from "@/components/web-analysis/client";
import type { RelationshipEvidenceReview } from "@/lib/relationship-evidence";

// This module is the only source for public walkthroughs. No account, uploaded
// report, contact ID or private material is accepted from a caller.
const anonymous = { id: "", reportId: "", subjectId: "", owner: "", ownerId: "", userId: "", kind: "demo", demo: true };
const quote = (index: number) => ({ reportId: "", lineId: chat.lines[index].id, date: chat.lines[index].timestampRaw.slice(0, 10), label: "虚构聊天 · " + (chat.lines[index].speaker === "self" ? "我" : "对方"), text: chat.lines[index].text, kind: "recognized-text" as const });
const actionReview: RelationshipEvidenceReview = {
  cards: [{
    kind: "action", title: "第一次从提议走到回顾，下一次还在安排中",
    reading: "10 月 9 日提出周六看展，11 日双方回顾了昨天的体验；现在对方又主动提议下周日。已有一次见面的双方自述，下一次尚未发生。",
    explanation: "回顾原话支持看展发生，也支持对方愿意继续接触；它不能证明长期承诺，不能把周日两点的单方提议算成双方确认。",
    question: "周日两点可以呀，到时见。", observe: "确认时间后，看是否落实；有变化时是否主动沟通。", sources: [quote(2), quote(5), quote(6), quote(8)],
  }], note: "只对照本案例原话与日期，不把提议当成已发生的结果，也不把两段聊天当成长时间趋势。",
};

const chatReport: Json = { ...chat, ...anonymous, personalConnection: publicPersonalConnection("chat", chat), publicEvidenceReview: actionReview };
export const publicReports: Record<"chat" | "moments" | "social", Json> = {
  chat: chatReport,
  moments: { ...publicMomentsCase, ...anonymous, personalConnection: publicPersonalConnection("moments", publicMomentsCase) },
  social: { ...publicSocialCase, ...anonymous, personalConnection: publicPersonalConnection("social", publicSocialCase) },
};

const goalSelf = { id: "case-10", speaker: "self", kind: "text", text: "我想认真了解，合适的话发展长期关系。你现在怎么想？", timestampRaw: "2026-10-12 20:01", sourceAt: "2026-10-12T20:01:00+08:00" };
const goalOther = { id: "case-11", speaker: "other", kind: "text", text: "我现在只想短期交往，不想承诺，轻松相处就好。", timestampRaw: "2026-10-12 20:03", sourceAt: "2026-10-12T20:03:00+08:00" };
const goalSources = [
  { id: "demo-goal-self", side: "self" as const, source: "chat" as const, label: "虚构聊天 · 第 10 句", quote: goalSelf.text, lineId: goalSelf.id },
  { id: "demo-goal-other", side: "other" as const, source: "chat" as const, label: "虚构聊天 · 第 11 句", quote: goalOther.text, lineId: goalOther.id },
];
const personal = publicPersonalConnection("chat", chat);
export const publicExpectationCase: Json = {
  ...chatReport, lines: [...chat.lines, goalSelf, goalOther], readableLineCount: 11,
  annotations: [...chat.annotations,
    { lineId: goalSelf.id, emotion: [{ key: "calm", label: "平静", probability: 1 }], intent: [{ key: "clarify", label: "确认期待", probability: 1 }], evidence: "sufficient", note: "我方明确说出长期关系的期待并询问对方。这是在澄清目标，不应把我方希望误写成对方承诺。" },
    { lineId: goalOther.id, emotion: [{ key: "calm", label: "平静", probability: 1 }], intent: [{ key: "boundary", label: "说明当前取向", probability: 1 }], evidence: "sufficient", note: "对方明确只想短期交往、不想承诺。无需用先前的好感或共同兴趣反驳这句话；重点是与你的长期期待是否兼容。" },
  ],
  decision: {
    ...chat.decision,
    judgment: "双方有共同体验和主动互动，但新增原话说清了目标差异：我希望长期关系，对方现在只想短期、不想承诺。共同点仍然成立，下一步应先对齐期待，再决定投入。",
    observation: "在原有 9 句聊天后，10 月 12 日新增两句关于关系期待的明确表达。",
    evidence: "我：“" + goalSelf.text + "” 对方：“" + goalOther.text + "”",
    nextStep: "说清自己的长期期待；如果不能接受短期交往，就调整见面安排和投入，不把对方以后可能改变当成承诺。",
    interactionInsight: { label: "愿意相处，与愿意长期承诺是两回事", observed: "看展、照片分享与邀约仍有原话支持；对方随后直接说“只想短期交往，不想承诺”。", interpretation: "新增信息改变的是下一步决策，不需要推翻之前的共同体验。若你期待长期关系，继续加大投入并不能自动解决目标差异。", alternative: "短期取向本身不是欺骗或品德问题；双方若明确同意同一种相处方式，也可以自行决定。", verify: "表达你能接受的关系方式，对方是否尊重你的选择，比继续猜动机更重要。" },
    replyOptions: [{ style: "说明自己的期待", text: "谢啦你说清楚。我想认真发展长期关系，短期交往不太适合我，周日的安排我们先缓一缓吧。", reason: "承接对方的坦诚，同时说明自己的目标和对现有安排的决定。", cost: "适合你确实不接受短期交往时；不用为了维持联系勉强答应。", weight: 90 }],
    replyReview: "前一情境只需确认周日时间。现在有了明确的目标差异，回复先表达自己的期待；共同兴趣和愉快见面不能替代双方对关系的共识。",
  },
  personalConnection: { ...personal, summary: "共同体验仍有双方原话支持；但新增信息显示关系期待不同，先确认这一点，再决定是否继续。", sources: [...personal.sources, ...goalSources], entryPoints: [], differences: [{ id: "demo-difference-expectation", title: "长期期待与短期取向不同", reading: "这是双方明确说出的当前目标差异，不需要靠外貌或回复速度猜测。", kind: "supported", evidenceIds: goalSources.map(row => row.id), alternative: "以后可能变化，但当前不能按已经改变来投入。", action: "说清你是否接受短期关系；不能接受时，可以调整见面安排。" }] },
  publicEvidenceReview: { ...actionReview, cards: actionReview.cards.map(card => ({ ...card, question: "", observe: "先对齐双方期待，再决定是否保留下一次见面安排。" })) },
};
