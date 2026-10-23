import type { getD1 } from "@/db";
import type { CaptureMemoryRow } from "./capture-analysis-input";
import { analyzeSentencePage, boundedSentenceRows, sentenceLine, SENTENCE_PAGE_SIZE, SENTENCE_READING_VERSION, validatedSentenceReadings, type SentenceAnnotation, type SentencePage } from "./capture-sentence-reading";
import {computeReplyAttention,REPLY_ATTENTION_RULES_VERSION,type ReplyAttentionRow} from "./reply-attention";

type Database=ReturnType<typeof getD1>;
type Snapshot={libraryId:string;epoch:number;revision:number};
type Source={owner:string;id:string;subjectId:string|null;snapshot:Snapshot;reportRevision:number;report:Record<string,any>};
type Original={record_json:string;raw_index:number};
type PageRow={payload:string;status:string;lease_id:string;lease_until:number;attempted_at:number};
export class SentenceReadingError extends Error {constructor(message:string,public status=400){super(message);}}
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const parse=(value:string)=>{try{return JSON.parse(value);}catch{return {};}};
const eligible="json_extract(record_json,'$.kind')='text' AND json_extract(record_json,'$.senderRole') IN ('self','other') AND length(trim(json_extract(record_json,'$.text')))>0";
const ordered="WITH originals AS (SELECT record_json,ROW_NUMBER() OVER (ORDER BY sort_known,sort_time,seq)-1 AS raw_index FROM coach_capture_records WHERE owner_id=? AND library_id=? AND epoch=?)";
const live=`EXISTS(SELECT 1 FROM coach_saved_reports r JOIN coach_capture_libraries l ON l.id=? AND l.owner_id=r.owner_id
 WHERE r.id=? AND r.owner_id=? AND r.status='done' AND l.epoch=? AND l.revision=? AND l.deleted_at IS NULL
 AND l.subject_id IS r.subject_id AND json_extract(r.result,'$.archiveSnapshot.libraryId')=l.id
 AND json_extract(r.result,'$.archiveSnapshot.epoch')=l.epoch AND json_extract(r.result,'$.archiveSnapshot.revision')<=l.revision)`;
const params=(s:Source)=>[s.owner,s.id,s.snapshot.epoch,s.snapshot.revision,SENTENCE_READING_VERSION];
const liveParams=(s:Source)=>[s.snapshot.libraryId,s.id,s.owner,s.snapshot.epoch,s.snapshot.revision];

