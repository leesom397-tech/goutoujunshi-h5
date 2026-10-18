import { getD1 } from "@/db";
import { captureLibraryId } from "./desktop-capture";

type Database = ReturnType<typeof getD1>;
type SubjectRow = { id: string; label: string; data: string };
export class CaptureSubjectError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
function fail(message: string, status = 400): never { throw new CaptureSubjectError(message, status); }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const safeData = "CASE WHEN json_valid(data) THEN CASE WHEN json_type(data)='object' THEN data ELSE '{}' END ELSE '{}' END";
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const exactText = (value: unknown, max = 200): value is string => typeof value === "string" && !!value.trim() && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
const displayName = (...values: unknown[]) => {
  const value = values.find(item => exactText(item));
  return typeof value === "string" ? value.replace(/ · #[a-fA-F0-9]{16}$/," ").trim().slice(0, 60) || "微信联系人" : "微信联系人";
};
const digest = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, "0")).join("");

/** Only small raster avatars or WeChat's HTTPS image hosts are retained. No server fetch. */
export function captureContactAvatar(contact: Record<string, unknown>): string {
  if (typeof contact.avatarData === "string" && contact.avatarData.length <= 128000) {
    const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(contact.avatarData);
    if (match && match[2].length % 4 === 0) {
      try {
        const bytes = atob(match[2]);
        const signature = match[1] === "jpeg" ? bytes.startsWith("\xff\xd8\xff") && bytes.endsWith("\xff\xd9")
          : match[1] === "png" ? bytes.startsWith("\x89PNG\r\n\x1a\n")
            : bytes.startsWith("RIFF") && bytes.slice(8, 12) === "WEBP";
        if (bytes.length >= 12 && signature) return contact.avatarData;
      } catch { /* An invalid avatar must not block importing this contact. */ }
    }
  }
  if (typeof contact.avatarUrl === "string" && contact.avatarUrl.length <= 2048) {
    try {
      const url = new URL(contact.avatarUrl);
      if (url.protocol === "https:" && !url.username && !url.password && !url.port && !url.hash && /(^|\.)(qlogo|qpic)\.cn$/.test(url.hostname)) return url.href;
    } catch { /* The normal initials avatar remains available. */ }
  }
  return "";
}

async function contactIdentity(owner: string, publicOwner: string, body: Record<string, unknown>) {
  if (body.contact !== undefined) {
    if (!object(body.contact)) fail("请选择助手中已确认的微信联系人。");
    const contact = body.contact as Record<string, unknown>;
    if (typeof contact.accountKey !== "string" || !/^[a-f0-9]{64}$/i.test(contact.accountKey) || !exactText(contact.contactId) || contact.contactId.trim() !== contact.contactId) fail("联系人身份不完整，请重新选择联系人。");
    return {
      key: await digest(JSON.stringify(["wechat-contact-v1", owner, contact.accountKey.toLowerCase(), contact.contactId])),
      kind: "wechat-contact", label: displayName(contact.remark, contact.nickname, contact.label), avatar: captureContactAvatar(contact),
    };
  }
  if (!object(body.library)) fail("请先选择联系人或已导入的原文库。");
  const library = body.library as Record<string, unknown>;
  if (typeof library.id !== "string" || !library.id.startsWith("capture:") || library.id.length > 1200 || !exactText(library.account) || !exactText(library.friend)) fail("原文库身份不完整，请重新打开这份材料。");
  let namespace: unknown;
  try { namespace = JSON.parse(library.id.slice(8)); } catch { fail("原文库编号无效。"); }
  if (!Array.isArray(namespace) || namespace.length !== 4 || namespace[0] !== publicOwner || namespace[1] !== library.account || namespace[2] !== library.friend || !["chat", "moments"].includes(namespace[3]) || library.kind !== undefined && library.kind !== namespace[3]) fail("原文库不属于当前账号或联系人。", 409);
  const kind = namespace[3] as "chat" | "moments";
  if (captureLibraryId({ ownerId: publicOwner, account: library.account as string, friend: library.friend as string, kind }) !== library.id) fail("原文库编号不一致。", 409);
  return { key: await digest(JSON.stringify(["capture-library-v1", owner, library.id])), kind: "capture-library", label: displayName(library.friend), avatar: "" };
}

