export type RiskAlert = { title: string; level: "clarify" | "boundary" | "safety"; evidence: string; uncertainty: string; nextStep: string };
export type RiskReport = { summary: string; alerts: RiskAlert[]; questions: string[] };

export function parseRiskReport(value: unknown, source: string, hasImage: boolean): RiskReport {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("RISK_FORMAT");
  const data = value as Record<string, unknown>;
  const clean = (input: unknown, limit: number) => typeof input === "string" ? input.trim().slice(0, limit) : "";
  const summary = clean(data.summary, 700);
  if (!summary || !Array.isArray(data.alerts) || !Array.isArray(data.questions)) throw new Error("RISK_FORMAT");
  const normalizedSource = source.replace(/\s+/g, "");
  const alerts: RiskAlert[] = data.alerts.slice(0, 4).flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
    const item = candidate as Record<string, unknown>;
    const alert: RiskAlert = { title: clean(item.title, 60), level: item.level === "safety" || item.level === "boundary" ? item.level : "clarify", evidence: clean(item.evidence, 160), uncertainty: clean(item.uncertainty, 240), nextStep: clean(item.nextStep, 240) };
    if (!alert.title || !alert.evidence || !alert.uncertainty || !alert.nextStep) return [];
    if (!hasImage && !normalizedSource.includes(alert.evidence.replace(/\s+/g, ""))) return [];
    return [alert];
  });
  return {
    summary: data.alerts.length && !alerts.length ? "这次没有得到能与材料核对的提醒。请补充具体原话、发生次数或对方对你明确表达后的回应。" : summary,
    alerts,
    questions: data.questions.slice(0, 3).map((item) => clean(item, 180)).filter(Boolean),
  };
}
