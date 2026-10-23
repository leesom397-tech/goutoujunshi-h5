import { projectMomentsInterpretations, validatedMomentsInterpretations } from "./moments-interpretations";

type Row = Record<string, any>;
export type MomentsValueItem = {
  id: string; label: string; reading: string; alternative: string; nextStep: string;
  evidence: Row[]; basis: "saved-interpretation" | "saved-finding" | "saved-profile" | "saved-legacy";
};
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.filter(item => item && typeof item === "object") : [];
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const key = (value: string) => value.replace(/[\s\p{P}\p{S}]/gu, "");
const unique = (items: MomentsValueItem[]) => items.filter((item, index) => items.findIndex(other => key(other.reading) === key(item.reading)) === index);

/** Reads saved material only. No model request, estimated identity or invented opener. */
export function reportMomentsValue(report: Row) {
  const semantic = report.semanticHistory || report.relationshipDiagnosis?.semanticHistory || {};
  const momentLibraries = new Set([...rows(report.sourceCoverage), ...rows(report.relatedSnapshots)].filter(row => row.kind === "moments").map(row => row.libraryId));
  const isMoment = (item: Row) => item.sourceKind === "moments" || item.kind === "moments" || !!item.libraryId && momentLibraries.has(item.libraryId);
  const findings: Row[] = rows(semantic.findings).filter(row => text(row.claim)).map(row => ({ ...row, evidence: rows(row.evidence).filter(source => text(source.quote)).map(source => ({ ...source, sourceKind: isMoment(source) ? "moments" : source.sourceKind || "chat" })) }));
  const evidence = (ids: unknown): Row[] => findings.filter(row => Array.isArray(ids) && ids.includes(row.id)).flatMap(row => rows(row.evidence)).filter((source, index, all) => all.findIndex(other => other.libraryId === source.libraryId && other.sourceId === source.sourceId && other.quote === source.quote) === index);
  const saved = validatedMomentsInterpretations(semantic.sourceInsights?.moments?.interpretations, findings as any);
  const interpretations = saved.length ? saved : projectMomentsInterpretations({ ...semantic, findings });
  const primary: MomentsValueItem[] = interpretations.map((row, index) => ({ id: `interpretation-${index}`, label: row.dimension, reading: row.reading, alternative: row.alternative, nextStep: row.nextStep, evidence: evidence(row.evidenceIds), basis: row.basis === "saved-finding" ? "saved-finding" : "saved-interpretation" }));
  primary.sort((a, b) => ["生活与工作", "反复主题", "图文对照", "聊天对照", "自我呈现"].indexOf(a.label) - ["生活与工作", "反复主题", "图文对照", "聊天对照", "自我呈现"].indexOf(b.label));
  const covered = new Set(interpretations.flatMap(row => row.evidenceIds));
  const additional: MomentsValueItem[] = findings.filter(row => !covered.has(row.id) && row.evidence.some(isMoment)).map((row, index) => ({ id: `finding-${row.id || index}`, label: text(row.dimension) || "已保存的推测", reading: row.claim, alternative: text(row.alternative), nextStep: "", evidence: row.evidence, basis: "saved-finding" }));
  const profile: MomentsValueItem[] = rows(semantic.profileInsights).filter(row => text(row.reading) && row.subject !== "self" && evidence(row.evidenceIds).some(isMoment)).map((row, index) => ({ id: `profile-${index}`, label: text(row.dimension) || "人物线索", reading: row.reading, alternative: text(row.alternative), nextStep: text(row.verify), evidence: evidence(row.evidenceIds), basis: "saved-profile" }));
  const legacySource = report.moments || (report.captureKind === "moments" ? report : null);
  const legacy: MomentsValueItem[] = [];
  if (legacySource) {
    for (const field of ["hypotheses", "behaviorClues", "themes", "photoClues", "profileBasics", "profileContext"] as const) {
      const combined = [...rows(legacySource[field]), ...(legacySource !== report ? rows(report[field]) : [])];
      for (const [index, row] of combined.entries()) {
        const reading = text(row.possibility || row.inference || row.reading || row.meaning || row.valueHint || row.value || row.observation || row.style);
        const quote = text(row.evidence || row.quote);
        if (!reading || !quote) continue;
        legacy.push({ id: `legacy-${field}-${index}`, label: text(row.title || row.dimension || row.item || row.category || row.field) || "原报告线索", reading, alternative: text(row.alternative), nextStep: text(row.verify || row.check), evidence: [{ quote, sourceKind: "moments" }], basis: "saved-legacy" });
      }
    }
  }
  const cross = semantic.sourceInsights?.moments?.crossSource, crossEvidence = evidence(cross?.evidenceIds);
  const crossSource: MomentsValueItem | null = text(cross?.summary) && crossEvidence.some(isMoment) && crossEvidence.some(row => !isMoment(row)) ? { id: "cross-source", label: "图片、配文与聊天怎么对应", reading: cross.summary, alternative: "", nextStep: "", evidence: crossEvidence, basis: "saved-interpretation" } : null;
  const existing = new Set(primary.map(item => key(item.reading)));
  const other = unique([...profile, ...legacy, ...additional]).filter(item => !existing.has(key(item.reading)));
  return { primary: unique(primary), other, crossSource, legacySource,
    unknowns: Array.isArray(semantic.sourceInsights?.moments?.unknowns) ? semantic.sourceInsights.moments.unknowns.filter((item: unknown) => text(item)) as string[] : [],
  };
}
