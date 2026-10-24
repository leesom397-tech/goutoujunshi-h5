'use strict';
// Build-host inputs only. Never accepts a renderer path or downloads resources.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const pin = require('../../wechat-collector/voice-model-manifest.json');
const COLLECTOR = path.resolve(__dirname, '../../wechat-collector');
const NOTICES = ['LICENSE-sensevoice-model.txt', 'THIRD-PARTY-VOICE-MODEL.md', 'LICENSE-voice-dependencies.txt'];

function sha(file) {
  // A bounded read keeps packaging independent of model size and available RAM.
  const digest = crypto.createHash('sha256'), buffer = Buffer.alloc(1024 * 1024);
  const fd = fs.openSync(file, 'r');
  try { let length; while ((length = fs.readSync(fd, buffer, 0, buffer.length, null))) digest.update(buffer.subarray(0, length)); }
  finally { fs.closeSync(fd); }
  return digest.digest('hex');
}

function validateVoiceModel(directory) {
  if (!path.isAbsolute(directory) || !fs.existsSync(directory) || fs.lstatSync(directory).isSymbolicLink()) throw Error('Select an absolute, unlinked voice model directory.');
  for (const [name, expected] of Object.entries(pin.files)) {
    const file = path.join(directory, name);
    if (!fs.existsSync(file) || !fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink() || fs.statSync(file).size !== expected.bytes || sha(file) !== expected.sha256) {
      throw Error('Pinned voice model is missing or differs: ' + name);
    }
  }
}

function stageVoiceModel(collector, input = process.env.CHENGZI_VOICE_MODEL_DIR || path.join(COLLECTOR, 'build-inputs', pin.id)) {
  validateVoiceModel(input);
  for (const folder of [path.join(collector, 'voice-models'), path.join(collector, 'voice-models', pin.id)]) {
    if (fs.existsSync(folder) && (fs.lstatSync(folder).isSymbolicLink() || !fs.statSync(folder).isDirectory())) throw Error('Refusing linked voice model staging target.');
  }
  const destination = path.join(collector, 'voice-models', pin.id);
  fs.mkdirSync(destination, { recursive: true });
  // Copy only fixed public assets; never recurse into the user's voice/cache tree.
  for (const name of Object.keys(pin.files)) fs.copyFileSync(path.join(input, name), path.join(destination, name));
  for (const name of NOTICES) fs.copyFileSync(path.join(COLLECTOR, name), path.join(destination, name));
  fs.copyFileSync(path.join(COLLECTOR, 'voice-model-manifest.json'), path.join(destination, 'manifest.json'));
  validateVoiceModel(destination);
  return destination;
}

function verifyVoiceModelResources(collector) {
  const directory = path.join(collector, 'voice-models', pin.id);
  for (const folder of [path.join(collector, 'voice-models'), directory]) {
    if (fs.existsSync(folder) && fs.lstatSync(folder).isSymbolicLink()) throw Error('Refusing linked voice model resources.');
  }
  validateVoiceModel(directory);
  for (const name of NOTICES) {
    if (!fs.existsSync(path.join(directory, name)) || sha(path.join(directory, name)) !== sha(path.join(COLLECTOR, name))) throw Error('Voice model notice is missing or differs: ' + name);
  }
  if (sha(path.join(directory, 'manifest.json')) !== sha(path.join(COLLECTOR, 'voice-model-manifest.json'))) throw Error('Voice model pin is missing or differs.');
}
module.exports = { stageVoiceModel, verifyVoiceModelResources, validateVoiceModel };
