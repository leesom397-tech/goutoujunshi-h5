import type { ChatActivitySummary } from "./chat-activity";
import type { SemanticHistoryReport, SemanticHistoryEvidence } from "./capture-semantic-history";
import { directedCommitment } from "./conversation-context";

export type RelationshipQuestion = "panorama" | "attitude" | "trend" | "worth" | "next" | "risk";
export type RelationshipEvidence = { id: string; claim: string; value?: string; metric?: string; source: "activity" | "conversation" | "profile" | "media" | "moments"; sample?: number; sourceIds?: string[]; quotes?: SemanticHistoryEvidence[] };
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
  relationship: { currentState: string; trend: "升温" | "降温" | "相对稳定" | "待了解"; reciprocity: string; risks: string[]; activityTrend?: string };
  periods: Array<{ label: string; range: string; sample: number; self: number; other: number }>;
  decision: { recommendation: string; options: Array<{ label: string; action: string; observeWindow: string; stopCondition: string }>; observeWindow: string; stopCondition: string };
  personalConnection: { commonPoints: Array<string | Record<string, unknown>>; fit: string; friction: Array<string | Record<string, unknown>> };
};

const questionLabels: Record<RelationshipQuestion, string> = {
  panorama: "先看完整关系全景",
  attitude: "TA 对我的态度是什么",
  trend: "这段关系是在升温还是降温",
  worth: "这段关系值得继续投入吗",
  next: "我下一步应该怎么做",
  risk: "有哪些风险需要核实，值不值得继续",
};

function question(value: unknown): RelationshipQuestion {
  return value === "attitude" || value === "trend" || value === "worth" || value === "next" || value === "risk" ? value : "panorama";
}

function percent(value: number | null) { return value === null ? "待了解" : `${value}%`; }

