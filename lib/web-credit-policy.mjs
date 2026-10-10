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
  if (['/api/chat', '/api/crush/quick', '/api/crush/rewrite', '/api/positioning', '/api/voice/delegate', '/api/voice/summary'].includes(path)) return { feature: 'chat', amount: CREDIT_PRICES.text };
  if (path === '/api/import/transcribe') return { feature: 'chat', amount: CREDIT_PRICES.transcription };
  if (path === '/api/voice') return { feature: 'voice', amount: CREDIT_PRICES.voice };
  if (path === '/api/crush/card') return { feature: 'analysis', amount: CREDIT_PRICES.text };
  return null;
}
const failure = error => Response.json({ error: error instanceof CreditError ? error.message : '本次处理未完成，请稍后重试。', ...(error instanceof CreditError ? { code: error.code } : {}) }, { status: error instanceof CreditError ? error.status : 503, headers: { 'Cache-Control': 'no-store' } });

export async function legacyCreditResponse(db, ownerId, request, policy, body, execute) {
  const requestId = body?.requestId || request.headers.get('x-request-id') || crypto.randomUUID();
  // Persist a payload digest, never duplicate image/audio/private input in receipts.
  const bytes = await request.clone().arrayBuffer();
  const fingerprint = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
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
