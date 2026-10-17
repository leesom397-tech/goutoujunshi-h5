import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const effects=[], calls=[];
const mocks={
  react:{useState:value=>[value,()=>{}],useEffect:fn=>effects.push(fn)},
  'react/jsx-runtime':{jsx:()=>null,jsxs:()=>null},
  '@/components/web-analysis/client':{useAccount:()=>({account:{account:{userId:'synthetic'}}}),api:async(...args)=>{calls.push(args);return {reports:[],total:0,pageSize:20};}},
};
const exports={};
new Function('exports','require',ts.transpileModule(fs.readFileSync('app/reports/page.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText)(exports,name=>mocks[name]||(name.endsWith('.css')?{default:{}}:{}));
exports.default();
const cleanup=effects.map(fn=>fn());
await new Promise(resolve=>setTimeout(resolve,10));
assert.equal(calls.length,1);
assert.equal(calls[0][0],'/api/web/report/list?q=&page=1');
assert.equal(calls[0][1],undefined,'GET must not pass AbortSignal as a POST body');
assert.ok(calls[0][2] instanceof AbortSignal);
for(const fn of cleanup)fn?.();
assert.equal(calls[0][2].aborted,true,'route or search change cancels the old GET');
console.log('PASS reports load by GET and abort the previous request; component effect with synthetic account only.');
