// Real workerd + SQLite transactions/alarms; synthetic images, no production calls.
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Miniflare } from "miniflare";

const source = readFileSync("lib/social-profile-jobs.mjs", "utf8")
  .replace('import { finishCreditTask, reserveCredits, CREDIT_PRICES } from "./account-credits.mjs";', readFileSync('lib/account-credits.mjs', 'utf8').replaceAll('export ', ''))
  .replace('import app from "../dist/server/index.js";', `
const app = { async fetch(request, env, ctx) {
  const body = await request.json();
  if(body.momentsPhase){
    if(request.headers.get('x-moments-job-key')!=='synthetic-pipeline-key')return Response.json({error:'denied'},{status:403});
    const stageKey='test:moments:'+body.momentsPhase+':'+(body.imageIndex??'summary');
    const count=(await ctx.storage.get(stageKey)||0)+1;await ctx.storage.put(stageKey,count);
    await new Promise(resolve=>setTimeout(resolve,80));
    if(body.momentsPhase==='extract'){
      if(body.imageIndex===1&&count===1)return Response.json({error:'synthetic timeout'},{status:503});
      return Response.json({kind:'profile',readable:true,summary:'合成动态'+body.imageIndex,posts:[{date:'10月8日',content:'合成内容'+body.imageIndex,evidence:'图'+(body.imageIndex+1)}]});
    }
    if(count===1)return Response.json({error:'summary temporary failure'},{status:503});
    if(body.images || body.observations.length!==body.imageCount)throw Error('summary must only receive saved observations');
    return Response.json({summary:'合成完整报告',moments:{summary:'合成完整报告',posts:body.observations.flatMap(x=>x.posts)}});
  }
  await ctx.storage.put("test:count", (await ctx.storage.get("test:count") || 0) + 1);
  await ctx.storage.put("test:call:" + (body.requestId || "profile"), body.image || body.images);
  if(body.image==='data:image/png;base64,ZmFpbA==') return Response.json({error:'synthetic unavailable'},{status:503});
  if(body.image==='data:image/png;base64,ZGVueQ==') return new Response('denied',{status:403});
  if (body.image === 'data:image/png;base64,cmV0cnk=') {
    const count = (await ctx.storage.get('test:retry-count') || 0) + 1;
    await ctx.storage.put('test:retry-count',count);
    if (count === 1) return Response.json({error:'synthetic transient timeout'}, {status:504});
  }
  return Response.json({ image: body.image, images: body.images, requestId: body.requestId });
} };`);
const script = source + `
export class TestJobs extends SocialProfileJobs {
  async fetch(request) {
    if (new URL(request.url).pathname === "/test-inspect") {
      const entries = await this.ctx.storage.list();
      return Response.json(Object.fromEntries(entries));
    }
    if(request.method==='POST') { const body=await request.json(); body.ownerId='synthetic-owner'; request=new Request(request,{body:JSON.stringify(body)}); }
    return super.fetch(request);
  }
}
export default { fetch(request, env) {
  return env.JOBS.get(env.JOBS.idFromName("synthetic-owner")).fetch(request);
} };
`;
const persist = mkdtempSync(join(tmpdir(), "chengzi-upload-runtime-"));
const options = { modules: true, script, compatibilityDate: "2026-05-15",
  bindings:{WECHAT_CALLBACK_TOKEN:'synthetic-pipeline-key'},
  d1Databases: { DB: 'credit-test' }, d1Persist: join(persist,'d1'),
  durableObjects: { JOBS: { className: "TestJobs", useSQLite: true } }, durableObjectsPersist: persist };
