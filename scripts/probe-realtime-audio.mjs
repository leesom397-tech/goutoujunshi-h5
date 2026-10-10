// One authorized <=20s provider call with a local, fixed synthetic greeting.
// Never reads a microphone, contacts a customer, or writes customer accounts.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

if (process.argv[2] !== '--synthetic-greeting-only') throw Error('EXPLICIT_SYNTHETIC_FLAG_REQUIRED');
const require = createRequire(import.meta.url), WebSocket = require('ws');
const keyPath = process.argv[3], wavPath = resolve('outputs/voice-live-synthetic-greeting.wav');
const outputPath = resolve('outputs/voice-live-synthetic-check.json');
if (!keyPath) throw Error('KEY_FILE_REQUIRED');
const bytes = readFileSync(resolve(keyPath));
const source = bytes.toString(bytes.includes(0) ? 'utf16le' : 'utf8').replace(/^\uFEFF/, '');
const fields = new Map(source.trim().split(/\r?\n/).map(line => {
  const comma = line.indexOf(','), unquote = value => value.trim().replace(/^"(.*)"$/s, '$1').replace(/""/g, '"');
  return [unquote(line.slice(0, comma)), unquote(line.slice(comma + 1))];
}));
const apiKey = fields.get('apiKey'), workspace = JSON.parse(readFileSync('wrangler.coach.jsonc', 'utf8')).vars.DASHSCOPE_WORKSPACE_ID;
if (!apiKey || !/^[A-Za-z0-9_.-]{16,200}$/.test(apiKey)) throw Error('KEY_FILE_INVALID');
if (fields.get('workspaceId') && fields.get('workspaceId') !== workspace) throw Error('KEY_WORKSPACE_MISMATCH');
const wav = readFileSync(wavPath);
if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') throw Error('SYNTHETIC_WAVE_REQUIRED');
let pcm;
for (let cursor = 12; cursor + 8 <= wav.length;) {
  const size = wav.readUInt32LE(cursor + 4), label = wav.toString('ascii', cursor, cursor + 4);
  if (label === 'fmt ' && (wav.readUInt16LE(cursor + 8) !== 1 || wav.readUInt16LE(cursor + 10) !== 1 || wav.readUInt32LE(cursor + 12) !== 16000 || wav.readUInt16LE(cursor + 22) !== 16)) throw Error('SYNTHETIC_PCM_FORMAT_REQUIRED');
  if (label === 'data') pcm = wav.subarray(cursor + 8, cursor + 8 + size);
  cursor += 8 + size + size % 2;
}
if (!pcm?.length || pcm.length > 160000) throw Error('SYNTHETIC_GREETING_TOO_LONG');
const audio = Buffer.concat([pcm, Buffer.alloc(32000)]);
const safeCode = value => typeof value === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(value) ? value : 'UNSPECIFIED';
const originalStarted = Date.now();
const result = await new Promise(resolveResult => {
  const socket = new WebSocket(`wss://${workspace}.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime?model=qwen3.5-omni-flash-realtime`, { headers: { Authorization: `Bearer ${apiKey}` }, handshakeTimeout: 10000 });
  let settled = false, uploadTimer, cursor = 0, ready = false, transcriptReceived = false, greetingRecognized = false, responseRequested = false, outputTextLength = 0, outputBytes = 0, nonzeroPcm = false, responseCount = 0;
  const eventTypes = new Set();
  const finish = (status, stage, extra = {}) => {
    if (settled) return; settled = true; clearTimeout(timeout); clearInterval(uploadTimer);
    try { socket.terminate(); } catch {}
    resolveResult({ checkedAt: new Date().toISOString(), status, stage, elapsedMs: Date.now() - originalStarted, syntheticOnly: true, fixture: '你好，请回复你好', inputFormat: 'PCM16LE mono 16000Hz', inputDurationMs: Math.round(pcm.length / 32), outputFormat: 'PCM16LE mono 24000Hz', ready, transcriptReceived, greetingRecognized, responseRequests: responseRequested ? 1 : 0, responseCount, outputTextLength, outputBytes, nonzeroPcm, eventTypes: [...eventTypes], ...extra });
  };
  const timeout = setTimeout(() => finish('FAIL', 'twenty_second_limit'), 20000);
  socket.on('message', data => {
    let packet; try { packet = JSON.parse(String(data)); } catch { return; }
    if (/^[a-z._]{1,80}$/.test(packet.type || '')) eventTypes.add(packet.type);
    if (packet.type === 'session.created') socket.send(JSON.stringify({ type: 'session.update', session: {
      modalities: ['text', 'audio'], voice: 'Ethan', input_audio_format: 'pcm', output_audio_format: 'pcm',
      input_audio_transcription: { model: 'qwen3-asr-flash-realtime' },
      turn_detection: { type: 'semantic_vad', threshold: 0.5, silence_duration_ms: 700, create_response: false, interrupt_response: false },
      instructions: '这是一次合成语音连通性检查。听到用户问候后只说一句“你好”，不要继续提问。',
    } }));
    if (packet.type === 'session.updated' && !ready) {
      ready = true;
      uploadTimer = setInterval(() => {
        if (settled || socket.readyState !== WebSocket.OPEN) return;
        if (cursor >= audio.length) { clearInterval(uploadTimer); return; }
        const chunk = audio.subarray(cursor, cursor + 2560); cursor += chunk.length;
        socket.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: chunk.toString('base64') }));
      }, 80);
    }
    if (packet.type === 'conversation.item.input_audio_transcription.completed') {
      transcriptReceived = !!String(packet.transcript || packet.text || '').trim();
      greetingRecognized = /你好/.test(String(packet.transcript || packet.text || ''));
      if (transcriptReceived && !responseRequested) { responseRequested = true; socket.send(JSON.stringify({ type: 'response.create' })); }
    }
    if (packet.type === 'response.created') responseCount++;
    if (packet.type === 'response.audio_transcript.delta') outputTextLength += String(packet.delta || '').length;
    if (packet.type === 'response.audio.delta' && typeof packet.delta === 'string') {
      const chunk = Buffer.from(packet.delta, 'base64');
      if (!chunk.length || chunk.length % 2) { finish('FAIL', 'invalid_pcm'); return; }
      outputBytes += chunk.length;
      for (let i = 0; i < chunk.length; i += 2) if (chunk.readInt16LE(i) !== 0) { nonzeroPcm = true; break; }
    }
    if (packet.type === 'response.done') finish(transcriptReceived && outputTextLength > 0 && outputBytes > 0 && nonzeroPcm ? 'PASS' : 'FAIL', 'response.done', { responseStatus: safeCode(packet.response?.status) });
    if (packet.type === 'error') finish('FAIL', 'provider_error', { code: safeCode(packet.error?.code) });
  });
  socket.on('unexpected-response', (_request, response) => finish('FAIL', 'http_upgrade', { httpStatus: response.statusCode }));
  socket.on('error', () => finish('FAIL', 'socket_error'));
  socket.on('close', code => finish('FAIL', 'closed', { closeCode: code }));
});
writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
if (result.status !== 'PASS') process.exitCode = 1;
