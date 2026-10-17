import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const compiled = ts.transpileModule(readFileSync("lib/desktop-capture.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const capture = {}; new Function("exports", compiled)(capture);
const ns = { ownerId: "synthetic-owner", account: "synthetic-account", friend: "synthetic-friend", kind: "chat" };
const base = { version: 1, kind: "chat", account: ns.account, friend: ns.friend, capturedAt: "2026-10-16T00:00:00Z", warnings: [] };
const row = (index, { tie = false, session = "synthetic-session", at } = {}) => ({
  id: `wechat-db:${session}-${index}`, kind: "text", sender: ns.friend, senderRole: "other",
  at: at || `2026-10-16T00:00:${String(tie ? 0 : index).padStart(2, "0")}Z`, text: `Synthetic database message ${session} ${index}`,
  source: { label: "Synthetic database", method: "wechat-local-db", accountId: ns.account, sessionId: session,
    messageShard: `message_${index % 2}.db`, messageId: String(index), idStability: "stable", timestampOrigin: "wechat-create-time" },
});
const ui = label => ({ kind: "text", sender: ns.friend, senderRole: "other", at: "", text: label, source: { label: "Synthetic UI", method: "uia" } });
const history = (count, direction = "backward") => ({ version: 1, direction, count, hasMore: true, nextCursor: "synthetic_next", snapshot: "synthetic_snapshot", complete: false });
const merge = (existing, records, direction) => capture.mergeCaptureRecords(existing, { ...base, records, ...(direction ? { history: history(records.length, direction) } : {}) }, ns);
const dbIds = rows => rows.filter(row => row.source.method === "wechat-local-db").map(row => Number(row.source.messageId));
const initialUi = merge([], [ui("Legacy A, no date"), ui("Legacy B, no date")]).records;

// Actual regression: an undated UI record made the entire older DB page append.
const first = merge(initialUi, [row(3), row(4)], "backward");
const second = merge(first.records, [row(1), row(2)], "backward");
assert.deepEqual(dbIds(second.records), [1, 2, 3, 4]);
assert.deepEqual(second.records.filter(row => row.source.method === "uia"), initialUi);
assert.equal(second.records.length, 6);
const retained = new Map(first.records.map(row => [row.id || row.text, row.localId]));
for (const record of second.records) if (retained.has(record.id || record.text)) assert.equal(record.localId, retained.get(record.id || record.text));

// Incremental rows may contain late history and a new message in the same page.
const original = merge([], [row(2), row(3)]).records;
const delta = merge(original, [row(1), row(4)], "forward");
assert.deepEqual(dbIds(delta.records), [1, 2, 3, 4]);
assert.equal(delta.added, 2);
const retry = merge(delta.records, [row(1), row(4)], "forward");
assert.equal(retry.added, 0); assert.deepEqual(retry.records.map(row => row.localId), delta.records.map(row => row.localId));

// A backwards page explicitly establishes order even when every timestamp ties.
const tiedFirst = merge(initialUi, [row(3, { tie: true }), row(4, { tie: true })], "backward");
const tiedSecond = merge(tiedFirst.records, [row(1, { tie: true }), row(2, { tie: true })], "backward");
assert.deepEqual(dbIds(tiedSecond.records), [1, 2, 3, 4]);
assert.deepEqual(tiedSecond.records.filter(row => row.source.method === "uia").map(row => row.text), initialUi.map(row => row.text));
const tiedReplay = merge(tiedSecond.records, [row(1, { tie: true }), row(2, { tie: true })], "backward");
assert.deepEqual(tiedReplay.records.map(row => row.localId), tiedSecond.records.map(row => row.localId));

// Existing anchors take precedence over a generic "new rows first" tie rule.
const gaps = merge([], [row(1, { tie: true }), row(3, { tie: true })]).records;
const filled = merge(gaps, [row(1, { tie: true }), row(2, { tie: true }), row(3, { tie: true })], "backward");
assert.deepEqual(dbIds(filled.records), [1, 2, 3]);

// Same-time forward additions have no proof of preceding the retained message.
const forward = merge(gaps, [row(4, { tie: true })], "forward");
assert.deepEqual(dbIds(forward.records), [1, 3, 4]);

// The strict timestamp contains its timezone; the wall-clock label alone is not order.
const zones = merge([], [row(1, { at: "2026-10-16T08:00:00+08:00" }), row(2, { at: "2026-10-16T00:00:01Z" })]).records;
assert.deepEqual(dbIds(zones), [1, 2]);
const between = merge(zones, [row(3, { at: "2026-10-16T00:00:00.500Z" })], "forward");
assert.deepEqual(dbIds(between.records), [1, 3, 2]);

// Distinct source sessions are never interleaved based on guessed contact identity.
const grouped = merge([], [row(3), row(1, { session: "another-session" }), row(4)]).records;
const inserted = merge(grouped, [row(2)], "forward");
assert.deepEqual(inserted.records.filter(row => row.source.sessionId === "synthetic-session").map(row => Number(row.source.messageId)), [2, 3, 4]);
assert.equal(inserted.records.findIndex(row => row.source.sessionId === "another-session"), 1);
console.log("PASS DB ordering: mixed undated UI, late incremental history, tied backwards pages, stable replay, shared anchors, timezone and session isolation; original IDs/UI order retained.");
