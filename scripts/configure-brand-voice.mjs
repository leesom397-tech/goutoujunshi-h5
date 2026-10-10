/** Operator only. Never import this module into the application or publish its outputs. */
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(project, 'outputs', 'voice-brand');
const [action, input] = process.argv.slice(2);
if (!['enroll', 'list', 'preview'].includes(action) || (action !== 'list' && !input)) {
  console.error('Usage: node scripts/configure-brand-voice.mjs enroll <prepared-24k-mono-pcm16.wav> | list [reference-sha256] | preview <voice-id>');
  process.exit(2);
}
const endpoint = new URL(process.env.VOICE_BRAND_OPERATOR_URL || 'https://coach.lovetalk.love/api/wechat/process');
if (!((endpoint.protocol === 'https:' && endpoint.hostname === 'coach.lovetalk.love') || (endpoint.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(endpoint.hostname))) || endpoint.username || endpoint.password || endpoint.pathname !== '/api/wechat/process') throw new Error('Operator endpoint is not allowlisted.');
try { execFileSync('git', ['check-ignore', '--quiet', 'outputs/voice-brand/operator-cache.json'], { cwd: project, stdio: 'ignore' }); }
catch { throw new Error('Private outputs must be ignored by git before running this operator tool.'); }
mkdirSync(output, { recursive: true, mode: 0o700 });

function saveJson(path, data) {
  const temporary = path + '.tmp';
  writeFileSync(temporary, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  renameSync(temporary, path);
}
function configuration() {
  const html = readFileSync(join(project, 'outputs', 'wechat-callback-private.html'), 'utf8');
  const embedded = html.match(/<script[^>]*id=["']setup-data["'][^>]*>([\s\S]*?)<\/script>/);
  if (!embedded) throw new Error('Existing private operator setup data is missing.');
  const config = JSON.parse(embedded[1]);
  if (typeof config.WECHAT_CALLBACK_TOKEN !== 'string' || !config.WECHAT_CALLBACK_TOKEN) throw new Error('Existing operator token is unavailable.');
  return config.WECHAT_CALLBACK_TOKEN;
}
async function request(payload) {
  let response;
  try {
    response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Wechat-Queue-Token': configuration() }, body: JSON.stringify({ kind: 'voice-brand-operator', ...payload }), signal: AbortSignal.timeout(40000) });
  } catch { throw new Error('Operator request did not finish. Keep the local cache; recover with list instead of creating again.'); }
  const result = await response.json().catch(() => null);
  if (!result || typeof result.status !== 'string') throw new Error(`Operator returned an unreadable response (HTTP ${response.status}).`);
  if (!response.ok) throw new Error(`Operator rejected request: ${result.status} (HTTP ${response.status}).`);
  return result;
}
function printable(result) {
  return Object.fromEntries(Object.entries(result).filter(([key]) => !['pcmBase64', 'audioBase64', 'transcript'].includes(key)));
}

try {
  if (action === 'list') {
    if (input && !/^[a-f0-9]{64}$/.test(input)) throw new Error('Reference SHA must be 64 lowercase hex characters.');
    const result = await request({ action, ...(input ? { sha: input } : {}) });
    if (input && result.status === 'ready') saveJson(join(output, `${input}.json`), { ...result, updatedAt: new Date().toISOString() });
    console.log(JSON.stringify(printable(result), null, 2));
  } else if (action === 'enroll') {
    const reference = resolve(input);
    const wav = readFileSync(reference);
    if (wav.length > 4 * 1024 * 1024 || wav.length < 44 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Reference must be a prepared PCM WAV file no larger than 4 MiB. The server also validates 24 kHz, mono, PCM16 and duration.');
    const sha = createHash('sha256').update(wav).digest('hex');
    const cachePath = join(output, `${sha}.json`);
    const cached = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : null;
    if (cached?.status === 'ready' && cached.voice) {
      console.log(JSON.stringify({ ...printable(cached), reusedLocalCache: true }, null, 2));
    } else {
      // Persist before sending; an interrupted client can only recover the receipt.
      if (!cached) saveJson(cachePath, { status: 'enrollment_pending', sha, startedAt: new Date().toISOString() });
      const result = await request(cached ? { action: 'list', sha } : { action: 'enroll', authorized: true, audioBase64: wav.toString('base64') });
      saveJson(cachePath, { ...result, sha, updatedAt: new Date().toISOString() });
      console.log(JSON.stringify(printable(result), null, 2));
      if (result.status !== 'ready') process.exitCode = 3;
    }
  } else {
    if (!/^[A-Za-z0-9_.-]{1,200}$/.test(input)) throw new Error('Invalid voice ID.');
    const result = await request({ action: 'preview', voice: input });
    if (result.status !== 'ready' || result.sampleRate !== 24000 || result.channels !== 1 || result.bitsPerSample !== 16 || typeof result.pcmBase64 !== 'string') throw new Error('Preview audio format was not the expected PCM format.');
    const pcm = Buffer.from(result.pcmBase64, 'base64');
    if (!pcm.length || pcm.length % 2 || pcm.length > 960000) throw new Error('Preview exceeded the 20 second audio limit.');
    const header = Buffer.alloc(44);
    header.write('RIFF', 0); header.writeUInt32LE(pcm.length + 36, 4); header.write('WAVEfmt ', 8); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(24000, 24); header.writeUInt32LE(48000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
    const filename = `preview-${input}-${Date.now()}`;
    const path = join(output, `${filename}.wav`);
    writeFileSync(path, Buffer.concat([header, pcm]), { mode: 0o600, flag: 'wx' });
    saveJson(join(output, `${filename}.json`), { ...printable(result), transcript: result.transcript, createdAt: new Date().toISOString() });
    console.log(JSON.stringify({ ...printable(result), privateAudioPath: path }, null, 2));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Operator command failed.');
  process.exitCode = 1;
}
