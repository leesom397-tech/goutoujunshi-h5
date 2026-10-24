'use strict';

// Build-host inputs only. None of these paths are accepted from a renderer.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { stageVoiceModel, verifyVoiceModelResources } = require('./voice-model-resources.cjs');
const APP = path.resolve(__dirname, '..');
const REPO = path.resolve(APP, '../..');
const COLLECTOR = path.join(REPO, 'desktop/wechat-collector');
const STAGE = path.join(APP, '.stage');

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative);
}
function sha(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function requiredFile(file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile() || fs.statSync(file).size === 0) {
    throw new Error('Required packaged resource missing: ' + file);
  }
}
function tree(root) {
  const canonical = fs.realpathSync(root);
  const entries = {};
  function visit(folder) {
    for (const name of fs.readdirSync(folder).sort()) {
      const file = path.join(folder, name);
      const relative = path.relative(root, file).split(path.sep).join('/');
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) {
        const link = fs.readlinkSync(file);
        if (path.isAbsolute(link) || !inside(canonical, fs.realpathSync(file))) {
          throw new Error('Sidecar contains an external or absolute link: ' + relative);
        }
        entries[relative] = { link };
      } else if (stat.isDirectory()) {
        entries[relative] = { directory: true };
        visit(file);
      } else if (stat.isFile()) {
        entries[relative] = { bytes: stat.size, sha256: sha(file) };
      } else {
        throw new Error('Unsupported sidecar filesystem entry: ' + relative);
      }
    }
  }
  visit(root);
  return entries;
}
function validateSidecar(root, platform) {
  if (platform === 'win32') {
    const executable = path.join(root, 'ChengziDesktopService.exe');
    requiredFile(executable);
    const pe = fs.readFileSync(executable);
    const offset = pe.length >= 64 ? pe.readUInt32LE(60) : -1;
    if (pe.subarray(0, 2).toString() !== 'MZ' || offset < 0 || offset + 6 > pe.length ||
        pe.readUInt32LE(offset) !== 0x4550 || pe.readUInt16LE(offset + 4) !== 0x8664) {
      throw new Error('Expected an x64 Windows service executable.');
    }
    const internal = path.join(root, '_internal');
    if (!fs.existsSync(internal) || !fs.statSync(internal).isDirectory() ||
        !fs.readdirSync(internal).some(name => /^python3\d+\.dll$/i.test(name))) {
      throw new Error('The full PyInstaller onedir, including its Python runtime, is required.');
    }
  } else if (platform === 'darwin') {
    if (process.platform !== 'darwin') throw new Error('Build and verify macOS packages on a native Mac.');
    const bundle = path.join(root, 'ChengziDesktopService.app');
    const executable = path.join(bundle, 'Contents/MacOS/ChengziDesktopService');
    requiredFile(executable);
    const info = path.join(bundle, 'Contents/Info.plist');
    const readPlist = key => execFileSync('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', info], { encoding: 'utf8' }).trim();
    if (readPlist('CFBundleIdentifier') !== 'love.lovetalk.coach.collector.macpreview' ||
        readPlist('CFBundleExecutable') !== 'ChengziDesktopService') {
      throw new Error('The nested service bundle does not match the verified key-provider contract.');
    }
    execFileSync('/usr/bin/lipo', [executable, '-verify_arch', 'arm64']);
    requiredFile(path.join(bundle, 'Contents/Resources/vendor/chatlog-keeper-pin.json'));
    for (const name of ['macos_memory_scan', 'macos_wechat_key_capture.dylib']) {
      const helper = path.join(bundle, 'Contents/Resources/vendor/chatlog_keeper/scripts', name);
      requiredFile(helper);
      execFileSync('/usr/bin/lipo', [helper, '-verify_arch', 'arm64']);
    }
  } else {
    throw new Error('Only Windows x64 and macOS arm64 are supported.');
  }
  return tree(root);
}

function stageResources(platform = process.platform) {
  if (!['win32', 'darwin'].includes(platform)) throw new Error('Unsupported target platform.');
  if (platform !== process.platform) throw new Error('Cross-platform packaging is intentionally disabled.');
  const override = process.env.CHENGZI_DESKTOP_SERVICE_DIR;
  if (override && !path.isAbsolute(override)) throw new Error('CHENGZI_DESKTOP_SERVICE_DIR must be an absolute build-host path.');
  const input = override || path.join(COLLECTOR, 'dist/desktop-service', platform === 'darwin' ? 'ChengziDesktopService.app' : 'ChengziDesktopService');
  if (!fs.existsSync(input)) throw new Error('Build the complete desktop service first: ' + input);
  const source = fs.realpathSync(input);
  if (source === STAGE || inside(STAGE, source)) throw new Error('The input cannot be a staging output.');
  if (platform === 'darwin' && path.basename(source) !== 'ChengziDesktopService.app') throw new Error('Select the entire ChengziDesktopService.app.');
  // Inspect links before copying; preserve only relative links confined to the source tree.
  tree(source);
  const target = path.join(STAGE, platform);
  fs.mkdirSync(STAGE, { recursive: true });
  if (fs.realpathSync(STAGE) !== STAGE) throw new Error('Refusing linked staging directory.');
  if (fs.existsSync(target)) {
    if (fs.lstatSync(target).isSymbolicLink() || !inside(STAGE, fs.realpathSync(target))) throw new Error('Unsafe staging target.');
    fs.rmSync(target, { recursive: true });
  }
  const destination = path.join(target, 'collector');
  fs.mkdirSync(destination, { recursive: true });
  fs.cpSync(source, platform === 'darwin' ? path.join(destination, 'ChengziDesktopService.app') : destination,
    { recursive: true, dereference: false, verbatimSymlinks: true });
  // Weights live beside the signed nested service; do not mutate its bundle.
  // Full desktop packages fail closed if the pinned build input is absent.
  stageVoiceModel(destination);
  const files = validateSidecar(destination, platform);
  const brand = path.join(target, 'brand');
  fs.mkdirSync(brand);
  const logo = path.join(REPO, 'public/brand/chengzi-fluted-chat-v1-512.png');
  const icon = path.join(COLLECTOR, 'chengzi-fluted-chat-v1.ico');
  requiredFile(logo);
  fs.copyFileSync(logo, path.join(brand, 'icon.png'));
  if (platform === 'win32') {
    requiredFile(icon);
    fs.copyFileSync(icon, path.join(brand, 'icon.ico'));
  }
  const manifest = { schema: 1, platform, arch: platform === 'darwin' ? 'arm64' : 'x64', bundledVoiceModel: true, files };
  fs.writeFileSync(path.join(target, 'service-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return { target, manifest };
}

function verifyPackagedResources(resources, platform) {
  const manifest = JSON.parse(fs.readFileSync(path.join(resources, 'service-manifest.json'), 'utf8'));
  if (manifest.schema !== 1 || manifest.platform !== platform) throw new Error('Wrong service manifest.');
  const files = validateSidecar(path.join(resources, 'collector'), platform);
  if (JSON.stringify(files) !== JSON.stringify(manifest.files)) throw new Error('Packaged service is missing or differs from the staged build.');
  if (manifest.bundledVoiceModel === true) verifyVoiceModelResources(path.join(resources, 'collector'));
}

module.exports = { stageResources, validateSidecar, verifyPackagedResources, tree };
if (require.main === module) {
  try {
    const { manifest } = stageResources();
    console.log(`Verified and staged ${manifest.platform}/${manifest.arch} desktop service (${Object.keys(manifest.files).length} entries).`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
