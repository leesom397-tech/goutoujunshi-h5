// Checks integration and schema preservation with synthetic model responses.
// It does not measure a live model's reasoning quality or resistance to attacks.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import ts from 'typescript';

const nativeRequire = createRequire(import.meta.url), root = resolve('.');
function load(file, mocks = {}, cache = new Map()) {
  const path = resolve(root, file);
  if (cache.has(path)) return cache.get(path).exports;
  const module = { exports: {} }; cache.set(path, module);
  if (path.endsWith('.json')) { module.exports = JSON.parse(readFileSync(path, 'utf8')); return module.exports; }
  const source = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const require = id => {
    if (id in mocks) return mocks[id];
    if (id === 'cloudflare:workers') return { env: {} };
    if (id.startsWith('.') || id.startsWith('@/')) {
      let next = id.startsWith('@/') ? resolve(root, id.slice(2)) : resolve(dirname(path), id);
      if (!/\.(?:[cm]?[jt]sx?|json)$/.test(next)) next += '.ts';
      return load(next, mocks, cache);
    }
    return nativeRequire(id);
  };
  new Function('require', 'module', 'exports', source)(require, module, module.exports);
  return module.exports;
}

const { DEEP_INFERENCE_GUIDANCE } = load('lib/deep-inference-guidance.ts');
const policies = load('lib/analysis-depth.ts');
const { COACH_RULES } = load('lib/coach.ts');
for (const policy of [policies.ANALYSIS_DEPTH_GUIDANCE, policies.PROFILE_DEPTH_GUIDANCE, policies.CHAT_DEPTH_GUIDANCE, COACH_RULES]) {
  assert.equal(policy.split(DEEP_INFERENCE_GUIDANCE).length - 1, 1, 'each shared policy embeds the new guidance exactly once');
}

const insight = {
  label: '改时间后仍给出可行安排',
  observed: '你提议周六见面，对方说“周六要加班，周日午后可以”，随后你表示到时再确认。',
  interpretation: '对方没有只停在说没空，而是主动给出另一个具体时段，这一组合更支持她愿意给这次见面留出空间，同时希望安排能够配合自己的日程。她可能在保护时间安排上的自主性，而不是拒绝与你见面；但这只说明她对这一次安排作出了有信息量的回应，不能直接推出她已经确认关系或有稳定的亲密意愿。现有材料也没有说明她是否会主动落实地点，因此主动给替代时间比单纯客套多了一步，仍需以实际兑现来修正判断。若之后始终不愿确认任何安排，这个解释就要减弱。',
  alternative: '也可能只是当下礼貌地给一个备选时间，还没认真决定；仅凭这轮文字，尚不能区分具体安排意愿与暂时客套。',
  verify: '按你已说的在周日午后前自然确认一次地点；若她具体承接或主动补充，可继续安排。若拒绝且不给替代方案，就停止推进，不反复催问。',
};
assert.ok(insight.interpretation.length > 180 && insight.interpretation.length < 320);
const interaction = load('lib/crush/interaction-insight.ts');
assert.deepEqual(interaction.normalizeInteractionInsight(insight), insight, 'the complete evidence chain and correction condition survive the expanded parser');
assert.equal(interaction.normalizeInteractionInsight({ ...insight, alternative: '' }), null, 'a competing explanation is still required');
assert.equal(interaction.normalizeInteractionInsight({ ...insight, verify: '' }), null, 'a verification step is still required');
assert.equal(interaction.normalizeInteractionInsight(null), null, 'insufficient material may still produce no insight');
const bounded = interaction.normalizeInteractionInsight({ label: '题'.repeat(50), observed: '证'.repeat(300), interpretation: '解'.repeat(400), alternative: '另'.repeat(300), verify: '看'.repeat(320) });
assert.deepEqual(Object.fromEntries(Object.entries(bounded).map(([key, value]) => [key, Array.from(value).length])), { label: 24, observed: 240, interpretation: 320, alternative: 220, verify: 260 });

