import type { CrushResult } from "@/lib/crush/types";
import { explicitEventDate, relationshipMaterial } from "@/lib/relationship-timeline";
import { createHash } from "node:crypto";

const kinds = { invite: "发出邀约", boundary: "表达边界", apologize: "表达歉意" } as const;
// Speech acts are candidates, not proof of meeting fulfillment or intention.
// Keep quoted evidence transient until the existing explicit confirmation flow.
export function relationshipEventCandidates(report: Pick<CrushResult, "id" | "lines" | "annotations">) {
  let date = "";
  const material = relationshipMaterial(report.lines).signature;
  return report.lines.flatMap(line => {
    const raw = line.timestampRaw || "";
    const explicit = explicitEventDate(raw);
    if (explicit) date = explicit;
    else if (raw && !/^\s*(?:上午|下午|晚上|凌晨|早上)?\s*\d{1,2}[:：]\d{2}(?::\d{2})?\s*$/.test(raw)) date = "";
    if (line.speaker !== "self" && line.speaker !== "other") return [];
    const annotation = report.annotations.find(item => item.lineId === line.id);
    if (!annotation || annotation.evidence !== "sufficient" || !line.text?.trim()) return [];
    const intent = annotation.intent.find(item => Object.hasOwn(kinds, item.key));
    if (!intent) return [];
    const kind = intent.key as keyof typeof kinds;
    const clock = raw.match(/(?:上午|下午|晚上|凌晨|早上)?\s*\d{1,2}[:：]\d{2}(?::\d{2})?/)?.[0].replace(/\s/g, "") || "";
    const eventKey = createHash("sha256").update(JSON.stringify([kind,line.speaker,date,clock,line.text.trim(),date ? "" : material])).digest("hex");
    return [{ sourceReportId: report.id, sourceLineId: line.id, speaker: line.speaker,
      kind, title: kinds[kind], spokenDate: date, timestampRaw: raw, eventKey,
      quote: line.text, confirmed: false as const, scope: "speech_act" as const }];
  });
}