async function source(db:Database,owner:string,id:string):Promise<Source>{
  if(!uuid.test(id))throw new SentenceReadingError("报告编号不正确。");
  const saved=await db.prepare("SELECT result,subject_id FROM coach_saved_reports WHERE owner_id=? AND id=? AND status='done'").bind(owner,id).first<{result:string;subject_id:string|null}>();
  if(!saved)throw new SentenceReadingError("报告不存在或已删除。",404);
  const report=parse(saved.result),snapshot=report.archiveSnapshot;
  if(report.analysisScope!=="fullHistory"||report.captureKind==="moments"||!snapshot||!/^cl_[a-f0-9]{64}$/.test(snapshot.libraryId)||![snapshot.epoch,snapshot.revision].every(Number.isSafeInteger))throw new SentenceReadingError("这份报告没有完整聊天资料库，已保存的逐句解读仍可查看。",422);
  const library=await db.prepare("SELECT revision FROM coach_capture_libraries WHERE id=? AND owner_id=? AND epoch=? AND subject_id IS ? AND deleted_at IS NULL").bind(snapshot.libraryId,owner,snapshot.epoch,saved.subject_id).first<{revision:number}>();
  if(!library||library.revision<snapshot.revision)throw new SentenceReadingError("原聊天资料已删除、重建或关联到其他人物；原报告已有解读仍保留。",409);
  const result={owner,id,subjectId:saved.subject_id,snapshot:{...snapshot,revision:library.revision},reportRevision:snapshot.revision,report};
  if(!await db.prepare(`SELECT 1 WHERE ${live}`).bind(...liveParams(result)).first())throw new SentenceReadingError("原聊天资料已变化，请重新读取；原报告已有解读仍保留。",409);
  return result;
}
function memory(row:Original,libraryId:string):CaptureMemoryRow{
  const value=parse(row.record_json);
  return {localId:value.localId,kind:"text",senderRole:value.senderRole,at:value.at,text:value.text,sourceKind:"chat",libraryId,sequence:row.raw_index};
}
function savedAnnotations(input:unknown,rows:readonly CaptureMemoryRow[]):SentenceAnnotation[]{
  if(!Array.isArray(input))return [];
  return validatedSentenceReadings({sentenceReadings:input.map(item=>({sourceId:item?.lineId,emotion:Object.fromEntries((Array.isArray(item?.emotion)?item.emotion:[]).map((tag:any)=>[tag.key,tag.probability])),intent:Object.fromEntries((Array.isArray(item?.intent)?item.intent:[]).map((tag:any)=>[tag.key,tag.probability])),note:item?.note}))},rows.map(row=>({...row,alias:row.localId})),new Set(rows.map(row=>row.localId)));
}
function initialAnnotations(s:Source){
  // Later messages or repaired media may change a sentence's context. Old
  // annotations remain in the original report, never relabelled as new reads.
  if(s.snapshot.revision!==s.reportRevision)return [];
  const recent=s.report.recentSentenceAnalysis||s.report.semanticHistory?.recentSentenceAnalysis||{};
  const originals:Array<CaptureMemoryRow>=(Array.isArray(recent.lines)?recent.lines:[]).filter((line:any)=>line&&["self","other"].includes(line.speaker)&&typeof line.text==="string"&&typeof line.id==="string").map((line:any)=>({localId:line.id,kind:"text",senderRole:line.speaker,at:line.at,text:line.text,sourceKind:"chat",libraryId:s.snapshot.libraryId}));
  return savedAnnotations(recent.annotations,originals);
}
type PageSelection={offset?:number;before?:number;count?:number};
async function readPage(db:Database,s:Source,selection:PageSelection){
  const sourceParams=[s.owner,s.snapshot.libraryId,s.snapshot.epoch];
  const count=await db.prepare(`SELECT COUNT(*) AS total FROM coach_capture_records WHERE owner_id=? AND library_id=? AND epoch=? AND ${eligible}`).bind(...sourceParams).first<{total:number}>();
  const total=count?.total||0,backwards=selection.before!==undefined,end=Math.min(total,selection.before??total);
  const start=backwards?Math.max(0,end-SENTENCE_PAGE_SIZE):Math.min(total,selection.offset??0);
  const limit=backwards?end-start:selection.count??SENTENCE_PAGE_SIZE;
  const candidate=limit?(await db.prepare(`${ordered} SELECT record_json,raw_index FROM originals WHERE ${eligible} ORDER BY raw_index LIMIT ? OFFSET ?`).bind(...sourceParams,limit,start).all<Original>()).results:[];
  const candidates=candidate.map(row=>memory(row,s.snapshot.libraryId)),rows=boundedSentenceRows(candidates,backwards);
  const offset=backwards?end-rows.length:start;
  // At most 12 targets plus six adjacent originals each. Images stay labelled
  // unavailable; they cannot turn into fabricated emotion/intent targets.
  const positions=[...new Set(rows.flatMap(row=>Array.from({length:7},(_,i)=>(row.sequence??0)+i-3).filter(n=>n>=0)))];
  const neighbors=positions.length?(await db.prepare(`${ordered} SELECT record_json,raw_index FROM originals WHERE raw_index IN (SELECT value FROM json_each(?)) ORDER BY raw_index`).bind(...sourceParams,JSON.stringify(positions)).all<Original>()).results:[];
  for(const row of rows)row.context=neighbors.filter(item=>item.raw_index!==row.sequence&&Math.abs(item.raw_index-(row.sequence??0))<=3).map(item=>{
    const r=parse(item.record_json),unread=r.kind!=="text";
    return {sourceId:r.localId,at:r.at,role:r.senderRole,text:unread?"这条消息是未解读的图片、语音或其它媒体，不能猜其含义。":String(r.text).slice(0,180),...(unread?{basis:"unavailable-media" as const}:{})};
  });
  const pageKey=`p${offset}_${rows.length}`;
  const cached=await db.prepare("SELECT payload,status,lease_id,lease_until,attempted_at FROM coach_report_sentence_pages WHERE owner_id=? AND report_id=? AND epoch=? AND revision=? AND version=? AND page_key=?").bind(...params(s),pageKey).first<PageRow>();
  // Adjacent pages may overlap at long-message boundaries. Read all existing
  // annotations for these IDs, so each model result remains reusable.
  const existing=rows.length?(await db.prepare("SELECT j.value AS annotation FROM coach_report_sentence_pages p,json_each(p.payload,'$.annotations') j WHERE p.owner_id=? AND p.report_id=? AND p.epoch=? AND p.revision=? AND p.version=? AND json_extract(j.value,'$.lineId') IN (SELECT value FROM json_each(?))").bind(...params(s),JSON.stringify(rows.map(row=>row.localId))).all<{annotation:string}>()).results:[];
  const seed=initialAnnotations(s);
  const annotations=[...new Map([...savedAnnotations(seed,rows),...savedAnnotations(existing.map(item=>parse(item.annotation)),rows)].map(item=>[item.lineId,item])).values()];
  const analyzed=await db.prepare("SELECT COUNT(DISTINCT line_id) AS total FROM (SELECT json_extract(j.value,'$.lineId') AS line_id FROM coach_report_sentence_pages p,json_each(p.payload,'$.annotations') j WHERE p.owner_id=? AND p.report_id=? AND p.epoch=? AND p.revision=? AND p.version=? UNION ALL SELECT value AS line_id FROM json_each(?))").bind(...params(s),JSON.stringify(seed.map(item=>item.lineId))).first<{total:number}>();
  const running=cached&&cached.lease_until>Date.now()&&["running","cancelling"].includes(cached.status);
  const page:SentencePage={offset,nextOffset:offset+rows.length,totalReadable:total,totalAnalyzed:Math.min(total,analyzed?.total||0),lines:rows.map(sentenceLine),annotations,status:running?cached.status as "running"|"cancelling":annotations.length===rows.length?"complete":annotations.length?"partial":"unread",pageKey,...(running?{requestId:cached.lease_id,leaseUntil:cached.lease_until}:{}),cost:0,sourceUpdated:s.snapshot.revision!==s.reportRevision,reportRevision:s.reportRevision,revision:s.snapshot.revision};
  return {page,rows,cached};
}
export async function readSentencePage(db:Database,owner:string,id:string,selection:PageSelection){
  const s=await source(db,owner,id),result=await readPage(db,s,selection);
  if((await source(db,owner,id)).snapshot.revision!==s.snapshot.revision)throw new SentenceReadingError("读取期间资料更新了，请重新读取这一页。",409);
  return result.page;
}
/** Read-only behavioral summary for old reports on a new device. Unlike the
 * sentence model page, this uses all originals, including unread-media gaps. */
