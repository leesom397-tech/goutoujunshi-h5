import { DurableObject } from "cloudflare:workers";
import app from "../dist/server/index.js";
import { finishCreditTask, reserveCredits } from "./account-credits.mjs";
import { screenshotPrice, requirePriceConfirmation } from "./analysis-pricing.mjs";
import { requestOwner, isWebApi, webSessionCookie } from "./request-identity.mjs";
import { beginSavedReport, saveAnalysisReport, readAnalysisReport } from "./saved-reports.mjs";
import { recognitionSnapshot, validateRecognitionConfirmation } from "./screenshot-recognition-review.mjs";

const reply = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const pattern = /^[a-f0-9-]{36}$/;
const digest = async value => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), b => b.toString(16).padStart(2, "0")).join("");
const uploadStatus = job => ({ creditAmount:job.creditAmount,taskId: job.taskId, status: job.status, imageCount: job.imageCount, completedCount: job.completedCount || 0, processingIndex: job.kind === 'chat' ? (job.completedCount || 0) : null, retryAttempt: job.attempt || 0, retryAt: job.retryAt || null, received: (job.parts || []).flatMap((part, index) => part ? [index] : []), expiresAt: job.expiresAt });

// Jobs retain only the credential required for their channel until they finish.
const jobIdentity = request => isWebApi(request)
  ? { webCookie: webSessionCookie(request), webOrigin: new URL(request.url).origin }
  : {};
const callbackUrl = (job, path) => (job.webOrigin || 'https://coach.lovetalk.love') + (job.webOrigin ? '/api/web/' : '/api/miniapp/') + path;
const callbackHeaders = job => ({ 'Content-Type': 'application/json', ...(job.webOrigin
  ? { Cookie: job.webCookie || '', Origin: job.webOrigin }
  : { Authorization: job.authorization || '' }) });

