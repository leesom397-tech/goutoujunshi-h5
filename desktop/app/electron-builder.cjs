'use strict';
const path = require('node:path');
const { stageResources, verifyPackagedResources } = require('./scripts/stage-resources.cjs');
const { validateFrontend, verifyPackagedFrontend } = require('./scripts/verify-frontend.cjs');
const platform = process.platform;
const stage = path.join(__dirname, '.stage', platform);
let frontendManifest;

module.exports = {
  appId: 'love.lovetalk.chengzi.desktop',
  productName: '成子',
  executableName: 'Chengzi',
  asar: true,
  npmRebuild: false,
  publish: null,
  directories: {
    app: __dirname,
    buildResources: path.join(stage, 'brand'),
    output: path.resolve(__dirname, '../../outputs/desktop-app/0.1.0-preview.4'),
  },
  files: ['main.cjs', 'preload.cjs', 'shell-preload.cjs', 'collector.cjs', 'policy.cjs', 'local-app.cjs', 'renderer/**', 'assets/**', 'frontend-dist/**', 'package.json', '!**/.env', '!**/.env.*', '!**/*.pem', '!**/*.key', '!**/*.p12', '!**/*.pfx', '!**/*.map'],
  extraResources: [
    { from: path.join(stage, 'collector'), to: 'collector', filter: ['**/*'] },
    { from: path.join(stage, 'service-manifest.json'), to: 'service-manifest.json' },
  ],
  beforePack: async context => {
    const target = context.electronPlatformName;
    // electron-builder uses numeric Arch values: x64=1, arm64=3.
    if ((target === 'win32' && context.arch !== 1) || (target === 'darwin' && context.arch !== 3)) {
      throw new Error('Only Windows x64 and macOS arm64 preview builds are supported.');
    }
    frontendManifest = validateFrontend();
    stageResources(target);
  },
  afterPack: async context => {
    const resources = context.electronPlatformName === 'darwin'
      ? path.join(context.appOutDir, context.packager.appInfo.productFilename + '.app', 'Contents/Resources')
      : path.join(context.appOutDir, 'resources');
    verifyPackagedResources(resources, context.electronPlatformName);
    verifyPackagedFrontend(resources, frontendManifest);
  },
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: path.join(stage, 'brand/icon.ico'),
    requestedExecutionLevel: 'asInvoker',
    artifactName: 'Chengzi-Desktop-${version}-win-${arch}-Setup.${ext}',
  },
  nsis: {
    oneClick: true,
    perMachine: false,
    allowElevation: false,
    packElevateHelper: false,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: '成子',
    runAfterFinish: false,
    deleteAppDataOnUninstall: false,
  },
  mac: {
    target: [{ target: 'dmg', arch: ['arm64'] }, { target: 'zip', arch: ['arm64'] }],
    icon: path.join(stage, 'brand/icon.png'),
    category: 'public.app-category.lifestyle',
    extendInfo: { NSMicrophoneUsageDescription: '成子使用麦克风进行语音输入和实时咨询。' },
    // Apple Silicon needs a valid local signature; this is not Developer ID.
    identity: '-',
    hardenedRuntime: false,
    notarize: false,
    artifactName: 'Chengzi-Desktop-${version}-mac-${arch}.${ext}',
  },
};
