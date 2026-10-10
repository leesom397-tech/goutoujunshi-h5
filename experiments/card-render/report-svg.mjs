// Isolated report-layout experiment: no customer input, storage or network I/O.
// Deliberately not wired into the production WeChat path.
const W=740,LEFT=42,INNER=656,FONT='Noto Sans CJK SC';
const xml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const units=char=>/^[\u0000-\u007f]$/.test(char)?0.57:1;
function wrap(value,max=30){
  const lines=[];
  for(const paragraph of String(value??'').split(/\r?\n/)){
    let current='',width=0;
    for(const char of paragraph){
      const next=units(char);
      if(current&&width+next>max){lines.push(current);current='';width=0;}
      current+=char;width+=next;
    }
    lines.push(current);
  }
  return lines;
}
const rect=(x,y,w,h,fill,rx=0,stroke='none')=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" stroke="${stroke}"/>`;
const text=(x,y,value,size=20,color='#192e38',weight=400)=>`<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${color}">${xml(value)}</text>`;
function lines(x,y,value,{size=20,color='#192e38',weight=400,max=30,gap=1.55}={}){
  const parts=wrap(value,max),step=Math.round(size*gap);
  return {svg:parts.map((part,i)=>text(x,y+i*step,part,size,color,weight)).join(''),height:parts.length*step};
}
function paginate(result){
  const rows=(result.lines||[]).flatMap((line,index)=>{
    const chars=Array.from(String(line.text||'')),chunks=[];
    for(let i=0;i<chars.length;i+=360)chunks.push(chars.slice(i,i+360).join(''));
    return (chunks.length?chunks:['']).map((quote,part)=>({line,index,part,parts:chunks.length||1,quote}));
  });
  if(!rows.length)return [[]];
  const pages=[];
  while(rows.length)pages.push(rows.splice(0,pages.length?4:3));
  return pages;
}
function metric(value){return value==null?'未见场景':`${value}/100`;}
function tagList(values){return (values||[]).filter(v=>v&&v.label&&(v.probability==null||v.probability>0)).slice(0,3).map(v=>`${v.label}${v.probability==null?'':` ${Math.round(v.probability*100)}%`}`).join(' · ');}
export function renderReportSvgs(result){
  const pages=paginate(result);
  return pages.map((rows,pageIndex)=>{
    const shapes=[rect(0,0,W,'__HEIGHT__','#edf1f3'),rect(20,20,700,'__PANEL__','#ffffff',22)];
    let y=74;
    shapes.push(text(LEFT,y,'LoveTalk · 聊天副驾',22,'#126956',600));
    shapes.push(text(630,y,`${pageIndex+1}/${pages.length}`,18,'#526a76'));
    y+=61;
    shapes.push(text(LEFT,y,'看懂原话，再决定怎么回。',31,'#192e38',700));
    y+=45;
    shapes.push(text(LEFT,y,`逐句 ${rows.length} 条 / 全部 ${result.lines.length} 条 · 判断不是读心`,16,'#526a76'));
    y+=34;
    const section=(heading,body,{dark=false,small=false}={})=>{
      if(!body)return;
      const info=lines(LEFT+20,y+64,body,{size:small?17:19,max:small?34:31,color:dark?'#ffffff':'#192e38'});
      const h=78+info.height;
      shapes.push(rect(LEFT,y,INNER,h,dark?'#133c38':'#f7faf9',14));
      shapes.push(text(LEFT+20,y+36,heading,18,dark?'#9bdcc6':'#176755',600));
      shapes.push(info.svg);y+=h+14;
    };
    if(pageIndex===0){
      const d=result.decision||{};
      section('这段互动怎么看',[d.judgment||d.observation,d.nextStep&&`下一步：${d.nextStep}`].filter(Boolean).join('\n'),{dark:true});
      const affinity=result.affinity||d.affinityPreview;
      if(affinity){
        section(`综合互动参考 · ${metric(affinity.value)}`,'当前可见互动的六维信号；不是对方喜欢你的概率。\n'+(affinity.dimensions||[]).map(item=>`${item.label} ${metric(item.value)}`).join(' · '),{small:true});
      }
      section(`你刚才回得怎么样${d.replyGrade?` · ${d.replyGrade} 级`:''}`,d.replyReview,{small:true});
      if(d.replyOptions?.length){
        section('接下来怎么聊 · 三种选择',d.replyOptions.slice(0,3).map((o,i)=>`${i+1}. ${o.style}：「${o.text}」\n   ${o.reason}`).join('\n'),{small:true});
      }
      if(d.unreadText||d.unknownSpeaker)section('未纳入判断',`${d.unreadText||0} 句未读清；${d.unknownSpeaker||0} 句说话人未确认。`,{small:true});
    }
    for(const row of rows){
      const a=(result.annotations||[]).find(item=>item.lineId===row.line.id);
      const valid=a&&a.evidence!=='insufficient';
      const speaker=row.line.speaker==='self'?'我':row.line.speaker==='other'?'对方':'身份未确认';
      const quote=lines(LEFT+20,y+76,row.quote,{size:22,max:27,gap:1.5});
      const intent=valid?tagList(a.intent):'暂无法可靠解读';
      const emotion=valid?tagList(a.emotion.filter(v=>v.key!=='unknown')):'';
      const annotation=lines(LEFT+20,y+76+quote.height+13,`沟通作用：${intent}${emotion?`\n明显语气：${emotion}`:''}`,{size:17,max:34});
      const note=valid&&a.note?lines(LEFT+20,y+76+quote.height+13+annotation.height+9,`这句话代表什么：${a.note}`,{size:17,max:34}):{svg:'',height:0};
      const h=100+quote.height+annotation.height+note.height;
      shapes.push(rect(LEFT,y,INNER,h,row.line.speaker==='self'?'#f1faf5':'#ffffff',14,'#dbe3e7'));
      shapes.push(rect(LEFT,y,6,h,row.line.speaker==='self'?'#4a9a73':'#75aaba',3));
      shapes.push(text(LEFT+20,y+34,`第 ${row.index+1} 句 · ${speaker}${row.parts>1?` · 续 ${row.part+1}/${row.parts}`:''}`,17,'#526a76',600));
      shapes.push(text(LEFT+506,y+34,`证据 ${!valid?0:a.evidence==='limited'?1:2}/2`,16,'#176755'));
      shapes.push(quote.svg,annotation.svg,note.svg);y+=h+14;
    }
    shapes.push(text(LEFT,y+19,'证据评分不是好感分 · 完整档案与追问见 coach.lovetalk.love',15,'#526a76'));
    const height=y+55;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${height}" viewBox="0 0 ${W} ${height}">${shapes.join('').replace('__HEIGHT__',String(height)).replace('__PANEL__',String(height-40))}</svg>`;
  });
}