export async function readSentenceAttention(db:Database,owner:string,id:string){
  const s=await source(db,owner,id);
  const cached=await db.prepare("SELECT payload FROM coach_report_sentence_pages WHERE owner_id=? AND report_id=? AND epoch=? AND revision=? AND version=? AND page_key='attention' AND status='complete'").bind(...params(s)).first<{payload:string}>();
  if(cached){const payload=parse(cached.payload);if(payload.replyAttention?.version===1&&payload.replyAttention.rulesVersion===REPLY_ATTENTION_RULES_VERSION){
    const current=await source(db,owner,id);
    if(current.snapshot.revision!==s.snapshot.revision)throw new SentenceReadingError("读取期间资料更新了，请重新核对。",409);
    return {...payload,sourceUpdated:current.snapshot.revision!==current.reportRevision,reportRevision:current.reportRevision,revision:current.snapshot.revision,cost:0,cached:true};
  }}
  const all:ReplyAttentionRow[]=[];let totalReadable=0;
  for(let offset=0;offset<=20_000;offset+=500){
    const page=(await db.prepare("SELECT record_json FROM coach_capture_records WHERE owner_id=? AND library_id=? AND epoch=? ORDER BY sort_known,sort_time,seq LIMIT 500 OFFSET ?").bind(owner,s.snapshot.libraryId,s.snapshot.epoch,offset).all<{record_json:string}>()).results;
    for(const item of page){
      const row=parse(item.record_json);if(typeof row.text!=="string"||typeof row.localId!=="string")throw new SentenceReadingError("原话内容不完整，暂不能核对回应。",409);
      all.push({...row,sequence:all.length,libraryId:s.snapshot.libraryId,sourceKind:"chat"});
      if(row.kind==="text"&&["self","other"].includes(row.senderRole)&&row.text.trim())totalReadable++;
    }
    if(all.length>20_000)throw new SentenceReadingError("资料超出本次回应核对范围，暂不生成片面的统计。",413);
    if(page.length<500)break;
  }
  const replyAttention=computeReplyAttention(all,{scope:"full-history"}),result={replyAttention,totalReadable,revision:s.snapshot.revision,reportRevision:s.reportRevision,sourceUpdated:s.snapshot.revision!==s.reportRevision,cost:0};
  const saved=await db.prepare(`INSERT INTO coach_report_sentence_pages(owner_id,report_id,library_id,epoch,revision,version,page_key,payload,status,updated_at) SELECT ?,?,?,?,?,?,'attention',?,'complete',? WHERE ${live} ON CONFLICT(owner_id,report_id,epoch,revision,version,page_key) DO UPDATE SET payload=excluded.payload,status='complete',updated_at=excluded.updated_at`).bind(owner,id,s.snapshot.libraryId,s.snapshot.epoch,s.snapshot.revision,SENTENCE_READING_VERSION,JSON.stringify(result),Date.now(),...liveParams(s)).run();
  if(!saved.meta.changes)throw new SentenceReadingError("核对期间资料已更新，请重新打开。",409);
  return {...result,cached:false};
}
/** Model usage is explicitly requested and budget-limited, but never debits
 * customer credits. A per-owner SQL lease prevents parallel page/model bursts. */
