import { WebIdentityUnavailable } from './web-identity-state.mjs';
const SESSION_COOKIE = 'cz_session';
const LEGACY_COOKIE = 'lt_next_session';
const AUTH_ORIGIN = 'https://ai.lovetalk.love';
const SESSION_TTL = 7 * 86400000;
const ITERATIONS = 100000;
const PASSWORD_MESSAGE = new TextEncoder().encode('chengzi-web-password-verifier-v1');
const noStore = { 'Cache-Control': 'no-store' };
const json = (body, status = 200, extra = {}) => Response.json(body, { status, headers: { ...noStore, ...extra } });
const hex = bytes => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
const bytes = value => Uint8Array.from(value.match(/.{2}/g) || [], part => parseInt(part, 16));
export const digest = async value => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
const random = count => hex(crypto.getRandomValues(new Uint8Array(count)));
export function sessionCookies(headers) {
  const values = (headers.get('cookie') || '').split(';').map(part => part.trim());
  const read = name => { const matches = values.filter(part => part.startsWith(name + '=')); return matches.length === 1 ? matches[0].slice(name.length + 1) : matches.length ? '' : null; };
  return { native: read(SESSION_COOKIE), legacy: read(LEGACY_COOKIE) };
}
export function authCookie(request) {
  const cookies = sessionCookies(request.headers);
  // An invalid or expired native cookie must never silently switch accounts.
  if (cookies.native !== null) return /^[a-f0-9]{64}$/.test(cookies.native) ? SESSION_COOKIE + '=' + cookies.native : null;
  return /^[A-Za-z0-9_-]{20,128}$/.test(cookies.legacy || '') ? LEGACY_COOKIE + '=' + cookies.legacy : null;
}
function cookie(name, value, request, clear = false) {
  return name + '=' + (clear ? '' : value) + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + (clear ? 0 : SESSION_TTL / 1000) + (new URL(request.url).protocol === 'https:' ? '; Secure' : '');
}
function allowed(request) { return request.headers.get('origin') === new URL(request.url).origin && request.headers.get('sec-fetch-site') !== 'cross-site'; }
export async function input(request) {
  if (!allowed(request)) return { response: json({ error: '请求来源无效。' }, 403) };
  if (!request.headers.get('content-type')?.includes('application/json')) return { response: json({ error: '请求格式不正确。' }, 415) };
  if (Number(request.headers.get('content-length') || 0) > 4096) return { response: json({ error: '请求过大。' }, 413) };
  try {
    const text = await request.text();
    if (text.length > 4096) return { response: json({ error: '请求过大。' }, 413) };
    const body = JSON.parse(text);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error();
    return { body };
  } catch { return { response: json({ error: '无法读取账号信息。' }, 400) }; }
}
async function passwordKey(password, salt) {
  const source = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: bytes(salt), iterations: ITERATIONS, hash: 'SHA-256' }, source, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign', 'verify']);
}
export async function passwordRecord(password) {
  const salt = random(16), key = await passwordKey(password, salt);
  return { salt, hash: hex(await crypto.subtle.sign('HMAC', key, PASSWORD_MESSAGE)) };
}
export async function verifyPassword(password, record) {
  // A missing user still performs the same PBKDF2 operation. HMAC verification
  // uses WebCrypto instead of a timing-dependent JavaScript string comparison.
  const salt = record?.password_salt || '0'.repeat(32);
  const hash = record?.password_hash || '0'.repeat(64);
  if (!/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{64}$/.test(hash)) return false;
  return crypto.subtle.verify('HMAC', await passwordKey(password, salt), bytes(hash), PASSWORD_MESSAGE);
}
export async function rateLimit(request, env, action, username) {
  const now = Date.now();
  const ip = request.headers.get('cf-connecting-ip') || 'local';
  const dimensions = action === 'register'
    ? [['register:ip:' + ip, 3600000, 5], ['register:global', 60000, 100]]
    : action === 'register_code'
      ? [['sms:phone-minute:' + username, 60000, 1], ['sms:phone-hour:' + username, 3600000, 5], ['sms:ip:' + ip, 3600000, 10], ['sms:global', 60000, 50]]
      : [['login:ip:' + ip, 900000, 40], ['login:user:' + username.toLowerCase(), 900000, 10], ['login:global', 60000, 500]];
  for (const [scope, window, limit] of dimensions) {
    const start = Math.floor(now / window) * window;
    const id = await digest(scope + ':' + start);
    const result = await env.DB.prepare('INSERT INTO coach_web_auth_attempts (id,attempts,expires_at) VALUES (?,1,?) ON CONFLICT(id) DO UPDATE SET attempts=attempts+1 WHERE attempts<? RETURNING attempts').bind(id, start + window, limit).first();
    if (!result) return json({ error: '操作过于频繁，请稍后再试。' }, 429, { 'Retry-After': String(Math.ceil((start + window - now) / 1000)) });
  }
  return null;
}
function reservedUsername(username, env) {
  const names = ['chengyi01'];
  for (const owner of ((env.COACH_WEB_ADMIN_OWNER_IDS || '') + ',' + (env.COACH_ADMIN_OWNER_IDS || '')).split(',')) {
    if (owner.trim().startsWith('lovetalk:')) names.push(owner.trim().slice('lovetalk:'.length));
  }
  return names.some(name => name.toLowerCase() === username.toLowerCase());
}
async function issueSession(db, userId, now = Date.now()) {
  const token = random(32);
  await db.prepare('INSERT INTO coach_web_sessions (token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)').bind(await digest(token), userId, now + SESSION_TTL, now).run();
  return token;
}
export async function nativeSession(headers, env) {
  const { native } = sessionCookies(headers);
  if (!native || !/^[a-f0-9]{64}$/.test(native) || !env?.DB) return null;
  try {
    const row = await env.DB.prepare('SELECT u.id,u.username FROM coach_web_sessions s JOIN coach_web_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?').bind(await digest(native), Date.now()).first();
    return row ? { ownerId: 'chengzi:' + row.id, openId: null, displayName: row.username } : null;
  } catch { throw new WebIdentityUnavailable(); }
}
function sessionResponse(request, token, username) {
  const headers = new Headers(noStore);
  headers.append('Set-Cookie', cookie(SESSION_COOKIE, token, request));
  headers.append('Set-Cookie', cookie(LEGACY_COOKIE, '', request, true));
  return Response.json({ ok: true, user: username }, { headers });
}
export async function nativeRegister(request, env) {
  const parsed = await input(request); if (parsed.response) return parsed.response;
  const { body } = parsed;
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!/^[A-Za-z][A-Za-z0-9_]{2,29}$/.test(username)) return json({ error: '账号须以字母开头，使用 3–30 位字母、数字或下划线。' }, 400);
  if (password.length < 10 || password.length > 128) return json({ error: '密码须为 10–128 位。' }, 400);
  if (body.agree !== true) return json({ error: '请先同意用户协议与隐私说明。' }, 400);
  try {
    const limited = await rateLimit(request, env, 'register', username); if (limited) return limited;
    if (reservedUsername(username, env)) return json({ error: '该账号不可注册，请更换账号。' }, 409);
    const previous = await env.DB.prepare('SELECT id FROM coach_web_users WHERE username_norm=?').bind(username.toLowerCase()).first();
    if (previous) return json({ error: '该账号已注册，请登录或更换账号。' }, 409);
    const record = await passwordRecord(password), id = crypto.randomUUID(), now = Date.now();
    const inserted = await env.DB.prepare('INSERT INTO coach_web_users (id,username,username_norm,password_salt,password_hash,password_iterations,created_at,last_login_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(username_norm) DO NOTHING').bind(id, username, username.toLowerCase(), record.salt, record.hash, ITERATIONS, now, now).run();
    if (!inserted.meta.changes) return json({ error: '该账号已注册，请登录或更换账号。' }, 409);
    // Creating an account never enables paid features or grants credits.
    return sessionResponse(request, await issueSession(env.DB, id, now), username);
  } catch { return json({ error: '账号暂未建立，请稍后重试。若已注册成功，可直接登录。' }, 503); }
}
export async function nativeLogin(request, env) {
  const parsed = await input(request); if (parsed.response) return parsed.response;
  const { body } = parsed;
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!username || username.length > 100 || /[\x00-\x1f\x7f]/.test(username) || !password || password.length > 128) return json({ error: '请填写有效账号与密码。' }, 400);
  try {
    const limited = await rateLimit(request, env, 'login', username); if (limited) return limited;
    // Explicit compatibility mode can recover an older account with the same
    // visible name as a newly registered native account, without silently changing identity.
    const user = body.accountType === 'existing' ? null : await env.DB.prepare('SELECT id,username,password_salt,password_hash FROM coach_web_users WHERE username_norm=?').bind(username.toLowerCase()).first();
    const verified = await verifyPassword(password, user);
    if (user) {
      if (!verified) return json({ error: '账号或密码不正确。' }, 401);
      const token = await issueSession(env.DB, user.id);
      await env.DB.prepare('UPDATE coach_web_users SET last_login_at=? WHERE id=?').bind(Date.now(), user.id).run();
      return sessionResponse(request, token, user.username);
    }
    // Existing customers may continue signing in with their already-created
    // account. This compatibility path never registers an external account.
    const response = await fetch(AUTH_ORIGIN + '/next/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: AUTH_ORIGIN },
      body: JSON.stringify({ username, password, agree: true }), cache: 'no-store', signal: AbortSignal.timeout(12000), redirect: 'manual',
    });
    const result = await response.json();
    const name = typeof result.user === 'string' ? result.user.trim() : '';
    const token = /(?:^|,\s*)lt_next_session=([A-Za-z0-9_-]{20,128})(?:;|$)/.exec(response.headers.get('set-cookie') || '')?.[1];
    if (!response.ok || result.logged_in !== true || !name || name.length > 100 || /[\x00-\x1f\x7f]/.test(name) || !token) return json({ error: '账号或密码不正确。' }, 401);
    const headers = new Headers(noStore);
    headers.append('Set-Cookie', cookie(LEGACY_COOKIE, token, request));
    headers.append('Set-Cookie', cookie(SESSION_COOKIE, '', request, true));
    return Response.json({ ok: true, user: name }, { headers });
  } catch { return json({ error: '暂时无法登录，请稍后重试。' }, 503); }
}
export async function nativeLogout(request, env) {
  if (!allowed(request)) return json({ error: '请求来源无效。' }, 403);
  const { native, legacy } = sessionCookies(request.headers);
  try { if (native && /^[a-f0-9]{64}$/.test(native)) await env.DB.prepare('DELETE FROM coach_web_sessions WHERE token_hash=?').bind(await digest(native)).run(); }
  catch { return json({ error: '会话暂未退出，请稍后重试。' }, 503); }
  try { if (legacy && /^[A-Za-z0-9_-]{20,128}$/.test(legacy)) await fetch(AUTH_ORIGIN + '/next/api/logout', { method: 'POST', headers: { Cookie: LEGACY_COOKIE + '=' + legacy, Origin: AUTH_ORIGIN }, cache: 'no-store', signal: AbortSignal.timeout(8000), redirect: 'manual' }); } catch { /* Clear a legacy browser session even if its remote logout is unavailable. */ }
  const headers = new Headers(noStore);
  headers.append('Set-Cookie', cookie(SESSION_COOKIE, '', request, true));
  headers.append('Set-Cookie', cookie(LEGACY_COOKIE, '', request, true));
  return Response.json({ ok: true }, { headers });
}
