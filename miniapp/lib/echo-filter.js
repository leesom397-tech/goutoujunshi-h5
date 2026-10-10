// Best-effort detector for acoustic playback leaking into RecorderManager.
// WebAudio and RecorderManager do not share a hardware AEC reference.
function createEchoFilter() {
  let chunks = [];
  return {
    reset() { chunks = []; },
    addPlayback(samples24k, startAt = 0) {
      if (!samples24k || !samples24k.length) return;
      const samples = new Float32Array(Math.floor(samples24k.length * 2 / 3));
      for (let index = 0; index < samples.length; index++) {
        const source = index * 1.5;
        const left = Math.floor(source);
        const fraction = source - left;
        samples[index] = (samples24k[left] || 0) * (1 - fraction) + (samples24k[left + 1] || 0) * fraction;
      }
      chunks.push({ samples, startAt, endAt: startAt + samples.length / 16000 });
      // Keep queued audio, but bound retained PCM to about 30 seconds.
      while (chunks.length > 1 && chunks[chunks.length - 1].endAt - chunks[0].startAt > 30) chunks.shift();
    },
    stopPlayback(at) {
      chunks = chunks.filter(chunk => chunk.startAt < at).map(chunk => chunk.endAt <= at ? chunk :
        { ...chunk, endAt: at, samples: chunk.samples.slice(0, Math.max(0, Math.floor((at - chunk.startAt) * 16000))) });
    },
    isEcho(frameBuffer, playbackTime = 0) {
      if (!frameBuffer || !Number.isFinite(playbackTime)) return false;
      const mic = new DataView(frameBuffer);
      const length = Math.floor(mic.byteLength / 2);
      if (length < 160 || length > 16000) return false;
      const end = Math.floor(playbackTime * 16000), start = end - length - 19200;
      chunks = chunks.filter(chunk => chunk.endAt * 16000 > start);
      const reference = new Float32Array(end - start), covered = new Uint8Array(end - start);
      // Join references on the playback clock, preserving gaps and excluding
      // not-yet-played samples even when they belong to a partially played chunk.
      for (const chunk of chunks) {
        const chunkStart = Math.round(chunk.startAt * 16000);
        const from = Math.max(start, chunkStart), to = Math.min(end, chunkStart + chunk.samples.length);
        if (from >= to) continue;
        reference.set(chunk.samples.subarray(from - chunkStart, to - chunkStart), from - start);
        covered.fill(1, from - start, to - start);
      }
      const count = Math.ceil(length / 320), windows = [];
      for (let block = 0; block < count; block++) {
        const from = Math.floor(block * length / count), to = Math.floor((block + 1) * length / count);
        let power = 0;
        for (let i = from; i < to; i += 4) { const value = mic.getInt16(i * 2, true) / 32768; power += value * value; }
        windows.push({ from, to, power });
      }
      if (!windows.some(window => window.power >= 0.0001)) return false;
      // All non-silent windows must match at the same delay. An echo prefix
      // must not cause independent near-end speech later in the frame to drop.
      for (let offset = 0; offset + length <= reference.length; offset += 16) {
        let match = true;
        for (const window of windows) {
          if (window.power < 0.0001) continue;
          let dot = 0, power = 0;
          for (let i = window.from; i < window.to; i += 4) {
            if (!covered[offset + i]) { match = false; break; }
            const played = reference[offset + i];
            dot += mic.getInt16(i * 2, true) / 32768 * played;
            power += played * played;
          }
          if (!match || power < 0.0001 || dot <= 0 || dot * dot <= window.power * power * 0.72) { match = false; break; }
        }
        if (match) return true;
      }
      return false;
    }
  };
}

module.exports = { createEchoFilter };
