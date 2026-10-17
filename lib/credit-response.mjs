import { reserveCredits, finishCreditTask, requireNewCreditTask, CreditError } from './account-credits.mjs';

const json = (body, status) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
// An explicit, verified release lets clients create a new attempt immediately.
// Never infer this from an HTTP error or a disconnected request: settlement may
// still be unknown, in which case the original idempotency key must survive.
async function releasedResponse(response) {
  const headers = new Headers(response.headers);
  headers.set('X-Credit-Task-Status', 'released');
  headers.set('Cache-Control', 'no-store');
  const payload = await response.clone().json().catch(() => null);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
  headers.delete('content-length');
  return new Response(JSON.stringify({ ...payload, creditTaskStatus: 'released' }), { status: response.status, statusText: response.statusText, headers });
}
// Result and settlement commit together. Retrying a timed-out request returns
// its receipt rather than making another paid model call.
export async function creditResponse(db, ownerId, request, feature, amount, execute) {
  let requestId, body;
  try { body = await request.clone().json(); requestId = body?.requestId || request.headers.get('x-request-id'); }
  catch { return json({ error: '请求格式不正确。' }, 400); }
  if (body?.confirmed !== true) return json({ error: '请先确认本次处理。' }, 400);
  const fingerprint = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ path: new URL(request.url).pathname, body })))), b => b.toString(16).padStart(2, '0')).join('');
  let reserved = false;
  try {
    const reservation = await reserveCredits(db, { ownerId, requestId, feature, amount, fingerprint });
    if (!reservation.execute && reservation.status === 'settled') {
      const receipt = await db.prepare('SELECT response_json,response_status FROM coach_credit_receipts WHERE owner_id=? AND request_id=? AND expires_at>?').bind(ownerId, requestId, Date.now()).first();
      if (receipt) return new Response(receipt.response_json, { status: receipt.response_status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    }
    requireNewCreditTask(reservation);
    reserved = true;
    const response = await execute();
    if (!response.ok) { await finishCreditTask(db, ownerId, requestId, false); return releasedResponse(response); }
    const text = await response.clone().text();
    JSON.parse(text);
    // Refuse to charge a result if a timeout reconciler already released it.
    await db.batch([
      db.prepare('INSERT INTO coach_credit_receipts (owner_id,request_id,response_json,response_status,expires_at) VALUES (?,?,?,?,?)').bind(ownerId, requestId, text, response.status, Date.now() + 86400000),
      db.prepare("UPDATE coach_credit_tasks SET status='settled',updated_at=? WHERE owner_id=? AND request_id=?").bind(Date.now(), ownerId, requestId),
    ]);
    return response;
  } catch (error) {
    let released = false;
    if (reserved) { try { await finishCreditTask(db, ownerId, requestId, false); released = true; } catch { /* Keep the original key when settlement is unknown. */ } }
    if (error instanceof CreditError) return json({ error: error.message, code: error.code, processing: error.code === 'CREDIT_PROCESSING', ...(released || error.code === 'CREDIT_RELEASED' ? { creditTaskStatus: 'released' } : {}) }, error.status);
    console.error('credit_response_failed', { name: error?.name || 'Error' });
    return json({ error: '本次处理未完成，积分不会重复扣除，请稍后重试。', ...(released ? { creditTaskStatus: 'released' } : {}) }, 503);
  }
}