let runtime = new Miniflare(options);
const ledger = await runtime.getD1Database('DB');
for(const file of ['0015_account_credits','0016_credit_receipts']) {
  const sql=readFileSync('drizzle/'+file+'.sql','utf8').replace(/^\s*--.*$/gm,'');
  // D1 exec parses one statement per line; triggers remain single statements.
  const statements=sql.match(/CREATE TRIGGER[\s\S]*?\nEND;|CREATE (?:TABLE|INDEX)[\s\S]*?;/g);
  for(const statement of statements)await ledger.prepare(statement).run();
}
await ledger.prepare("INSERT INTO coach_credit_accounts(owner_id,public_id,balance,features,enabled_until,created_at,updated_at) VALUES ('synthetic-owner','test-public',10000,'[\"analysis\"]',?,0,0)").bind(Date.now()+86400000).run();
const taskId = "77777777-7777-4777-8777-777777777777";
const url = "http://local/api/miniapp/screenshot/batch?taskId=" + taskId;
const images = [0, 1, 2].map(i => "data:image/png;base64," + Buffer.from(String(i).repeat(200000)).toString("base64"));
async function post(body, expected = 200) {
  const response = await runtime.dispatchFetch(url, { method: "POST", headers: { Authorization: "Bearer synthetic", "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const value = await response.json();
  assert.equal(response.status, expected, JSON.stringify(value));
  return value;
}
const inspect = async () => (await runtime.dispatchFetch("http://local/test-inspect")).json();
try {
  await post({ uploadAction: "init", confirmed: true, imageCount: 3, selfSide: "right", sessionId: taskId }, 201);
  await post({ uploadAction: "part", index: 2, image: images[2] });
  await post({ uploadAction: "part", index: 0, image: images[0] });
  assert.equal(Object.keys(await inspect()).filter(k => k.startsWith("upload:")).length, 6, "multi-chunk transactions persisted");
  await runtime.dispose();
  runtime = new Miniflare(options);
  const resumed = await (await runtime.dispatchFetch(url)).json();
  assert.deepEqual(resumed.received, [0, 2], "receipts survive a full runtime restart");
  await post({ uploadAction: "commit" }, 409);
  await post({ uploadAction: "part", index: 0, image: images[0] });
  await post({ uploadAction: "part", index: 0, image: images[1] }, 409);
  await post({ uploadAction: "part", index: 1, image: images[1] });
  await post({ uploadAction: "commit" }, 202);
  // No polling or manual alarm invocation: let the real alarm run independently.
  await delay(2500);
  const completed = await (await runtime.dispatchFetch(url)).json();
  assert.equal(completed.status, "done", JSON.stringify(completed));
  assert.deepEqual(completed.result.entries.map(entry => entry.image), images, "analysis preserves original selection order");
  await post({ uploadAction: "commit" }, 202);
  await delay(200);
  const state = await inspect();
  assert.equal(state["test:count"], 3, "duplicate commit does not invoke analysis again");
  assert.equal(Object.keys(state).filter(k => k.startsWith("test:call:")).length, 3);
  assert.equal(Object.keys(state).filter(k => /^(upload|payload):/.test(k)).length, 0, "terminal tasks remove image chunks");
  assert.equal(state["job:" + taskId].authorization, undefined);
  assert.equal(state["job:" + taskId].parameters, undefined);
  assert.equal(state['job:'+taskId].creditFinished,true,'background alarm settles without foreground polling');
  const currentLedger=await runtime.getD1Database('DB');
  assert.equal((await currentLedger.prepare('SELECT status FROM coach_credit_tasks WHERE request_id=?').bind(taskId).first()).status,'settled');
  await runtime.dispose();
  runtime = new Miniflare(options);
  assert.equal((await (await runtime.dispatchFetch(url)).json()).status, "done", "completed result survives restart");
  const cancelId = "88888888-8888-4888-8888-888888888888";
  const cancelUrl = url.replace(taskId, cancelId);
  for (const body of [
    { uploadAction: "init", confirmed: true, imageCount: 1, selfSide: "right", sessionId: cancelId },
    { uploadAction: "part", index: 0, image: images[0] },
    { uploadAction: "cancel" }
  ]) {
    const response = await runtime.dispatchFetch(cancelUrl, { method: "POST", body: JSON.stringify(body) });
    assert.ok(response.ok, await response.text());
  }
  const cancelled = await inspect();
  assert.equal(cancelled["job:" + cancelId].status, "error");
  assert.equal(cancelled["job:" + cancelId].authorization, undefined);
  assert.equal(Object.keys(cancelled).filter(k => k.startsWith("upload:")).length, 0);
  assert.equal(cancelled["test:count"], 3, "cancelled upload never starts analysis");
  for (const [kind, autoId] of [["chat", "99999999-9999-4999-8999-999999999999"], ["profile", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"]]) {
    const autoUrl = kind === "chat" ? url.replace(taskId, autoId) : "http://local/api/miniapp/social-profile?taskId=" + autoId;
    const before = (await inspect())["test:count"];
    const send = body => runtime.dispatchFetch(autoUrl, { method: "POST", headers: { Authorization: "Bearer synthetic" }, body: JSON.stringify(body) });
    assert.equal((await send({ uploadAction: "init", autoStart: true, confirmed: true, imageCount: 2, selfSide: "right", sessionId: autoId })).status, 201);
    assert.equal((await send({ uploadAction: "part", index: 0, image: images[0] })).status, 200);
    await delay(200);
    assert.equal((await inspect())["test:count"], before, "incomplete material must not be presented as a complete analysis");
    // Send the final bytes but ignore its response: no commit and no client polling.
    await send({ uploadAction: "part", index: 1, image: images[1] });
    await delay(1800);
    const automatic = await (await runtime.dispatchFetch(autoUrl)).json();
    assert.equal(automatic.status, "done", kind + " auto-starts without a commit");
    assert.deepEqual(kind === "chat" ? automatic.result.entries.map(entry => entry.image) : automatic.result.images, images.slice(0, 2));
    const count = (await inspect())["test:count"];
    assert.equal(count, before + (kind === "chat" ? 2 : 1));
    assert.equal((await send({ uploadAction: "part", index: 1, image: images[1] })).status, 200);
    await delay(200);
    assert.equal((await inspect())["test:count"], count, "lost final ACK retry cannot repeat model calls");
    assert.equal(Object.keys(await inspect()).filter(k => k.startsWith("upload:")).length, 0);
  }
  const retryId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const retryUrl=url.replace(taskId,retryId);
  const retryImages=[images[0],'data:image/png;base64,cmV0cnk='];
  const beforeRetry=(await inspect())['test:count'];
  await runtime.dispatchFetch(retryUrl,{method:'POST',headers:{Authorization:'Bearer synthetic'},body:JSON.stringify({images:retryImages,confirmed:true,selfSide:'right',sessionId:retryId})});
  await delay(500);
  const checkpoint=(await inspect())['job:'+retryId];
  assert.equal(checkpoint.completedCount,1,'first successful image committed before retry');
  assert.equal(checkpoint.status,'queued');
  assert.equal(checkpoint.attempt,1);
  assert.ok(checkpoint.retryAt>Date.now());
  await runtime.dispose();
  runtime=new Miniflare(options);
  // Reinstantiate the test isolate once; production wakeup uses persisted alarm.
  await inspect();
  await delay(2200);
  const retried=await (await runtime.dispatchFetch(retryUrl)).json();
  assert.equal(retried.status,'done');
  assert.equal(retried.completedCount,2);
  assert.deepEqual(retried.result.entries.map(entry=>entry.image),retryImages);
  assert.equal((await inspect())['test:count'],beforeRetry+3,'first image called once; failed second called twice');
  assert.equal((await inspect())['job:'+retryId].requestIds[1],checkpoint.requestIds[1],'retry keeps original request id');
  assert.equal(Object.keys(await inspect()).filter(k=>k.startsWith('upload:') || k.startsWith('payload:')).length,0);
  console.log('PASS: committed first result survives process restart; only failed second image retries automatically with stable request id');
  for(const [id,image,status,attempts,partial] of [
    ['cccccccc-cccc-4ccc-8ccc-cccccccccccc','data:image/png;base64,ZmFpbA==',503,3,true],
    ['dddddddd-dddd-4ddd-8ddd-dddddddddddd','data:image/png;base64,ZGVueQ==',403,1,false]
  ]) {
    const terminalUrl=url.replace(taskId,id), before=(await inspect())['test:count'];
    await runtime.dispatchFetch(terminalUrl,{method:'POST',headers:{Authorization:'Bearer synthetic'},body:JSON.stringify({images:[images[0],image],confirmed:true,selfSide:'right',sessionId:id})});
    await delay(partial?4500:700);
    const terminal=await (await runtime.dispatchFetch(terminalUrl)).json();
    assert.equal(terminal.status,'error');
    assert.equal(terminal.completedCount,1);
    assert.equal((await inspect())['test:count'],before+1+attempts,'retry ceiling and no retry for denied authorization');
    const stored=(await inspect())['job:'+id];
    assert.equal(stored.failureStatus,status);
    assert.equal(stored.authorization,undefined);
    assert.equal(stored.parameters,undefined);
    if(partial) assert.deepEqual(terminal.partialResult.entries.map(row=>row.image),[images[0]]);
    else assert.equal(terminal.partialResult,undefined,'authorization failure cannot release earlier result');
    assert.equal(Object.keys(await inspect()).filter(k=>k.startsWith('payload:') || k.startsWith('upload:')).length,0);
  }
  console.log('PASS: transient failure stops after three attempts and releases saved prefix; non-JSON 403 stops immediately and withholds partial output');
  console.log("PASS: both chat and social profiles auto-start after the final image with no client commit or polling; lost final ACK is idempotent");
  console.log("PASS: SQLite chunk transactions, full runtime restart, receipts, conflict guards, automatic alarm without client polling, ordering and cleanup");
  const momentsId='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  let momentsLedger=await runtime.getD1Database('DB');
  const momentsUrl='http://local/api/miniapp/social-profile?taskId='+momentsId;
  const beforeBalance=await momentsLedger.prepare("SELECT balance FROM coach_credit_accounts WHERE owner_id='synthetic-owner'").first();
  const submitted=await runtime.dispatchFetch(momentsUrl,{method:'POST',headers:{Authorization:'Bearer synthetic'},body:JSON.stringify({confirmed:true,materialType:'moments',images:images.slice(0,3)})});
  assert.equal(submitted.status,202);
  // Restart the entire server after the first wave, without losing saved OCR.
  // Observe durable storage, not the phone endpoint; scheduling does not rely on polling.
  // Wait for an actual checkpoint instead of assuming workerd starts within 600 ms.
  let momentsCheckpoint;
  const checkpointDeadline=Date.now()+10000;
  do {
    await delay(100);
    momentsCheckpoint=await inspect();
  } while (!momentsCheckpoint['job:'+momentsId]?.momentsDone?.[0] && Date.now()<checkpointDeadline);
  assert.ok(momentsCheckpoint['job:'+momentsId].momentsDone[0], JSON.stringify({job:momentsCheckpoint['job:'+momentsId],calls:Object.fromEntries(Object.entries(momentsCheckpoint).filter(([key])=>key.startsWith('test:moments:')))}));
  await runtime.dispose();runtime=new Miniflare(options);
  momentsLedger=await runtime.getD1Database('DB');
  // No phone polling or additional commit while both extraction and summary retry.
  await delay(4000);
  const finished=await (await runtime.dispatchFetch(momentsUrl)).json();
  assert.equal(finished.status,'done');assert.equal(finished.result.moments.posts.length,3);
  const inspected=await inspect();
  assert.equal(inspected['test:moments:extract:0'],1);
  assert.equal(inspected['test:moments:extract:1'],2);
  assert.equal(inspected['test:moments:extract:2'],1);
  assert.equal(inspected['test:moments:summarize:summary'],2);
  assert.equal(Object.keys(inspected).filter(k=>k.startsWith('moments:'+momentsId)||k.startsWith('payload:'+momentsId)).length,0);
  const afterBalance=await momentsLedger.prepare("SELECT balance FROM coach_credit_accounts WHERE owner_id='synthetic-owner'").first();
  assert.equal(beforeBalance.balance-afterBalance.balance,30,'all stage retries settle only one profile charge');
  console.log('PASS moments: persisted per-image stages, two independent reads, failed-step-only retries, text-only summary, autonomous completion without polling and one credit charge');
} finally {
  await runtime.dispose();
}