// One isolated task store per authenticated owner. Images live only in temporary
// job chunks, never coach_profiles. Terminal tasks discard images immediately.
export class SocialProfileJobs extends DurableObject {
  reportOptions(job) {
    return { ownerId:job.ownerId,id:job.taskId,kind:job.kind==='chat'?'chat':job.reportKind || (job.parameters?.materialType==='moments' || job.result?.moments ? 'moments':'social'),
      subjectId:job.reportSubjectId || job.parameters?.subjectId || null,imageCount:job.imageCount,createdAt:job.createdAt || job.expiresAt-86400000,
      targetSelf:job.target==='self',totalCount:job.totalCount,selfSide:job.reportSelfSide || job.parameters?.selfSide,captureOrigin:job.captureOrigin===true };
  }
  async persistReport(job, result) {
    const value=result || (job.resultChunks ? await this.readResult(job):job.result);
    return saveAnalysisReport(this.env.DB,{...this.reportOptions(job),result:{...value,
      ...(!value?.partial&&job.billingFingerprint&&!Object.keys(job.reviewReceipts||{}).length?{billingFingerprint:job.billingFingerprint}:{})}});
  }
  async reuseIdenticalReport(job, key) {
    if(job.billingChecked)return false;
    const body=await this.readPayload(job);
    // Hash exact uploaded bytes and interpretation settings. Request/session
    // identifiers are transport metadata, never a reason to sell the same
    // completed report twice. Corrected OCR is deliberately not cached here.
    job.billingFingerprint=await digest(JSON.stringify({version:1,kind:job.kind,
      materialType:body.materialType||'profile',subjectId:body.subjectId||null,selfSide:body.selfSide||null,
      target:body.target||'other',compareWithSelf:body.compareWithSelf===true,knownContext:body.knownContext||{},
      previous:body.previous||null,previousCount:body.previousCount||0,
      images:await Promise.all(body.images.map(image=>digest(image)))}));
    job.billingChecked=true;
    const prior=await this.env.DB.prepare("SELECT id FROM coach_saved_reports WHERE owner_id=? AND id!=? AND status='done' AND COALESCE(json_extract(result,'$.partial'),0)=0 AND json_extract(result,'$.billingFingerprint')=? ORDER BY created_at DESC LIMIT 1")
      .bind(job.ownerId,job.taskId,job.billingFingerprint).first();
    const saved=prior?await readAnalysisReport(this.env.DB,job.ownerId,prior.id):null;
    if(!saved){await this.ctx.storage.put(key,job);return false;}
    const settings=await this.env.DB.prepare('SELECT consent_at,image_consent_at,image_self_side FROM coach_crush_settings WHERE owner_id=?').bind(job.ownerId).first();
    if(!settings?.consent_at||!settings.image_consent_at||job.kind==='chat'&&settings.image_self_side!==body.selfSide){
      // Let the normal handler report revoked settings; a cached result is
      // never a shortcut around the permission/speaker checks of analysis.
      await this.ctx.storage.put(key,job);return false;
    }
    job.reused=true;job.reusedReportId=prior.id;job.status='done';job.completedCount=job.imageCount;
    job.result=await this.persistReport(job,saved.entries?{entries:saved.entries}:saved.report);job.reportSaved=true;
    // Save the free outcome before settlement, so a crash retries its refund
    // instead of falling through to another paid analysis.
    await this.ctx.storage.put(key,job);
    await this.settleJob(job,false);
    delete job.authorization;delete job.webCookie;delete job.parameters;
    await this.ctx.storage.put(key,job);await this.removePayload(job);
    return true;
  }
  // Called only through the authenticated owner's namespace binding. Existing
  // completed jobs still in their temporary store are promoted on history load.
  async syncSavedReports(owner) {
    const jobs=await this.ctx.storage.list({prefix:'job:'});
    for(const [key,job] of jobs) if(job.ownerId===owner && job.status==='done' && !job.reportSaved){
      try { const saved=await this.persistReport(job);job.reportSaved=true;if(!job.resultChunks)job.result=saved;await this.ctx.storage.put(key,job); }
      catch(error){if(error.message!=='SAVED_REPORT_DELETED')throw error;}
    }
  }
  // Internal RPC only. Bind checkpoints to the authenticated owner and the
  // current image, so a retry can reuse OCR without accepting client input.
  async screenshotCheckpoint(taskId, requestId, owner, token, update) {
    if (!this.env.WECHAT_CALLBACK_TOKEN || token !== this.env.WECHAT_CALLBACK_TOKEN) throw new Error('CHECKPOINT_DENIED');
    const job = await this.ctx.storage.get('job:' + taskId);
    if (!job || job.ownerId !== owner || job.kind !== 'chat' || job.status !== 'running' || job.expiresAt <= Date.now() || job.requestIds[job.completedCount || 0] !== requestId) throw new Error('CHECKPOINT_STALE');
    const key = `screenshot:${taskId}:${requestId}`;
    const prior = await this.ctx.storage.get(key) || {};
    if (update) {
      if (!['ocr', 'recognized', 'text_analysis', 'save'].includes(update.phase)) throw new Error('CHECKPOINT_PHASE');
      if(prior.reviewed && update.raw && JSON.stringify(prior.raw)!==JSON.stringify(update.raw))throw new Error('CHECKPOINT_STALE');
      const next = {...prior, phase:update.phase, updatedAt:Date.now(), ...(update.raw ? {raw:update.raw} : {}),...(update.budgetReserved===true?{budgetReserved:true}:{})};
      if (JSON.stringify(next).length > 100000) throw new Error('CHECKPOINT_SIZE');
      await this.ctx.storage.put(key, next);
      return {...next,reviewOnDoubt:job.reviewOnDoubt===true};
    }
    return {...prior,reviewOnDoubt:job.reviewOnDoubt===true};
  }
  async review(request,taskId,body){
    const job=await this.ctx.storage.get('job:'+taskId);
    if(!job||job.ownerId!==body.ownerId||!job.reviewOnDoubt||job.kind!=='chat')return reply({error:'没有找到这份待确认的识别内容。'},404);
    if(job.expiresAt<=Date.now())return reply({error:'识别内容已到期，请重新上传。'},410);
    if(body.reviewAction==='cancel')return this.upload(request,taskId,{...body,uploadAction:'cancel'});
    if(body.reviewAction!=='confirm')return reply({error:'本次任务不支持中途暂停，请等待已有结果。'},400);
    if(this.submitting)return reply({error:'正在确认，请稍后重试。'},409);
    this.submitting=true;
    try{
      if(!Number.isInteger(body.index)||body.index<0||body.index>=job.imageCount||body.requestId!==job.requestIds[body.index])return reply({error:'截图序号或记录编号不一致。'},409);
      const receipt=job.reviewReceipts?.[body.requestId];
      if(receipt){const fingerprint=await digest(JSON.stringify({confirmed:body.confirmed,index:body.index,requestId:body.requestId,revision:body.revision,selfSide:body.selfSide,lines:body.lines}));return receipt===fingerprint?reply(uploadStatus(job),202):reply({error:'这次纠正已经确认，不能覆盖已开始的分析。'},409);}
      if(job.status!=='awaiting_review'||body.index!==(job.completedCount||0))return reply({error:'这张图不在待确认阶段，请刷新任务。'},409);
      const key=`screenshot:${taskId}:${body.requestId}`,checkpoint=await this.ctx.storage.get(key);
      if(!checkpoint?.raw)return reply({error:'识别内容暂不可用，请重新打开任务。'},409);
      const fixed=validateRecognitionConfirmation(checkpoint.raw,{index:body.index,requestId:body.requestId,revision:0,selfSide:job.reportSelfSide||job.parameters?.selfSide},body);
      const fingerprint=await digest(JSON.stringify({confirmed:body.confirmed,index:body.index,requestId:body.requestId,revision:body.revision,selfSide:body.selfSide,lines:body.lines}));
      job.reviewReceipts={...(job.reviewReceipts||{}),[body.requestId]:fingerprint};job.status='queued';job.attempt=0;delete job.error;delete job.retryAt;
      await this.ctx.storage.transaction(async tx=>{await tx.put(key,{...checkpoint,raw:fixed.raw,reviewed:true,phase:'recognized'});await tx.put('job:'+taskId,job);await tx.setAlarm(Date.now()+100);});
      return reply(uploadStatus(job),202);
    }catch(error){if(error.status)return reply({error:error.message},error.status);throw error;}
    finally{this.submitting=false;}
  }
  async fetch(request) {
    const taskId = new URL(request.url).searchParams.get("taskId");
    if (!taskId || !pattern.test(taskId)) return reply({ error: "任务编号无效。" }, 400);
    const key = "job:" + taskId;
    if (request.method === "GET") {
      const job = await this.ctx.storage.get(key);
      if (!job || job.expiresAt <= Date.now()) return reply({ status: "expired", error: "任务已过期，请重新选择资料。" }, 404);
      if(job.status==='done' && !job.reportSaved){try{const saved=await this.persistReport(job);job.reportSaved=true;if(!job.resultChunks)job.result=saved;await this.ctx.storage.put(key,job);}catch(error){if(error.message==='SAVED_REPORT_DELETED')return reply({error:'报告已删除。'},404);throw error;}}
      const stored=job.status==='done'?await readAnalysisReport(this.env.DB,job.ownerId,taskId):null;
      if(job.status==='done'&&!stored)return reply({error:'报告已删除。'},404);
      const result=stored ? (stored.entries?{entries:stored.entries,reportId:taskId,subjectId:stored.subjectId,selfSide:stored.selfSide,retention:stored.retention,...(stored.report.captureOrigin===true?{captureOrigin:true}:{})}:stored.report) : job.result;
      // Only committed single-image reports are readable during processing.
      // This is a checkpoint, not a completed batch or a settlement trigger.
      const partialReadable = job.status === 'error' || job.kind === 'chat' && ['queued','running','awaiting_review'].includes(job.status);
      const partialSaved=partialReadable && job.completedCount>0 ? await readAnalysisReport(this.env.DB,job.ownerId,taskId):null;
      const partialResult = partialSaved && ![401,403,409].includes(job.failureStatus) ? {entries:partialSaved.entries,reportId:taskId,partial:true,...(partialSaved.report.captureOrigin===true?{captureOrigin:true}:{})} : undefined;
      const checkpoint = job.kind === 'chat' && ['queued','running','awaiting_review'].includes(job.status) ? await this.ctx.storage.get(`screenshot:${taskId}:${job.requestIds[job.completedCount || 0]}`) : null;
      const recognition = checkpoint?.raw ? recognitionSnapshot(checkpoint.raw,{index:job.completedCount||0,requestId:job.requestIds[job.completedCount||0],selfSide:job.reportSelfSide||job.parameters?.selfSide,editable:job.status==='awaiting_review'}) : undefined;
      return reply({ ...uploadStatus(job), taskId, status: job.status, result, partialResult, recognition, error: job.error, target: job.target, compareWithSelf: job.compareWithSelf, totalCount: job.totalCount, phase:checkpoint?.phase || job.momentsPhase, startedAt:job.startedAt, recognizedCount:job.kind === 'chat' ? (job.completedCount || 0)+(checkpoint?.raw?1:0) : (job.momentsDone||[]).filter(Boolean).length, preview:job.preview });
    }
    if (request.method !== "POST") return reply({ error: "METHOD_NOT_ALLOWED" }, 405);
    const raw = await request.text();
    if (raw.length > 49_000_000) return reply({ error: "这组图片过大，请压缩后重试。" }, 413);
    let body;
    try { body = JSON.parse(raw); } catch { return reply({ error: "无法读取图片。" }, 400); }
    if (body?.reviewAction) return this.review(request, taskId, body);
    if (body?.uploadAction) return this.upload(request, taskId, body);
    if (!body || body.confirmed !== true || !Array.isArray(body.images) || body.images.length < 1 || body.images.length > 9) return reply({ error: "请确认并选择 1–9 张截图。" }, 400);
    if (this.submitting) return reply({ error: "正在提交，请稍后再试。" }, 409);
    this.submitting = true;
    let admissionReserved=false;
    try {
      const existing = await this.ctx.storage.get(key);
      if (existing) return reply({ taskId, status: existing.status, result: existing.result }, 202);
      const jobs = await this.ctx.storage.list({ prefix: "job:" });
      if ([...jobs.values()].some(job => ["uploading", "queued", "running", "awaiting_review"].includes(job.status) && job.expiresAt > Date.now())) return reply({ error: "上一份资料仍在处理中，请先查看任务。" }, 409);
      const quote = screenshotPrice(body.images.length);
      try { requirePriceConfirmation(body.priceConfirmation, quote); }
      catch (error) { return reply({error:error.message,code:error.code,quote:error.quote},409); }
      const creditAmount = await this.reserveJob(body.ownerId, taskId, body.images.length, new URL(request.url).pathname.endsWith("/screenshot/batch"), await digest(raw));
      admissionReserved=true;
      const chunks = Math.ceil(raw.length / 128000);
      const job = { ...jobIdentity(request), taskId, status: "queued", kind: new URL(request.url).pathname.endsWith("/screenshot/batch") ? "chat" : "profile", imageCount: body.images.length, requestIds: body.images.map(() => crypto.randomUUID()), target: body.target, compareWithSelf: body.compareWithSelf === true, totalCount: (Number(body.previousCount) || 0) + body.images.length, chunks, authorization: request.headers.get("authorization"), ownerId: body.ownerId, creditAmount, creditRequestId: taskId, expiresAt: Date.now() + 86400000 };
      Object.assign(job,{createdAt:Date.now(),reportKind:body.materialType==='moments'?'moments':'social',reportSubjectId:body.subjectId||null,reportSelfSide:body.selfSide,captureOrigin:body.captureOrigin===true});
      await beginSavedReport(this.env.DB,this.reportOptions(job));
      // Commit the payload and alarm together. Scheduling never depends on a phone remaining connected.
      await this.ctx.storage.transaction(async txn => {
        for (let i = 0; i < chunks; i++) await txn.put("payload:" + taskId + ":" + i, raw.slice(i * 128000, (i + 1) * 128000));
        await txn.put(key, job);
        await txn.setAlarm(Date.now() + 100);
      });
      return reply({ taskId, status: "running" }, 202);
    } catch(error) {
      if(admissionReserved)await finishCreditTask(this.env.DB,body.ownerId,taskId,false);
      throw error;
    } finally { this.submitting = false; }
  }

