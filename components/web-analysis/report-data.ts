import {relationshipRiskReview} from "@/lib/relationship-risk";
type Row = Record<string, any>;

export const profileLabels: Record<string, string> = { ageRange: "年龄", city: "常住地", education: "学历", occupation: "职业", relationshipStatus: "婚恋状态", childrenPlan: "婚育想法", lifestyle: "生活方式", stage: "关系阶段", howMet: "认识方式", values: "价值观", boundaries: "边界" };
export const validScore = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;

// A screenshot can contain useful dimensions before there is enough evidence
// for a combined score. Keep those dimensions, including genuine zero values.
export function reportAffinity(report: Row): Row | null {
  if (report.affinityStatus === "unread_media") return null;
  const candidates = [report.affinity, report.decision?.affinityPreview].filter(value => value && typeof value === "object");
  const usable = (value: Row) => validScore(value.value) || (Array.isArray(value.dimensions) && value.dimensions.some((row: Row) => row && row.status !== "insufficient" && validScore(row.value)));
  return candidates.find(usable) || candidates[0] || null;
}

const readableMessage = (line: Row) => typeof line?.text === "string" && !!line.text.trim() && !/^\s*[\[【](?:图片|照片|语音|视频|文件|表情(?:包)?|贴纸|动图|image|sticker|gif)(?:[\]】]|[：:])/i.test(line.text);

// A complete chart of *visible evidence*, rather than an invented affection score.
// Zero means that this excerpt contains no matching cue; it says nothing about
// the person's feelings outside the material supplied by the user.
export function visibleSignalProfile(lines: Row[] = []) {
  const seen = new Set<string>();
  const other = lines.filter(line => {
    if (line?.speaker !== "other" || !readableMessage(line)) return false;
    const key = line.sourceLineId || line.id ? JSON.stringify([line.sourceLineId || line.id, line.speaker, line.text]) : "";
    if (key && seen.has(key)) return false;
    if (key) seen.add(key);
    return true;
  });
  const rules = [
    { key: "initiative", label: "主动延续", test: (text: string) => /[？?]|下次|改天|周[一二三四五六日天]|要不要|你觉得/.test(text) },
    { key: "engagement", label: "回应投入", test: (text: string) => text.replace(/\s/g, "").length >= 16 },
    { key: "care", label: "关心体贴", test: (text: string) => /怎么样|到家|早点睡|辛苦|记得|休息|注意|别太累|送你/.test(text) },
    { key: "openness", label: "自我开放", test: (text: string) => /我(?:最近|其实|觉得|也有|挺|很|喜欢|想)|跟你聊天/.test(text) },
    { key: "intimacy", label: "亲近表达", test: (text: string) => /喜欢跟你|想你|想见你|跟你聊天.*(?:开心|轻松)|多了解你|在意你/.test(text) },
    { key: "action", label: "具体行动", test: (text: string) => /我(?:订票|买票|拍了|发给你|去接你|送你)|周[一二三四五六日天].{0,12}(?:见|去)|[一二三四五六七八九十0-9]点.{0,12}(?:见|去)/.test(text) },
  ];
  return rules.map(rule => {
    const matches = other.filter(line => rule.test(line.text));
    return { key: rule.key, label: rule.label, count: matches.length,
      value: Math.min(100, matches.length * 25),
      evidence: matches.slice(0, 2).map(line => line.text.slice(0, 85)),
      source: "本段原话" };
  });
}

// Counts describe visible turns. Missing speakers/media interrupt adjacency;
// repeated ordinary phrases remain distinct unless the same source ID is reused.
export function interactionMetrics(lines: Row[] = []) {
  const seen = new Set<string>(), turns: Row[] = [];
  let interrupted = true;
  for (const line of lines) {
    if (!line || !["self", "other"].includes(line.speaker) || !readableMessage(line)) { interrupted = true; continue; }
    const key = line.sourceLineId || line.id ? JSON.stringify([line.sourceLineId || line.id, line.speaker, line.text]) : "";
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    const last = turns.at(-1);
    if (!interrupted && last && last.speaker === line.speaker) last.text += "\n" + line.text;
    else turns.push({ speaker: line.speaker, text: line.text, interrupted });
    interrupted = false;
  }
  const other = turns.filter(line => line.speaker === "other");
  const inviting = (text: string) => !/不约|不见|取消|没约|未约|上次|昨天|他说|她说|听说/.test(text) && /(?:要不要|要不|我们|咱们|一起).{0,15}(?:见面|见一面|吃饭|喝咖啡|看电影|逛街)/.test(text);
  const activeCount = other.filter(line => /[？?]|要不要|你觉得/.test(line.text) || inviting(line.text)).length;
  const responses = turns.filter((line, index) => line.speaker === "other" && !line.interrupted && turns[index - 1]?.speaker === "self");
  const expandedCount = responses.filter(line => line.text.replace(/\s/g, "").length >= 15 || /[？?]/.test(line.text)).length;
  const invitationCount = other.filter(line => inviting(line.text)).length;
  const boundary = other.some(line => /别再联系我|不要再联系我|不要联系我|别联系我|别再找我|不想和你继续|不想跟你继续/.test(line.text));
  return { otherTurnCount: other.length, activeCount, responseCount: responses.length, expandedCount, invitationCount, boundary,
    activeRate: other.length ? Math.round(activeCount / other.length * 100) : null,
    replyExpansion: responses.length ? Math.round(expandedCount / responses.length * 100) : null,
    stage: boundary ? "明确退出信号" : invitationCount ? "出现邀约线索" : "交流了解中",
    redFlag: boundary ? "对方明确要求停止联系，应尊重边界并停止主动推进。" : "本轮没有识别到明确停止联系的原话，不等于已排除其他风险。",
    opportunity: activeCount ? "对方有提问或邀约表达，可围绕原话具体回应。" : "先观察对方是否回应并延伸话题，不从短句直接推断冷淡。",
    stopAdvice: boundary ? "停止主动联系，尊重对方的明确表达。" : "降低投入要看多次真实互动与已确认失约，不能按重复分析次数决定。",
    issues: [other.length < 3 ? "当前对方原话较少，本轮比例不能代替长期主动率。" : "", !responses.length ? "截图没有完整的我方发言 → 对方回应，回应扩展度暂不计分。" : "", invitationCount ? "邀约需关联具体约定与后续结果，见面回顾不直接计为兑现。" : ""].filter(Boolean) };
}