const annotation = [[{ key: 'calm', weight: 100 }], [{ key: 'share', weight: 100 }], 'limited', '对方给出替代时间，这比只说没空更具体，但仍需看实际安排。'];
const lines = [['right', 'text', '周六一起喝咖啡吗？'], ['left', 'text', '周六要加班，周日午后可以'], ['right', 'text', '那周日下午我再和你确认']];
const calls = [];
let answer = {};
let budget = 0;
const mocks = {
  '@/lib/knowledge': { selectKnowledge: () => [] },
  '@/lib/miniapp-auth': { miniappOwner: async () => ({ ownerId: 'synthetic-owner' }) },
  '@/lib/crush/service': { reserveBudget: async () => { budget++; } },
  '@/db': { getD1: () => { throw Error('No long-term data access is expected without compareWithSelf'); } },
  '@/lib/qwen': { parseQwenJson: JSON.parse, qwenPublicError: (_e, fallback) => fallback, qwenChat: async (messages, options) => { calls.push({ messages, options }); return JSON.stringify(answer); } },
};
const screenshot = load('lib/crush/screenshot.ts', mocks);
answer = { annotations: lines.map(() => annotation), observation: insight.observed, judgment: '愿意给本次见面留出空间，仍需确认', nextStep: '按已约定的时间自然确认一次', interactionInsight: insight, replyOptions: [], affinityDims: [], boundary: false };
let result = await screenshot.readScreenshotFromQuick({ layout: 'wechat-one-to-one', lines }, 'right', [], '');
assert.deepEqual(result.decision.interactionInsight, insight);
assert.deepEqual(result.prepared.lines.map(line => line.text), lines.map(line => line[2]), 'deeper inference does not rewrite source messages');
assert.equal(calls.length, 1, 'no additional model call for the deeper explanation');
assert.equal(calls[0].options.vision, undefined, 'OCR reuse remains a text-only model call');
assert.equal(calls[0].options.maxTokens, 3000, 'existing short screenshot output budget remains unchanged');
assert.ok(calls[0].messages[0].content.includes(DEEP_INFERENCE_GUIDANCE));
assert.deepEqual(JSON.parse(calls[0].messages[1].content).lines, lines);

answer = { layout: 'wechat-one-to-one', complete: true, lines: lines.map(line => [...line, ...annotation]), observation: insight.observed, judgment: '愿意具体商量这次见面', nextStep: '按已约定的时间自然确认一次', interactionInsight: insight, replyOptions: [], affinityDims: [], boundary: false };
result = await screenshot.readScreenshot('data:image/png;base64,YQ==', 'right', [], '');
assert.deepEqual(result.decision.interactionInsight, insight);
assert.equal(calls.length, 2);
assert.equal(calls.at(-1).options.maxTokens, 3600, 'existing vision output budget remains unchanged');
assert.ok(calls.at(-1).messages[0].content.includes(DEEP_INFERENCE_GUIDANCE));

const hypothesis = {
  title: '更愿意从具体计划展开', evidence: '图1自述“周末喜欢提前安排”，图2配文“临时改计划有点累”',
  possibility: '两处独立自述都强调安排的可预期性，可能希望交流给她留出准备空间；这是公开表达倾向，不等于她在所有相处中都不接受变化。',
  alternative: '也可能只是这两次临时变动较多，并非长期偏好。',
  verify: '提出一个可调整的具体时间；若她补充安排就继续，若更喜欢随性决定就修正这个判断。',
};
answer = { kind: 'profile', readable: true, summary: '材料中有两处关于计划的明确自述', hypotheses: [hypothesis], visibleFacts: [], positives: [], cautions: [], fit: [], unknowns: [], questions: [], nextMaterials: [] };
const social = load('app/api/miniapp/social-profile/route.ts', mocks);
const response = await social.POST(new Request('https://coach.example.test/api/miniapp/social-profile', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ confirmed: true, target: 'other', images: ['data:image/png;base64,YQ=='], compareWithSelf: false }),
}));
assert.equal(response.status, 200);
const data = await response.json();
assert.deepEqual(data.hypotheses, [hypothesis], 'profile schema retains evidence, interpretation, alternative and adjustment branches');
assert.equal(data.fitScore, null, 'deep inference must not invent a compatibility score without self comparison');
assert.equal(calls.length, 3); assert.equal(budget, 1);
assert.equal(calls.at(-1).options.maxTokens, 3200);
assert.ok(calls.at(-1).messages.some(message => message.role === 'system' && message.content.includes(DEEP_INFERENCE_GUIDANCE)));

const momentsHelpers = load('lib/moments-report.ts');
const moments = momentsHelpers.cleanMomentsReport({ summary: '本批公开表达倾向', hypotheses: [hypothesis], posts: [], starters: [] });
assert.deepEqual(moments.hypotheses, [hypothesis]);
assert.deepEqual(momentsHelpers.cleanMomentsReport(moments), moments, 'archive round trip preserves evidence and observable follow-up');
console.log('PASS deep inference: shared policy reaches screenshot and profile model requests; expanded insight survives both screenshot parsers; profile/moments schema and archive round trips stay compatible; existing model budgets and call counts retained. Synthetic responses only.');
