"use client";
import {isStickerPhotoClue} from "@/lib/screenshot-photo";
import { useEffect, useState } from "react";
import { ChartNoAxesCombined, Images, BookOpen, UserRound, ArrowUpRight, MessageCircle, HeartHandshake, Heart, CalendarCheck, CircleHelp, History, ShieldAlert, ShieldCheck, Quote } from "lucide-react";
import { api, type Json } from "./client";
import { CaptureEvidence } from "./CaptureEvidence";
import { profileLabels, reportAffinity, validScore } from "./report-data";
import { interactionDashboard, interactionTrend, type InteractionCue } from './interaction-dashboard';
import styles from "./ReportEvidence.module.css";

export function AffinityRadar({ dimensions }: { dimensions: Json[] }) {
  const icons = [ArrowUpRight, MessageCircle, HeartHandshake, UserRound, Heart, CalendarCheck];
  const items: Json[] = dimensions.slice(0, 6).map(row => ({ ...row, value: row.status !== "insufficient" && validScore(row.value) ? Math.round(row.value) : null }));
  const known = items.filter(row => row.value !== null).length;
  const xy = (index: number, radius: number) => [210 + Math.cos(-Math.PI / 2 + index * Math.PI / 3) * radius, 154 + Math.sin(-Math.PI / 2 + index * Math.PI / 3) * radius];
  return <div className={styles.dimensions}>
    <div className={styles.plot}>
      <div className={styles.plotHeading}><ChartNoAxesCombined size={17}/><span>本轮六维信号</span><small>已知 {known} / 6</small></div>
      {known ? <svg viewBox="0 0 420 326" role="img" aria-label={items.map(row => `${row.label}：${row.value === null ? "待了解" : `${row.value}/100 参考指数`}`).join("；")}>
        {[25, 50, 75, 100].map(level => <polygon key={level} className={styles.grid} points={Array.from({ length: 6 }, (_, index) => xy(index, level).join(",")).join(" ")}/>)}
        {items.map((_, index) => { const edge = xy(index, 100); return <line key={index} className={styles.axis} x1="210" y1="154" x2={edge[0]} y2={edge[1]}/>; })}
        {known === 6 && <polygon className={styles.area} points={items.map((row, index) => xy(index, row.value!).join(",")).join(" ")}/>}
        {items.map((row, index) => { const label = xy(index, 128), point = row.value === null ? null : xy(index, row.value); return <g key={row.key || index}>
          {point && <>{known < 6 && <line className={styles.signalRay} x1="210" y1="154" x2={point[0]} y2={point[1]}/>}<circle className={styles.point} cx={point[0]} cy={point[1]} r="4.5"/></>}
          <text className={styles.axisLabel} x={label[0]} y={label[1] - 5} textAnchor="middle">{row.label}</text><text className={styles.axisValue} data-unknown={row.value === null} x={label[0]} y={label[1] + 15} textAnchor="middle">{row.value === null ? "待了解" : row.value}</text>
        </g>; })}
      </svg> : <div className={styles.empty}><CircleHelp size={30}/><strong>这段材料还不足以给出六维指数</strong><p>已识别原话仍可在「逐句语气」中查看。</p></div>}
      <p className={styles.chartNote}>数值为互动参考指数，非喜欢你的概率。未知项留空。</p>
    </div>
    <div className={styles.dimensionList}>{items.map((row, index) => { const Icon = icons[index] || ChartNoAxesCombined; return <div className={styles.dimension} key={row.key || index}>
      <span className={styles.dimensionIcon}><Icon size={20} aria-hidden="true"/></span><div className={styles.dimensionBody}><div><strong>{row.label}</strong><span className={styles.value} data-unknown={row.value === null}>{row.value === null ? "待了解" : <>{row.value}<small>/100</small></>}</span></div><div className={styles.track} data-unknown={row.value === null} aria-hidden="true"><i style={{ width: `${row.value || 0}%` }}/></div><small>{row.value === null ? "本段缺少可判断的场景" : row.status === "ambiguous" ? "有线索，仍有其他解释" : "有可见互动依据"}</small></div>
    </div>; })}</div>
  </div>;
}

function CueQuote({ cue }: { cue: InteractionCue }) {
  return <div className={styles.cueQuote}>
    {cue.context && <p className={styles.quoteContext}>我：{cue.context}</p>}
    <span><Quote size={14}/>{cue.label} · 对方原话</span><blockquote>{cue.text}</blockquote><CaptureEvidence quote={cue.text}/>
  </div>;
}

