function retryPause(signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason || new DOMException('Aborted', 'AbortError')); return; }
    const abort = () => { clearTimeout(timer); reject(signal.reason || new DOMException('Aborted', 'AbortError')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, 250);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

/** Retry a read only when the server explicitly reports transient auth failure. */
export async function fetchWebJson(path, options, fetcher = fetch, readTimeoutMs = 20000) {
  // Bound the complete read (including its one retry), never a paid POST.
  if ((options.method || 'GET') === 'GET') {
    const timeout = AbortSignal.timeout(readTimeoutMs);
    options = { ...options, signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout };
  }
  const read = async () => {
    const response = await fetcher(path, options);
    const data = await response.json().catch(() => ({}));
    return { response, data };
  };
  const first = await read();
  if ((options.method || 'GET') !== 'GET' || first.response.status !== 503 || first.data?.code !== 'AUTH_IDENTITY_UNAVAILABLE') return first;
  await retryPause(options.signal);
  return read();
}
