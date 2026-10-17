import { readFile, writeFile, readdir, access } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';

const exists = async path => access(path).then(() => true, () => false);
/** Vite 8 can remove a CSS-only JS chunk after RSC records its preload URL. */
export async function verifyClientAssets(root = process.cwd()) {
  const client = resolve(root, 'dist/client'), server = resolve(root, 'dist/server');
  const manifests = [join(server, '__vite_rsc_assets_manifest.js'), join(server, 'ssr/__vite_rsc_assets_manifest.js')];
  const chunks = join(client, '_next/static/chunks');
  const scriptSources = (await Promise.all((await readdir(chunks)).filter(name => name.endsWith('.js')).map(name => readFile(join(chunks, name), 'utf8')))).join('\n');
  let removed = 0;
  for (const file of manifests) {
    const source = await readFile(file, 'utf8');
    const manifest = JSON.parse(source.replace(/^export default\s*/, '').replace(/;\s*$/, ''));
    const groups = [...Object.values(manifest.clientReferenceDeps || {}), ...Object.values(manifest.serverResources || {})];
    const entry = /import\("([^"]+)"\)/.exec(manifest.bootstrapScriptContent)?.[1];
    if (!entry || !await exists(join(client, entry))) throw Error('Browser bootstrap is missing from build output.');
    for (const group of groups) {
      for (const css of group.css || []) if (!await exists(join(client, css))) throw Error('Missing stylesheet: ' + css);
      const retained = [];
      for (const asset of group.js || []) {
        if (await exists(join(client, asset))) { retained.push(asset); continue; }
        const name = basename(asset);
        const isRemovedCssPreload = asset !== group.js[0] && (group.css || []).some(css => name.startsWith(basename(css).split('.')[0] + '-')) && !scriptSources.includes(name);
        if (!isRemovedCssPreload) throw Error('Missing browser code: ' + asset);
        removed++;
      }
      group.js = retained;
    }
    await writeFile(file, 'export default ' + JSON.stringify(manifest, null, 2) + ';\n');
  }
  return { removed, manifests: manifests.length };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await verifyClientAssets();
  console.log(`Browser assets verified; removed ${result.removed} stale CSS-only preload references.`);
}
