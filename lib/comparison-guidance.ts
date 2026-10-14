import type { ArchiveState, ArchiveFact, Person } from "@/app/archive/types";
import { personalConnection, type PersonalEvidence, type PersonalInsight } from "./personal-context";
import { relationshipFit } from "./relationship-fit";

export type ComparisonSource = { label: string; quote: string; side: "self" | "other" | "interaction" | "pending"; reportId?: string };
export type ComparisonFinding = { title: string; reading: string; basis: "confirmed" | "report" | "inference" | "missing" | "pending"; sources: ComparisonSource[] };
export type PersonGuidance = {
  id: string; label: string; tone: "explore" | "verify" | "observe";
  headline: string; summary: string;
  commonPoints: ComparisonFinding[]; strengths: ComparisonFinding[]; cautions: ComparisonFinding[];
  expectation: ComparisonFinding; investment: ComparisonFinding; boundaries: ComparisonFinding;
  nextStep: string; verifyQuestion: string; reportId: string;
};
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const known = (value: unknown) => /^(未知|不详|待了解|待补充|未填写|暂无|不知道|不清楚|尚未记录|未提供|待确认)(?:\s|[·：:]|$)/.test(text(value)) ? "" : text(value);
const list = <T>(value: T[] | undefined): T[] => Array.isArray(value) ? value : [];
const labels: Record<string, string> = { lifestyle: "生活方式", interests: "兴趣", communicationStyle: "沟通偏好", values: "看重的事", boundaries: "相处边界", preferredRelationship: "关系期待", goals: "当前目标", relationshipStatus: "婚恋状态与目标", childrenPlan: "婚育想法", city: "常住地", occupation: "职业" };
const personalKeys = ["lifestyle", "interests", "communicationStyle", "values", "boundaries", "preferredRelationship", "goals", "relationshipStatus", "childrenPlan"];
const profileKeys = ["lifestyle", "values", "boundaries", "relationshipStatus", "childrenPlan", "city", "occupation"];

function confirmedPerson(person: Person, facts: ArchiveFact[]) {
  const values: Record<string, string> = {}, sources: Record<string, ComparisonSource> = {};
  for (const key of profileKeys) {
    const manual = known((person as unknown as Record<string, unknown>)[key]);
    const accepted = facts.find(fact => fact.status === "accepted" && fact.kind === `subjectBasic:${key}` && known(fact.value));
    const value = manual || known(accepted?.value);
    if (!value) continue;
    values[key] = value;
    sources[key] = { side: "other", label: accepted && value === known(accepted.value) ? `已核对档案 · ${labels[key]}` : `人物档案 · ${labels[key]}`, quote: value };
  }
  return { values, sources };
}
function dated(value: unknown) {
  const raw = text(value); if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "";
  const day = new Date(raw + "T00:00:00Z");
  return Number.isFinite(day.getTime()) && day.toISOString().slice(0, 10) === raw ? raw : "";
}
const insightFinding = (item: PersonalInsight, evidence: PersonalEvidence[]): ComparisonFinding => ({ title: item.title, reading: item.reading,
  basis: item.kind === "supported" ? "confirmed" : "inference",
  sources: evidence.filter(source => item.evidenceIds.includes(source.id)).map(source => ({ label: source.label, quote: source.quote, side: source.side })) });

