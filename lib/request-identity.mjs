import { nativeSession, sessionCookies, authCookie, legacySourceRevoked } from "./web-native-auth.mjs";
import { WebIdentityUnavailable, isWebIdentityUnavailable, currentIdentityScope } from './web-identity-state.mjs';
// Cookie identities are verified by the existing account service. No request header
// can assert an owner. A cookie is accepted only on explicitly registered web routes.
export const WEB_API_PREFIX = '/api/web/';
export const isWebApi = request => new URL(request.url).pathname.startsWith(WEB_API_PREFIX);
export function browserRequestAllowed(request) {
  const origin = request.headers.get('origin');
  const sameOrigin = new URL(request.url).origin;
  if (request.headers.get('sec-fetch-site') === 'cross-site') return false;
  if (origin && origin !== sameOrigin) return false;
  return ['GET', 'HEAD', 'OPTIONS'].includes(request.method) && request.headers.get('upgrade')?.toLowerCase() !== 'websocket'
    || origin === sameOrigin;
}
export const webSessionCookie = authCookie;
const identities = new WeakMap();
export async function readWebIdentity(requestHeaders, env) {
  const cookies = sessionCookies(requestHeaders);
  const cookie = authCookie({ headers: requestHeaders });
  if (!cookie) return null;
  const scope = currentIdentityScope();
  const verify = async () => {
    if (cookies.native !== null || cookies.verified !== null) return nativeSession(requestHeaders, env);
    if (env?.DB && await legacySourceRevoked(requestHeaders, env)) return null;
    const identity = await verifyLegacyIdentity(cookie);
    // Only the response belonging to this exact verified cookie can upgrade it.
    if (identity && scope?.cookie === cookie) scope.verifiedLegacyIdentity = identity;
    return identity;
  };
  try {
    if (scope?.cookie === cookie) return await (scope.promise ||= verify());
    return await verify();
  } catch (error) {
    if (scope && isWebIdentityUnavailable(error)) scope.unavailable = true;
    throw error;
  }
}

async function verifyLegacyIdentity(cookie) {
  // Identity work belongs to this invocation. Sharing an in-flight fetch with
  // another Worker request can strand it when the first client navigates away.
  const deadline = Date.now() + 8000;
  for (let attempt = 0; attempt < 2; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new WebIdentityUnavailable();
    try {
      const response = await fetch('https://ai.lovetalk.love/next/api/session', {
        headers: { Cookie: cookie }, cache: 'no-store', signal: AbortSignal.timeout(Math.min(6000, remaining)), redirect: 'manual',
      });
      if ([401, 403].includes(response.status)) return null;
      if (!response.ok) throw new WebIdentityUnavailable();
      const data = await response.json();
      if (data?.logged_in === false) return null;
      if (data?.logged_in !== true || typeof data.user !== 'string') throw new WebIdentityUnavailable();
      const name = data.user.trim();
      if (!name || name.length > 100 || /[\x00-\x1f\x7f]/.test(name)) return null;
      return { ownerId: 'lovetalk:' + name, openId: null, displayName: name };
    } catch {
      if (attempt === 1) throw new WebIdentityUnavailable();
    }
  }
}
export async function webOwner(request, env) {
  if (!browserRequestAllowed(request)) return null;
  if (!identities.has(request)) identities.set(request, readWebIdentity(request.headers, env));
  return identities.get(request);
}
// Used by worker-only routes as well as the shared app handlers. Browser
// cookies never authenticate /api/miniapp; web routes never consume bearer tokens.
export async function requestOwner(request, env) {
  if (isWebApi(request)) return webOwner(request, env);
  if (!env.MINIAPP_APPID || !env.MINIAPP_APPSECRET) return null;
  const token = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.get('authorization') || '')?.[1];
  if (!token) return null;
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))), b => b.toString(16).padStart(2, '0')).join('');
  const row = await env.DB.prepare('SELECT l.owner_id, s.open_id FROM coach_miniapp_sessions s JOIN coach_miniapp_links l ON l.open_id=s.open_id WHERE s.token_hash=? AND s.expires_at>?').bind(hash, Date.now()).first();
  return row?.owner_id ? { ownerId: row.owner_id, openId: row.open_id } : null;
}
