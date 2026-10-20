import { ANALYSIS_PRICES } from './analysis-pricing.mjs';
// Shared by the worker and local SQLite regressions. No automatic grants.
export const ACCOUNT_FEATURES = Object.freeze(['analysis', 'chat', 'voice']);
export const SIGNUP_CREDITS = 0;
export const CREDIT_PRICES = Object.freeze({ text: 5, ...ANALYSIS_PRICES, profile: 30, transcription: 5, voice: 20 });
const idPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

export class CreditError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}
export function requireNewCreditTask(reservation) {
  if (reservation.execute) return;
  const status = reservation.status;
  throw new CreditError(status === 'reserved' ? 'CREDIT_PROCESSING' : status === 'released' ? 'CREDIT_RELEASED' : 'CREDIT_ALREADY_SETTLED',
    status === 'reserved' ? '本次任务仍在处理中，请稍后查看。' : status === 'released' ? '本次任务已结束，冻结积分已退回，请重新发起。' : '本次任务已完成，请查看已有结果。', 409);
}
function invalid(message) { throw new CreditError('INVALID_CREDIT_INPUT', message); }
function validateId(id) { if (typeof id !== 'string' || !idPattern.test(id)) invalid('操作编号无效。'); }
function validateReason(reason) {
  if (typeof reason !== 'string' || reason.trim().length < 2 || reason.trim().length > 200) invalid('请填写 2–200 字操作原因。');
  return reason.trim();
}
export function isCreditAdmin(ownerId, allowlist) {
  return typeof ownerId === 'string' && !!ownerId && typeof allowlist === 'string'
    && allowlist.split(',').map(value => value.trim()).filter(Boolean).includes(ownerId);
}
export async function ensureCreditAccount(db, ownerId, now = Date.now()) {
  if (typeof ownerId !== 'string' || !ownerId || ownerId.length > 200) invalid('账号无效。');
  await db.prepare('INSERT INTO coach_credit_accounts (owner_id,public_id,created_at,updated_at) VALUES (?,?,?,?) ON CONFLICT(owner_id) DO NOTHING')
    .bind(ownerId, crypto.randomUUID(), now, now).run();
  return db.prepare('SELECT * FROM coach_credit_accounts WHERE owner_id=?').bind(ownerId).first();
}
export async function readCreditAccount(db, ownerId, now = Date.now()) {
  const row = await ensureCreditAccount(db, ownerId, now);
  const totals = await db.prepare("SELECT COALESCE(SUM(CASE WHEN status='reserved' THEN amount ELSE 0 END),0) AS reserved, COALESCE(SUM(CASE WHEN status='settled' THEN amount ELSE 0 END),0) AS spent FROM coach_credit_tasks WHERE owner_id=?").bind(ownerId).first();
  const entries = await db.prepare("SELECT 'adjustment' AS kind, delta AS amount, reason AS label, created_at AS time FROM coach_credit_adjustments WHERE owner_id=? UNION ALL SELECT status AS kind, amount, feature AS label, updated_at AS time FROM coach_credit_tasks WHERE owner_id=? ORDER BY time DESC LIMIT 50").bind(ownerId, ownerId).all();
  return { userId: row.public_id, balance: row.balance, reserved: totals.reserved, spent: totals.spent,
    features: JSON.parse(row.features), active: row.enabled_until > now, enabledUntil: row.enabled_until,
    entries: entries.results || [], signupCredits: SIGNUP_CREDITS };
}
export async function findCreditOwner(db, publicId) {
  validateId(publicId);
  const row = await db.prepare('SELECT owner_id FROM coach_credit_accounts WHERE public_id=?').bind(publicId).first();
  if (!row) throw new CreditError('ACCOUNT_NOT_FOUND', '没有找到此账号，请核对用户编号。', 404);
  return row.owner_id;
}
export async function adjustCredits(db, { id, ownerId, actorId, delta, reason }, now = Date.now()) {
  validateId(id); reason = validateReason(reason);
  if (!actorId || !Number.isSafeInteger(delta) || delta === 0 || Math.abs(delta) > 1000000) invalid('积分调整必须是非零整数，单次不超过 100 万。');
  const old = await db.prepare('SELECT * FROM coach_credit_adjustments WHERE id=?').bind(id).first();
  if (old) {
    if (old.owner_id !== ownerId || old.actor_id !== actorId || old.delta !== delta || old.reason !== reason) throw new CreditError('CREDIT_CONFLICT', '操作编号已被其他调整使用。', 409);
    return { replayed: true };
  }
  // INSERT OR IGNORE would silently ignore CHECK failures: deliberately do not use it.
  await db.prepare('INSERT INTO coach_credit_adjustments (id,owner_id,actor_id,delta,reason,created_at) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING')
    .bind(id, ownerId, actorId, delta, reason, now).run();
  const saved = await db.prepare('SELECT * FROM coach_credit_adjustments WHERE id=?').bind(id).first();
  if (!saved || saved.owner_id !== ownerId || saved.actor_id !== actorId || saved.delta !== delta || saved.reason !== reason) throw new CreditError('CREDIT_CONFLICT', '操作编号冲突。', 409);
  return { replayed: false };
}
export async function setCreditPermissions(db, { id, ownerId, actorId, features, enabledUntil, reason }, now = Date.now()) {
  validateId(id); reason = validateReason(reason);
  if (!actorId || !Array.isArray(features) || features.length > ACCOUNT_FEATURES.length || features.some(value => !ACCOUNT_FEATURES.includes(value))) invalid('功能选择无效。');
  features = JSON.stringify([...new Set(features)].sort());
  if (!Number.isSafeInteger(enabledUntil) || enabledUntil < 0 || enabledUntil > now + 3660 * 86400000) invalid('有效期无效，最长为十年。');
  const same = row => row.owner_id === ownerId && row.actor_id === actorId && row.features === features && row.enabled_until === enabledUntil && row.reason === reason;
  const old = await db.prepare('SELECT * FROM coach_credit_permissions WHERE id=?').bind(id).first();
  if (old) {
    if (!same(old)) throw new CreditError('CREDIT_CONFLICT', '操作编号已被其他权限调整使用。', 409);
    return { replayed: true };
  }
  await db.prepare('INSERT INTO coach_credit_permissions (id,owner_id,actor_id,features,enabled_until,reason,created_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING')
    .bind(id, ownerId, actorId, features, enabledUntil, reason, now).run();
  const saved = await db.prepare('SELECT * FROM coach_credit_permissions WHERE id=?').bind(id).first();
  if (!saved || !same(saved)) throw new CreditError('CREDIT_CONFLICT', '操作编号冲突。', 409);
  return { replayed: false };
}
export async function reserveCredits(db, { ownerId, requestId, feature, fingerprint, amount }, now = Date.now()) {
  validateId(requestId);
  if (!ACCOUNT_FEATURES.includes(feature) || !/^[a-f0-9]{64}$/.test(fingerprint || '') || !Number.isSafeInteger(amount) || amount < 1 || amount > 1000000) invalid('积分任务无效。');
  const same = row => row.feature === feature && row.fingerprint === fingerprint && row.amount === amount;
  const old = await db.prepare('SELECT * FROM coach_credit_tasks WHERE owner_id=? AND request_id=?').bind(ownerId, requestId).first();
  if (old) {
    if (!same(old)) throw new CreditError('CREDIT_CONFLICT', '本次任务编号已用于其他材料。', 409);
    return { execute: false, status: old.status };
  }
  // This INSERT and the trigger's balance decrement are one atomic SQLite transaction.
  // A losing concurrent caller must never start a second model request.
  let inserted;
  try {
    inserted = await db.prepare("INSERT INTO coach_credit_tasks (owner_id,request_id,feature,fingerprint,amount,created_at,updated_at) SELECT ?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM coach_credit_tasks WHERE owner_id=? AND request_id=?)")
      .bind(ownerId, requestId, feature, fingerprint, amount, now, now, ownerId, requestId).run();
  } catch (error) {
    if (String(error).includes('CREDIT_NOT_AVAILABLE')) throw new CreditError('CREDIT_NOT_AVAILABLE', '功能未开通、已到期或可用积分不足。', 403);
    throw error;
  }
  const saved = await db.prepare('SELECT * FROM coach_credit_tasks WHERE owner_id=? AND request_id=?').bind(ownerId, requestId).first();
  if (!saved || !same(saved)) throw new CreditError('CREDIT_CONFLICT', '任务编号冲突。', 409);
  return { execute: Number(inserted.meta.changes) > 0, status: saved.status };
}
export async function finishCreditTask(db, ownerId, requestId, success, now = Date.now()) {
  validateId(requestId);
  if (typeof success !== 'boolean') invalid('结算状态无效。');
  const status = success ? 'settled' : 'released';
  await db.prepare("UPDATE coach_credit_tasks SET status=?,updated_at=? WHERE owner_id=? AND request_id=? AND status='reserved'").bind(status, now, ownerId, requestId).run();
  const row = await db.prepare('SELECT status FROM coach_credit_tasks WHERE owner_id=? AND request_id=?').bind(ownerId, requestId).first();
  if (!row || row.status !== status) throw new CreditError('CREDIT_CONFLICT', '任务已经以其他状态结算或不存在。', 409);
  return { status };
}
