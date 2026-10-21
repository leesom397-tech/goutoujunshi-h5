import { DurableObject } from 'cloudflare:workers';
import app from '../dist/server/index.js';
import { reserveCredits, finishCreditTask } from './account-credits.mjs';
import { fullHistoryPrice, requirePriceConfirmation } from './analysis-pricing.mjs';
import { legacyMiniappHistoryQuote } from './miniapp-legacy-pricing.mjs';
import { beginSavedReport, readAnalysisReport } from './saved-reports.mjs';

const digest = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)))), b => b.toString(16).padStart(2, '0')).join('');
const running = job => ['queued', 'running', 'retrying'].includes(job.status);
const fail = (message, status = 409) => Object.assign(new Error(message), {status});
const view = job => ({creditAmount:job.creditAmount,quote:job.priceQuote,taskId:job.taskId, status:job.status, phase:job.phase || 'preparing', kind:job.input.kind || 'chat', completedCaptions:job.completedCaptions || 0, friend:job.input.friend.replace(/ · #[a-fA-F0-9]{16}$/,''), completedText:job.completedText || 0, completedImages:job.completedImages || 0, totalCount:job.input.expectedTotal, reusedSteps:job.reusedSteps || 0, startedAt:job.createdAt, updatedAt:job.updatedAt, completedAt:job.status==='done'?(job.completedAt||job.updatedAt):undefined, primarySnapshot:{libraryId:job.input.libraryId,expectedEpoch:job.input.expectedEpoch,expectedTotal:job.input.expectedTotal,revision:job.manifest?.primary?.revision}, relatedSnapshots:job.manifest?.related||job.input.relatedSnapshots||[], error:job.error || '', subjectId:job.input.subjectId, libraryId:job.input.libraryId, creditTaskStatus:job.creditOutcome || (job.creditFinished ? job.status === 'done' ? 'settled' : 'released' : 'reserved'), creditSettlementPending:!job.creditFinished && !running(job), creditSettlementIssue:job.creditSettlementIssue || undefined});

// One namespace per owner. The alarm, payload and model checkpoints live in
// durable storage, independent of browsers, tabs and Worker process lifetimes.
export class CaptureHistoryJobs extends DurableObject {
  startTail = Promise.resolve();
  async start(owner, input, manifest, options = {}) {
    const work = this.startTail.catch(() => {}).then(() => this.begin(owner, input, manifest, options));
    this.startTail = work.then(() => {}, () => {});
    return work;
  }
  async begin(owner, input, manifest, options = {}) {
    if (!owner || !/^[a-f0-9-]{36}$/.test(input?.requestId || '') || input.analysisScope !== 'fullHistory' || !['chat','moments'].includes(input.kind)) throw fail('任务参数无效。', 400);
    if (!this.env.WECHAT_CALLBACK_TOKEN) throw fail('后台分析暂不可用，请稍后重试。', 503);
    const {requestId, ...scope} = input;
    const fingerprint = await digest({scope, manifest});
    const old = await this.ctx.storage.get('job:' + requestId);
    if (old) {
      if (old.owner !== owner || JSON.stringify(old.input) !== JSON.stringify(input)) throw fail('任务编号与材料不一致。');
      return this.status(owner, requestId);
    }
    const previous = await this.env.DB.prepare("SELECT id FROM coach_saved_reports WHERE owner_id=? AND status='done' AND json_extract(result,'$.analysisFingerprint')=? ORDER BY created_at DESC LIMIT 1").bind(owner,fingerprint).first();
    if(previous){const saved=await readAnalysisReport(this.env.DB,owner,previous.id);if(saved&&!saved.report?.degradedSynthesis)return {taskId:previous.id,status:'done',result:saved.report,reused:true};}
    const jobs = await this.ctx.storage.list({prefix:'job:'});
    for (const job of jobs.values()) {
      if (job.owner !== owner) throw fail('任务账号不一致。', 403);
      if (job.fingerprint === fingerprint && job.status === 'done') {
        const saved = await readAnalysisReport(this.env.DB, owner, job.taskId);
        if (saved&&!saved.report?.degradedSynthesis) return {...view(job), result:saved.report, reused:true};
      }
      if (running(job) && job.expiresAt > Date.now()) return {...view(job), active:true, sameMaterials:job.fingerprint === fingerprint};
    }
    const currentQuote = fullHistoryPrice(input);
    // This option is set only by the authenticated server route, never copied
    // from the request body or normalized analysis input.
    const quote = options.legacyMiniapp === true ? legacyMiniappHistoryQuote(currentQuote) : currentQuote;
    if (options.quoteOnly === true) return {status:'quoted',quote};
    if(options.legacyMiniapp !== true)requirePriceConfirmation(options.priceConfirmation, quote);
    const reservation = await reserveCredits(this.env.DB, {ownerId:owner,requestId,feature:'analysis',amount:quote.amount,fingerprint});
    if (!reservation.execute && reservation.status !== 'reserved') throw fail('本次任务已结束，请重新发起。');
    const now = Date.now();
    const job = {owner,taskId:requestId,input,manifest,fingerprint,creditAmount:quote.amount,priceQuote:quote,createdAt:now,updatedAt:now,expiresAt:now+23*3600000,status:'queued',used:[],completedText:0,completedCaptions:0,completedImages:0,reusedSteps:0,failures:0};
    try {
      await beginSavedReport(this.env.DB,{ownerId:owner,id:requestId,kind:input.kind,subjectId:input.subjectId,createdAt:now});
      await this.ctx.storage.transaction(async tx => {await tx.put('job:'+requestId,job);await tx.setAlarm(now+100);});
    } catch (error) {await finishCreditTask(this.env.DB,owner,requestId,false);throw error;}
    return view(job);
  }
  async status(owner, taskId, scope = {}) {
    let job;
    const matches=value=>value.owner===owner&&(!scope.libraryId||value.input.libraryId===scope.libraryId)&&(!scope.subjectId||value.input.subjectId===scope.subjectId);
    if (taskId) job = await this.ctx.storage.get('job:'+taskId);
    else {
      const jobs = await this.ctx.storage.list({prefix:'job:'});
      job = [...jobs.values()].filter(matches).sort((a,b)=>Number(running(b))-Number(running(a)) || b.createdAt-a.createdAt)[0];
    }
    if (!job || !matches(job)) return null;
    const alarmAt=await this.ctx.storage.getAlarm();
    // A stale running job may retain a cleanup alarm rather than its recovery
    // alarm after an interrupted invocation. Merely checking for any alarm can
    // leave it showing "running" until cleanup weeks later.
    const recoveryLost=running(job)&&Date.now()-job.updatedAt>210000&&(!alarmAt||alarmAt>Date.now()+180000||alarmAt<Date.now()-180000);
    if ((running(job) || !job.creditFinished) && (!alarmAt||recoveryLost)) await this.ctx.storage.setAlarm(Math.max(Date.now()+100, !running(job) ? job.nextSettlementAt || 0 : 0));
    if (job.status === 'done') {
      const saved = await readAnalysisReport(this.env.DB,owner,job.taskId);
      if (!saved) return {...view(job),status:'removed',result:undefined,error:'报告已删除。'};
      return {...view(job),...(scope.summaryOnly?{}:{result:saved.report})};
    }
    return view(job);
  }
  async checkpoint(owner, taskId, token, key, update) {
    if (!this.env.WECHAT_CALLBACK_TOKEN || token !== this.env.WECHAT_CALLBACK_TOKEN) throw fail('任务验证失败。',403);
    return this.ctx.storage.transaction(async tx => {
      const job = await tx.get('job:'+taskId);
      if (!job || job.owner!==owner || !running(job) || job.expiresAt<=Date.now()) throw fail('任务已结束。');
      if (key === 'context') {
        if (update && !job.context) {job.context=update;await tx.put('job:'+taskId,job);}
        return job.context || null;
      }
      if (key === 'progress') {
        if(update){
          job.phase=update.phase;
          // Media observations may already be in the exact-image cache from a
          // prior attempt. They still count as read in this task's progress.
          if(Number.isSafeInteger(update.completedImages)&&update.completedImages>=0)job.completedImages=Math.max(job.completedImages||0,update.completedImages);
          job.updatedAt=Date.now();await tx.put('job:'+taskId,job);
        }
        return null;
      }
      if (!/^[a-f0-9]{64}$/.test(key)) throw fail('检查点无效。',400);
      // Owner isolation comes from the namespace. Epoch binding prevents reuse
      // after deletion/reimport; exact prompt hashes invalidate edited evidence.
      const scope = await digest([job.input.libraryId,job.input.expectedEpoch,job.input.subjectId,job.input.relatedSnapshots.map(x=>[x.libraryId,x.expectedEpoch])]);
      const cacheKey = 'step:'+scope+':'+key;
      let cached = await tx.get(cacheKey);
      if (cached?.expiresAt <= Date.now()) cached = null;
      if (update) {
        if(typeof update.text!=='string'||update.text.length>60000)throw fail('检查点过大。',413);
        cached={...update,expiresAt:Date.now()+7*86400000};await tx.put(cacheKey,cached);
      }
      if (cached && !cached.draft && !job.used.includes(key)) {
        job.used.push(key);job.completedText+=cached.count || 0;job.completedCaptions=(job.completedCaptions || 0)+(cached.captionCount || 0);job.completedImages+=cached.phase==='images'?(cached.imageCount || 1):0;
        job.reusedSteps+=update?0:1;job.updatedAt=Date.now();job.failures=0;
        await tx.put('job:'+taskId,job);
      }
      return cached || null;
    });
  }
  async purge(owner) {
    const work=this.startTail.catch(()=>{}).then(async()=>{
      const interrupted=await this.ctx.storage.transaction(async tx=>{
        const jobs=await tx.list({prefix:'job:'}), affected=[];
        for(const [key,job] of jobs){
          if(job.owner!==owner)throw fail('任务账号不一致。',403);
          if(running(job)||job.purged){
            const clean={owner,taskId:job.taskId,input:{friend:'',expectedTotal:0,subjectId:null,libraryId:null},manifest:{},fingerprint:'',status:'error',phase:'stopped',error:'已清理资料，本次后台分析已停止。',purged:true,createdAt:job.createdAt,updatedAt:Date.now(),creditFinished:job.creditFinished===true,creditOutcome:job.creditOutcome,used:[],expiresAt:job.expiresAt};
            await tx.put(key,clean);affected.push(clean);
          }else if(job.creditFinished)await tx.delete(key);
          else {delete job.context;job.input={friend:'',expectedTotal:0,subjectId:null,libraryId:null};job.manifest={};job.fingerprint='';job.used=[];await tx.put(key,job);}
        }
        for(const [key] of await tx.list({prefix:'step:'}))await tx.delete(key);
        await tx.setAlarm(Date.now()+100);
        return affected;
      });
      for(const job of interrupted){
        // A late save cannot recreate an interrupted report after this marker.
        await this.env.DB.prepare("UPDATE coach_saved_reports SET status='deleted',result='{}',summary='',updated_at=? WHERE owner_id=? AND id=?").bind(Date.now(),owner,job.taskId).run();
        if(!job.creditFinished)await this.settle('job:'+job.taskId,job);
      }
      return {cleared:true};
    });
    this.startTail=work.then(()=>{},()=>{});
    return work;
  }
  async outcome(key, patch) {
    return this.ctx.storage.transaction(async tx=>{
      const job=await tx.get(key);
      if(!job||job.purged)return job;
      Object.assign(job,patch,{updatedAt:Date.now()});if(patch.status==='done'&&!job.completedAt)job.completedAt=job.updatedAt;await tx.put(key,job);return job;
    });
  }
  async settle(key, job) {
    const desired=job.status==='done'?'settled':'released';
    let actual;
    try { actual=(await finishCreditTask(this.env.DB,job.owner,job.taskId,desired==='settled')).status; }
    catch {
      // A cron recovery can already have released the reservation. Confirm the
      // actual ledger state before closing it; never reserve or charge again.
      try {actual=(await this.env.DB.prepare('SELECT status FROM coach_credit_tasks WHERE owner_id=? AND request_id=?').bind(job.owner,job.taskId).first())?.status;} catch {}
    }
    return this.ctx.storage.transaction(async tx=>{
      const current=await tx.get(key);if(!current)return null;
      if(actual==='settled'||actual==='released'){
        current.creditFinished=true;current.creditOutcome=actual;delete current.context;delete current.nextSettlementAt;
        current.creditSettlementIssue=actual!==desired ? actual==='released'?'积分已退回，本次未重复扣费。':'积分已结算，本次未重复扣费。' : '';
      }else{
        current.creditFinished=false;current.settlementAttempts=Math.min(1024,(current.settlementAttempts||0)+1);
        current.nextSettlementAt=Date.now()+Math.min(300000,1000*2**Math.min(8,current.settlementAttempts));
        current.creditSettlementIssue='积分状态正在核对，系统会继续重试。';
        // Cloudflare's automatic alarm retries are finite. Persist another
        // alarm ourselves so a prolonged ledger outage remains recoverable.
        const alarm=await tx.getAlarm();if(!alarm||alarm>current.nextSettlementAt)await tx.setAlarm(current.nextSettlementAt);
      }
      await tx.put(key,current);return current;
    });
  }
  async alarm() {
    const jobs=await this.ctx.storage.list({prefix:'job:'});
    for(const [key] of jobs){
      let job=await this.ctx.storage.get(key);
      if(!job)continue;
      if(running(job)){
        if(job.expiresAt<=Date.now())job=await this.outcome(key,{status:'error',error:'本次后台任务已到期，冻结积分退回。可以重新发起，已完成段落会复用。'});
        else {
          job=await this.ctx.storage.transaction(async tx=>{
            const current=await tx.get(key);if(!current||!running(current)||current.purged)return current;
            current.status='running';current.updatedAt=Date.now();await tx.put(key,current);await tx.setAlarm(Date.now()+180000);return current;
          });
          if(job&&running(job)&&!job.purged)try{
            const response=await app.fetch(new Request('https://coach.lovetalk.love/api/web/capture/analyze',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://coach.lovetalk.love','x-capture-job-key':this.env.WECHAT_CALLBACK_TOKEN,'x-capture-job-owner':job.owner},body:JSON.stringify({input:job.input,manifest:job.manifest,fingerprint:job.fingerprint})}),this.env,this.ctx);
            const result=await response.json();job=await this.ctx.storage.get(key);
            if(job&&!job.purged){
              if(response.status===202&&result.code==='CAPTURE_JOB_YIELD')job=await this.outcome(key,{status:'queued',error:''});
              else if(response.ok&&result.reportId)job=await this.outcome(key,{status:'done',error:'',phase:'complete'});
              else{
                const failures=(job.failures||0)+1, transient=response.status>=500||response.status===429;
                job=await this.outcome(key,{failures,status:transient&&failures<4?'retrying':'error',error:transient&&failures<4?(result.code==='CAPTURE_JOB_RETRY'&&typeof result.error==='string'?result.error.slice(0,300):'当前步骤正在重试，已完成内容会保留。'):result.error||'本次分析未完成，冻结积分退回；已完成段落会保留。'});
              }
            }
          }catch{
            job=await this.ctx.storage.get(key);
            if(job&&!job.purged){
              const failures=(job.failures||0)+1;
              job=await this.outcome(key,{failures,status:failures<4?'retrying':'error',error:'服务连接暂时中断。已完成的段落会保留。'});
            }
          }
        }
      }
      job=await this.ctx.storage.get(key);if(!job)continue;
      // Persisted terminal state precedes settlement. Both a restart and a
      // concurrent deletion settle idempotently without another provider call.
      if(!running(job)&&!job.creditFinished&&(!job.nextSettlementAt||job.nextSettlementAt<=Date.now()))job=await this.settle(key,job);
      if(!job)continue;
      if(running(job)){await this.ctx.storage.setAlarm(Date.now()+(job.status==='retrying'?5000:100));return;}
    }
    const steps=await this.ctx.storage.list({prefix:'step:'}),cleanupAt=[];
    for(const [key,step] of steps){if(step.expiresAt<=Date.now())await this.ctx.storage.delete(key);else cleanupAt.push(step.expiresAt);}
    for(const [key,job] of await this.ctx.storage.list({prefix:'job:'})){
      if(running(job)){cleanupAt.push(Date.now()+100);continue;}
      if(!running(job)&&job.creditFinished&&(job.purged||job.createdAt<Date.now()-30*86400000))await this.ctx.storage.delete(key);
      else cleanupAt.push(!running(job)&&!job.creditFinished ? job.nextSettlementAt||Date.now()+1000 : job.createdAt+30*86400000+1000);
    }
    if(cleanupAt.length)await this.ctx.storage.setAlarm(Math.max(Date.now()+1000,Math.min(...cleanupAt)));
    else await this.ctx.storage.deleteAlarm();
  }
}
