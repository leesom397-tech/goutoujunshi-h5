import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
let definition;
const scroll=[];
new Function('require','Page','wx',readFileSync('miniapp/pages/archive/index.js','utf8'))(
  ()=>({}), value=>{definition=value;}, {pageScrollTo:value=>scroll.push(value)});
const page={...definition,data:{showSelfEditor:false},setData(value,done){Object.assign(this.data,value);done?.();}};
page.editSelfPreferences();
assert.equal(page.data.showSelfEditor,true);
assert.equal(scroll[0].selector,'#self-preferences-editor');
const template=readFileSync('miniapp/pages/archive/index.wxml','utf8');
assert.match(template,/bindtap="editSelfPreferences"/);
assert.match(template,/id="self-preferences-editor"/);
for(const field of ['preferredAgeRange','distancePreference','preferredRelationship','values','boundaries','goals']) {
  assert.ok(template.includes(`data-field="${field}"`),field+' has an editable control');
}
console.log('PASS: direct preference editor entry opens and scrolls to six editable fields');
