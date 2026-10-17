// Real Python reader output into the web validator, merge, and coverage code.
// Sources are in-memory synthetic SQLite; no WeChat process, network, or audio.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {buildSync} from 'esbuild';

const collector=path.resolve('desktop/wechat-collector');
const venv=path.join(collector,process.platform==='win32'?'.venv/Scripts/python.exe':'.venv/bin/python');
const python=fs.existsSync(venv)?venv:process.platform==='win32'?'python':'python3';
const fixture=String.raw`
import json
from test_background_reader import Source, REQUEST
from background_reader import capture_from_source

def make(include_voice):
    source = Source()
    shard = source.shard('message_0.db')
    source.add(shard, 1, 101, sequence=1, text='这是前方的合成文字。')
    source.add(shard, 2, 102, mtype=34, sequence=2,
        text='<msg><voicemsg voicelength="6210"/></msg>')
    source.add(shard, 3, 103, mtype=34, sequence=3)
    source.add(shard, 4, 104, sequence=4, text='这是后方的合成文字。')
    source.add_audio(102)
    partials = []
    batch = capture_from_source({**REQUEST, 'includeVoice':include_voice},
        lambda _: None, partials.append, source,
        lambda *_: '这是本机转写的合成语音文字。')
    return {'batch':batch,'partials':partials}
print(json.dumps({'quick':make(False), 'voice':make(True)},ensure_ascii=False))
`;
const payload=JSON.parse(execFileSync(python,['-X','utf8','-c',fixture],{cwd:collector,encoding:'utf8',timeout:15000}));
const bundled=buildSync({stdin:{contents:"export * from './lib/desktop-capture'; export * from './lib/capture-coverage';",resolveDir:process.cwd(),sourcefile:'capture-contract.ts'},bundle:true,write:false,format:'cjs',platform:'node'});
const module={exports:{}};
new Function('module','exports',bundled.outputFiles[0].text)(module,module.exports);
const {validateCaptureBatch,mergeCaptureRecords,captureCoverage}=module.exports;
const batch=validateCaptureBatch(payload.quick.batch);
const namespace={ownerId:'contract-test-owner',account:batch.account,friend:batch.friend,kind:batch.kind};
let merged=mergeCaptureRecords([],batch,namespace);
assert.equal(merged.total,4);
assert.equal(merged.records.find(r=>r.source.mediaKind==='voice').source.durationSeconds,6.21);
const initialIds=merged.records.map(r=>r.localId);
let info=captureCoverage(merged.records);
assert.deepEqual([info.voiceTotal,info.voiceAvailable,info.voiceMissingLocal,info.transcribed],[2,1,1,0]);
for(const partial of payload.voice.partials)merged=mergeCaptureRecords(merged.records,partial,namespace);
merged=mergeCaptureRecords(merged.records,payload.voice.batch,namespace);
assert.equal(merged.total,4);
assert.deepEqual(merged.records.map(r=>r.localId),initialIds);
info=captureCoverage(merged.records);
assert.deepEqual([info.voiceTotal,info.voiceAvailable,info.voiceMissingLocal,info.transcribed],[2,0,1,1]);
const replay=mergeCaptureRecords(merged.records,payload.quick.batch,namespace);
assert.equal(replay.added,0);
assert.equal(captureCoverage(replay.records).transcribed,1);
console.log('PASS Python reader → web validation/merge/coverage: quick, fractional duration, live partial, missing audio, final and fast rescan. Synthetic data only.');
