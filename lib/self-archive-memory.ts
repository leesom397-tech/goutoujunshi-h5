import { getD1 } from "@/db";
import { extractQuickSelfProfile } from "./personal-context";
import { cleanConversationProfileCandidates, type ConversationMemoryLine } from "./conversation-profile-memory";

type Database = ReturnType<typeof getD1>;
type Item = { id: string; sourceId: string; field: string; label: string; value: string; quote: string; at: string; basis: "statement" | "correction" };
type Memory = { version: number; libraryId: string; epoch: number; items: Item[]; removed: string[] };
type Fact = { id: string; value: string; created_at: number };
export type SelfArchiveMemoryState = { version: 1; status: "ready" | "disabled"; summaries: Array<{id: string; version: number; summary: string; updatedAt: number; items: Item[]}> };
const parse = <T>(value: string, fallback: T): T => { try { return JSON.parse(value) as T; } catch { return fallback; } };
const normalized = (value: string) => value.replace(/[\s。；，,.!！]/g, "");
const live = "EXISTS(SELECT 1 FROM coach_profiles WHERE owner_id=? AND consent_at=? AND paused=0) AND EXISTS(SELECT 1 FROM coach_capture_libraries l WHERE l.owner_id=? AND l.id=? AND l.epoch=? AND l.kind='chat' AND l.deleted_at IS NULL AND (l.subject_id IS NULL OR EXISTS(SELECT 1 FROM coach_subjects s WHERE s.id=l.subject_id AND s.owner_id=l.owner_id AND s.status='active')))";
const summary = (items: Item[]) => [...new Set(items.map(item => `${item.label}：${item.value}`))].join("；");
const allowedFields = new Set(["interests", "communicationStyle", "preferredRelationship", "values", "boundaries", "lifestyle", "goals", "strengths"]);

/** Every imported row is inspected locally. Only explicit self declarations are
 * retained; no paid model request or other person's statements enter this store. */
export function extractSelfArchiveItems(rows: readonly ConversationMemoryLine[]): Item[] {
  const result: Item[] = [];
  for (const row of rows) {
    if (row.senderRole !== "self" || row.kind && row.kind !== "text" || /他|她|对方|前任|朋友说|你(?:的|家|有|是)|\d+\s*(?:万|元|块)/.test(row.text)) continue;
    const clauses = row.text.split(/[。！？!?；;，,\n]/).map(text=>text.trim());
    const draft = {evidence:clauses.flatMap(clause=>extractQuickSelfProfile(clause).evidence)};
    for (const sentence of clauses) {
      if (/^我(?:平时|周末|一直|通常|经常|习惯)/.test(sentence)) draft.evidence.push({field:"lifestyle",quote:sentence});
      if (/^我(?:正在|最近在|目前在|计划|打算).{1,30}(?:学习|开发|筹备|练习|准备|做项目|做产品)/.test(sentence)) draft.evidence.push({field:"goals",quote:sentence});
      if (/^我(?:比较|很|最)?(?:擅长|拿手)/.test(sentence)) draft.evidence.push({field:"strengths",quote:sentence});
    }
    for (const source of draft.evidence) {
      if (!allowedFields.has(source.field)) continue;
      const candidate = cleanConversationProfileCandidates([{target: "self", field: source.field, value: source.quote, quote: source.quote, basis: "statement", sourceId: row.localId}], [row])[0];
      if (candidate) result.push({id: row.localId + ":" + candidate.field, sourceId: row.localId, field: candidate.field, label: candidate.label, value: candidate.value, quote: candidate.quote, at: row.at, basis: "statement"});
    }
  }
  return result;
}

/** One versioned, bounded summary per source library reuses coach_facts. Derived
 * is distinct from accepted, so it never silently overwrites confirmed data. */
