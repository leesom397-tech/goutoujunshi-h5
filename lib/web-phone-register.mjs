import { input, rateLimit, verifiedLegacySessionResponse } from './web-native-auth.mjs';
import { ensureCreditAccount } from './account-credits.mjs';
const origin = 'https://ai.lovetalk.love';
const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const phoneOf = body => typeof body.phone === 'string' ? body.phone.trim() : '';
const validPhone = phone => /^1[3-9]\d{9}$/.test(phone);
// Only known public validation errors are exposed. Provider diagnostics and debug codes stay server-side.
function publicError(data, fallback) {
  const value = typeof data?.error === 'string' ? data.error : '';
  if (/注册短信未配置|ALIYUN_SMS_SIGN_NAME|SMS_TEMPLATE_CODE/.test(value)) return '短信服务尚未配置，请联系客服开通账号。';
  return /^(请先获取|请填写正确|验证码错误|验证码已过期|验证码错误次数|验证码已发送|该手机号已注册|这个注册名|注册名需|两次密码不一致|密码须)/.test(value) ? value.slice(0, 160) : fallback;
}
async function upstream(path, body) {
  const response = await fetch(origin + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body), cache: 'no-store', signal: AbortSignal.timeout(15000), redirect: 'manual' });
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = null; }
  if (!data || typeof data !== 'object') console.error('[register_sms] upstream_non_json', response.status, response.headers.get('content-type') || '-');
  return { response, data };
}
export async function sendRegistrationCode(request, env) {
  const parsed = await input(request); if (parsed.response) return parsed.response;
  const phone = phoneOf(parsed.body);
  if (!validPhone(phone)) return json({ error: '请填写正确的 11 位手机号。' }, 400);
  if (parsed.body.agree !== true) return json({ error: '请先阅读并同意数据与使用说明。' }, 400);
  let stage = 'rate_limit';
  try {
    const limited = await rateLimit(request, env, 'register_code', phone); if (limited) return limited;
    stage = 'upstream';
    const { response, data } = await upstream('/next/api/register/send-code', { phone });
    if (!response.ok) console.error('[register_sms] upstream_status', response.status, typeof data?.error === 'string' ? data.error.slice(0, 160) : '-');
    if (!response.ok || data?.ok !== true || data.debug_code) return json({ error: publicError(data, '验证码暂未发送，请稍后重试。') }, response.status === 429 ? 429 : 400);
    return json({ ok: true, message: '验证码已发送，请查看手机短信。', resendSeconds: Math.min(600, Math.max(60, Number(data.resend_seconds) || 60)) });
  } catch (error) {
    console.error('[register_sms] request_failed', stage, error?.name || 'Error', String(error?.message || '').slice(0, 160));
    return json({ error: '短信服务暂时不可用，请稍后重试。' }, 503);
  }
}
export async function phoneRegister(request, env) {
  const parsed = await input(request); if (parsed.response) return parsed.response;
  const body = parsed.body;
  const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
  const phone = phoneOf(body), code = typeof body.code === 'string' ? body.code.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!/^[a-z][a-z0-9_]{2,19}$/.test(username)) return json({ error: '注册名需以字母开头，使用 3–20 位字母、数字或下划线。' }, 400);
  if (!validPhone(phone) || !/^\d{6}$/.test(code)) return json({ error: '请填写正确的手机号和 6 位短信验证码。' }, 400);
  if (password.length < 8 || password.length > 128 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) return json({ error: '密码需为 8–128 位，同时包含字母和数字。' }, 400);
  if (password !== body.password2) return json({ error: '两次密码不一致。' }, 400);
  if (body.agree !== true) return json({ error: '请先阅读并同意数据与使用说明。' }, 400);
  let registered = false;
  try {
    const limited = await rateLimit(request, env, 'register', username); if (limited) return limited;
    const reserved = ['chengyi01', ...((env.COACH_WEB_ADMIN_OWNER_IDS || '') + ',' + (env.COACH_ADMIN_OWNER_IDS || '')).split(',').filter(v => v.trim().startsWith('lovetalk:')).map(v => v.trim().slice(9).toLowerCase())];
    if (reserved.includes(username) || await env.DB.prepare('SELECT id FROM coach_web_users WHERE username_norm=?').bind(username).first()) return json({ error: '该注册名不可使用，请更换或直接登录。' }, 409);
    const { response, data } = await upstream('/next/api/register', { registration_name: username, phone, code, password, password2: password, agree: true });
    if (!response.ok || data?.ok !== true) return json({ error: publicError(data, '注册未完成，请核对信息或稍后重试。') }, response.status === 429 ? 429 : 400);
    registered = true;
    const name = typeof data.username === 'string' ? data.username.trim() : username;
    if (name.toLowerCase() !== username) throw Error('Unexpected registered identity');
    await ensureCreditAccount(env.DB, 'lovetalk:' + name);
    const logged = await upstream('/next/api/login', { username: name, password, agree: true });
    const token = /(?:^|,\s*)lt_next_session=([A-Za-z0-9_-]{20,128})(?:;|$)/.exec(logged.response.headers.get('set-cookie') || '')?.[1];
    if (!logged.response.ok || logged.data?.logged_in !== true || logged.data.user !== name || !token) throw Error('Session unavailable');
    return await verifiedLegacySessionResponse(request, env, { ownerId: 'lovetalk:' + name, displayName: name });
  } catch {
    return registered ? json({ ok: true, registered: true, loginRequired: true, message: '注册成功，请使用注册名和密码登录。' }) : json({ error: '暂时无法确认注册结果，请稍后尝试登录或重试注册。' }, 503);
  }
}
