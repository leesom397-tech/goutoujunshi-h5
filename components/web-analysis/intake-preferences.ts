export type IntakeMode = "chat" | "moments" | "social";
export type IntakePreference = { subjectId: string; selfSide?: "left" | "right"; sameCity?: boolean };
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const key = (owner: string, scope: string, value = "") => "chengzi-intake:v1:" + JSON.stringify([owner, scope, value]);
function storage(store?: Store): Store | null { try { return store || (typeof localStorage !== "undefined" ? localStorage : null); } catch { return null; } }
function read(owner: string, scope: string, value: string, store?: Store): any { if (!owner) return null; try { return JSON.parse(storage(store)?.getItem(key(owner, scope, value)) || "null"); } catch { return null; } }

/** Remember only explicitly chosen identities. Never reuse an unassociated side. */
export function readIntakePreference(owner: string, subjectId: string, store?: Store): IntakePreference {
  const saved = subjectId ? read(owner, "subject", subjectId, store) : null;
  return { subjectId, ...(saved?.subjectId === subjectId && ["left", "right"].includes(saved.selfSide) ? { selfSide: saved.selfSide } : {}), ...(saved?.subjectId === subjectId && typeof saved.sameCity === "boolean" ? { sameCity: saved.sameCity } : {}) };
}
export function lastIntakeSubject(owner: string, mode: string, allowedIds: string[], store?: Store): string {
  const subjectId = read(owner, "last", mode, store)?.subjectId;
  return typeof subjectId === "string" && allowedIds.includes(subjectId) ? subjectId : "";
}
export function rememberIntakePreference(owner: string, mode: string, preference: IntakePreference, store?: Store): void {
  if (!owner) return;
  try {
    const target = storage(store); if (!target) return;
    target.setItem(key(owner, "last", mode), JSON.stringify({ subjectId: preference.subjectId }));
    if (!preference.subjectId) return;
    const prior = readIntakePreference(owner, preference.subjectId, target);
    target.setItem(key(owner, "subject", preference.subjectId), JSON.stringify({ ...prior, ...preference }));
  } catch { /* Storage is optional; the visible selection remains usable. */ }
}
export function captureIntakeSubject(owner: string, libraryId: string, allowedIds: string[], store?: Store): string {
  const subjectId = read(owner, "library", libraryId, store)?.subjectId;
  return typeof subjectId === "string" && allowedIds.includes(subjectId) ? subjectId : "";
}
export function rememberCaptureSubject(owner: string, libraryId: string, subjectId: string, store?: Store): void {
  if (!owner || !libraryId) return;
  try { storage(store)?.setItem(key(owner, "library", libraryId), JSON.stringify({ subjectId })); } catch {}
}

/** Explicit choice wins. A new capture must not inherit an unrelated last-used person. */
export function resolveIntakeIdentity(input: {owner:string;mode:string;allowedIds:string[];requestedSubjectId?:string|null;captureLibraryId?:string;targetSelf?:boolean}, store?:Store): IntakePreference & {source:"explicit"|"capture"|"history"|"none";needsChoice:boolean} {
  const none = {subjectId:"",source:"none" as const,needsChoice:!input.targetSelf};
  if(!input.owner||input.targetSelf)return none;
  let subjectId="",source:"explicit"|"capture"|"history"|"none"="none";
  if(typeof input.requestedSubjectId==='string') { subjectId=input.allowedIds.includes(input.requestedSubjectId)?input.requestedSubjectId:"";source=subjectId?"explicit":"none"; }
  else if(input.captureLibraryId) { subjectId=captureIntakeSubject(input.owner,input.captureLibraryId,input.allowedIds,store);source=subjectId?"capture":"none"; }
  else { subjectId=lastIntakeSubject(input.owner,input.mode,input.allowedIds,store);source=subjectId?"history":"none"; }
  return {...readIntakePreference(input.owner,subjectId,store),source,needsChoice:!subjectId};
}

const fingerprints = new WeakMap<Blob, Promise<string>>();
export function imageFingerprint(file: Blob): Promise<string> {
  let value = fingerprints.get(file);
  if (!value) { value = file.arrayBuffer().then(data => crypto.subtle.digest("SHA-256", data)).then(hash => Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("")); fingerprints.set(file, value); }
  return value;
}
/** Only byte-identical uploads are skipped. Similar pictures or filenames remain. */
export async function uniqueIntakeImages(existing: File[], incoming: File[]): Promise<{ files: File[]; repeated: number }> {
  const seen = new Set(await Promise.all(existing.map(imageFingerprint))), files: File[] = [];
  let repeated = 0;
  for (const file of incoming) { const fingerprint = await imageFingerprint(file); if (seen.has(fingerprint)) repeated++; else { seen.add(fingerprint); files.push(file); } }
  return { files, repeated };
}
