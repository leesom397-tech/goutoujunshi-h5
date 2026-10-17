import assert from "node:assert/strict";
import { consumeCaptureHandoff, isCaptureHandoff, PENDING_CAPTURE_HANDOFF_KEY, stageCaptureHandoff } from "../lib/capture-pairing-handoff.ts";

const handoff = "A".repeat(43);
const values = new Map();
const tab = {
  getItem: key => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value),
  removeItem: key => values.delete(key),
};

assert.equal(isCaptureHandoff(handoff), true);
assert.equal(stageCaptureHandoff("bad", tab, 1000), false);
assert.equal(values.size, 0);
assert.equal(stageCaptureHandoff(handoff, tab, 1000), true);
assert.equal(consumeCaptureHandoff(tab, 2000), handoff);
assert.equal(values.has(PENDING_CAPTURE_HANDOFF_KEY), false);
assert.equal(consumeCaptureHandoff(tab, 2000), "");
assert.equal(stageCaptureHandoff(handoff, tab, 1000), true);
assert.equal(consumeCaptureHandoff(tab, 121000), "");
assert.equal(values.has(PENDING_CAPTURE_HANDOFF_KEY), false);
values.set(PENDING_CAPTURE_HANDOFF_KEY, JSON.stringify({ value: handoff, expiresAt: 9999999 }));
assert.equal(consumeCaptureHandoff(tab, 2000), "");
console.log("capture pairing handoff: passed");