function InteractionHistory({ points }: { points: Json[] }) {
  const first=Date.parse(points[0].eventEnd),last=Date.parse(points.at(-1)!.eventEnd);
  const xy=(point:Json)=>[48+(Date.parse(point.eventEnd)-first)/(last-first)*624,142-point.score*1.12];
  return <div className={styles.trendPlot}>
    <svg viewBox="0 0 720 185" role="img" aria-label={points.map(row=>row.eventEnd+'：互动参考指数 '+row.score).join('；')}>
      {[0,50,100].map(value=><g key={value}><line x1="48" x2="672" y1={142-value*1.12} y2={142-value*1.12} className={styles.trendGrid}/><text x="34" y={146-value*1.12} textAnchor="end">{value}</text></g>)}
      <polyline points={points.map(row=>xy(row).join(',')).join(' ')} className={styles.trendLine}/>
      {points.map(row=>{const [x,y]=xy(row);return <g key={row.reportId}><circle cx={x} cy={y} r="5"/><text x={x} y={y-12} textAnchor="middle">{row.score}</text></g>;})}
      <text x="48" y="174" textAnchor="start">{points[0].eventEnd}</text><text x="672" y="174" textAnchor="end">{points.at(-1)!.eventEnd}</text>
    </svg>
    <div className={styles.trendDates}>{points.map(row=><a key={row.reportId} href={'/report?id='+encodeURIComponent(row.reportId)}>{row.eventEnd}<span>{row.score} / 100</span></a>)}</div>
    <p>历史保留原模型的互动参考指数，不是好感概率；数值变化不能说明建议已奏效。</p>
  </div>;
}

export function InteractionEvidence({ report, owner }: { report: Json; owner?: string }) {
  const dashboard=interactionDashboard(report), affinity=reportAffinity(report);
  const dimensions:Json[]=Array.isArray(affinity?.dimensions)?affinity.dimensions.filter((row:Json)=>row&&typeof row.label==='string').slice(0,6):[];
  const scope=[owner,report.subjectId,report.id].join('|');
  const initial={title:'暂不能比较趋势',note:'还没有两段日期明确、去重且可比的独立互动。',delta:null,points:[] as Json[]};
  const [historical,setHistorical]=useState<{scope:string;loading:boolean;trend:ReturnType<typeof interactionTrend>}|null>(null);
  const current=historical?.scope===scope?historical:null,trend=current?.trend||initial;
  useEffect(()=>{
    const controller=new AbortController();
    if(!owner||!report.subjectId||!report.id)return ()=>controller.abort();
    setHistorical({scope,loading:true,trend:initial});
    void (async()=>{
      const account=await api('/api/account/credits',undefined,controller.signal);
      if(controller.signal.aborted||account.account?.userId!==owner)return;
      const profile=await api('/api/web/profile',undefined,controller.signal);
      if(controller.signal.aborted)return;
      if(!profile.enabled||profile.paused||!(profile.subjects||[]).some((person:Json)=>person.id===report.subjectId))return;
      const value=interactionTrend((profile.trends||[]).find((row:Json)=>row.subjectId===report.subjectId)?.points,report.subjectId,report.id);
      setHistorical({scope,loading:false,trend:value});
    })().catch(()=>{if(!controller.signal.aborted)setHistorical({scope,loading:false,trend:{...initial,note:'历史暂未取回，本次的原话与线索仍可查看。'}});}).finally(()=>{if(!controller.signal.aborted)setHistorical(previous=>previous?.scope===scope?{...previous,loading:false}:previous);});
    return ()=>controller.abort();
  },[owner,report.id,report.subjectId,scope]);
  const icons=[ArrowUpRight,MessageCircle,CalendarCheck,ShieldCheck];
  let offset=0;
  return <section className={`wa-card ${styles.section}`} id="signals">
    <h2><HeartHandshake size={23}/>互动仪表</h2>
    <p className={styles.dashboardIntro}>先看四件事：谁主动、怎么回应、有没有具体行动、是否尊重边界。</p>
    {dashboard.priority&&<div className={styles.priority} role="note" aria-label="优先处理的边界或风险"><ShieldAlert size={22}/><div><strong>{dashboard.priority.title}</strong><p>{dashboard.priority.text}</p>{dashboard.priority.evidence&&<blockquote>{dashboard.priority.evidence}</blockquote>}</div></div>}
    <div className={styles.composition}>
      <div className={styles.donut}>
        <svg viewBox="0 0 200 200" role="img" aria-label={dashboard.total?`四类线索构成，共 ${dashboard.total} 次匹配；同一句可匹配多类，不是好感概率`:'本段尚未匹配到可核对的四类线索'}>
          <circle cx="100" cy="100" r="82" className={styles.donutTrack}/>
          {dashboard.dimensions.filter(row=>row.count>0).map(row=>{const share=row.count/dashboard.total*100,start=offset;offset+=share;return <circle key={row.key} cx="100" cy="100" r="82" pathLength="100" stroke={row.color} strokeDasharray={`${share} ${100-share}`} strokeDashoffset={-start} className={styles.donutSegment}/>;})}
        </svg><div><strong>{dashboard.total||'—'}</strong><span>{dashboard.total?'次线索匹配':'暂缺明确线索'}</span></div>
      </div>
      <div className={styles.compositionBody}><h3>{dashboard.summary}</h3><div className={styles.legend}>{dashboard.dimensions.map((row,index)=>{const Icon=icons[index];return <div key={row.key}><span><i style={{background:row.color}}/><Icon size={17}/>{row.label}</span><strong>{dashboard.otherCount?row.count:'—'}<small>{dashboard.otherCount?' 次':''}</small></strong>{dashboard.total>0&&<small>{Math.round(row.count/dashboard.total*100)}%</small>}</div>;})}</div><p>占比按四类线索的总匹配次数计算；同一句可归入多类。包含边界提醒，不能把扇区大小理解为好感程度。</p></div>
    </div>
    <div className={styles.sampleBar} aria-label="本次样本与依据"><span>可读原话 <strong>{dashboard.readableCount}</strong> 句</span><span>其中对方 <strong>{dashboard.otherCount}</strong> 句</span><span>依据把握：<strong>{dashboard.basis}</strong></span></div>
    <div className={styles.fourDimensions}>{dashboard.dimensions.map((row,index)=>{const Icon=icons[index];return <article key={row.key} className={styles.cueCard} data-interaction-dimension={row.key} style={{borderTopColor:row.color}}><header><Icon size={22} style={{color:row.color}}/><h3>{row.label}</h3><strong>{dashboard.otherCount?row.count:'—'}<small>{dashboard.otherCount?' 处':''}</small></strong></header><h4>{row.conclusion}</h4>{row.cues[0]&&<CueQuote cue={row.key==='investment'?(row.cues.find(cue=>cue.kind==='已做自述')||row.cues[0]):row.cues[0]}/>}<p className={styles.cueBasis}>{row.basis}</p></article>;})}</div>
    <details className={styles.referenceDetails}><summary>核对全部匹配原话与原模型参考</summary><div className={styles.allCues}>{dashboard.dimensions.map(row=><section key={row.key}><h3>{row.label} · {row.count} 处</h3>{row.cues.length?row.cues.map((cue,index)=><CueQuote key={cue.id+'-'+index} cue={cue}/>):<p className={styles.chartNote}>本段未见对应场景；不代表对方长期如此。</p>}</section>)}</div>{dimensions.length>0&&<><h3 className={styles.referenceTitle}>原模型六维参考</h3><p className={styles.chartNote}>与上方原话计数分别展示。没有依据的维度保留为空。</p><AffinityRadar dimensions={dimensions}/></>}</details>
    {owner&&report.subjectId&&<div className={styles.history}><History size={20}/><div><strong>{current?.loading?'正在核对历史日期与重复材料…':trend.points.length>=2?trend.title:'暂不能比较趋势'}</strong>{trend.points.length>=2?<><p>{trend.note}</p><InteractionHistory points={trend.points}/></>:<p>{trend.note}</p>}</div></div>}
  </section>;
}