export async function supplementSentencePage(db:Database,owner:string,id:string,offset:number,count:number,requestId:string,qwen:Parameters<typeof analyzeSentencePage>[1],beforeAnalyze:()=>Promise<void>){
  if(!uuid.test(requestId))throw new SentenceReadingError("补充任务编号不正确。");
  const s=await source(db,owner,id),{page,rows}=await readPage(db,s,{offset,count});
  if(page.status==="complete")return page;
  if(page.status==="running"||page.status==="cancelling")throw new SentenceReadingError(page.status==="cancelling"?"本页正在停止，请稍后再试。":"本页正在解读，请等待完成。",409);
  const now=Date.now(),key=[...params(s),page.pageKey];
  await db.prepare(`INSERT OR IGNORE INTO coach_report_sentence_pages(owner_id,report_id,library_id,epoch,revision,version,page_key) SELECT ?,?,?,?,?,?,? WHERE ${live}`).bind(owner,id,s.snapshot.libraryId,s.snapshot.epoch,s.snapshot.revision,SENTENCE_READING_VERSION,page.pageKey,...liveParams(s)).run();
  const claim=await db.prepare(`UPDATE coach_report_sentence_pages SET status='running',lease_id=?,lease_until=?,attempted_at=?,updated_at=? WHERE owner_id=? AND report_id=? AND epoch=? AND revision=? AND version=? AND page_key=? AND lease_until<=? AND attempted_at<=? AND NOT(lease_id=? AND status='cancelled') AND NOT EXISTS(SELECT 1 FROM coach_report_sentence_pages active WHERE active.owner_id=? AND active.lease_until>?) AND ${live}`).bind(requestId,now+65_000,now,now,...key,now,now-2000,requestId,owner,now,...liveParams(s)).run();
  if(!claim.meta.changes)throw new SentenceReadingError("已有逐句解读正在进行，或刚刚重试过。请稍后继续。",429);
  try{
    await beforeAnalyze();
    const active=await db.prepare(`SELECT 1 FROM coach_report_sentence_pages WHERE owner_id=? AND report_id=? AND epoch=? AND revision=? AND version=? AND page_key=? AND lease_id=? AND status='running' AND lease_until>? AND ${live}`).bind(...key,requestId,Date.now(),...liveParams(s)).first();
    if(!active)throw new SentenceReadingError("本次补充已取消，或原报告资料已更新。",409);
    const known=new Set(page.annotations.map(item=>item.lineId)),missing=rows.filter(row=>!known.has(row.localId));
    const fresh=await analyzeSentencePage(missing,qwen);
    const annotations=[...page.annotations,...fresh],status=annotations.length===rows.length?"complete":"partial";
    if(!fresh.length)throw new SentenceReadingError("这页没有返回可核对的解读。原文仍在，可再次补充。",502);
    const saved=await db.prepare(`UPDATE coach_report_sentence_pages SET payload=?,status=?,lease_until=0,updated_at=? WHERE owner_id=? AND report_id=? AND epoch=? AND revision=? AND version=? AND page_key=? AND lease_id=? AND status='running' AND ${live}`).bind(JSON.stringify({annotations}),status,Date.now(),...key,requestId,...liveParams(s)).run();
    if(!saved.meta.changes)throw new SentenceReadingError("本次补充已取消，或原报告资料已更新；原报告没有被改写。",409);
    return await readSentencePage(db,owner,id,{offset,count});
  }catch(error){
    await db.prepare("UPDATE coach_report_sentence_pages SET status=CASE WHEN status='cancelling' THEN 'cancelled' ELSE 'failed' END,lease_until=0,updated_at=? WHERE owner_id=? AND report_id=? AND epoch=? AND revision=? AND version=? AND page_key=? AND lease_id=? AND status IN ('running','cancelling')").bind(Date.now(),...key,requestId).run();
    throw error;
  }
}
export async function cancelSentencePage(db:Database,owner:string,id:string,offset:number,count:number,requestId:string){
  const s=await source(db,owner,id),{page}=await readPage(db,s,{offset,count});
  if(!uuid.test(requestId))throw new SentenceReadingError("补充任务编号不正确。");
  // A fast cancel may arrive before the original POST claims its lease.
  await db.prepare(`INSERT OR IGNORE INTO coach_report_sentence_pages(owner_id,report_id,library_id,epoch,revision,version,page_key,status,lease_id) SELECT ?,?,?,?,?,?,?,'cancelled',? WHERE ${live}`).bind(owner,id,s.snapshot.libraryId,s.snapshot.epoch,s.snapshot.revision,SENTENCE_READING_VERSION,page.pageKey,requestId,...liveParams(s)).run();
  await db.prepare("UPDATE coach_report_sentence_pages SET status='cancelling',updated_at=? WHERE owner_id=? AND report_id=? AND epoch=? AND revision=? AND version=? AND page_key=? AND lease_id=? AND status='running'").bind(Date.now(),...params(s),page.pageKey,requestId).run();
  await db.prepare("UPDATE coach_report_sentence_pages SET status='cancelled',lease_id=?,lease_until=0,updated_at=? WHERE owner_id=? AND report_id=? AND epoch=? AND revision=? AND version=? AND page_key=? AND status NOT IN ('running','cancelling')").bind(requestId,Date.now(),...params(s),page.pageKey).run();
  return readSentencePage(db,owner,id,{offset,count});
}
