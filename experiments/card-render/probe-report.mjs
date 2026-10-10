// Fixed fictional input only. Produces an ignored local preview PNG.
import {readFileSync,writeFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import {initWasm,Resvg} from './package/index.mjs';
import {renderReportSvgs} from './report-svg.mjs';

const source=Array.from({length:12},(_,i)=>({
  id:String(i),speaker:i%2?'self':'other',
  text:`第${i+1}句：周末一起去看电影吧？我看到有一部新片，顺便聊聊最近的安排。`,
}));
const annotations=source.map(line=>({
  lineId:line.id,evidence:'sufficient',
  intent:[{label:'提出具体邀约',probability:0.7},{label:'延续话题',probability:0.3}],
  emotion:[{key:'happy',label:'开心',probability:0.6}],
  note:'这句话给出了可执行的线下安排，但不能单凭一句推定长期关系意愿。',
}));
const result={lines:source,annotations,decision:{
  judgment:'对方主动提出一起看电影，已有具体见面意愿；长期态度仍需看后续行动。',
  nextStep:'先把模糊的周末约成具体时间，再观察对方是否落实。',
  replyReview:'你接住了邀约，但还没有确认时间；把下一步落到可执行的安排上。',
  replyGrade:'B',
  replyOptions:[
    {style:'自然推进',text:'周六下午可以，你方便吗？',reason:'直接确认时间，避免邀约悬空。'},
    {style:'轻松调侃',text:'你选片，我负责爆米花？周六怎样？',reason:'保持轻松，也提出时间。'},
    {style:'稳妥边界',text:'这周比较忙，下周日我有空，可以一起看。',reason:'不勉强自己的日程。'},
  ],
  affinityPreview:{value:69,dimensions:[
    {label:'主动延续',value:75},{label:'回应投入',value:68},
    {label:'关心体贴',value:null},{label:'自我开放',value:62},
    {label:'亲密表达',value:null},{label:'实际行动',value:72},
  ]},
}};
const svgs=renderReportSvgs(result);
const allText=svgs.join('').replace(/<[^>]*>/g,'');
if(svgs.length!==4||source.some(row=>!allText.includes(row.text)))throw Error('report paging lost a quote');
const large={...result,lines:Array.from({length:80},(_,i)=>({...source[i%12],id:`long-${i}`,text:`第${i+1}条真实应保留的原文。`}))};
const largeSvg=renderReportSvgs(large).join('').replace(/<[^>]*>/g,'');
if(large.lines.some(row=>!largeSvg.includes(row.text)))throw Error('80-line report lost a quote');
await initWasm(readFileSync(new URL('./package/index_bg.wasm',import.meta.url)));
const font=readFileSync(new URL('./NotoSansCJKsc-Regular.otf',import.meta.url));
const start=performance.now();
const png=new Resvg(svgs[0],{font:{fontBuffers:[font],loadSystemFonts:false}}).render().asPng();
writeFileSync(new URL('./fictional-report.png',import.meta.url),png);
console.log(JSON.stringify({status:'ok',syntheticOnly:true,pages:svgs.length,firstPageHeight:Number(svgs[0].match(/height="(\d+)"/)?.[1]),firstPagePngBytes:png.length,renderMs:Math.round(performance.now()-start),stressLines:large.lines.length,stressPages:renderReportSvgs(large).length}));
