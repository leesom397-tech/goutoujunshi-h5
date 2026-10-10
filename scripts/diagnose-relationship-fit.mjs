// Read-only semantic audit. Synthetic cases only; no database or model calls.
// Findings are defects, not passing expectations or calibrated scores.
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = ts.transpileModule(readFileSync('lib/relationship-fit.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const api = {};
new Function('exports', source)(api);
const cases = [
  { id: 'negated-interest', own: { lifestyle: '喜欢健身' }, other: { lifestyle: '不喜欢健身' }, field: 'lifestyle', invalid: row => row.status === '匹配', expectation: 'Negated shared word must not become a common interest.' },
  { id: 'negated-partner-status', own: { relationshipStatus: '单身' }, other: { relationshipStatus: '单身，没有男友' }, field: 'relationshipStatus', invalid: row => row.status === '有冲突', expectation: 'No boyfriend must not be parsed as having a boyfriend.' },
  { id: 'children-without-status', own: { childrenPlan: '丁克' }, other: { childrenPlan: '想生孩子' }, field: 'relationshipStatus', invalid: row => row.status !== '有冲突', expectation: 'Explicit child-plan conflict must be visible even without relationship status.' },
  { id: 'same-nonmedia-job', own: { occupation: '程序员' }, other: { occupation: '程序员' }, field: 'occupation', invalid: row => /内容创作|拍摄/.test(row.conclusion), expectation: 'Same non-media job must not generate media-specific conclusions.' },
  { id: 'province-is-not-city', own: { city: '广东' }, other: { city: '广东深圳' }, field: 'city', invalid: row => row.score !== null, expectation: 'Province-only location cannot establish same city or different-city distance.' },
  { id: 'future-birth-year', own: { ageRange: '1990年' }, other: { ageRange: '2099年' }, field: 'ageRange', invalid: row => row.score !== null, expectation: 'Future birth year must not produce a scored age comparison.' }
];
const findings = cases.map(item => {
  const result = api.relationshipFit(item.own, item.other);
  const row = result.fit.find(row => row.field === item.field);
  return { case: item.id, defectObserved: item.invalid(row), expectation: item.expectation,
    observed: { status: row.status, score: row.score, conclusion: row.conclusion } };
});
console.log(JSON.stringify({ scope: 'synthetic semantic diagnosis, not a passing regression suite', findings }, null, 2));
