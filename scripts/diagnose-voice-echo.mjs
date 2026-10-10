// Read-only diagnostic with synthetic PCM. No microphone, network or user audio.
import { readFileSync } from "node:fs";
const module = {exports:{}};
new Function("module",readFileSync("miniapp/lib/echo-filter.js","utf8"))(module);
const { createEchoFilter } = module.exports;
const samples = Float32Array.from({length:1920},(_,i)=>0.32*Math.sin(i*0.071)+0.17*Math.sin(i*0.133));
const downsampled = Float32Array.from({length:1280},(_,i)=>{
  const position=i*1.5,left=Math.floor(position),fraction=position-left;
  return samples[left]*(1-fraction)+(samples[left+1]||0)*fraction;
});
const pcm = values => {
  const bytes=new ArrayBuffer(values.length*2), view=new DataView(bytes);
  values.forEach((value,index)=>view.setInt16(index*2,Math.round(Math.max(-1,Math.min(1,value))*32767),true));
  return bytes;
};
const whole=createEchoFilter(); whole.addPlayback(samples,0);
const segmented=createEchoFilter();
for(let offset=0;offset<samples.length;offset+=480) segmented.addPlayback(samples.slice(offset,offset+480),offset/24000);
const mixed=downsampled.slice(0,1024);
for(let i=640;i<mixed.length;i++)mixed[i]=0.6*Math.sin(i*0.31); // synthetic independent near-end tail
const source=readFileSync("miniapp/pages/voice/index.js","utf8");
const report={
  scope:"Synthetic PCM only; not acoustic-device validation",
  pureEchoWholeChunkDetected:whole.isEcho(pcm(downsampled.slice(0,1024)),0.08),
  samePureEchoAcross20msChunksDetected:segmented.isEcho(pcm(downsampled.slice(0,1024)),0.08),
  echoPrefixIndependentTailEntireFrameDropped:whole.isEcho(pcm(mixed),0.08),
  recorderDuration180Seconds:/duration:\s*180000/.test(source),
  recorderStopHandlerPresent:/recorder\.onStop(?:\?\.)?\s*\(/.test(source),
  hideEndsCall:/onHide\(\)\s*\{\s*this\.end\(\)/.test(source)
};
console.log(JSON.stringify(report,null,2));
