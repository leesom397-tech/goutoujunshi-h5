import { probabilityText, type CrushResult, type Tag } from "@/lib/crush/types";
import {unavailableMedia} from "@/lib/crush/evidence";
function Distribution({title,tags}:{title:string;tags:Tag[]}){
  return <section className="crush-distribution-group"><strong>{title}</strong>{tags.map(tag=><div className="crush-distribution-row" key={tag.key}><span>{tag.label}</span><div className="crush-distribution-track"><i style={{width:Math.round((tag.probability||0)*100)+"%"}}/></div><b>{probabilityText(tag.probability)}</b></div>)}</section>;
}
export function CrushBubbles({result}:{result:CrushResult}) {
  return <div className="crush-bubbles">{result.lines.map(line=>{
    const annotation=result.annotations.find(a=>a.lineId===line.id);
    const insufficient=annotation?.evidence==="insufficient";
    const missing=unavailableMedia(line.text);
    return <article key={line.id} className={"crush-message "+(line.speaker==="self"?"is-self":"is-other")}>
      <div className="crush-speaker">{line.speaker==="self"?"我":"对方"}{line.timestampRaw&&<time>{line.timestampRaw}</time>}</div>
      <div className="crush-bubble">{line.text}</div>
      {annotation&&<div className="crush-annotation">
        {missing?<span className="crush-unsure">{missing==="voice"?"语音正文未读取 · 这不是转写文字":"附件正文未读取"} · 不参与判断</span>:insufficient?<span className="crush-unsure">信息不足 · 暂不判断意图</span>:<>
          <div className="crush-tag-row"><span className="crush-tag-key">语气</span>{annotation.emotion.filter(tag=>tag.probability===undefined||tag.probability>0).slice(0,3).map(tag=><span className="crush-tag emotion" key={tag.key}>{tag.label}<small>{probabilityText(tag.probability)}</small></span>)}</div>
          <div className="crush-tag-row"><span className="crush-tag-key">可能意图</span>{annotation.intent.filter(tag=>tag.probability===undefined||tag.probability>0).slice(0,3).map(tag=><span className="crush-tag" key={tag.key}>{tag.label}<small>{probabilityText(tag.probability)}</small></span>)}</div>
          {(annotation.emotion.some(tag=>tag.probability!==undefined)||annotation.intent.some(tag=>tag.probability!==undefined))&&<details className="crush-distribution"><summary>{result.provider==="jev"?"展开完整情绪与意图分布":"展开本次候选权重"}</summary><p>{result.provider==="jev"?"完整分类分布来自第三方模型；百分比不是情感概率。":"只显示模型实际给出的候选；未列出的类别没有被评估，不能当作 0%。"}</p><Distribution title="情绪" tags={annotation.emotion.filter(tag=>tag.probability!==undefined)}/><Distribution title="沟通意图" tags={annotation.intent.filter(tag=>tag.probability!==undefined)}/></details>}
        </>}
        <p className="crush-note">{annotation.note}</p>
      </div>}
    </article>;
  })}</div>;
}
