'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '../frontend-dist');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const REQUIRED_ROUTES = ['/', '/capture', '/history', '/archive', '/chat', '/account'];

function validateFrontend(root = ROOT) {
  if (!fs.existsSync(path.join(root, 'index.html'))) throw new Error('Build the complete local desktop frontend first (frontend-dist/index.html is missing).');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  if (/<(?:iframe|frame)\b/i.test(html) || /<meta\b[^>]*http-equiv\s*=\s*["']?refresh/i.test(html)) {
    throw new Error('The packaged entry must be the local application, not a remote redirect/frame.');
  }
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)].map(match => match[1]);
  if (!scripts.length || scripts.some(src => /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(src))) {
    throw new Error('The frontend entry must load bundled local JavaScript.');
  }
  const manifestPath = path.join(root, 'route-manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error('The complete local route manifest is required.');
  const routes = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const routeList = Array.isArray(routes) ? routes : routes.routes;
  if (!Array.isArray(routeList)) throw new Error('Invalid local route manifest.');
  const routeNames = routeList.map(route => typeof route === 'string' ? route : route.path);
  for (const route of REQUIRED_ROUTES) {
    if (!routeNames.includes(route)) throw new Error('Missing core local page: ' + route);
  }
  const files = {};
  function visit(directory) {
    for (const name of fs.readdirSync(directory).sort()) {
      const file = path.join(directory, name);
      const relative = path.relative(root, file).split(path.sep).join('/');
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) throw new Error('Linked frontend output is not accepted: ' + relative);
      if (/(^|\/)\.env(?:\.|$)|(^|\/)(?:node_modules|\.git)(?:\/|$)|\.(?:pem|key|p12|pfx|map)$/i.test(relative)) {
        throw new Error('Private/build-only file in frontend output: ' + relative);
      }
      if (stat.isDirectory()) visit(file);
      else if (stat.isFile()) {
        const content = fs.readFileSync(file);
        if (/\.(?:js|json|html|txt)$/i.test(relative) && /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/.test(content.toString('utf8'))) {
          throw new Error('Private key material must not enter frontend assets.');
        }
        files[relative] = { bytes: stat.size, sha256: sha(content) };
      } else throw new Error('Unexpected frontend file: ' + relative);
    }
  }
  visit(root);
  if (!Object.keys(files).some(name => /^assets\/.+\.css$/.test(name))) throw new Error('Bundled frontend styles are missing.');
  for (const src of scripts) {
    const normalized = src.replace(/^\.\//, '').replace(/^\//, '').split(/[?#]/)[0];
    if (!files[normalized] || !/^assets\/.+\.js$/.test(normalized)) throw new Error('Missing bundled frontend entry: ' + normalized);
  }
  return { schema: 1, routeCount: routeNames.length, files };
}

function verifyPackagedFrontend(resources, expected) {
  const asar = require('@electron/asar');
  const archive = path.join(resources, 'app.asar');
  const names = new Set(asar.listPackage(archive).map(name => name.replaceAll('\\', '/').replace(/^\//, '')));
  for (const [file, record] of Object.entries(expected.files)) {
    const name = 'frontend-dist/' + file;
    if (!names.has(name)) throw new Error('Packaged local frontend asset missing: ' + file);
    const bytes = asar.extractFile(archive, name.split('/').join(path.sep));
    if (bytes.length !== record.bytes || sha(bytes) !== record.sha256) throw new Error('Packaged local frontend differs: ' + file);
  }
  for (const name of names) {
    if (name.startsWith('frontend-dist/') && /(?:^|\/)\.env(?:\.|$)|\.(?:pem|key|p12|pfx|map)$/i.test(name)) throw new Error('Unexpected private/build frontend file.');
  }
}

module.exports = { validateFrontend, verifyPackagedFrontend };
if (require.main === module) {
  try { const result = validateFrontend(); console.log(`Verified local frontend: ${result.routeCount} routes, ${Object.keys(result.files).length} assets.`); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
