import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative, sep } from 'node:path';
import { readdir, readFile, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import tailwind from '@tailwindcss/postcss';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const output = resolve(here, '../frontend-dist');
const slash = value => value.split(sep).join('/');
async function files(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('Symlinks are not frontend inputs: ' + entry.name);
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...await files(path));
    else if (entry.isFile()) result.push(path);
  }
  return result;
}
const pages = (await files(resolve(root, 'app'))).filter(path => /[\\/]page\.tsx$/.test(path));
const routes = pages.map(path => '/' + slash(relative(resolve(root, 'app'), dirname(path)))).sort();
if (routes.some(path => /[[\]()]/.test(path))) throw new Error('Dynamic routes need an explicit desktop adapter.');
const inputs = new Set(pages.map(path => slash(relative(root, path))));
const blocked = /(?:^|\/)(?:app\/api|db)(?:\/|$)|(?:^|\/)(?:\.env[^/]*|chatgpt-auth\.[tj]s)$/;
const forbiddenImports = /^(?:node:|server-only$|next\/(?:headers|server)$|(?:fs|child_process|worker_threads|net|tls|http|https)$)/;
await build({
  configFile: false,
  envFile: false,
  envPrefix: 'CHENGZI_DESKTOP_PUBLIC_',
  root: here,
  publicDir: false,
  base: '/',
  plugins: [{
    name: 'desktop-client-boundary', enforce: 'pre',
    resolveId(source) { if (forbiddenImports.test(source)) throw new Error('Server module requested by desktop frontend: ' + source); },
    load(id) {
      const path = slash(relative(root, id.split('?')[0]));
      if (blocked.test(path)) throw new Error('Server source requested by desktop frontend: ' + path);
      if (!path.startsWith('../') && !path.includes('node_modules/') && !path.startsWith('\0') && !id.startsWith('\0')) inputs.add(path);
    },
  }, react()],
  resolve: { alias: [
    { find: /^@\/lib\/desktop-download$/, replacement: resolve(here, 'desktop-download.ts') },
    { find: /^next\/navigation$/, replacement: resolve(here, 'navigation.tsx') },
    { find: /^next\/image$/, replacement: resolve(here, 'next-image.ts') },
    { find: /^next\/link$/, replacement: resolve(here, 'next-link.ts') },
    { find: /^next\/script$/, replacement: resolve(here, 'next-script.ts') },
    { find: '@', replacement: root },
  ], dedupe: ['react', 'react-dom'] },
  css: { postcss: { plugins: [tailwind({ base: root })] } },
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: { outDir: output, emptyOutDir: true, sourcemap: false, target: 'chrome132', chunkSizeWarningLimit: 1200, manifest: true },
});

// Only shipping visual assets enter the app. Downloads, service workers and env
// files must not be copied alongside the local application or its API proxy.
const publicRoot = resolve(root, 'public');
const visuals = (await files(publicRoot)).filter(path => {
  const name = slash(relative(publicRoot, path));
  return /^(?:(?:brand|examples|images|visuals)\/|[^/]+$)/.test(name) && /\.(?:png|jpe?g|webp|avif|gif|svg|ico|woff2?|mp4|webm)$/i.test(name);
});
for (const path of visuals) {
  const target = resolve(output, relative(publicRoot, path));
  await mkdir(dirname(target), { recursive: true }); await copyFile(path, target);
  inputs.add(slash(relative(root, path)));
}
await writeFile(resolve(output, 'routes.json'), JSON.stringify(routes, null, 2) + '\n');
await writeFile(resolve(output, 'route-manifest.json'), JSON.stringify({ schemaVersion: 1, renderer: 'local-react-spa', routes }, null, 2) + '\n');
await writeFile(resolve(output, 'source-inputs.json'), JSON.stringify([...inputs].sort(), null, 2) + '\n');
const sourceDigests={};
for(const name of [...inputs].sort()) sourceDigests[name]=createHash('sha256').update(await readFile(resolve(root,name))).digest('hex');
await writeFile(resolve(output, 'source-integrity.json'), JSON.stringify({schemaVersion:1,files:sourceDigests},null,2)+'\n');
const assets = [];
for (const path of await files(output)) {
  const bytes = await readFile(path);
  assets.push({ path: slash(relative(output, path)), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
await writeFile(resolve(output, 'asset-integrity.json'), JSON.stringify({ schemaVersion: 1, assets }, null, 2) + '\n');
console.log(`Local desktop frontend: ${routes.length} routes, ${assets.length} files, ${assets.reduce((sum, file) => sum + file.bytes, 0)} bytes`);
