import type { ChatActivitySummary } from "./chat-activity";

export type RelationshipQuestion = "panorama" | "attitude" | "trend" | "worth" | "next";
export type RelationshipEvidence = { id: string; claim: string; value?: string; metric?: string; source: "activity" | "conversation" | "profile" };
export type RelationshipHypothesis = {
  id: string;
  claim: string;
  supportIds: string[];
  counterIds: string[];
  alternatives: string[];
  confidence: "高" | "中" | "低";
  whatToObserve: string;
};
export type RelationshipClaimAction = {
  id: string;
  claim: string;
  action: string;
  status: "已有后续线索" | "待核对";
  claimEvidence: string;
  actionEvidence?: string;
  note: string;
};
export type RelationshipDiagnosis = {
  version: 1;
  question: RelationshipQuestion;
  questionLabel: string;
  coverage: { total: number; dated: number; startDate: string | null; endDate: string | null; activeDays: number; voiceCount: number; voiceTranscribed: number; identityNote: string };
  facts: RelationshipEvidence[];
  hypotheses: RelationshipHypothesis[];
  claimActions: RelationshipClaimAction[];
  unknowns: string[];
  relationship: { currentState: string; trend: "升温" | "降温" | "相对稳定" | "待了解"; reciprocity: string; risks: string[] };
  decision: { recommendation: string; options: Array<{ label: string; action: string; observeWindow: string; stopCondition: string }>; observeWindow: string; stopCondition: string };
  personalConnection: { commonPoints: Array<string | Record<string, unknown>>; fit: string; friction: Array<string | Record<string, unknown>> };
};

const questionLabels: Record<RelationshipQuestion, string> = {
  panorama: "先看完整关系全景",
  attitude: "TA 对我的态度是什么",
  trend: "这段关系是在升温还是降温",
  worth: "这段关系值得继续投入吗",
  next: "我下一步应该怎么做",
};

function question(value: unknown): RelationshipQuestion {
  return value === "attitude" || value === "trend" || value === "worth" || value === "next" ? value : "panorama";
}

function percent(value: number | null) { return value === null ? "待了解" : `${value}%`; }

type DiagnosisLine = { speaker?: string; text?: string; id?: string; sourceId?: string };
function shortQuote(value: string) { return value.replace(/[\\r\\n]+/g, " ").trim().slice(0, 110); }
function lineLabel(line: DiagnosisLine, index: number) {
  const source = typeof line.sourceId === "string" && line.sourceId.trim() ? ` · ${line.sourceId}` : "";
  return `第 ${index + 1} 句${source}：“${shortQuote(String(line.text || ""))}”`;
}
function buildClaimActions(lines: readonly DiagnosisLine[]): RelationshipClaimAction[] {
  const other = lines.map((line, index) => ({ line, index, text: String(line.text || "").trim() }))
    .filter(item => item.line.speaker === "other" && item.text && item.text.length >= 3);
  const patterns: Array<{ id: string; claim: RegExp; action: RegExp; label: string; note: string }> = [
    { id: "meetup", claim: /想(?:和你)?见面|想见你|一起(?:吃饭|看展|看电影|出去)|有空(?:见|出来)|周末(?:见|一起)|改天(?:见|一起)|下次(?:见|一起)/, action: /(?:周[一二三四五六日天]|今天|明天|后天|几点|时间|定位|地址|门口|买票|订票|到(?:了|店)|见面|一起(?:吃|看|去))/, label: "想见面或一起安排", note: "口头表达本身不等于已经约成；需要看到时间、地点或后续确认。" },
    { id: "communication", claim: /重视沟通|有事(?:就)?说|不喜欢冷战|愿意沟通|可以聊清楚|会解释|好好沟通/, action: /解释|说明|道歉|抱歉|理解|聊清楚|说清楚|认真听|回应你的/, label: "表达重视沟通", note: "把“重视沟通”和实际回应分开看，回应的内容和持续性仍需结合上下文。" },
    { id: "commitment", claim: /我会|答应你|保证|下次(?:给|帮|带|陪)|以后(?:会|可以)|一定(?:会|给|来)/, action: /已经|完成|做到|兑现|到了|过来|帮你|安排好|买了|订了|发给你|给你了/, label: "做出后续承诺", note: "承诺需要后续行为或结果来核对，暂不把承诺当作已完成。" },
  ];
  const output: RelationshipClaimAction[] = [];
  for (const pattern of patterns) {
    const candidate = other.find(item => pattern.claim.test(item.text));
    if (!candidate) continue;
    const follow = other.find(item => item.index > candidate.index && item.index - candidate.index <= 24 && pattern.action.test(item.text));
    output.push({
      id: `claim-action:${pattern.id}`,
      claim: pattern.label,
      action: follow ? "后续原话出现可核对的落实线索" : "暂未在当前可读聊天中看到后续落实线索",
      status: follow ? "已有后续线索" : "待核对",
      claimEvidence: lineLabel(candidate.line, candidate.index),
      ...(follow ? { actionEvidence: lineLabel(follow.line, follow.index) } : {}),
      note: pattern.note,
    });
  }
  return output;
}