/** Exact identities are checked again inside the transaction; display names never select a person. */
export async function bindCaptureSubject(owner: string, publicOwner: string, body: Record<string, unknown>, db: Database = getD1()) {
  if (body.expectedOwnerId !== publicOwner) fail("账号已变化，请刷新后再导入。", 409);
  if (body.confirmed !== true || body.consent !== true) fail("请确认导入所选联系人的材料并保存人物档案。", 403);
  const identity = await contactIdentity(owner, publicOwner, body);
  const explicit = body.subjectId === undefined || body.subjectId === null || body.subjectId === "" ? "" : body.subjectId;
  if (typeof explicit !== "string" || explicit && !uuid.test(explicit)) fail("所选人物无效。");
  if (explicit && !await db.prepare("SELECT id FROM coach_subjects WHERE owner_id=? AND id=? AND status='active'").bind(owner, explicit).first()) fail("所选人物不存在，请重新选择。", 404);
  // The transaction checks the exact binding before insertion. A fresh candidate
  // also lets a later, explicitly confirmed import replace an archived/deleted person.
  const key = identity.key, candidateId = crypto.randomUUID();
  const path = `$.captureBindings.${key}`, now = Date.now();
  const boundQuery = `SELECT id FROM coach_subjects WHERE owner_id=? AND status='active' AND json_type(${safeData},?)='object' ORDER BY id LIMIT 1`;
  const activeProfile = "EXISTS(SELECT 1 FROM coach_profiles WHERE owner_id=? AND consent_at IS NOT NULL AND paused=0)";
  const statements = [db.prepare(`INSERT INTO coach_profiles (owner_id,consent_at,paused,data,updated_at)
    SELECT ?,?,0,'{}',? WHERE (?='' OR EXISTS(SELECT 1 FROM coach_subjects WHERE owner_id=? AND id=? AND status='active'))
    ON CONFLICT(owner_id) DO UPDATE SET consent_at=COALESCE(coach_profiles.consent_at,excluded.consent_at),paused=0,updated_at=excluded.updated_at`)
    .bind(owner, now, now, explicit, owner, explicit)];
  const insertIndex = statements.length;
  statements.push(db.prepare(`INSERT OR IGNORE INTO coach_subjects (id,owner_id,label,status,data,created_at,updated_at)
    SELECT ?,?,?,'active','{}',?,? WHERE ?='' AND NOT EXISTS(${boundQuery})
    AND (SELECT COUNT(*) FROM coach_subjects WHERE owner_id=?)<40 AND ${activeProfile}`)
    .bind(candidateId, owner, identity.label, now, now, explicit, owner, path, owner, owner));
  if (explicit) {
    statements.push(db.prepare(`UPDATE coach_subjects SET data=json_remove(${safeData},?),updated_at=?
      WHERE owner_id=? AND id<>? AND json_type(${safeData},?)='object' AND ${activeProfile}
      AND EXISTS(SELECT 1 FROM coach_subjects target WHERE target.owner_id=? AND target.id=? AND target.status='active')`)
      .bind(path, now, owner, explicit, path, owner, owner, explicit));
  }
  const selected = explicit ? "?" : `COALESCE((${boundQuery}),?)`;
  const selectedParams = explicit ? [explicit] : [owner, path, candidateId];
  const bindingData = `json_set(${safeData},'$.captureBindings',json(CASE WHEN json_type(${safeData},'$.captureBindings')='object' THEN json_extract(${safeData},'$.captureBindings') ELSE '{}' END))`;
  const withBinding = `json_set(${bindingData},?,json(?))`;
  const withAvatar = `CASE WHEN ?<>'' AND COALESCE(json_extract(${safeData},'$.avatar'),'')='' THEN json_set(${withBinding},'$.avatar',?) ELSE ${withBinding} END`;
  const binding = JSON.stringify({ version: 1, kind: identity.kind });
  statements.push(db.prepare(`UPDATE coach_subjects SET data=${withAvatar},updated_at=? WHERE owner_id=? AND id=${selected} AND status='active' AND ${activeProfile}`)
    .bind(identity.avatar, path, binding, identity.avatar, path, binding, now, owner, ...selectedParams, owner));
  const results = await db.batch(statements);
  const row = await db.prepare(`SELECT id,label,data FROM coach_subjects WHERE owner_id=? AND status='active' AND json_type(${safeData},?)='object'${explicit ? " AND id=?" : ""} ORDER BY id LIMIT 1`).bind(owner, path, ...(explicit ? [explicit] : [])).first<SubjectRow>();
  if (!row) fail("人物档案无法保存，请刷新或整理已达到上限的档案后重试。", 409);
  let avatar = "";
  try { const value = JSON.parse(row.data).avatar; if (typeof value === "string") avatar = value; } catch { /* A normal initials avatar is used. */ }
  return { subjectId: row.id, created: !!results[insertIndex]?.meta?.changes && row.id === candidateId, label: row.label, ...(avatar ? { avatar } : {}) };
}
