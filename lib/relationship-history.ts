import { getD1 } from "@/db";
import type { CrushResult } from "@/lib/crush/types";
import { relationshipMaterial } from "@/lib/relationship-timeline";

const percentage = (a: number, b: number) => b ? Math.round(a / b * 100) : null;
// These are textual clues, not linked invitation events. Never derive a
// fulfillment percentage from the number of mentions in a screenshot.
function meetingClues(text: string) {
  const sentences = (text.match(/[^。！!？?\n]+[。！!？?]?/g) || []).map(part => part.trim()).filter(Boolean);
  const blocked = (part: string) => /[“”「」『』"？?]|听说|听人说|他说|她说|你说|假如|如果|要是|希望|期待|想象|梦见|本来|原本|可惜|没|未|不|取消|改天|下次|明天|后天|下周|将来/.test(part);
  return {
    invitation: sentences.some(part => !/取消|不约|不见|没约|未约/.test(part) && /(?:要不要|要不|可以|我们|咱们|和你|跟你|一起).{0,16}(?:吃饭|喝咖啡|看电影|逛街|见面)|(?:周[一二三四五六日天]|几点).{0,12}(?:见面|见一面|见$)/.test(part)),
    recap: sentences.some(part => !blocked(part) && /(?:昨天|昨晚|上次|刚才).{0,16}(?:见面|见到你)|见到你.{0,6}(?:很开心|很高兴)|今天.{0,12}见面.{0,12}(?:开心|愉快|聊得)|(?:昨天|昨晚|上次).{0,12}(?:和你|跟你|我们|咱们).{0,12}(?:吃饭|喝咖啡|看电影|逛街)|今天.{0,12}(?:和你|跟你|我们|咱们).{0,12}(?:吃饭|喝咖啡|看电影|逛街).{0,12}(?:开心|愉快|聊得)/.test(part))
  };
}
export function observedSignals(report: Pick<CrushResult, "lines" | "decision" | "createdAt">) {
  const lines = report.lines.filter(line => line.speaker === "self" || line.speaker === "other");
  const other = lines.filter(line => line.speaker === "other");
  const self = lines.filter(line => line.speaker === "self");
  const asking = other.filter(line => /[？?]|要不要|什么时候|一起|你觉得/.test(line.text)).length;
  let opportunities = 0, responded = 0, expanded = 0;
  lines.forEach((line, i) => { if (line.speaker === "self" && lines[i + 1]) { opportunities++; if (lines[i + 1].speaker === "other") { responded++; if (lines[i + 1].text.length >= 15 || /[？?]/.test(lines[i + 1].text)) expanded++; } } });
  const meeting = lines.map(line => meetingClues(line.text));
  const invitationCount = meeting.filter(item => item.invitation).length;
  const completionCount = meeting.filter(item => item.recap).length;
  const clearStop = other.some(line => /别再联系|不要再联系|不想继续|别再找我/.test(line.text));
  const activeRate = percentage(asking, other.length);
  const responseRate = percentage(responded, opportunities);
  const replyExpansion = percentage(expanded, responded);
  const dimensions = [
    { label: "主动表达", value: activeRate }, { label: "回应承接", value: responseRate },
    { label: "回应扩展", value: replyExpansion },
    { label: "邀约兑现", value: null },
    { label: "边界尊重", value: null }, { label: "互惠稳定", value: null }
  ];
  const known = dimensions.filter(item => item.value !== null);
  return { dimensions, score: known.length ? Math.round(known.reduce((sum, item) => sum + (item.value || 0), 0) / known.length) : null, comparable: false, estimated: true,
    activeRate, replyExpansion, invitationCount, completionCount, meetingCountScope: "text_clues_not_events",
    stage: clearStop ? "明确退出信号" : completionCount ? "出现见面回顾线索" : invitationCount ? "邀约了解中" : "交流了解中",
    nextStep: clearStop ? "停止主动推进，尊重对方明确表达的边界。" : invitationCount && !completionCount ? "先核对邀约是否落实，不把口头答应当成已经见面。" : "围绕共同话题继续一次自然交流，观察对方是否主动延伸。",
    sampleSize: lines.length, selfCount: self.length, otherCount: other.length };
}

export async function recordRelationshipHistory(owner: string, subjectId: string, report: CrushResult) {
  const db = getD1();
  const profile = await db.prepare("SELECT consent_at,paused FROM coach_profiles WHERE owner_id=?").bind(owner).first<{ consent_at: number | null; paused: number }>();
  if (!profile?.consent_at || profile.paused) return;
  const material = relationshipMaterial(report.lines);
  if (!material.signature) return;
  const signature = material.signature;
  const observed = observedSignals(report);
  const affinity = report.affinity || report.decision?.affinityPreview;
  const score = typeof affinity?.value === "number" ? affinity.value : observed.score;
  const dimensions = affinity?.dimensions?.length ? affinity.dimensions : observed.dimensions;
  const eventLabel = report.lines.find(line => line.timestampRaw)?.timestampRaw || "";
  const point = { ...observed, ...material, subjectId, reportId: report.id, signature, score, dimensions, comparable: affinity?.valueScope === "full", estimated: affinity?.valueScope !== "full", updatedAt: report.createdAt, eventLabel, summary: report.decision?.judgment || report.decision?.possibleIntent || observed.nextStep, nextStep: report.decision?.nextStep || observed.nextStep };
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await db.prepare("SELECT data FROM coach_subjects WHERE id=? AND owner_id=? AND status='active'").bind(subjectId, owner).first<{ data: string }>();
    if (!row) return;
    let data: Record<string, unknown>;
    try { data = JSON.parse(row.data); } catch { data = {}; }
    const history = Array.isArray(data.relationshipHistory) ? data.relationshipHistory as typeof point[] : [];
    if (history.some(item => item.signature === signature || item.reportId === report.id)) return;
    const updated = await db.prepare("UPDATE coach_subjects SET data=json_set(data,'$.relationshipHistory',json(?)),updated_at=? WHERE id=? AND owner_id=? AND data=? AND EXISTS (SELECT 1 FROM coach_profiles WHERE owner_id=? AND consent_at IS NOT NULL AND paused=0)").bind(JSON.stringify([...history, point].slice(-120)), Date.now(), subjectId, owner, row.data, owner).run();
    if (updated.meta.changes) return;
  }
  throw new Error("RELATIONSHIP_HISTORY_CONCURRENT_UPDATE");
}
