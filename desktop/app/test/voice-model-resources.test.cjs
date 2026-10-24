'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validateVoiceModel } = require('../scripts/voice-model-resources.cjs');
const pin = require('../../wechat-collector/voice-model-manifest.json');

test('full package input rejects missing, wrong-size and same-size corrupt model', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chengzi-model-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.throws(() => validateVoiceModel('relative-model'), /absolute/);
  assert.throws(() => validateVoiceModel(root), /missing or differs/);
  for (const [name, expected] of Object.entries(pin.files)) {
    const fd = fs.openSync(path.join(root, name), 'w');
    fs.ftruncateSync(fd, expected.bytes); fs.closeSync(fd);
  }
  assert.throws(() => validateVoiceModel(root), /model.int8.onnx/);
});

test('model package pin and Python runtime use identical assets', () => {
  const python = fs.readFileSync(path.resolve(__dirname, '../../wechat-collector/local_voice_transcriber.py'), 'utf8');
  assert.ok(python.includes('MODEL_ID = "' + pin.id + '"'));
  for (const [name, expected] of Object.entries(pin.files)) assert.ok(python.includes(`"${name}": (${expected.bytes}, "${expected.sha256}")`));
});