type DiagnosisLine = { speaker?: string; text?: string; id?: string; sourceId?: string };
function conversationFacts(lines: readonly DiagnosisLine[]): RelationshipEvidence[] {
  const readable = lines.filter(line => (line.speaker === "self" || line.speaker === "other") && String(line.text || "").trim().length >= 2);
  if (readable.length < 8) return [];
  const asks = (speaker: string) => readable.filter(line => line.speaker === speaker && /[?？]|吗[。？?]?$|呢[。？?]?$/u.test(String(line.text).trim())).length;
  const life = /今天|昨天|明天|周末|上班|下班|加班|吃饭|外卖|家里|爸妈|孩子|生病|睡觉|出行|出差/;
  const lifeCount = readable.filter(line => life.test(String(line.text))).length;
  return [
    { id: "conversation:questions", claim: `可读文字里，你提出问句 ${asks("self")} 次，TA 提出问句 ${asks("other")} 次。问句只按标点和语气词计数，不是态度评分。`, value: `你 ${asks("self")} · TA ${asks("other")}`, metric: `样本 ${readable.length} 条可读文字`, source: "conversation" },
    { id: "conversation:life", claim: lifeCount ? `${lifeCount} 条可读文字提到了具体生活安排或近况。这只说明话题出现过，不代表情绪浓度或关系深度。` : "可读文字里很少出现可核对的生活安排或近况。", value: `${lifeCount} 条`, metric: `样本 ${readable.length} 条可读文字`, source: "conversation" },
  ];
}
function activityPeriods(summary: ChatActivitySummary) {
  if (!summary.startDate || !summary.endDate || !summary.spanDays || summary.spanDays < 4) return [];
  // Compare equal calendar windows, including silent days. Splitting active
  // days would hide long silences and compare unequal spans.
  const end = Date.parse(summary.endDate), windowDays = Math.min(14, Math.floor(summary.spanDays / 2));
  const date = (value: number) => new Date(value).toISOString().slice(0, 10);
  const pack = (from: number, to: number, label: string) => {
    const days = summary.days.filter(day => day.date >= date(from) && day.date <= date(to));
    return {
    label,
    range: `${date(from)} 至 ${date(to)}`,
    sample: days.reduce((total, day) => total + day.total, 0),
    self: days.reduce((total, day) => total + day.self, 0),
    other: days.reduce((total, day) => total + day.other, 0),
    };
  };
  return [pack(end - (windowDays * 2 - 1) * 86400000, end - windowDays * 86400000, `此前 ${windowDays} 天`), pack(end - (windowDays - 1) * 86400000, end, `最近 ${windowDays} 天`)];
}
function shortQuote(value: string) { return value.replace(/[\r\n]+/g, " ").trim().slice(0, 110); }
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
    const candidate = other.find(item => pattern.claim.test(item.text) && (pattern.id !== "commitment" || directedCommitment(item.text)));
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
    { id: "activity:starts", claim: summary.starts.comparable ? `可比较的 ${summary.starts.comparable} 轮中，你先重新开启 ${summary.starts.self} 次，TA 先重新开启 ${summary.starts.other} 次。` : "目前没有足够的完整时间信息判断谁更常重新开启聊天。", value: summary.starts.comparable ? `你 ${percent(summary.starts.selfPercent)} · TA ${percent(summary.starts.otherPercent)}` : "待了解", metric: summary.starts.comparable ? `样本 ${summary.starts.comparable} 轮` : undefined, source: "activity" },
    { id: "activity:responses", claim: summary.responses.comparableTurns ? `可比较的回应中，TA 接住你的消息 ${summary.responses.selfToOther} 次，你接住 TA 的消息 ${summary.responses.otherToSelf} 次。` : "这份材料还不能稳定计算双方的回应覆盖。", value: summary.responses.comparableTurns ? `TA 接住你 ${percent(summary.responses.otherCoverage)} · 你接住 TA ${percent(summary.responses.selfCoverage)}` : "待了解", metric: summary.responses.comparableTurns ? `样本 ${summary.responses.comparableTurns} 轮` : undefined, source: "activity" },
    // Persisted names refer to the preceding speaker: selfReply is the other's reply to self.
    { id: "activity:reply-gap", claim: summary.responses.averageOtherReplyMinutes !== null || summary.responses.averageSelfReplyMinutes !== null ? `有时间的回应里，TA 平均 ${summary.responses.averageSelfReplyMinutes ?? "未知"} 分钟后回复，你平均 ${summary.responses.averageOtherReplyMinutes ?? "未知"} 分钟后回复。` : "现有时间精度不够，不能计算回复间隔。", value: summary.responses.comparableTurns ? `样本 ${summary.responses.comparableTurns} 轮` : "待了解", metric: summary.startDate && summary.endDate ? `${summary.startDate} 至 ${summary.endDate}` : undefined, source: "activity" },
    { id: "activity:voices", claim: summary.voices ? `共识别到 ${summary.voices} 条语音，其中 ${Math.max(0, summary.voices - summary.unreadVoices)} 条已有文字可用于后续解读。` : "本次没有识别到语音消息。", value: summary.voices ? `${summary.voices} 条` : "0 条", metric: `文字 ${summary.text} · 图片 ${summary.images} · 表情 ${summary.stickers}`, source: "activity" },
    ...conversationFacts(lines),
  ];
  const selfLeads = summary.starts.self > summary.starts.other, otherLeads = summary.starts.other > summary.starts.self;
  const responseBalanced = summary.responses.comparableTurns > 2 && Math.abs(summary.responses.selfToOther - summary.responses.otherToSelf) <= Math.max(1, Math.round(summary.responses.comparableTurns * .25));
  const hypotheses: RelationshipHypothesis[] = [];
  if (otherLeads) hypotheses.push({ id: "hypothesis:other-initiative", claim: "在这份材料里，TA 重新开启聊天的次数更多，存在主动维持联系的行为线索。", supportIds: ["activity:starts"], counterIds: [], alternatives: ["主动开口不等于明确的恋爱意愿，还要看回应质量和后续行动。"], confidence: summary.starts.comparable >= 5 ? "中" : "低", whatToObserve: "下一次由 TA 主动开启后，是否继续提问、延续话题或落实具体安排。" });
  else if (selfLeads) hypotheses.push({ id: "hypothesis:self-initiative", claim: "在这份材料里，你重新开启聊天的次数更多，文字联系的发起更多来自你。", supportIds: ["activity:starts"], counterIds: [], alternatives: ["TA 也可能更习惯回应，或在线下和通话里投入，不能只凭文字发起次数定性。"], confidence: summary.starts.comparable >= 5 ? "中" : "低", whatToObserve: "接下来的自然互动中，看 TA 是否认真回应你的内容、主动延续或落实安排。" });
  else if (summary.starts.comparable > 2) hypotheses.push({ id: "hypothesis:shared-initiative", claim: "双方都有重新开启聊天的记录，发起行为相对接近。", supportIds: ["activity:starts"], counterIds: [], alternatives: ["发起次数没有反映每次聊天的质量和线下投入。"], confidence: "中", whatToObserve: "继续看谁会把聊天推进到具体行动，以及行动能否兑现。" });
  if (responseBalanced) hypotheses.push({ id: "hypothesis:reciprocal-response", claim: "双方在可比较的消息里都有接住对方的记录，互动回应具有一定互惠性。", supportIds: ["activity:responses"], counterIds: [], alternatives: ["回应次数没有判断语气、内容深度或现实投入。"], confidence: "中", whatToObserve: "观察对方是否会回应你的具体问题，并在下一轮主动延续。" });

  const periods = activityPeriods(summary);
  const activityTrend = periods.length ? `${periods[0].label} ${periods[0].sample} 条，${periods[1].label} ${periods[1].sample} 条；这只反映文字互动量，关系方向仍需结合内容与实际行动。` : "时间材料不足，暂不比较互动量变化。";
  const trend = "待了解" as const;
  const reciprocity = summary.starts.comparable && summary.responses.comparableTurns ? `发起比例：你 ${percent(summary.starts.selfPercent)}，TA ${percent(summary.starts.otherPercent)}；回应覆盖：TA 接住你 ${percent(summary.responses.otherCoverage)}。` : "当前材料不足以稳定判断双方投入是否均衡。";
  const risks = [
    summary.starts.comparable < 3 ? "发起轮次较少，暂不适合概括长期主动性。" : "",
    summary.undatedMessages ? `${summary.undatedMessages} 条消息缺少可靠日期，关系趋势可能不完整。` : "",
    summary.unreadVoices ? `${summary.unreadVoices} 条语音还没有转成文字，相关判断需要保留。` : "",
  ].filter(Boolean);
  const currentState = summary.messages < 3 ? "可读材料较少，暂不足以判断整体关系" : "已整理互动数据，关系状态还需结合原话与实际行动判断";
  const recommendation = "先围绕你当前最在意的一件事自然沟通，结合对方的具体回应再决定下一步；仅凭消息统计不建议改变关系投入。";
  const options = [{ label: "核对当前疑问", action: recommendation, observeWindow: "下一次与当前疑问相关的自然交流", stopCondition: "若对方明确拒绝或表达边界，尊重其回应并停止推进。" }];
  const primary = options[0];
  return {
    version: 1, question: selected, questionLabel: questionLabels[selected],
    coverage: { total: summary.messages, dated: summary.datedMessages, startDate: summary.startDate, endDate: summary.endDate, activeDays: summary.activeDays, voiceCount: summary.voices, voiceTranscribed: Math.max(0, summary.voices - summary.unreadVoices), identityNote: summary.unknown ? `${summary.unknown} 条身份待确认` : "双方身份已用于统计" },
    facts, hypotheses, claimActions: buildClaimActions(lines),
    unknowns: [summary.undatedMessages ? "部分消息没有可靠日期，无法判断完整时间线。" : "", summary.unreadVoices ? "部分语音没有文字，无法纳入语义判断。" : "", "聊天记录无法替代线下见面、通话和真实兑现情况；补充后会更新判断。"].filter(Boolean),
    relationship: { currentState, trend, reciprocity, risks, activityTrend },
    periods,
    decision: { recommendation, options, observeWindow: primary.observeWindow, stopCondition: primary.stopCondition },
    personalConnection: { commonPoints: [], fit: "共同点需要结合你的个人资料与对方的聊天、朋友圈内容后生成。", friction: [] },
  };
}