/**
 * Turns the fast, deterministic activity summary into a stable report contract.
 * It intentionally makes no claim about a person's inner state. The Qwen report
 * can add hypotheses later, but these facts remain available when model work is
 * still running or unavailable.
 */
export function buildRelationshipDiagnosis(summary: ChatActivitySummary, requestedQuestion?: unknown, lines: readonly DiagnosisLine[] = []): RelationshipDiagnosis {
  const selected = question(requestedQuestion);
  const facts: RelationshipEvidence[] = [
    { id: "activity:coverage", claim: `本次纳入 ${summary.messages} 条可统计消息，覆盖 ${summary.activeDays || 0} 个有记录的日期。`, value: `${summary.messages} 条`, metric: summary.startDate && summary.endDate ? `${summary.startDate} 至 ${summary.endDate}` : undefined, source: "activity" },
    { id: "activity:starts", claim: summary.starts.comparable ? `可比较的 ${summary.starts.comparable} 轮中，你先重新开启 ${summary.starts.self} 次，TA 先重新开启 ${summary.starts.other} 次。` : "目前没有足够的完整时间信息判断谁更常重新开启聊天。", value: summary.starts.comparable ? `你 ${percent(summary.starts.selfPercent)} · TA ${percent(summary.starts.otherPercent)}` : "待了解", source: "activity" },
    { id: "activity:responses", claim: summary.responses.comparableTurns ? `可比较的回应中，TA 接住你的消息 ${summary.responses.selfToOther} 次，你接住 TA 的消息 ${summary.responses.otherToSelf} 次。` : "这份材料还不能稳定计算双方的回应覆盖。", value: summary.responses.comparableTurns ? `TA 接住你 ${percent(summary.responses.otherCoverage)} · 你接住 TA ${percent(summary.responses.selfCoverage)}` : "待了解", source: "activity" },
    { id: "activity:voices", claim: summary.voices ? `共识别到 ${summary.voices} 条语音，其中 ${Math.max(0, summary.voices - summary.unreadVoices)} 条已有文字可用于后续解读。` : "本次没有识别到语音消息。", value: summary.voices ? `${summary.voices} 条` : "0 条", source: "activity" },
  ];
  const selfLeads = summary.starts.self > summary.starts.other, otherLeads = summary.starts.other > summary.starts.self;
  const responseBalanced = summary.responses.comparableTurns > 2 && Math.abs(summary.responses.selfToOther - summary.responses.otherToSelf) <= Math.max(1, Math.round(summary.responses.comparableTurns * .25));
  const hypotheses: RelationshipHypothesis[] = [];
  if (otherLeads) hypotheses.push({ id: "hypothesis:other-initiative", claim: "在这份材料里，TA 重新开启聊天的次数更多，存在主动维持联系的行为线索。", supportIds: ["activity:starts"], counterIds: [], alternatives: ["主动开口不等于明确的恋爱意愿，还要看回应质量和后续行动。"], confidence: summary.starts.comparable >= 5 ? "中" : "低", whatToObserve: "下一次由 TA 主动开启后，是否继续提问、延续话题或落实具体安排。" });
  else if (selfLeads) hypotheses.push({ id: "hypothesis:self-initiative", claim: "在这份材料里，你重新开启聊天的次数更多，当前投入可能更偏向你这一侧。", supportIds: ["activity:starts"], counterIds: [], alternatives: ["TA 也可能更习惯回应而不是主动开场，不能只凭发起次数定性。"], confidence: summary.starts.comparable >= 5 ? "中" : "低", whatToObserve: "降低一次主动频率后，观察 TA 是否主动回来并把话题继续下去。" });
  else if (summary.starts.comparable > 2) hypotheses.push({ id: "hypothesis:shared-initiative", claim: "双方都有重新开启聊天的记录，发起行为相对接近。", supportIds: ["activity:starts"], counterIds: [], alternatives: ["发起次数没有反映每次聊天的质量和线下投入。"], confidence: "中", whatToObserve: "继续看谁会把聊天推进到具体行动，以及行动能否兑现。" });
  if (responseBalanced) hypotheses.push({ id: "hypothesis:reciprocal-response", claim: "双方在可比较的消息里都有接住对方的记录，互动回应具有一定互惠性。", supportIds: ["activity:responses"], counterIds: [], alternatives: ["回应次数没有判断语气、内容深度或现实投入。"], confidence: "中", whatToObserve: "观察对方是否会回应你的具体问题，并在下一轮主动延续。" });

  const trend = summary.days.length >= 4 ? (() => {
    const split = Math.max(1, Math.floor(summary.days.length / 2)), first = summary.days.slice(0, split).reduce((n, day) => n + day.total, 0), last = summary.days.slice(-split).reduce((n, day) => n + day.total, 0);
    if (last >= first * 1.35) return "升温" as const;
    if (last <= first * .65) return "降温" as const;
    return "相对稳定" as const;
  })() : "待了解" as const;
  const reciprocity = summary.starts.comparable && summary.responses.comparableTurns ? `发起比例：你 ${percent(summary.starts.selfPercent)}，TA ${percent(summary.starts.otherPercent)}；回应覆盖：TA 接住你 ${percent(summary.responses.otherCoverage)}。` : "当前材料不足以稳定判断双方投入是否均衡。";
  const risks = [
    summary.starts.comparable < 3 ? "发起轮次较少，暂不适合概括长期主动性。" : "",
    summary.undatedMessages ? `${summary.undatedMessages} 条消息缺少可靠日期，关系趋势可能不完整。` : "",
    summary.unreadVoices ? `${summary.unreadVoices} 条语音还没有转成文字，相关判断需要保留。` : "",
  ].filter(Boolean);
  const currentState = summary.messages < 3 ? "材料太少，先补充完整对话" : trend === "升温" ? "互动量近期增加，关系有升温线索" : trend === "降温" ? "互动量近期减少，出现降温线索" : "已有持续互动，当前状态需要结合回应和行动判断";
  const recommendation = risks.length >= 2 ? "先补齐关键材料，再决定是否增加投入。" : otherLeads || responseBalanced ? "保持一次具体、低压力的推进，观察对方是否把回应落实成行动。" : "先降低主动频率，给对方一次自然发起和推进的空间。";
  const options = [
    { label: "继续观察", action: "保持自然联系，提出一个具体但可退出的小话题或安排。", observeWindow: "观察接下来 1–2 轮互动", stopCondition: "连续两轮都只有你推进，且对方不回应或不提供替代安排。" },
    { label: "直接确认", action: "用一句具体问题确认对方对联系频率或关系方向的期待。", observeWindow: "看对方是否正面回答并给出自己的安排", stopCondition: "回避关键问题、反复含糊或明确表示不想继续。" },
    { label: "降低投入", action: "暂停连续追问，把时间留给自己的生活和其他关系。", observeWindow: "观察 7–14 天内是否出现自然回联", stopCondition: "长期没有主动联系或行动兑现。" },
  ];
  return {
    version: 1, question: selected, questionLabel: questionLabels[selected],
    coverage: { total: summary.messages, dated: summary.datedMessages, startDate: summary.startDate, endDate: summary.endDate, activeDays: summary.activeDays, voiceCount: summary.voices, voiceTranscribed: Math.max(0, summary.voices - summary.unreadVoices), identityNote: summary.unknown ? `${summary.unknown} 条身份待确认` : "双方身份已用于统计" },
    facts, hypotheses, claimActions: buildClaimActions(lines),
    unknowns: [summary.undatedMessages ? "部分消息没有可靠日期，无法判断完整时间线。" : "", summary.unreadVoices ? "部分语音没有文字，无法纳入语义判断。" : "", "聊天记录无法替代线下见面、通话和真实兑现情况；补充后会更新判断。"].filter(Boolean),
    relationship: { currentState, trend, reciprocity, risks },
    decision: { recommendation, options, observeWindow: options[0].observeWindow, stopCondition: options[0].stopCondition },
    personalConnection: { commonPoints: [], fit: "共同点需要结合你的个人资料与对方的聊天、朋友圈内容后生成。", friction: [] },
  };
}

