import assert from "node:assert/strict";
import { analyzeCaptureSemanticHistory, chunkCaptureHistory, validatedChunkFindings } from "../lib/capture-semantic-history.ts";

const row = (index, text = `第${index}条消息：周末见面以后继续聊安排。`) => ({
  localId: `real-source-${index}`, kind: "text", senderRole: index % 2 ? "other" : "self",
  at: `2026-10-${String(1 + Math.floor(index / 30)).padStart(2, "0")} 10:00`, text,
});

const all = Array.from({ length: 675 }, (_, i) => row(i + 1));
const chunks = chunkCaptureHistory(all);
assert.ok(chunks.length > 1);
assert.equal(chunks.flat().length, all.length);
assert.deepEqual(chunks.flat().map(item => item.localId), all.map(item => item.localId));
assert.equal(new Set(chunks.flat().map(item => item.alias)).size, all.length);
assert.ok(chunks.every(chunk => chunk.length <= 250 && chunk.reduce((n, item) => n + item.text.length, 0) <= 16_000));

const tampered = validatedChunkFindings({ findings: [
  { claim: "有证据的观察", confidence: "中", alternative: "也可能是普通社交", evidence: [{ sourceId: chunks[0][0].alias, quote: "周末见面" }] },
  { claim: "捏造来源", evidence: [{ sourceId: "H9999", quote: "周末见面" }] },
  { claim: "捏造原话", evidence: [{ sourceId: chunks[0][0].alias, quote: "我已经答应结婚" }] },
] }, chunks[0], 0);
assert.equal(tampered.length, 1);
assert.equal(tampered[0].evidence[0].sourceId, "real-source-1");

const seen = [];
const qwen = async messages => {
  const payload = JSON.parse(messages[1].content);
  if (payload.rows) {
    seen.push(...payload.rows.map(item => item.sourceId));
    const chosen = payload.rows.at(-1);
    return JSON.stringify({ findings: [{ claim: `第${payload.segment}段有持续交谈的原话`, confidence: "中", alternative: "也可能只是朋友聊天",
      evidence: [{ sourceId: chosen.sourceId, quote: "继续聊安排" }] }] });
  }
  return JSON.stringify({ summary: "双方有持续聊天，也需核对现实行动。", summaryEvidenceIds: payload.findings.map(item => item.id),
    trend: "待了解", reciprocity: "双方都参与了聊天，意图仍需继续观察。", action: "下一次确认具体安排。",
    actionEvidenceIds: [payload.findings[0].id] });
};
const result = await analyzeCaptureSemanticHistory({ historyRecords: all, totalImported: 675, selectedLineCount: 40 }, qwen);
assert.equal(result.status, "complete");
assert.equal(result.coverage.receivedText, 675);
assert.equal(result.coverage.analyzedText, 675);
assert.equal(result.coverage.missingFromText, 0);
assert.equal(result.coverage.selectedLineCount, 40);
assert.equal(seen.length, 675);
assert.equal(new Set(seen).size, 675);
assert.equal(result.findings.length, chunks.length);
assert.equal(result.findings.at(-1).evidence[0].sourceId, "real-source-675");
assert.equal(result.summaryEvidenceIds.length, chunks.length);

const sparse = await analyzeCaptureSemanticHistory({ historyRecords: all.slice(0, 396), totalImported: 675, selectedLineCount: 40 }, qwen);
assert.equal(sparse.coverage.analyzedText, 396);
assert.equal(sparse.coverage.missingFromText, 279);
assert.match(sparse.coverage.limitation, /不能当作已读正文/);

const invalidSynthesis = await analyzeCaptureSemanticHistory({ historyRecords: [row(1)], totalImported: 2, selectedLineCount: 1 }, async messages => {
  const payload = JSON.parse(messages[1].content);
  return payload.rows ? JSON.stringify({ findings: [{ claim: "观察", evidence: [{ sourceId: "H1", quote: "继续聊安排" }] }] })
    : JSON.stringify({ summary: "没有依据的结论", summaryEvidenceIds: ["fake:id"], trend: "升温", action: "立刻表白", actionEvidenceIds: ["fake:id"] });
});
assert.match(invalidSynthesis.summary, /局部线索包括：观察/);
assert.deepEqual(invalidSynthesis.summaryEvidenceIds, ["history:1:1"]);
assert.equal(invalidSynthesis.trend, "待了解");
assert.equal(invalidSynthesis.action, "");

const failed = await analyzeCaptureSemanticHistory({ historyRecords: [row(1)], totalImported: 2, selectedLineCount: 1 }, async () => { throw Error("model failed"); });
assert.equal(failed.status, "unavailable");
assert.equal(failed.coverage.analyzedText, 0);
assert.match(failed.coverage.limitation, /0 \/ 1/);
const empty = await analyzeCaptureSemanticHistory({ historyRecords: [], totalImported: 675, selectedLineCount: 40 }, async () => { throw Error("unexpected call"); });
assert.equal(empty.status, "no_text");
assert.equal(empty.coverage.analyzedText, 0);
console.log("Capture semantic history passed: all rows processed, evidence grounded, honest coverage, invalid synthesis rejected, failures surfaced.");