/** Merge only source-checked semantic findings; never turn missing data into rejection. */
export function applySemanticDiagnosis(diagnosis: RelationshipDiagnosis, semantic: SemanticHistoryReport): RelationshipDiagnosis {
  if (!semantic.summary || !semantic.summaryEvidenceIds.length) return diagnosis;
  const evidence = semantic.findings.map(item => ({ id: item.id, claim: item.claim, source: (item.evidence.every(source=>source.basis==="visual") ? "media" : item.evidence.every(source=>source.sourceKind==="moments") ? "moments" : "conversation") as RelationshipEvidence["source"],
    sourceIds: item.evidence.map(source => source.sourceId), quotes: item.evidence, sample: item.evidence.length,
    metric: [...new Set(item.evidence.map(source => source.at).filter(Boolean))].join(" · ") }));
  diagnosis.facts.push(...evidence);
  diagnosis.hypotheses = [{ id: "hypothesis:relationship", claim: semantic.summary,
    supportIds: semantic.summaryEvidenceIds, counterIds: semantic.counterEvidenceIds || [],
    alternatives: semantic.alternatives?.length ? semantic.alternatives : [...new Set(semantic.findings.filter(item => semantic.summaryEvidenceIds.includes(item.id)).map(item => item.alternative))].slice(0, 3),
    confidence: semantic.confidence || "低", whatToObserve: semantic.observeWindow || "结合下一次真实互动核对判断。" }];
  diagnosis.relationship.currentState = semantic.summary;
  diagnosis.relationship.trend = semantic.trend;
  if (semantic.reciprocity) diagnosis.relationship.reciprocity = semantic.reciprocity;
  diagnosis.unknowns = [...new Set([...(semantic.unknowns || []), ...diagnosis.unknowns])];
  if (semantic.action && semantic.actionEvidenceIds.length) {
    diagnosis.decision.recommendation = semantic.action;
    diagnosis.decision.observeWindow = semantic.observeWindow || "下一次与这件事相关的真实互动";
    diagnosis.decision.stopCondition = semantic.stopCondition || "若对方明确拒绝或出现与当前判断相反的新证据，停止推进并重新判断。";
    // Keep one grounded plan rather than presenting four conflicting generic choices.
    diagnosis.decision.options = [{ label: "当前建议", action: semantic.action, observeWindow: diagnosis.decision.observeWindow, stopCondition: diagnosis.decision.stopCondition }];
  }
  if(semantic.actionPlan?.steps.length){
    const first=semantic.actionPlan.steps[0];
    diagnosis.decision.recommendation=first.action;
    diagnosis.decision.observeWindow=first.observeFor;
    diagnosis.decision.stopCondition=first.stopWhen;
    diagnosis.decision.options=semantic.actionPlan.steps.map(step=>({label:step.title,action:step.action,observeWindow:step.observeFor,stopCondition:step.stopWhen}));
  }
  if(!semantic.actionPlan?.steps.length&&!semantic.action&&semantic.actionUnavailableReason){
    diagnosis.decision={recommendation:semantic.actionUnavailableReason,options:[],observeWindow:"",stopCondition:""};
  }
  return diagnosis;
}