export async function updateSelfArchiveMemory(owner: string, libraryId: string, epoch: number, rows: readonly ConversationMemoryLine[], db: Database = getD1()) {
  const profile = await db.prepare("SELECT consent_at,paused FROM coach_profiles WHERE owner_id=?").bind(owner).first<{consent_at:number|null;paused:number}>();
  if (!profile?.consent_at || profile.paused) return "disabled" as const;
  const candidates = extractSelfArchiveItems(rows);
  const id = `self-archive:${libraryId}:${epoch}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const old = await db.prepare("SELECT id,value,created_at FROM coach_facts WHERE id=? AND owner_id=? AND field='selfArchiveSummary' AND status='derived'").bind(id,owner).first<Fact>();
    const memory = old ? parse<Memory>(old.value, {version:0,libraryId,epoch,items:[],removed:[]}) : {version:0,libraryId,epoch,items:[] as Item[],removed:[] as string[]};
    const removed = new Set(memory.removed), items = [...memory.items];
    for (const candidate of candidates) {
      const key = candidate.field + ":" + normalized(candidate.quote);
      if (removed.has(candidate.id) || removed.has(key) || items.some(item => item.id === candidate.id || item.field === candidate.field && normalized(item.quote) === normalized(candidate.quote))) continue;
      items.push(candidate);
    }
    // Keep several dated examples per field rather than a rolling last-N chat
    // slice. All rows were inspected; these are a bounded preference summary.
    const retained = items.filter((item,index) => item.basis === "correction" || items.slice(index+1).filter(next => next.field === item.field).length < 8).slice(-64);
    if (old && JSON.stringify(retained) === JSON.stringify(memory.items)) return "unchanged" as const;
    const next = JSON.stringify({...memory, version:memory.version+1, items:retained});
    const now = Date.now(), guard = [owner,profile.consent_at,owner,libraryId,epoch];
    const write = old
      ? await db.prepare(`UPDATE coach_facts SET value=?,evidence=?,created_at=? WHERE id=? AND owner_id=? AND value=? AND ${live}`).bind(next,summary(retained),now,id,owner,old.value,...guard).run()
      : await db.prepare(`INSERT INTO coach_facts(id,owner_id,subject_id,field,value,source,evidence,event_meta,confidence,status,created_at) SELECT ?,?,NULL,'selfArchiveSummary',?,'本人聊天自述摘要',?,'{"version":1,"basis":"derived"}','medium','derived',? WHERE ${live} ON CONFLICT(id) DO NOTHING`).bind(id,owner,next,summary(retained),now,...guard).run();
    if (write.meta.changes) return "updated" as const;
  }
  throw Error("本人资料正在更新，摘要暂未保存。");
}

/** One-time deterministic backfill for archives imported before this feature.
 * Subsequent imports update the saved summary incrementally at synchronization. */
export async function backfillSelfArchiveMemory(owner: string, db: Database = getD1()) {
  const profile = await db.prepare("SELECT consent_at,paused FROM coach_profiles WHERE owner_id=?").bind(owner).first<{consent_at:number|null;paused:number}>();
  if (!profile?.consent_at || profile.paused) return;
  const libraries = await db.prepare("SELECT l.id,l.epoch FROM coach_capture_libraries l WHERE l.owner_id=? AND l.kind='chat' AND l.deleted_at IS NULL AND (l.subject_id IS NULL OR EXISTS(SELECT 1 FROM coach_subjects s WHERE s.id=l.subject_id AND s.owner_id=l.owner_id AND s.status='active')) AND NOT EXISTS(SELECT 1 FROM coach_facts f WHERE f.owner_id=l.owner_id AND f.id='self-archive:'||l.id||':'||l.epoch AND f.field='selfArchiveSummary') LIMIT 20").bind(owner).all<{id:string;epoch:number}>();
  for (const library of libraries.results) {
    const total = await db.prepare("SELECT COUNT(*) AS total FROM coach_capture_records WHERE owner_id=? AND library_id=? AND epoch=?").bind(owner,library.id,library.epoch).first<{total:number}>();
    if (!total || total.total>20000) continue;
    const candidates: ConversationMemoryLine[] = [];
    for (let offset=0;offset<Math.max(1,total.total);offset+=500) {
      const sources = await db.prepare("SELECT record_json FROM coach_capture_records WHERE owner_id=? AND library_id=? AND epoch=? ORDER BY seq LIMIT 500 OFFSET ?").bind(owner,library.id,library.epoch,offset).all<{record_json:string}>();
      const values=sources.results.flatMap(row=>{const value=parse<ConversationMemoryLine|null>(row.record_json,null);return value?[value]:[];});
      const useful=new Set(extractSelfArchiveItems(values).map(item=>item.sourceId));
      candidates.push(...values.filter(row=>useful.has(row.localId)));
    }
    await updateSelfArchiveMemory(owner,library.id,library.epoch,candidates,db);
  }
}

export async function loadSelfArchiveMemory(owner: string, db: Database = getD1()): Promise<SelfArchiveMemoryState> {
  const disabled: SelfArchiveMemoryState = {version:1,status:"disabled",summaries:[]};
  const profile = await db.prepare("SELECT consent_at,paused,data FROM coach_profiles WHERE owner_id=?").bind(owner).first<{consent_at:number|null;paused:number;data:string}>();
  if (!profile?.consent_at || profile.paused) return disabled;
  const confirmed = parse<Record<string,unknown>>(profile.data,{});
  const facts = await db.prepare("SELECT id,value,created_at FROM coach_facts WHERE owner_id=? AND subject_id IS NULL AND field='selfArchiveSummary' AND status='derived' ORDER BY created_at DESC LIMIT 100").bind(owner).all<Fact>();
  const memories = facts.results.flatMap(fact => {
    const memory = parse<Memory | null>(fact.value,null);
    return memory && Array.isArray(memory.items) && typeof memory.libraryId === "string" && Number.isSafeInteger(memory.epoch)
      ? [{fact,memory}] : [];
  });
  const libraryIds = [...new Set(memories.map(({memory}) => memory.libraryId))];
  const libraries = libraryIds.length ? await db.prepare("SELECT l.id,l.epoch FROM coach_capture_libraries l WHERE l.owner_id=? AND l.kind='chat' AND l.deleted_at IS NULL AND l.id IN (SELECT value FROM json_each(?)) AND (l.subject_id IS NULL OR EXISTS(SELECT 1 FROM coach_subjects s WHERE s.id=l.subject_id AND s.owner_id=l.owner_id AND s.status='active'))").bind(owner,JSON.stringify(libraryIds)).all<{id:string;epoch:number}>() : {results:[]};
  const epochs = new Map(libraries.results.map(library => [library.id,library.epoch]));
  const activeMemories = memories.filter(({memory}) => epochs.get(memory.libraryId) === memory.epoch);
  const sourceKey = (libraryId:string,epoch:number,sourceId:string) => JSON.stringify([libraryId,epoch,sourceId]);
  const references = new Map<string,[string,number,string]>();
  for (const {memory} of activeMemories) for (const item of memory.items) {
    if (item && typeof item.sourceId === "string") references.set(sourceKey(memory.libraryId,memory.epoch,item.sourceId),[memory.libraryId,memory.epoch,item.sourceId]);
  }
  const requested = [...references.values()];
  const bySource = new Map<string,Pick<ConversationMemoryLine,"senderRole"|"kind"|"text">>();
  // Exact source tuples prevent same local IDs in separate libraries from
  // borrowing each other's quotations. Recheck live sources inside each chunk
  // so deletion or an epoch change after the initial lookup cannot revive them.
  // At most 500 citations are read per query; no full chat history is scanned.
  // CROSS JOIN keeps the bounded requested tuples outermost, then probes the
  // existing (library_id,epoch,local_id) unique index instead of scanning archives.
  for (let offset=0;offset<requested.length;offset+=500) {
    const sources = await db.prepare("SELECT r.library_id,r.epoch,r.local_id,r.record_json FROM json_each(?) requested CROSS JOIN coach_capture_records r ON r.library_id=json_extract(requested.value,'$[0]') AND r.epoch=json_extract(requested.value,'$[1]') AND r.local_id=json_extract(requested.value,'$[2]') CROSS JOIN coach_capture_libraries l ON l.id=r.library_id AND l.epoch=r.epoch WHERE r.owner_id=? AND l.owner_id=? AND l.kind='chat' AND l.deleted_at IS NULL AND (l.subject_id IS NULL OR EXISTS(SELECT 1 FROM coach_subjects s WHERE s.id=l.subject_id AND s.owner_id=l.owner_id AND s.status='active'))").bind(JSON.stringify(requested.slice(offset,offset+500)),owner,owner).all<{library_id:string;epoch:number;local_id:string;record_json:string}>();
    for (const row of sources.results) {
      const source = parse<ConversationMemoryLine|null>(row.record_json,null);
      if (source) bySource.set(sourceKey(row.library_id,row.epoch,row.local_id),{senderRole:source.senderRole,kind:source.kind,text:source.text});
    }
  }
  const summaries: SelfArchiveMemoryState["summaries"] = [];
  const removed = new Set<string>();
  for (const {fact,memory} of activeMemories) {
    for (const key of memory.removed || []) removed.add(key);
    if (!memory.items.length) continue;
    const items = memory.items.filter(item => {
      if (!item || typeof item.sourceId !== "string" || typeof item.quote !== "string") return false;
      const source = bySource.get(sourceKey(memory.libraryId,memory.epoch,item.sourceId));
      return allowedFields.has(item.field) && !Object.hasOwn(confirmed,item.field) && source?.senderRole === "self" && source.kind === "text" && typeof source.text === "string" && source.text.includes(item.quote);
    });
    if (items.length) summaries.push({id:fact.id,version:memory.version,summary:summary(items),updatedAt:fact.created_at,items});
  }
  const corrected = new Map<string,string>();
  for (const source of summaries) for (const item of source.items) {
    const key=item.field+":"+normalized(item.quote);
    if (item.basis==="correction" && !corrected.has(key)) corrected.set(key,source.id+":"+item.id);
  }
  const visible = summaries.flatMap(source=>{
    const items=source.items.filter(item=>{
      const key=item.field+":"+normalized(item.quote),preferred=corrected.get(key);
      return !removed.has(key) && (!preferred || preferred===source.id+":"+item.id);
    });
    return items.length?[{...source,items,summary:summary(items)}]:[];
  });
  const active = await db.prepare("SELECT consent_at,paused FROM coach_profiles WHERE owner_id=?").bind(owner).first<{consent_at:number|null;paused:number}>();
  return !active || active.paused || active.consent_at !== profile.consent_at ? disabled : {version:1,status:"ready",summaries:visible};
}

export function selfArchiveMemoryContext(state: SelfArchiveMemoryState, query = "", maxChars = 1400) {
  if (state.status !== "ready") return "";
  const words = query.match(/[\p{Script=Han}a-z0-9]{2,}/gu) || [], pairs = words.flatMap(word=>Array.from({length:word.length-1},(_,i)=>word.slice(i,i+2)));
  const unique = new Map<string, Item>();
  for (const source of state.summaries) for (const item of source.items) {
    const key = item.field + ":" + normalized(item.value), old = unique.get(key);
    if (!old || item.basis === "correction") unique.set(key,item);
  }
  const ranked = [...unique.values()].sort((a,b)=>Number(b.basis==="correction")-Number(a.basis==="correction") || pairs.filter(p=>(b.label+b.value).includes(p)).length-pairs.filter(p=>(a.label+a.value).includes(p)).length);
  const prefix = "此前从本人聊天持续整理的自述摘要（仅本人；不是人格定论；原话只证明当时说过。用户纠正和当前确认资料优先，不得把与旧联系人有关的内容搬给当前人物）：";
  for (let count=Math.min(6,ranked.length);count>0;count--) {
    const block = prefix+JSON.stringify(ranked.slice(0,count).map(({field,value,quote,at,basis})=>({field,value,quote,at,basis})));
    if (block.length<=maxChars) return block;
  }
  return "";
}

export async function correctSelfArchiveMemory(owner: string, memoryId: unknown, itemId: unknown, value: unknown, remove: boolean, db: Database = getD1()) {
  if (typeof memoryId!=="string" || typeof itemId!=="string" || !remove && (typeof value!=="string" || !value.trim() || value.length>180)) throw Error("请填写不超过180字的本人自述。");
  const state = await loadSelfArchiveMemory(owner,db);
  if (state.status!=="ready") throw Error("请先启用并恢复个人档案。");
  if (!state.summaries.some(source=>source.id===memoryId && source.items.some(item=>item.id===itemId))) throw Error("这条资料已变化或来源已删除，请刷新。");
  const row = await db.prepare("SELECT id,value,created_at FROM coach_facts WHERE id=? AND owner_id=? AND field='selfArchiveSummary' AND status='derived'").bind(memoryId,owner).first<Fact>();
  if (!row) throw Error("这条资料已经移除。");
  const memory = parse<Memory>(row.value,null as never), item=memory.items.find(item=>item.id===itemId)!;
  if (remove) {memory.removed=[...new Set([...memory.removed,item.id,item.field+":"+normalized(item.quote)])];memory.items=memory.items.filter(item=>item.id!==itemId);}
  else { item.value=String(value).trim();item.basis="correction"; }
  memory.version++;
  const saved = await db.prepare("UPDATE coach_facts SET value=?,evidence=?,created_at=? WHERE id=? AND owner_id=? AND value=? AND EXISTS(SELECT 1 FROM coach_profiles WHERE owner_id=? AND consent_at IS NOT NULL AND paused=0)").bind(JSON.stringify(memory),summary(memory.items),Date.now(),memoryId,owner,row.value,owner).run();
  if (!saved.meta.changes) throw Error("资料刚刚更新，请刷新后再保存。");
  const copies=await db.prepare("SELECT id,value,created_at FROM coach_facts WHERE owner_id=? AND subject_id IS NULL AND field='selfArchiveSummary' AND status='derived' ORDER BY created_at DESC LIMIT 100").bind(owner).all<Fact>();
  const key=item.field+":"+normalized(item.quote);
  for(const copy of copies.results) {
    if(copy.id===memoryId)continue;
    const other=parse<Memory|null>(copy.value,null);
    if(!other?.items.some(entry=>entry.field+":"+normalized(entry.quote)===key))continue;
    if(remove){other.removed=[...new Set([...other.removed,key])];other.items=other.items.filter(entry=>entry.field+":"+normalized(entry.quote)!==key);}
    else for(const entry of other.items)if(entry.field+":"+normalized(entry.quote)===key){entry.value=item.value;entry.basis="correction";}
    other.version++;
    const updated=await db.prepare("UPDATE coach_facts SET value=?,evidence=?,created_at=? WHERE id=? AND owner_id=? AND value=? AND EXISTS(SELECT 1 FROM coach_profiles WHERE owner_id=? AND consent_at IS NOT NULL AND paused=0)").bind(JSON.stringify(other),summary(other.items),Date.now(),copy.id,owner,copy.value,owner).run();
    if(!updated.meta.changes)throw Error("其他来源的相同自述刚刚更新，请刷新后再保存。");
  }
}
