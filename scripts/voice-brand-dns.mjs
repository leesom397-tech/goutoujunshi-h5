// Optional preload: node --import ./scripts/voice-brand-dns.mjs ./scripts/configure-brand-voice.mjs ...
// Resolve only this product host when system DNS fails. No HTTP request is retried.
import dns from 'node:dns';
import { Resolver } from 'node:dns/promises';
import { syncBuiltinESMExports } from 'node:module';
const host = 'coach.lovetalk.love';
if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new Error('TLS certificate verification must remain enabled.');

export function createBrandVoiceLookup(systemLookup, resolveAddress) {
  return function lookup(name, options, callback) {
    if (typeof options === 'function') { callback = options; options = {}; }
    const settings = typeof options === 'number' ? { family: options } : options || {};
    return systemLookup(name, options, (error, addresses, family) => {
      if (!error || name !== host || !['ENOTFOUND', 'EAI_AGAIN', 'ETIMEOUT', 'ESERVFAIL'].includes(error.code)) return callback(error, addresses, family);
      // DNS fallback precedes connecting/sending any request, including enrollment.
      const wanted = settings.family === 6 ? 6 : 4;
      Promise.resolve().then(() => resolveAddress(host, wanted)).then(values => {
        if (!values.length) throw new Error('No DNS addresses for the product host.');
        if (settings.all) callback(null, values.map(address => ({ address, family: wanted })));
        else callback(null, values[0], wanted);
      }).catch(() => callback(error));
    });
  };
}
const original = dns.lookup.bind(dns);
const cache = new Map();
const resolver = new Resolver({ timeout: 2000, tries: 1 });
resolver.setServers(['1.1.1.1', '8.8.8.8']);
dns.lookup = createBrandVoiceLookup(original, async (name, family) => {
  let cached = cache.get(family);
  if (!cached || cached.expires <= Date.now()) {
    cached = { promise: family === 6 ? resolver.resolve6(name) : resolver.resolve4(name), expires: Date.now() + 30000 };
    cache.set(family, cached);
  }
  return cached.promise;
});
syncBuiltinESMExports();
