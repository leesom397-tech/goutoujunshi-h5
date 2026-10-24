'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validateSidecar, verifyPackagedResources, tree } = require('../scripts/stage-resources.cjs');
const { validateFrontend, verifyPackagedFrontend } = require('../scripts/verify-frontend.cjs');

test('explicit builder files preserve setup helper in actual asar and shared package stays production disabled', async t => {
  const appRoot = path.resolve(__dirname, '..');
  const config = require('../electron-builder.cjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chengzi-setup-asar-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  fs.mkdirSync(source);
  assert.ok(config.files.includes('setup.cjs'), 'setup.cjs must be in the explicit production file list');
  for (const file of config.files.filter(file => /^[a-z-]+\.cjs$/.test(file))) fs.copyFileSync(path.join(appRoot, file), path.join(source, file));
  const asar = require('@electron/asar');
  const target = path.join(root, 'app.asar');
  await asar.createPackage(source, target);
  assert.deepEqual(asar.extractFile(target, 'setup.cjs'), fs.readFileSync(path.join(appRoot, 'setup.cjs')));
  assert.match(asar.extractFile(target, 'main.cjs').toString(), /require\('\.\/setup\.cjs'\)/);
  assert.match(asar.extractFile(target, 'collector.cjs').toString(), /require\('\.\/setup\.cjs'\)/);
  const metadata = require('../package.json');
  if (process.env.CHENGZI_EXPECT_EXPERIMENTAL_PACKAGE === '1') {
    assert.equal(metadata.chengziExperimentalMacSetup, true, 'experimental CI package must explicitly enable setup');
  } else {
    assert.equal(Object.hasOwn(metadata, 'chengziExperimentalMacSetup'), false, 'shared production package must keep setup disabled');
  }
});

test('actual asar contains the complete local frontend on Windows and Mac path formats', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chengzi-asar-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  const frontend = path.join(source, 'frontend-dist');
  fs.mkdirSync(path.join(frontend, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(frontend, 'index.html'), '<script src="./assets/app.js"></script>');
  fs.writeFileSync(path.join(frontend, 'route-manifest.json'), JSON.stringify({ routes: ['/', '/capture', '/history', '/archive', '/chat', '/account'] }));
  fs.writeFileSync(path.join(frontend, 'assets/app.js'), 'console.log("synthetic fixture")');
  fs.writeFileSync(path.join(frontend, 'assets/app.css'), 'body{}');
  const manifest = validateFrontend(frontend);
  await require('@electron/asar').createPackage(source, path.join(root, 'app.asar'));
  verifyPackagedFrontend(root, manifest);
  manifest.files['assets/app.js'].sha256 = '0'.repeat(64);
  assert.throws(() => verifyPackagedFrontend(root, manifest), /differs/);
});

test('packaging rejects a remote wrapper or missing local pages', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chengzi-frontend-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.throws(() => validateFrontend(root), /complete local desktop frontend/);
  fs.writeFileSync(path.join(root, 'index.html'), '<iframe src="https://example.com"></iframe>');
  assert.throws(() => validateFrontend(root), /remote redirect\/frame/);
  fs.writeFileSync(path.join(root, 'index.html'), '<script src="https://example.com/app.js"></script>');
  assert.throws(() => validateFrontend(root), /bundled local JavaScript/);
  fs.writeFileSync(path.join(root, 'index.html'), '<script src="/assets/app.js"></script>');
  fs.writeFileSync(path.join(root, 'route-manifest.json'), JSON.stringify({ routes: ['/'] }));
  assert.throws(() => validateFrontend(root), /Missing core local page/);
});

test('local frontend gate excludes secret env files even in a valid app tree', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chengzi-frontend-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'assets'));
  fs.writeFileSync(path.join(root, 'index.html'), '<script src="./assets/app.js"></script>');
  fs.writeFileSync(path.join(root, 'route-manifest.json'), JSON.stringify({ routes: ['/', '/capture', '/history', '/archive', '/chat', '/account'] }));
  fs.writeFileSync(path.join(root, 'assets/app.js'), 'console.log("synthetic fixture")');
  fs.writeFileSync(path.join(root, 'assets/app.css'), 'body{}');
  assert.equal(validateFrontend(root).routeCount, 6);
  fs.writeFileSync(path.join(root, '.env.production'), 'SYNTHETIC_SECRET=not-a-real-key');
  assert.throws(() => validateFrontend(root), /Private\/build-only/);
});

test('packaging rejects a missing or incomplete native service', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chengzi-package-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.throws(() => validateSidecar(root, 'win32'), /missing/);
  // Minimal synthetic PE header, never launched by this test.
  const pe = Buffer.alloc(128);
  pe.write('MZ'); pe.writeUInt32LE(64, 60); pe.writeUInt32LE(0x4550, 64); pe.writeUInt16LE(0x8664, 68);
  fs.writeFileSync(path.join(root, 'ChengziDesktopService.exe'), pe);
  assert.throws(() => validateSidecar(root, 'win32'), /full PyInstaller/);
});

test('final package verification detects dropped or changed sidecar content', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chengzi-package-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const service = path.join(root, 'collector');
  fs.mkdirSync(path.join(service, '_internal'), { recursive: true });
  const pe = Buffer.alloc(128);
  pe.write('MZ'); pe.writeUInt32LE(64, 60); pe.writeUInt32LE(0x4550, 64); pe.writeUInt16LE(0x8664, 68);
  fs.writeFileSync(path.join(service, 'ChengziDesktopService.exe'), pe);
  fs.writeFileSync(path.join(service, '_internal/python312.dll'), 'synthetic runtime');
  fs.writeFileSync(path.join(root, 'service-manifest.json'), JSON.stringify({ schema: 1, platform: 'win32', files: tree(service) }));
  verifyPackagedResources(root, 'win32');
  fs.writeFileSync(path.join(service, '_internal/python312.dll'), 'changed runtime');
  assert.throws(() => verifyPackagedResources(root, 'win32'), /differs/);
});
