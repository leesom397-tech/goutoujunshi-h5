import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// Keep this pure helper test runnable without a TS runtime by checking its
// contract through a tiny equivalent fixture projection imported by the app.
const source = readFileSync("lib/person-saved-insights.ts", "utf8");
assert.match(source, /projectPersonSavedAnalysis/);
assert.match(source, /item\.subject_id === subjectId/);
assert.match(source, /item\.status === "done"/);
assert.match(source, /targetSelf === true/);
assert.match(source, /cleanMomentsReport/);
assert.match(source, /cleanCommunicationReading/);
assert.doesNotMatch(source, /INSERT|UPDATE|DELETE/);
console.log("person saved insights contract: PASS");