  async upload(request, taskId, body) {
    if (this.submitting) return reply({ error: "正在接收，请稍后重试。" }, 409);
    this.submitting = true;
    const key = "job:" + taskId;
    let admissionReserved=false;
    try {
      let job = await this.ctx.storage.get(key);
      if (job && job.expiresAt <= Date.now()) return reply({ error: "上传任务已过期，请重新选择图片。" }, 410);
      if (body.uploadAction === "init") {
        if (body.confirmed !== true || !Number.isInteger(body.imageCount) || body.imageCount < 1 || body.imageCount > 9) return reply({ error: "请确认并选择 1–9 张截图。" }, 400);
        const kind = new URL(request.url).pathname.endsWith("/screenshot/batch") ? "chat" : "profile";
        const parameters = { confirmed: true, materialType: body.materialType === "moments" ? "moments" : "profile", target: body.target === "self" ? "self" : "other", compareWithSelf: body.compareWithSelf === true, knownContext: body.knownContext?.sameCity === true ? {sameCity:true} : {},
          selfSide: body.selfSide, subjectId: body.subjectId || null, sessionId: body.sessionId,captureOrigin:body.captureOrigin===true,...(kind==='chat'&&body.reviewOnDoubt===true?{reviewOnDoubt:true}:{}),
          previous: body.previous || null, previousCount: body.previousCount || 0 };
        if (kind === "chat" && (!["left", "right"].includes(parameters.selfSide) || !pattern.test(parameters.sessionId || ""))) return reply({ error: "请确认聊天气泡侧与会话。" }, 400);
        if (parameters.subjectId !== null && !pattern.test(parameters.subjectId)) return reply({ error: "人物编号无效。" }, 400);
        if (!Number.isInteger(parameters.previousCount) || parameters.previousCount < 0 || parameters.previousCount + body.imageCount > 9 || JSON.stringify(parameters).length > 16000) return reply({ error: "资料摘要或图片数量超出范围。" }, 400);
        const autoStart = body.autoStart === true;
        const fingerprint = await digest(JSON.stringify({ kind, imageCount: body.imageCount, parameters, ...(autoStart ? { autoStart: true } : {}) }));
        if (job) return job.uploadFingerprint === fingerprint ? reply(uploadStatus(job), 202) : reply({ error: "此任务已用于另一组材料，请勿复用。" }, 409);
        const jobs = await this.ctx.storage.list({ prefix: "job:" });
        if ([...jobs.values()].some(item => ["uploading", "queued", "running", "awaiting_review"].includes(item.status) && item.expiresAt > Date.now())) return reply({ error: "请先完成已有上传或分析任务。" }, 409);
        for (const [expiredKey, expired] of jobs) if (expired.expiresAt <= Date.now()) { await this.removePayload(expired); await this.ctx.storage.delete(expiredKey); }
        try { requirePriceConfirmation(body.priceConfirmation, screenshotPrice(body.imageCount)); }
        catch (error) { return reply({error:error.message,code:error.code,quote:error.quote},409); }
        const creditAmount = await this.reserveJob(body.ownerId, taskId, body.imageCount, kind === "chat", fingerprint);
        admissionReserved=true;
        job = { ...jobIdentity(request), ownerId: body.ownerId, creditAmount, creditRequestId: taskId, taskId, status: "uploading", kind, parameters, autoStart, uploadFingerprint: fingerprint, imageCount: body.imageCount, parts: Array(body.imageCount).fill(null),
          target: parameters.target, compareWithSelf: parameters.compareWithSelf, totalCount: parameters.previousCount + body.imageCount,
          authorization: request.headers.get("authorization"), requestIds: Array.from({ length: body.imageCount }, () => crypto.randomUUID()), expiresAt: Date.now() + 86400000 };
        Object.assign(job,{createdAt:Date.now(),reportKind:parameters.materialType==='moments'?'moments':'social',reportSubjectId:parameters.subjectId,reportSelfSide:parameters.selfSide,captureOrigin:parameters.captureOrigin===true});
        if(parameters.reviewOnDoubt)job.reviewOnDoubt=true;
        await beginSavedReport(this.env.DB,this.reportOptions(job));
        await this.ctx.storage.transaction(async txn => { await txn.put(key, job); await txn.setAlarm(job.expiresAt); });
        return reply(uploadStatus(job), 201);
      }
      if (!job || !job.uploadFingerprint) return reply({ error: "上传任务不存在。" }, 404);
      if (body.uploadAction === "commit") {
        if (job.status !== "uploading") return reply(uploadStatus(job), 202);
        if (job.parts.some(part => !part)) return reply({ error: "图片尚未到齐，请继续上传。", ...uploadStatus(job) }, 409);
        job.status = "queued";
        job.authorization = request.headers.get("authorization"); Object.assign(job, jobIdentity(request));
        await this.ctx.storage.transaction(async txn => { await txn.put(key, job); await txn.setAlarm(Date.now() + 100); });
        return reply(uploadStatus(job), 202);
      }
      if (body.uploadAction === "cancel") {
        if(job.reviewCancelled)return reply({...uploadStatus(job),reviewCancelled:true});
        if (job.status !== "uploading" && job.status !== 'awaiting_review') return reply({ error: "分析已启动，不能作为未提交上传撤销。" }, 409);
        if(job.status==='awaiting_review')job.reviewCancelled=true;
        job.status = "error"; job.error = job.reviewCancelled?'本次任务已取消，预留积分将释放；已完成的单张报告仍保留。':"上传已取消。";
        await this.settleJob(job, false);
        delete job.authorization; delete job.webCookie; delete job.parameters;
        await this.ctx.storage.put(key, job);
        await this.removePayload(job);
        return reply({...uploadStatus(job),...(job.reviewCancelled?{reviewCancelled:true}:{})});
      }
      if (body.uploadAction !== "part") return reply({ error: "上传操作无效。" }, 400);
      if (!Number.isInteger(body.index) || body.index < 0 || body.index >= job.imageCount || typeof body.image !== "string" || body.image.length > 7_000_000 || !/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(body.image)) return reply({ error: "图片格式、大小或序号无效。" }, 400);
      const fingerprint = await digest(body.image);
      const prior = job.parts[body.index];
      if (prior) return prior.hash === fingerprint ? reply(uploadStatus(job)) : reply({ error: "此序号已接收另一张图片，请勿替换。" }, 409);
      if (job.status !== "uploading") return reply({ error: "此任务已结束接收图片。" }, 409);
      if (job.parts.reduce((sum, part) => sum + (part?.size || 0), body.image.length) > 48_000_000) return reply({ error: "这组图片过大，请压缩后重试。" }, 413);
      const chunks = Math.ceil(body.image.length / 128000);
      job.parts[body.index] = { hash: fingerprint, chunks, size: body.image.length };
      const start = job.autoStart && job.parts.every(Boolean);
      if (start) { job.status = "queued"; job.authorization = request.headers.get("authorization"); Object.assign(job, jobIdentity(request)); }
      await this.ctx.storage.transaction(async txn => {
        for (let i = 0; i < chunks; i++) await txn.put(`upload:${taskId}:${body.index}:${i}`, body.image.slice(i * 128000, (i + 1) * 128000));
        await txn.put(key, job);
        if (start) await txn.setAlarm(Date.now() + 100);
      });
      return reply(uploadStatus(job));
    } catch(error) {
      if(admissionReserved)await finishCreditTask(this.env.DB,body.ownerId,taskId,false);
      throw error;
    } finally { this.submitting = false; }
  }

