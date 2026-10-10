// Keep TLS verification enabled while avoiding this host's inconsistent
// dns.lookup result for the Cloudflare API and OAuth refresh. Scope: this process.
const dns = require('node:dns');
const originalLookup = dns.lookup;
const cloudflareResolver = new dns.Resolver();
cloudflareResolver.setServers(['8.8.8.8']);

dns.lookup = function lookup(hostname, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  if (!['api.cloudflare.com', 'dash.cloudflare.com'].includes(hostname)) {
    return originalLookup.call(dns, hostname, options, callback);
  }
  return cloudflareResolver.resolve4(hostname, (error, addresses) => {
    if (error) return callback(error);
    if (options && options.all) {
      return callback(null, addresses.map((address) => ({ address, family: 4 })));
    }
    return callback(null, addresses[0], 4);
  });
};