export function ChatPhotoClues({ clues }: { clues?: Json[] }) {
  clues=clues?.filter(clue=>!isStickerPhotoClue(clue));
  if (!clues?.length) return null;
  return <section className="wa-card" id="photos"><h2><Images size={21}/>对话里的照片线索</h2>{clues.map((clue, index) => <div className="wa-insight" key={index}><strong>{clue.location || `照片 ${index + 1}`}</strong>{clue.speaker && <p className="wa-muted">{clue.speaker === "other" ? "对方发送的图片" : clue.speaker === "self" ? "我发送的图片" : "发送者待确认"} · 不代表发送者本人拍摄</p>}<p>看到了：{clue.observation}</p>{clue.inference && <p>可能说明：{clue.inference}</p>}{clue.alternative && <p>也可能：{clue.alternative}</p>}{clue.verify && <p>可以聊聊：{clue.verify}</p>}</div>)}</section>;
}

export function SocialMaterialEvidence({ report }: { report: Json }) {
  return <>{report.photoClues?.length > 0 && <section className="wa-card"><h2><Images size={21}/>照片里的可聊线索</h2>{report.photoClues.map((row: Json, index: number) => <div className="wa-insight" key={index}><span className="wa-pill">{row.category}</span><h3>{row.item}</h3>{row.style && <p>{row.style}</p>}<p className="wa-muted">依据：{row.evidence}</p>{row.valueHint && <p>{row.valueHint}</p>}</div>)}</section>}{(report.profileBasics?.length > 0 || report.profileContext?.length > 0) && <section className="wa-card"><h2><UserRound size={21}/>识别到的基础资料</h2><p className="wa-muted">资料自述与可见线索，归档后仍需你核对。</p><div className="wa-observable-grid">{[...(report.profileBasics || []), ...(report.profileContext || [])].map((row: Json, index: number) => <div key={`${row.field}-${index}`}><small>{profileLabels[row.field] || row.field}</small><strong>{row.value}</strong>{row.evidence && <span>{row.evidence}</span>}</div>)}</div></section>}{report.knowledgeSources?.length > 0 && <section className="wa-card"><h2><BookOpen size={21}/>本次参考的方法</h2><div className="wa-actions">{report.knowledgeSources.map((row: Json, index: number) => <span className="wa-pill" key={row.anchor || index}>{row.label}</span>)}</div><p className="wa-muted">结合本次资料选取的关系主题笔记。</p></section>}</>;
}