/** Local projection only. Pending claims and previous model summaries never become confirmed interests. */
export function buildComparisonGuidance(state: Partial<ArchiveState> = {}, selectedIds: string[] = []) {
  const subjects = list(state.subjects), ids = [...new Set(selectedIds)].filter(id => subjects.some(person => person.id === id)).slice(0, 3);
  if (state.enabled === false || state.paused === true) return { people: [] as PersonGuidance[], hasSelf: false, preferences: [] as ComparisonSource[], disabled: true };
  const own = (state.self || {}) as Record<string, unknown>;
  const preferences: ComparisonSource[] = personalKeys.filter(key => known(own[key])).map(key => ({ side: "self", label: `你 · ${labels[key]}`, quote: known(own[key]) }));
  const selfEvidence: PersonalEvidence[] = personalKeys.filter(key => known(own[key])).map(key => ({ id: `self:${key}`, side: "self", source: "self-profile", field: key, label: `你的资料 · ${labels[key]}`, quote: known(own[key]) }));
  const people: PersonGuidance[] = ids.map(id => {
    const person = subjects.find(item => item.id === id)!, facts = list(state.facts).filter(fact => fact.subjectId === id), confirmed = confirmedPerson(person, facts);
    const otherEvidence: PersonalEvidence[] = Object.entries(confirmed.values).map(([field, quote]) => ({ id: `person:${id}:${field}`, side: "other", source: "subject-profile", field, label: confirmed.sources[field].label, quote }));
    const connection = personalConnection({}, { evidence: [...selfEvidence, ...otherEvidence] });
    const commonPoints = connection.commonPoints.map(item => insightFinding(item, connection.sources));
    const differences = connection.differences.map(item => insightFinding(item, connection.sources));
    const fits = relationshipFit(own, confirmed.values).fit;
    const goal = fits.find(row => row.field === "relationshipStatus");
    const goalSources: ComparisonSource[] = ["preferredRelationship", "relationshipStatus", "childrenPlan"].filter(key => known(own[key])).map(key => ({ side: "self", label: `你 · ${labels[key]}`, quote: known(own[key]) }));
    for (const key of ["relationshipStatus", "childrenPlan"]) if (confirmed.sources[key]) goalSources.push(confirmed.sources[key]);
    const explicitDifference = connection.differences.find(item => item.id === "expectation");
    const explicitFinding = explicitDifference ? insightFinding(explicitDifference, connection.sources) : null;
    const expectationConflict = !!explicitFinding || (!!goal && goal.status === "有冲突" && goalSources.some(source => source.side === "self") && goalSources.some(source => source.side === "other"));
    const goalCommon = connection.commonPoints.find(item => item.id === "common-expectation");
    const expectation: ComparisonFinding = {
      title: expectationConflict ? "关系期待需要先聊清" : goalCommon ? "关系方向有明确交集" : confirmed.values.relationshipStatus ? "对方的期待已有记录" : "对方的关系期待还未明确",
      reading: expectationConflict ? explicitFinding?.reading || goal!.conclusion : goalCommon?.reading || (confirmed.values.relationshipStatus ? `已记录“${confirmed.values.relationshipStatus}”。是否愿意与你发展，还要看具体互动。` : "先自然了解对方目前想怎样相处，不从照片或回复频率推定关系目标。"),
      basis: expectationConflict ? "inference" : confirmed.values.relationshipStatus ? "confirmed" : "missing", sources: explicitFinding?.sources || goalSources,
    };
    const signal = list(state.signals).filter(item => item.subjectId === id).sort((a, b) => {
      const ad = dated(a.eventEnd), bd = dated(b.eventEnd); if (!!ad !== !!bd) return ad ? -1 : 1;
      return bd.localeCompare(ad) || (b.updatedAt || 0) - (a.updatedAt || 0);
    })[0];
    const reportId = text(signal?.reportId), date = dated(signal?.eventEnd);
    const signalScope = signal?.comparable && !signal.estimated ? "已有完整互动分析" : "已有片段分析";
    const investment: ComparisonFinding = signal ? {
      title: signalScope,
      reading: known(signal.summary) || "已有一份互动记录，可以回到原报告核对双方是否都在发起、回应和落实安排。",
      basis: "report", sources: [{ side: "interaction", label: `${signalScope}${date ? ` · 材料截至 ${date}` : " · 聊天日期未明确"}`, quote: signal.comparable && !signal.estimated ? "保留原报告的判断口径；不把分数直接当成是否适合你的结论。" : "片段不足以比较长期投入，不因资料少就认为对方更差。", ...(reportId ? { reportId } : {}) }],
    } : { title: "还没有可核对的互动记录", reading: "共同兴趣适合开场，是否愿意回应、守约和尊重边界，要靠实际相处确认。", basis: "missing", sources: [] };
    const boundarySources: ComparisonSource[] = [];
    if (known(own.boundaries)) boundarySources.push({ side: "self", label: "你 · 相处边界", quote: known(own.boundaries) });
    if (confirmed.sources.boundaries) boundarySources.push(confirmed.sources.boundaries);
    const boundaries: ComparisonFinding = { title: boundarySources.length ? "已表达的相处边界" : "边界还没有明确记录",
      reading: boundarySources.length === 2 ? "两边的要求已放在一起。表达了原则，还需要观察是否尊重彼此明确说出的需要。" : boundarySources.length ? "先把已经明确的需要说清楚，再观察对方的实际回应；没有记录不代表没有边界。" : "可以在具体安排中说明自己的时间与空间需要，看彼此是否愿意协调。",
      basis: boundarySources.length ? "confirmed" : "missing", sources: boundarySources };
    const pending = facts.filter(fact => fact.status === "pending" && known(fact.value));
    const cautions: ComparisonFinding[] = [...(expectationConflict ? [expectation] : []), ...differences.filter(item => !expectationConflict || !item.title.includes("关系期待"))].slice(0, 2);
    if (pending.length && cautions.length < 2) cautions.push({ title: "有一条档案线索尚未核对", reading: "这条信息尚不能用于判断共同点或决定加大投入。先确认它是否属于当前情况。", basis: "pending", sources: [{ side: "pending", label: pending[0].source ? `待核对 · ${pending[0].source}` : "待核对档案线索", quote: pending[0].value }] });
    const strengths = commonPoints.slice(0, 2);
    if (goalCommon && !strengths.some(item => item.title === goalCommon.title)) strengths.push(expectation);
    const priority = connection.commonPoints[0] || connection.entryPoints[0];
    const nextStep = expectationConflict ? "先表达你想要的关系，确认双方方向是否一致，再决定是否继续增加投入。" : known(signal?.nextStep) || priority?.action || "从对方明确提过的一件事自然聊起，观察是否愿意回应和共同安排下一次交流。";
    const ownGoal = known(own.preferredRelationship) || known(own.relationshipStatus) || known(own.goals);
    const verifyQuestion = expectationConflict ? ownGoal ? `“我目前的期待是${ownGoal}。你现在更想怎样相处？”` : "“我想先说清自己的关系期待，也想了解你现在更想怎样相处。”" : pending.length ? `关于“${pending[0].value.slice(0, 100)}”，这是现在的情况吗？有没有已经改变的地方？` : !confirmed.values.relationshipStatus && known(own.preferredRelationship) ? "我想先说说自己希望的相处方式，也想了解你现在更想发展怎样的关系？" : "这次聊完或见面以后，双方有没有自然地继续分享、回应或提出下一步？";
    const tone = expectationConflict ? "verify" : commonPoints.length ? "explore" : "observe";
    return { id, label: text(person.label) || "未命名人物", tone,
      headline: expectationConflict ? "先聊清重要期待，再决定投入" : commonPoints.length ? `有 ${commonPoints.length} 个明确交集，可以继续了解` : signal ? "先看这段互动如何落实" : "先用具体交流补上判断依据",
      summary: expectationConflict ? "共同兴趣不能抵消关系方向上的差异。" : commonPoints.length ? "共同点提供接近的理由，是否合拍仍看双向行动。" : !selfEvidence.length ? "目前以对方已有资料为线索；补充你的偏好后，可直接得到双侧对照。" : "现有材料不足以找出明确共同点，不等于不合适。",
      commonPoints, strengths: strengths.slice(0, 3), cautions, expectation, investment, boundaries, nextStep, verifyQuestion, reportId,
    };
  });
  return { people, hasSelf: selfEvidence.length > 0, preferences, disabled: false };
}