  async readPayload(job) {
    if (job.uploadFingerprint) {
      const images = [];
      for (let index = 0; index < job.imageCount; index++) {
        const chunks = [];
        for (let i = 0; i < job.parts[index].chunks; i++) chunks.push(await this.ctx.storage.get(`upload:${job.taskId}:${index}:${i}`));
        if (chunks.some(chunk => typeof chunk !== "string")) throw new Error("UPLOAD_PART_MISSING");
        const image = chunks.join("");
        if (await digest(image) !== job.parts[index].hash) throw new Error("UPLOAD_PART_CHANGED");
        images.push(image);
      }
      return { ...job.parameters, images };
    }
    const chunks = [];
    for (let i = 0; i < job.chunks; i++) chunks.push(await this.ctx.storage.get("payload:" + job.taskId + ":" + i));
    if (chunks.some(chunk => typeof chunk !== "string")) throw new Error("PAYLOAD_MISSING");
    return JSON.parse(chunks.join(""));
  }

  async readResult(job) {
    const entries = [];
    for (let index = 0; index < job.resultChunks.length; index++) {
      const chunks = [];
      for (let part = 0; part < job.resultChunks[index]; part++) chunks.push(await this.ctx.storage.get(`result:${job.taskId}:${index}:${part}`));
      if (chunks.some(value => typeof value !== 'string')) throw new Error('RESULT_MISSING');
      entries.push(JSON.parse(chunks.join('')));
    }
    return { entries };
  }

