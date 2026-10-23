import { encodeBase64 } from "./client";
export type Microphone = { close: () => Promise<void>; sampleRate: number };
export async function openMicrophone(onPcm: (samples: Int16Array) => void, options: { echoCancellation?: boolean; onEnded?: () => void } = {}): Promise<Microphone> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("当前浏览器无法访问麦克风，请使用 HTTPS 地址与较新版本浏览器。");
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: options.echoCancellation ?? true, noiseSuppression: true, autoGainControl: true } });
  let context: AudioContext | undefined;
  try {
  context = new AudioContext({ sampleRate: 16000 }); await context.resume();
  const audio = context, source = audio.createMediaStreamSource(stream), processor = audio.createScriptProcessor(4096, 1, 1), silence = audio.createGain(); silence.gain.value = 0;
  let stopped = false, carry: number[] = [];
  processor.onaudioprocess = event => {
    if (stopped) return;
    const input = event.inputBuffer.getChannelData(0), rate = audio.sampleRate / 16000;
    carry.push(...input); const length = Math.floor(carry.length / rate), samples = new Int16Array(length);
    for (let i = 0; i < length; i++) { const begin = Math.floor(i * rate), end = Math.min(carry.length, Math.floor((i + 1) * rate)); let sum = 0; for (let index = begin; index < end; index++) sum += carry[index]; const average = Math.max(-1, Math.min(1, sum / Math.max(1, end - begin))); samples[i] = average < 0 ? average * 32768 : average * 32767; }
    carry = carry.slice(Math.floor(length * rate)); if (samples.length) onPcm(samples);
  };
  for (const track of stream.getAudioTracks()) track.onended = () => { if (!stopped) options.onEnded?.(); };
  source.connect(processor); processor.connect(silence); silence.connect(audio.destination);
  return { sampleRate: 16000, async close() { if (stopped) return; stopped = true; processor.onaudioprocess = null; stream.getTracks().forEach(track => { track.onended = null; track.stop(); }); source.disconnect(); processor.disconnect(); silence.disconnect(); if (audio.state !== "closed") await audio.close(); } };
  } catch (error) { stream.getTracks().forEach(track => { track.onended = null; track.stop(); }); if (context && context.state !== "closed") await context.close().catch(() => {}); throw error; }
}
export function pcmBase64(samples: Int16Array) { const bytes = new Uint8Array(samples.length * 2), view = new DataView(bytes.buffer); for (let i = 0; i < samples.length; i++) view.setInt16(i * 2, samples[i], true); return encodeBase64(bytes); }
export function wavBase64(chunks: Int16Array[]) {
  const count = chunks.reduce((sum, chunk) => sum + chunk.length, 0), bytes = new Uint8Array(44 + count * 2), view = new DataView(bytes.buffer);
  const write = (offset: number, value: string) => { for (let index = 0; index < value.length; index++) bytes[offset + index] = value.charCodeAt(index); };
  write(0, "RIFF"); view.setUint32(4, bytes.length - 8, true); write(8, "WAVE"); write(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, "data"); view.setUint32(40, count * 2, true); let offset = 44; for (const chunk of chunks) for (const sample of chunk) { view.setInt16(offset, sample, true); offset += 2; } return encodeBase64(bytes);
}
