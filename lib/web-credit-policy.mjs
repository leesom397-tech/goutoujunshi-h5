import { CREDIT_PRICES, reserveCredits, finishCreditTask, requireNewCreditTask, CreditError } from './account-credits.mjs';
import { creditResponse } from './credit-response.mjs';

// Reads and settings stay free. Every legacy operation that invokes a model or
// browser renderer enters the same ledger as the new workspace.
export function legacyCreditPolicy(path, method, body = {}) {
  if (method !== 'POST') return null;
  if (path === '/api/crush') {
    if (['analyze', 'enrichDistribution', 'refreshAffinity'].includes(body?.action)) return { feature: 'analysis', amount: CREDIT_PRICES.analysisSmall };
    if (body?.action === 'advice') return { feature: 'chat', amount: CREDIT_PRICES.text };
    return null;
  }
  if (['/api/crush/screenshot', '/api/import/analyze', '/api/history/check', '/api/risk'].includes(path)) return { feature: 'analysis', amount: CREDIT_PRICES.analysisSmall };
  if (path === '/api/profile/suggest') return { feature: 'analysis', amount: CREDIT_PRICES.profile };
  if (path === '/api/chat' && Array.isArray(body?.turns) && body.turns.some(turn => turn?.image)) return { feature: 'analysis', amount: CREDIT_PRICES.analysisSmall };
  // Positioning uses local rules for generation and an owner-scoped UPSERT for
  // saving. Neither operation invokes a provider or consumes credits.
  if (['/api/chat', '/api/crush/quick', '/api/crush/rewrite', '/api/voice/delegate', '/api/voice/summary'].includes(path)) return { feature: 'chat', amount: CREDIT_PRICES.text };
  if (path === '/api/import/transcribe') return { feature: 'chat', amount: CREDIT_PRICES.transcription };
  if (path === '/api/voice') return { feature: 'voice', amount: CREDIT_PRICES.voice };
  if (path === '/api/crush/card') return { feature: 'analysis', amount: CREDIT_PRICES.text };
  return null;
}
const failure = error => Response.json({ error: error instanceof CreditError ? error.message : '本次处理未完成，请稍后重试。', ...(error instanceof CreditError ? { code: error.code } : {}) }, { status: error instanceof CreditError ? error.status : 503, headers: { 'Cache-Control': 'no-store' } });
const digest = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');

// Browser-generated multipart boundaries change on every retry. Canonicalize
// this one audio endpoint by fields and file bytes, with the endpoint's existing
// body/file limits enforced before reserving credits. Other legacy paths retain
// their original byte-for-byte fingerprint contract.
async function transcriptionFingerprint(request) {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('multipart/form-data')) throw new CreditError('INVALID_AUDIO_UPLOAD', '上传格式不正确。', 415);
  const limit = 7_500_000;
  if (Number(request.headers.get('content-length') || 0) > limit) throw new CreditError('AUDIO_TOO_LARGE', '录音文件请控制在 7 MB 以内。', 413);
  const reader = request.clone().body?.getReader(), parts = []; let length = 0;
  if (!reader) throw new CreditError('INVALID_AUDIO_UPLOAD', '无法读取录音。');
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    length += part.value.byteLength;
    if (length > limit) { void reader.cancel().catch(() => {}); throw new CreditError('AUDIO_TOO_LARGE', '录音文件请控制在 7 MB 以内。', 413); }
    parts.push(part.value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  let form;
  try { form = await new Response(bytes, { headers: { 'Content-Type': contentType } }).formData(); }
  catch { throw new CreditError('INVALID_AUDIO_UPLOAD', '无法读取录音。'); }
  const fields = [];
  // Stable sort retains the order of duplicate names, matching FormData.get().
  for (const [name, value] of [...form.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    if (typeof value === 'string') fields.push(['field', name, value]);
    else {
      if (value.size > 7_000_000) throw new CreditError('AUDIO_TOO_LARGE', '录音文件请控制在 7 MB 以内。', 413);
      fields.push(['file', name, value.name, value.type, value.size, await digest(await value.arrayBuffer())]);
    }
  }
  return digest(new TextEncoder().encode(JSON.stringify(fields)));
}

export async function legacyCreditResponse(db, ownerId, request, policy, body, execute) {
  const requestId = body?.requestId || request.headers.get('x-request-id') || crypto.randomUUID();
  // Persist a payload digest, never duplicate image/audio/private input in receipts.
  let fingerprint;
  try { fingerprint = new URL(request.url).pathname === '/api/import/transcribe' ? await transcriptionFingerprint(request) : await digest(await request.clone().arrayBuffer()); }
  catch (error) { const response = failure(error); response.headers.set('X-Request-Id', String(requestId)); return response; }
  const billing = new Request(request.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmed: true, requestId, input: fingerprint, query: new URL(request.url).search }) });
  let response;
  if (['/api/voice', '/api/crush/card'].includes(new URL(request.url).pathname)) {
    // SDP and binary cards cannot be replayed as JSON. An identical retry gets
    // an explicit task state and never opens another connection or charges twice.
    let reserved = false;
    try {
      const reservation = await reserveCredits(db, { ownerId, requestId, feature: policy.feature, amount: policy.amount, fingerprint });
      requireNewCreditTask(reservation); reserved = true;
      response = await execute();
      await finishCreditTask(db, ownerId, requestId, response.ok);
    } catch (error) {
      if (reserved) await finishCreditTask(db, ownerId, requestId, false).catch(() => {});
      response = failure(error);
    }
  } else response = await creditResponse(db, ownerId, billing, policy.feature, policy.amount, execute);
  const headers = new Headers(response.headers);
  headers.set('X-Request-Id', String(requestId));
  headers.set('Cache-Control', 'no-store');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
