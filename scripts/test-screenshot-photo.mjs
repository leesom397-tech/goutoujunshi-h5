import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const api={};
new Function('exports',ts.transpileModule(readFileSync('lib/screenshot-photo.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(api);
assert.deepEqual(api.screenshotPhotoClues(null),[]);
assert.deepEqual(api.screenshotPhotoClues([null,{}, {observation:'looks clear'}]),[]);
const clue={location:'第2个图片气泡',observation:'山路和背包',inference:'可能想分享户外体验',alternative:'也可能只是转发风景',verify:'这是你最近去的地方吗？'};
assert.deepEqual(api.screenshotPhotoClues([clue]),[clue]);
assert.equal(api.screenshotPhotoClues([{...clue,alternative:''}])[0].inference,'');
assert.equal(api.screenshotPhotoClues([{...clue,verify:''}])[0].inference,'');
assert.equal(api.screenshotPhotoClues(Array(10).fill(clue)).length,3);
const source=readFileSync('lib/crush/screenshot.ts','utf8');
assert.match(source,/photoClues:ocr.photoClues/);
assert.match(source,/photoClues:screenshotPhotoClues\(raw.photoClues\)/);
assert.ok((source.match(/SCREENSHOT_PHOTO_GUIDANCE/g)||[]).length>=3,'both vision paths include photo rules');
for(const page of ['quick','report']) {
  assert.match(readFileSync(`miniapp/pages/${page}/index.wxml`,'utf8'),/is="photo-clues"/);
  assert.match(readFileSync(`miniapp/pages/${page}/index.wxml`,'utf8'),/count:(?:result|report).photoClueCount/);
}
assert.match(readFileSync('miniapp/templates/photo-clues.wxml','utf8'),/count > 0/,'visibility uses explicit count across template bridge');
assert.match(api.SCREENSHOT_PHOTO_GUIDANCE,/不用于互动评分或档案事实/);
console.log('PASS: visible photo clues stay separate, require located evidence, qualified inference needs alternatives and verification, bounded output and both report bindings');