  async alarm() {
    const jobs = await this.ctx.storage.list({ prefix: "job:" });
    for (const [key, job] of jobs) {
      if(job.status==='done'&&!job.reportSaved){
        try{const saved=await this.persistReport(job);job.reportSaved=true;if(!job.resultChunks)job.result=saved;await this.ctx.storage.put(key,job);}
        catch(error){if(error.message!=='SAVED_REPORT_DELETED')throw error;}
      }
      if (job.expiresAt <= Date.now()) {
        await this.settleJob(job, job.status === 'done' && !job.reused);
        await this.removePayload(job);
        for (let i = 0; i < (job.resultChunks || []).length; i++) for (let part = 0; part < job.resultChunks[i]; part++) await this.ctx.storage.delete(`result:${job.taskId}:${i}:${part}`);
        await this.ctx.storage.delete(key); continue;
      }
      if (job.status === 'done' || job.status === 'error') {
        await this.settleJob(job);
        await this.ctx.storage.put(key, job);
        continue;
      }
      if (job.status !== "queued" && job.status !== "running") continue;
      if (job.retryAt && job.retryAt > Date.now()) continue;
      try { if(await this.reuseIdenticalReport(job,key))continue; }
      catch {
        job.status='error';job.error='图片资料核对暂未完成，本次积分将退回，请重新上传。';
        await this.settleJob(job,false);
        delete job.authorization;delete job.webCookie;delete job.parameters;
        await this.ctx.storage.put(key,job);await this.removePayload(job);continue;
      }
      if (job.kind === 'chat') {
        const index = job.completedCount || 0;
        // A persisted running state means an earlier alarm lost execution. The
        // stable request id retrieves the saved report if its response was lost.
        if ((job.attempt || 0) >= 3) {
          job.status = 'error'; job.error = `第 ${index + 1} 张多次处理未完成，已完成 ${index} 张；已有报告保留在档案中。`;
        } else {
          job.status = 'running'; job.startedAt ||= Date.now(); job.attempt = (job.attempt || 0) + 1; delete job.retryAt;
          await this.ctx.storage.transaction(async txn => { await txn.put(key, job); await txn.setAlarm(Math.min(job.expiresAt, Date.now() + 300000)); });
          try {
            const body = await this.readPayload(job);
            const response = await app.fetch(new Request(callbackUrl(job, 'screenshot'), { method:'POST', headers:{...callbackHeaders(job), 'x-screenshot-task':job.taskId, 'x-screenshot-job-key':this.env.WECHAT_CALLBACK_TOKEN || ''}, body:JSON.stringify({image:body.images[index],confirmed:true,selfSide:body.selfSide,subjectId:body.subjectId || null,sessionId:body.sessionId,requestId:job.requestIds[index]}) }), this.env, this.ctx);
            let result;
            try { result = await response.json(); } catch { const error=new Error('RESPONSE_FORMAT'); error.status=response.status; error.retryable=response.status >= 500 || response.ok; throw error; }
            if (!response.ok) { const error = new Error(typeof result.error === 'string' ? result.error : '本次分析未完成。'); error.status=response.status; error.retryable=result.retryable !== false && (response.status >= 500 || response.status === 429 || response.status === 408); throw error; }
            if(result.reviewRequired===true&&job.reviewOnDoubt){
              // No analysis has started for this image. The callback has ended,
              // so confirmation cannot race an in-flight model save.
              job.status='awaiting_review';job.attempt=0;delete job.retryAt;delete job.error;
              await this.ctx.storage.transaction(async tx=>{await tx.put(key,job);await tx.setAlarm(job.expiresAt);});
              continue;
            }
            const encoded = JSON.stringify(result), count = Math.ceil(encoded.length / 32000);
            const next = { ...job, resultChunks: [...(job.resultChunks || [])], completedCount: index + 1, attempt: 0,
              status: index + 1 === body.images.length ? 'done' : 'queued' };
            next.resultChunks[index] = count;
            const previous=job.resultChunks?await this.readResult(job):{entries:[]};
            try{await this.persistReport(job,{entries:[...previous.entries,result],partial:next.status!=='done'});}
            catch(error){
              if(error.message==='SAVED_REPORT_DELETED' && pattern.test(result.id||''))await this.env.DB.prepare('DELETE FROM coach_crush_reports WHERE id=? AND owner_id=?').bind(result.id,job.ownerId).run();
              throw error;
            }
            next.reportSaved=next.status==='done';
            delete next.error;
            if (next.status === 'done') { delete next.authorization; delete next.webCookie; delete next.parameters; }
            await this.ctx.storage.transaction(async txn => {
              for (let part=0; part<count; part++) await txn.put(`result:${job.taskId}:${index}:${part}`, encoded.slice(part*32000,(part+1)*32000));
              await txn.put(key,next);
              await txn.setAlarm(next.status === 'done' ? next.expiresAt : Date.now()+100);
            });
            Object.assign(job,next);
            if (next.status === 'done') { delete job.authorization; delete job.webCookie; delete job.parameters; }
            delete job.error;
          } catch (error) {
            job.failureStatus = error.status || null;
            const retryable = error.retryable === true || ['TimeoutError','AbortError','TypeError'].includes(error.name);
            if (retryable && job.attempt < 3) {
              job.status='queued'; job.retryAt=Date.now()+1000*job.attempt;
              job.error=`第 ${index + 1} 张正在后台重试，已完成 ${index} 张。`;
            } else { job.status='error'; job.error=error.message || '后台分析未完成。'; }
          }
        }
        if (job.status === 'done' || job.status === 'error') {
          await this.settleJob(job);
          delete job.authorization; delete job.webCookie; delete job.parameters;
          await this.ctx.storage.put(key,job); await this.removePayload(job);
        } else await this.ctx.storage.transaction(async txn => { await txn.put(key,job); await txn.setAlarm(job.retryAt || Date.now()+100); });
        continue;
      }
      const profileBody=await this.readPayload(job);
      if(profileBody.materialType==='moments' && this.env.WECHAT_CALLBACK_TOKEN){
        await this.runMoments(job,key,profileBody);
        continue;
      }
      if ((job.profileAttempts || 0) >= 2) {
        job.status = "error";
        job.error = "资料识别两次未完整返回，本次积分已释放，请检查截图后重试。";
      } else {
        job.profileAttempts = (job.profileAttempts || 0) + 1;
        job.status = "running";
        job.startedAt ||= Date.now();
        delete job.retryAt;
        await this.ctx.storage.transaction(async tx=>{await tx.put(key, job);await tx.setAlarm(Math.min(job.expiresAt,Date.now()+180000));});
        try {
          const body = await this.readPayload(job);
          let response;
          if (job.kind === "chat") {
            const entries = [];
            for (let i = 0; i < body.images.length; i++) {
              const imageResponse = await app.fetch(new Request(callbackUrl(job, "screenshot"), { method: "POST", headers: callbackHeaders(job), body: JSON.stringify({ image: body.images[i], confirmed: true, selfSide: body.selfSide, subjectId: body.subjectId || null, sessionId: body.sessionId, requestId: job.requestIds[i] }) }), this.env, this.ctx);
              if (!imageResponse.ok) { response = imageResponse; break; }
              entries.push(await imageResponse.json());
            }
            if (!response) response = Response.json({ entries });
          } else response = await app.fetch(new Request(callbackUrl(job, "social-profile"), { method: "POST", headers: callbackHeaders(job), body: JSON.stringify(body) }), this.env, this.ctx);
          const text = await response.text();
          let result;
          try { result = JSON.parse(text); } catch { const error=new Error('分析返回不完整。');error.retryable=true;throw error; }
          if (!response.ok) { const error=new Error(typeof result.error === 'string' ? result.error : '本次分析未完成，请重试。');error.retryable=response.status>=500||response.status===408||response.status===429;throw error; }
          else { job.result = await this.persistReport(job,result); job.status = "done"; job.reportSaved=true;job.completedCount=job.imageCount; }
        } catch(error) {
          if(job.profileAttempts<2&&(error.retryable===true||['TimeoutError','AbortError','TypeError'].includes(error.name))){job.status='queued';job.retryAt=Date.now()+1000;job.error='资料结果尚未完整返回，正在继续原任务，不会重复扣费。';}
          else {job.status='error';job.error=error.message||'后台分析未完成，请稍后重试。';}
        }
      }
      if(job.status==='done'||job.status==='error'){
        delete job.authorization; delete job.webCookie;delete job.parameters;
        await this.settleJob(job);await this.ctx.storage.put(key,job);await this.removePayload(job);
      }else await this.ctx.storage.transaction(async tx=>{await tx.put(key,job);await tx.setAlarm(job.retryAt);});
    }
    const remaining = await this.ctx.storage.list({ prefix: "job:" });
    if (remaining.size) await this.ctx.storage.setAlarm(Math.min(...[...remaining.values()].map(job => job.ownerId && ['done','error'].includes(job.status) && !job.creditFinished ? Date.now()+5000 : job.status === 'queued' ? job.retryAt || Date.now()+100 : job.expiresAt)));
  }
  async momentsCall(job, body) {
    const response=await app.fetch(new Request(callbackUrl(job, 'social-profile'),{method:'POST',headers:{...callbackHeaders(job),'x-moments-job-key':this.env.WECHAT_CALLBACK_TOKEN},body:JSON.stringify(body)}),this.env,this.ctx);
    let result;try{result=await response.json();}catch{const e=new Error('分析返回不完整。');e.retryable=response.ok||response.status>=500;throw e;}
    if(!response.ok){const e=new Error(result.error||'分析未完成。');e.retryable=response.status>=500||response.status===408;e.status=response.status;throw e;}
    return result;
  }
  async runMoments(job,key,body) {
    job.momentsDone ||= Array(job.imageCount).fill(false);
    job.momentsAttempts ||= Array(job.imageCount).fill(0);
    const pending=job.momentsDone.flatMap((done,i)=>done?[]:[i]).slice(0,2);
    job.status='running';job.momentsPhase=pending.length?'extract':'summarize';delete job.error;delete job.retryAt;
    await this.ctx.storage.transaction(async tx=>{await tx.put(key,job);await tx.setAlarm(Math.min(job.expiresAt,Date.now()+60000));});
    try {
      if(pending.length){
        // Two independent reads; checkpoint each as it finishes. A lost alarm
        // never reruns an image whose observation was already committed.
        const outcomes=await Promise.allSettled(pending.map(async index=>{
          if(job.momentsAttempts[index]>=2){const e=new Error(`第${index+1}张两次识别未完成，已识别进度保留至任务到期。`);e.retryable=false;throw e;}
          job.momentsAttempts[index]++;
          await this.ctx.storage.put(key,job);
          const result=await this.momentsCall(job,{confirmed:true,materialType:'moments',target:body.target,momentsPhase:'extract',imageIndex:index,images:[body.images[index]]});
          job.momentsDone[index]=true;
          job.preview={summary:result.summary,posts:(result.posts||[]).slice(0,3).map(x=>({content:x.content,date:x.date}))};
          await this.ctx.storage.transaction(async tx=>{await tx.put(`moments:${job.taskId}:${index}`,result);await tx.put(key,job);});
        }));
        const failure=outcomes.find(x=>x.status==='rejected' && x.reason.retryable!==true)||outcomes.find(x=>x.status==='rejected');
        if(failure)throw failure.reason;
        job.status='queued';job.retryAt=Date.now()+100;
      }else{
        if((job.summaryAttempts||0)>=2){const e=new Error('汇总两次未完成，已识别内容保留至任务到期。');e.retryable=false;throw e;}
        job.summaryAttempts=(job.summaryAttempts||0)+1;await this.ctx.storage.put(key,job);
        const observations=await Promise.all(job.momentsDone.map((_,i)=>this.ctx.storage.get(`moments:${job.taskId}:${i}`)));
        const {images,...parameters}=body;
        job.result=await this.momentsCall(job,{...parameters,confirmed:true,materialType:'moments',momentsPhase:'summarize',observations,imageCount:job.imageCount});
        job.result=await this.persistReport(job,job.result);job.reportSaved=true;
        job.status='done';job.completedCount=job.imageCount;delete job.preview;delete job.retryAt;delete job.error;
      }
    }catch(error){
      const exhausted=pending.length?pending.some(i=>!job.momentsDone[i]&&job.momentsAttempts[i]>=2):(job.summaryAttempts||0)>=2;
      if(!exhausted&&(error.retryable===true||['TimeoutError','AbortError','TypeError'].includes(error.name))){job.status='queued';job.retryAt=Date.now()+1000;job.error='当前步骤正在后台重试，已完成内容不会重新识别。';}
      else {job.status='error';job.error=error.message||'本次分析未完成。';}
    }
    if(job.status==='done'||job.status==='error'){
      await this.settleJob(job);delete job.authorization; delete job.webCookie;delete job.parameters;
      await this.ctx.storage.put(key,job);await this.removePayload(job);
      if(job.status==='done')for(let i=0;i<job.imageCount;i++)await this.ctx.storage.delete(`moments:${job.taskId}:${i}`);
    }else await this.ctx.storage.transaction(async tx=>{await tx.put(key,job);await tx.setAlarm(job.retryAt||Date.now()+100);});
  }
  async reserveJob(ownerId, taskId, count, isChat, fingerprint) {
    const amount = screenshotPrice(count).amount;
    const reservation = await reserveCredits(this.env.DB, { ownerId, requestId: taskId, feature: 'analysis', fingerprint, amount });
    if (!reservation.execute && reservation.status !== 'reserved') throw new Error('本次任务已结束，请重新提交。');
    return amount;
  }
  async settleJob(job, success = job.status === 'done' && !job.reused) {
    if (!job.ownerId || !job.creditAmount || job.creditFinished) return;
    try {
      await finishCreditTask(this.env.DB, job.ownerId, job.creditRequestId, success);
      job.creditFinished = true;
    } catch {
      await this.ctx.storage.setAlarm(Date.now() + 5000);
      // Keep the saved result and retry settlement independently of the phone.
      if (job.expiresAt <= Date.now()) throw new Error('CREDIT_SETTLEMENT_PENDING');
    }
  }
  async removePayload(job) {
    for (const requestId of job.requestIds || []) await this.ctx.storage.delete(`screenshot:${job.taskId}:${requestId}`);
    if(job.expiresAt<=Date.now())for(let i=0;i<job.imageCount;i++)await this.ctx.storage.delete(`moments:${job.taskId}:${i}`);
    for (let i = 0; i < job.chunks; i += 100) await this.ctx.storage.delete(Array.from({ length: Math.min(100, job.chunks - i) }, (_, offset) => "payload:" + job.taskId + ":" + (i + offset)));
    for (let index = 0; index < (job.parts || []).length; index++) {
      const part = job.parts[index];
      if (part) await this.ctx.storage.delete(Array.from({ length: part.chunks }, (_, i) => `upload:${job.taskId}:${index}:${i}`));
    }
  }
}

