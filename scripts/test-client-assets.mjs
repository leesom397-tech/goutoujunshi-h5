import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { verifyClientAssets } from './verify-client-assets.mjs';

await mkdir('.tmp', {recursive:true});
const root = await mkdtemp(resolve('.tmp/asset-manifest-'));
const client = join(root,'dist/client/_next/static'), server = join(root,'dist/server');
await Promise.all([mkdir(join(client,'chunks'),{recursive:true}),mkdir(join(client,'css'),{recursive:true}),mkdir(join(server,'ssr'),{recursive:true})]);
await writeFile(join(client,'chunks/entry.js'),'export {};');
await writeFile(join(client,'css/styles.abc.css'),'body{}');
const create = async deps => {const value={bootstrapScriptContent:'import("/_next/static/chunks/entry.js")',clientReferenceDeps:{one:{js:['/_next/static/chunks/entry.js',...deps],css:['/_next/static/css/styles.abc.css']}}};await Promise.all(['__vite_rsc_assets_manifest.js','ssr/__vite_rsc_assets_manifest.js'].map(file=>writeFile(join(server,file),'export default '+JSON.stringify(value))));};
await create(['/_next/static/chunks/styles-abc.js']);assert.equal((await verifyClientAssets(root)).removed,2);
assert.ok(!(await readFile(join(server,'__vite_rsc_assets_manifest.js'),'utf8')).includes('styles-abc.js'));
assert.equal((await verifyClientAssets(root)).removed,0);
await create(['/_next/static/chunks/missing-component.js']);await assert.rejects(verifyClientAssets(root),/Missing browser code/);
await writeFile(join(client,'chunks/entry.js'),'import "./styles-abc.js";');
await create(['/_next/static/chunks/styles-abc.js']);await assert.rejects(verifyClientAssets(root),/Missing browser code/);
console.log('PASS CSS-only stale preload cleanup, idempotency, missing code failure, imported code failure; synthetic build only.');
