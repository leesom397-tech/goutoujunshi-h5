const normalize = value => String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
export function createVoiceTurnGuard() {
  let spoken = '', lastPlayback = 0;
  const seen = new Set();
  return {
    output(text, now = Date.now()) { spoken = (spoken + normalize(text)).slice(-1800); lastPlayback = now; },
    playback(now = Date.now()) { lastPlayback = now; },
    accept(itemId, text, now = Date.now()) {
      if (!itemId || seen.has(itemId)) return false;
      seen.add(itemId);
      if (seen.size > 500) seen.delete(seen.values().next().value);
      const input = normalize(text);
      if (!input) return false;
      if (input.length < 4 || now - lastPlayback > 3000 || !spoken) return true;
      if (spoken.includes(input)) return false;
      let matched = 0;
      for (let i = 0; i < input.length - 1; i++) if (spoken.includes(input.slice(i, i + 2))) matched++;
      return matched / (input.length - 1) < 0.78;
    }
  };
}
