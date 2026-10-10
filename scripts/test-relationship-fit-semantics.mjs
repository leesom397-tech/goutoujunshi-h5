import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Semantic release gate: failures are defects, not expected snapshots.
// Synthetic inputs; no database, network, model, or real user information.
const js = ts.transpileModule(readFileSync('lib/relationship-fit.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const api = {};
new Function('exports', js)(api);
let passed = 0, failed = 0;
function test(name, check) {
  try { check(); passed++; console.log('PASS ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + ': ' + error.message); }
}
function assess(own, other) {
  const original = JSON.stringify([own, other]);
  const result = api.relationshipFit(own, other);
  assert.equal(JSON.stringify([own, other]), original, 'input profiles must remain unchanged');
  assert.equal(result.fit.length, 6);
  assert.equal(result.coverage, result.fit.filter(row => row.score !== null).length);
  for (const row of result.fit) assert.ok(row.score === null || (Number.isFinite(row.score) && row.score >= 0 && row.score <= 100));
  return result;
}
const dimension = (result, field) => result.fit.find(row => row.field === field);
for (const value of ['不喜欢健身', '不爱健身', '从不健身']) {
  test('negated interest: ' + value, () => {
    const result = assess({ lifestyle: '喜欢健身' }, { lifestyle: value });
    assert.notEqual(dimension(result, 'lifestyle').status, '匹配');
    assert.ok(!result.commonPoints.some(row => row.title === '生活方式'));
  });
}
for (const value of ['单身，没有男友', '单身，没有女友', '未婚，没有伴侣']) {
  test('negative partner statement: ' + value, () => {
    const row = dimension(assess({ relationshipStatus: '单身' }, { relationshipStatus: value }), 'relationshipStatus');
    assert.notEqual(row.status, '有冲突');
    assert.doesNotMatch(row.conclusion, /不适合继续升级/);
  });
}
test('explicit child-plan conflict without status fields', () => {
  const result = assess({ childrenPlan: '丁克' }, { childrenPlan: '想生孩子' });
  const row = dimension(result, 'relationshipStatus');
  assert.equal(row.status, '有冲突');
  assert.match(row.conclusion, /丁克/);
  assert.match(row.conclusion, /想生孩子/);
  assert.match(result.fitSummary, /冲突|暂缓/);
});
test('shared non-media occupation has no invented media activity', () => {
  const row = dimension(assess({ occupation: '程序员' }, { occupation: '程序员' }), 'occupation');
  assert.match(row.conclusion, /程序员/);
  assert.doesNotMatch(row.conclusion, /内容创作|拍摄/);
});
for (const province of ['广东', '浙江省']) {
  test('province alone does not establish meeting distance: ' + province, () => {
    const result = assess({ city: province }, { city: province === '广东' ? '深圳' : '杭州' });
    assert.equal(dimension(result, 'city').score, null);
    assert.equal(result.coverage, 0);
  });
}
test('future birth year remains unscored', () => {
  const result = assess({ ageRange: '1990年' }, { ageRange: `${new Date().getFullYear() + 10}年` });
  assert.equal(dimension(result, 'ageRange').score, null);
  assert.doesNotMatch(dimension(result, 'ageRange').conclusion, /-\d+岁/);
});
test('missing inputs do not manufacture score or common points', () => {
  const result = assess({}, {});
  assert.equal(result.fitScore, null);
  assert.equal(result.coverage, 0);
  assert.equal(result.commonPoints.length, 0);
});
test('positive media example retains useful concrete conclusions without counting a local feed', () => {
  const result = assess({ occupation: '导演', city: '上海' }, { occupation: '主播', city: '上海市' });
  assert.equal(dimension(result, 'occupation').status, '匹配');
  assert.match(dimension(result, 'occupation').conclusion, /创作|作品|拍摄/);
  assert.equal(dimension(result, 'city').status, '有线索');
  assert.equal(dimension(result, 'city').score, null);
  assert.ok(!result.commonPoints.some(row => row.title === '见面距离'));
});
test('positive shared interest is still recognized', () => {
  assert.equal(dimension(assess({ lifestyle: '喜欢健身' }, { lifestyle: '喜欢健身' }), 'lifestyle').status, '匹配');
});
test('explicit unavailable partner is not erased by positive dimensions', () => {
  const result = assess({ relationshipStatus: '单身', city: '上海', occupation: '导演' },
    { relationshipStatus: '已婚', city: '上海', occupation: '主播' });
  assert.equal(dimension(result, 'relationshipStatus').status, '有冲突');
  assert.match(result.fitSummary, /暂缓|不适合/);
  assert.ok(result.fitScore < 40, 'clear conflict must cap the overall reference score');
});
test('mixed clauses retain only affirmative shared interests', () => {
  const row=dimension(assess({lifestyle:'喜欢旅行，喜欢健身'}, {lifestyle:'不喜欢健身，但喜欢旅行'}),'lifestyle');
  assert.equal(row.status,'匹配');
  assert.match(row.conclusion,/旅行/);
  assert.doesNotMatch(row.conclusion,/健身/);
});
test('contradictory status cannot receive a positive fit', () => {
  assert.equal(dimension(assess({relationshipStatus:'单身'}, {relationshipStatus:'单身，已婚'}),'relationshipStatus').score,null);
});
test('child-plan negative variant retains conflict', () => {
  assert.equal(dimension(assess({childrenPlan:'我不想要孩子'}, {childrenPlan:'想要孩子'}),'relationshipStatus').status,'有冲突');
});
test('age range is not silently converted to its last endpoint', () => {
  assert.equal(api.ageInYears('25至35岁',2026),null);
});
test('autonomous region is not a city', () => {
  assert.equal(dimension(assess({city:'新疆'}, {city:'乌鲁木齐'}),'city').score,null);
});
console.log(`Semantic compatibility gate: ${passed} passed, ${failed} failed.`);
process.exitCode = failed ? 1 : 0;
