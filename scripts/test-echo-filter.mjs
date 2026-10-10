import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const module={exports:{}};
new Function('module',readFileSync('miniapp/lib/echo-filter.js','utf8'))(module);
const {createEchoFilter}=module.exports;
const samples=Float32Array.from({length:1920},(_,i)=>.32*Math.sin(i*.071)+.17*Math.sin(i*.133));
const down=Float32Array.from({length:1280},(_,i)=>{const p=i*1.5,l=Math.floor(p);return samples[l]*(1-p+l)+(samples[l+1]||0)*(p-l);});
const pcm=values=>Int16Array.from(values,value=>Math.round(value*32767)).buffer;
const echo=pcm(down.slice(0,1024));
const split=createEchoFilter();
for(let i=0;i<samples.length;i+=480)split.addPlayback(samples.slice(i,i+480),i/24000);
assert.equal(split.isEcho(echo,0),false);
assert.equal(split.isEcho(echo,.08),true,'continuous playback matches across 20 ms chunks');
for(const [from,to] of [[0,320],[320,640],[640,1024]]) {
  const mixed=down.slice(0,1024);
  for(let i=from;i<to;i++)mixed[i]=.6*Math.sin(i*.31);
  assert.equal(split.isEcho(pcm(mixed),.08),false,'independent speech anywhere in a frame must survive');
}
assert.equal(split.isEcho(pcm(new Float32Array(1024)),.08),false);
const stopped=createEchoFilter();stopped.addPlayback(samples,0);stopped.stopPlayback(.08);
assert.equal(stopped.isEcho(echo,.12),true,'played residual echo survives interruption');
assert.equal(stopped.isEcho(echo,2),false,'stale playback is excluded');
const queued=createEchoFilter();queued.addPlayback(samples,1);queued.stopPlayback(.5);
assert.equal(queued.isEcho(echo,1.1),false,'cancelled future audio cannot suppress user speech');
split.reset();assert.equal(split.isEcho(echo,.08),false);
console.log('PASS: cross-chunk echo, past-only reference, mixed-speech protection, silence, interruption residuals, cancellation, expiry and reset');