export function historicalTrend(points: Row[] = [], subjectId: string, reportId: string) {
  if (points.some(point => point.subjectId === subjectId && point.reportId !== reportId && point.sourceReportIds?.includes(reportId))) return { title: "已记录的互动", delta: null, note: "这段材料已合并到已有记录，重新分析不新增关系进展，也不累计加分。" };
  const date = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + "T00:00:00Z")) && new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;
  const dated = points.filter(point => point.subjectId === subjectId && date(point.eventStart) && date(point.eventEnd) && point.eventStart <= point.eventEnd);
  const latest = dated.find(point => point.reportId === reportId), before = latest && dated.find(point => point.reportId === latest.previousReportId);
  if (!latest || !before || !latest.connectPrevious || before.eventEnd >= latest.eventStart || !validScore(latest.score) || !validScore(before.score)) return { title: "待对照历史", delta: null, note: "还没有两段日期明确、去重且可比的独立互动。" };
  const delta = Math.round(latest.score - before.score);
  return { title: delta > 0 ? "参考指标上升" : delta < 0 ? "参考指标下降" : "参考指标持平", delta, note: `${before.eventEnd} → ${latest.eventEnd}，互动参考指数 ${before.score} → ${latest.score}；不是好感概率。` };
}

export function mergeChatReports(reports: Row[]): Row | null {
  const last = reports.at(-1);
  if (!last) return null;
  const merged:Row = { ...last, lines: reports.flatMap((report, index) => (report.lines || []).map((line: Row, position: number) => ({ ...line, sourceLineId: line.id, id: `${index + 1}:${line.id || position}`, screenshotNumber: report.captureFormat === "records" ? undefined : index + 1 }))),
    annotations: reports.flatMap((report, index) => (report.annotations || []).map((row: Row) => ({ ...row, lineId: `${index + 1}:${row.lineId}` }))),
    decision: { ...last.decision, photoClues: reports.flatMap((report, index) => (report.decision?.photoClues || []).map((clue: Row) => ({ ...clue, location: `图 ${index + 1} · ${clue.location || "照片"}` }))), mediaBubbles: reports.flatMap((report, index) => (report.decision?.mediaBubbles || []).map((bubble: Row) => ({ ...bubble, lineId: `${index + 1}:${bubble.lineId}`, screenshotNumber: report.captureFormat === "records" ? undefined : index + 1 }))) } };
  merged.riskReview=relationshipRiskReview({...merged,riskReview:{signals:reports.flatMap(report=>relationshipRiskReview(report).signals)}});
  return merged;
}

export function socialPrevious(report: Row) {
  const short = (value: unknown, max: number) => typeof value === "string" ? value.slice(0, max) : "";
  const rows = (items: Row[] | undefined, count: number, lengths: Record<string, number>) => (items || []).slice(0, count).map(item => Object.fromEntries(Object.entries(lengths).map(([key, max]) => [key, short(item[key], max)])));
  const riskReview=relationshipRiskReview(report);
  const retainedFacts=[...riskReview.signals.map(signal=>({title:"先前材料中的原话",evidence:signal.evidence,meaning:"先前分析引用的原话，结合本批内容复核。"})),...(report.visibleFacts||[])];
  return { riskReview, summary: short(report.summary, 180), visibleFacts: rows(retainedFacts, 8, { title: 32, evidence: 240, meaning: 100 }), positives: rows(report.positives, 3, { title: 32, evidence: 120, meaning: 100 }), cautions: rows(report.cautions, 3, { title: 32, evidence: 120, meaning: 100 }),
    hypotheses: rows(report.hypotheses, 2, { title: 40, evidence: 120, possibility: 140, alternative: 100, verify: 100 }), riskSignals: rows(report.riskSignals, 2, { category: 32, evidence: 120, check: 100, level: 2 }), fit: rows(report.fit, 2, { dimension: 24, selfNeed: 90, evidence: 120, reading: 100, conclusion: 90, status: 3 }), profileBasics: rows(report.profileBasics, 7, { field: 20, value: 70, evidence: 100 }), unknowns: (report.unknowns || []).slice(0, 5).map((item: string) => short(item, 70)), questions: (report.questions || []).slice(0, 3).map((item: string) => short(item, 90)) };
}

export function socialArchiveMaterial(report: Row, targetSelf: boolean) {
  return { candidates: [...(report.visibleFacts || []).slice(0, 8).map((row: Row) => ({ title: row.title, evidence: row.evidence })), ...(report.profileContext || []).slice(0, 4).map((row: Row) => ({ title: `${profileLabels[row.field] || row.field}：${row.value}`, evidence: row.evidence }))].slice(0, 12), basics: [...(report.profileBasics || []).slice(0, 7), ...(!targetSelf ? report.profileContext || [] : [])].map((row: Row) => ({ field: row.field, value: row.value, evidence: row.evidence })) };
}
