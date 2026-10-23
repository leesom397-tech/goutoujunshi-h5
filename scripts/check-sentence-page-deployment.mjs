import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
// Read-only deployment gate: schema metadata and an unauthenticated route.
// No private reports, model calls, billing, migrations or writes are performed.
const args=process.argv.slice(2);
if(!args.includes('--remote')&&!args.includes('--local')){
  console.log('Usage: node scripts/check-sentence-page-deployment.mjs --remote|--local [--origin=https://coach.lovetalk.love]');
  process.exit(args.includes('--help')?0:1);
}
assert.notEqual(args.includes('--remote'),args.includes('--local'),'Choose exactly one database environment');
const expected=['coach_report_sentence_pages','coach_sentence_pages_owner_lease','coach_sentence_pages_library','coach_sentence_report_deleted','coach_sentence_report_removed','coach_sentence_library_changed','coach_sentence_library_removed'];
const root=fileURLToPath(new URL('../',import.meta.url)),wrangler=fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js',import.meta.url));
const result=spawnSync(process.execPath,[wrangler,'d1','execute','goutoujunshi-coach',args.includes('--remote')?'--remote':'--local','--config','wrangler.coach.jsonc','--command',`SELECT name,type FROM sqlite_master WHERE name IN (${expected.map(name=>"'"+name+"'").join(',')})`,'--json'],{cwd:root,encoding:'utf8',windowsHide:true,timeout:45_000});
assert.equal(result.status,0,'Schema check failed: '+String(result.stderr||result.error||'').slice(0,500));
const parsed=JSON.parse(result.stdout),actual=new Set(parsed.flatMap(item=>item.results||[]).map(item=>item.name));
assert.deepEqual([...actual].sort(),[...expected].sort(),'0022 sentence-page migration is incomplete');
console.log('PASS sentence cache table, indexes and deletion/revision triggers installed');
const origin=args.find(arg=>arg.startsWith('--origin='))?.slice(9);
if(origin){
  const url=new URL('/api/web/report/sentences?id=00000000-0000-4000-8000-000000000000',origin);
  const response=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(15_000)});
  assert.equal(response.status,401,'Deployed sentence route must reject an unauthenticated read');
  assert.match(response.headers.get('cache-control')||'',/no-store/);
  assert.equal(typeof (await response.json()).error,'string');
  console.log('PASS deployed route authentication and no-store response');
}
