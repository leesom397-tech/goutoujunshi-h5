// Explicit opt-in; only a generated fictional feed, no account/credit/DB writes.
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {createRequire} from 'node:module';
import ts from 'typescript';
import sharp from 'sharp';
if(process.argv[2]!=='--synthetic-only')throw Error('SYNTHETIC_ONLY_REQUIRED');
try{process.loadEnvFile('.env.local');}catch{}
const config=process.env;
if(!config.DASHSCOPE_API_KEY){console.log(JSON.stringify({status:'blocked',reason:'local_model_credential_unavailable'}));process.exit(2);}
config.DASHSCOPE_WORKSPACE_ID ||= JSON.parse(readFileSync('wrangler.coach.jsonc','utf8')).vars.DASHSCOPE_WORKSPACE_ID;
const native=createRequire(import.meta.url),cache=new Map();
function load(file){
  const path=resolve(file);if(cache.has(path))return cache.get(path).exports;
  const module={exports:{}};cache.set(path,module);
  const source=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  const require=id=>{
    if(id==='cloudflare:workers')return {env:config};
    if(id==='@/lib/miniapp-auth')return {miniappOwner:async()=>({ownerId:'synthetic'})};
    if(id==='@/lib/crush/service')return {reserveBudget:async()=>{}};
    if(id==='@/db')return {getD1:()=>{throw Error('NO_DB_ACCESS_PERMITTED');}};
    if(id.startsWith('.')||id.startsWith('@/')){let next=id.startsWith('@/')?resolve(id.slice(2)):resolve(dirname(path),id);if(!/\.(json|mjs|ts)$/.test(next))next+='.ts';return next.endsWith('.json')?JSON.parse(readFileSync(next,'utf8')):load(next);}
    return native(id);
  };
  new Function('require','module','exports',source)(require,module,module.exports);return module.exports;
}
// This key authenticates only the in-process route; never sent to a public service.
config.WECHAT_CALLBACK_TOKEN='synthetic-local-stage-key';
const route=load('app/api/miniapp/social-profile/route.ts');
const svg=`<svg width="720" height="1000" xmlns="http://www.w3.org/2000/svg"><rect width="720" height="1000" fill="white"/><g font-family="Microsoft YaHei" fill="#142633"><text x="35" y="65" font-size="32">测试用户的朋友圈（虚构测试资料）</text><text x="35" y="150" font-size="25">10月8日 今天完成项目，终于能休息一下。</text><text x="35" y="340" font-size="25">10月7日 周末登山，风景真好。</text><text x="35" y="530" font-size="25">10月6日 陪妈妈散步，慢慢聊家常。</text><text x="35" y="760" font-size="25">朋友仅展示最近一个月的朋友圈</text></g></svg>`;
const png=await sharp(Buffer.from(svg)).png().toBuffer();
const image='data:image/png;base64,'+png.toString('base64');
async function call(body){const response=await route.POST(new Request('https://synthetic.local/api/miniapp/social-profile',{method:'POST',headers:{'Content-Type':'application/json','x-moments-job-key':config.WECHAT_CALLBACK_TOKEN},body:JSON.stringify({confirmed:true,target:'other',materialType:'moments',...body})}));const result=await response.json();if(!response.ok)throw Error('STAGE_HTTP_'+response.status);return result;}
const started=Date.now();let firstMs=null;
try{
  const observations=await Promise.all([0,1].map(async imageIndex=>{const value=await call({momentsPhase:'extract',imageIndex,images:[image]});firstMs??=Date.now()-started;return value;}));
  const recognitionMs=Date.now()-started;
  const result=await call({momentsPhase:'summarize',imageCount:2,observations});
  console.log(JSON.stringify({status:'ok',syntheticOnly:true,firstMs,recognitionMs,totalMs:Date.now()-started,posts:result.moments?.posts?.length,hasReport:!!result.moments,hasFindings:!!result.moments?.hypotheses?.length,dbWrites:0}));
}catch(error){console.log(JSON.stringify({status:'failed',syntheticOnly:true,elapsedMs:Date.now()-started,reason:/^STAGE_HTTP_\d+$/.test(error.message)?error.message:'probe_error'}));process.exitCode=1;}