export function relationshipReportDocument(diagnosis: RelationshipDiagnosis, semantic?: Partial<SemanticHistoryReport> | null) {
  const voices = diagnosis.coverage.voiceCount;
  return {
    question: diagnosis.questionLabel,
    coverage: {
      messageCount: diagnosis.coverage.total,
      dateRange: [diagnosis.coverage.startDate, diagnosis.coverage.endDate],
      voiceCoverage: voices ? Number((diagnosis.coverage.voiceTranscribed / voices).toFixed(2)) : null,
      analyzedText: semantic?.coverage?.analyzedText ?? null,
      limitation: semantic?.status === "complete" ? "" : semantic?.coverage?.limitation || "",
    },
    facts: diagnosis.facts.map(fact => ({
      id: fact.id,
      claim: fact.claim,
      value: fact.value || "",
      range: fact.metric || (diagnosis.coverage.startDate && diagnosis.coverage.endDate ? `${diagnosis.coverage.startDate} 至 ${diagnosis.coverage.endDate}` : ""),
      sample: fact.sample ?? (fact.id === "activity:starts" ? Number(fact.metric?.match(/\d+/)?.[0] || 0) : fact.id === "activity:responses" || fact.id === "activity:reply-gap" ? Number(fact.value?.match(/样本 (\d+)/)?.[1] || fact.metric?.match(/样本 (\d+)/)?.[1] || 0) : diagnosis.coverage.total),
      sourceIds: fact.sourceIds || [], quotes: fact.quotes || [],
    })),
    hypotheses: diagnosis.hypotheses,
    unknowns: diagnosis.unknowns,
    affinity:semantic?.affinity,
    changes:semantic?.changeInsights||[],
    sourceInsights:semantic?.sourceInsights,
    actionPlan:semantic?.actionPlan,
    analysisQuestion:diagnosis.question,
    riskAssessment:semantic?.riskAssessment,
    timeline: semantic?.timeline?.length ? semantic.timeline : diagnosis.periods.map(period => ({ trend: "互动量", note: `${period.label} ${period.range}：共 ${period.sample} 条，你 ${period.self}，TA ${period.other}` })),
    decision: {
      action: diagnosis.decision.recommendation,
      observeFor: diagnosis.decision.observeWindow,
      stopCondition: diagnosis.decision.stopCondition,
      options: diagnosis.decision.options,
    },
  };
}