export async function routeSocialProfileJob(request, env, ctx) {
  const identity = await requestOwner(request, env);
  if (!identity) return reply({ error: "登录已过期，请重新登录。" }, 401);
  const url = new URL(request.url);
  if (request.method === "POST") {
    let body;
    try { body = await request.clone().json(); } catch { body = null; }
    const headerId = request.headers.get("x-request-id");
    const bodyId = isWebApi(request) && typeof body?.taskId === 'string' ? body.taskId : null;
    if (headerId && bodyId && headerId !== bodyId) return reply({ error: "任务编号不一致，请重新打开当前任务。" }, 409);
    const taskId = headerId || bodyId || crypto.randomUUID();
    url.searchParams.set("taskId", taskId);
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      body.ownerId = identity.ownerId;
      delete body.creditAmount;
      request = new Request(request, { body: JSON.stringify(body) });
    }
  }
  const id = env.SOCIAL_PROFILE_JOBS.idFromName(identity.ownerId);
  try { return await env.SOCIAL_PROFILE_JOBS.get(id).fetch(new Request(url, request)); }
  catch (error) { return reply(error?.code === 'PRICE_CONFIRMATION_REQUIRED' ? {error:error.message,code:error.code,quote:error.quote} : { error: error?.code === 'CREDIT_NOT_AVAILABLE' ? '功能未开通、已到期或可用积分不足。' : '任务暂未建立，请使用同一任务重试。' }, error?.status || 503); }
}
