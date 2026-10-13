"use client";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { ArrowDown, ArrowRight, ArrowUp, ArrowUpDown, Camera, Check, Crop, Film, LoaderCircle, RotateCcw, Scissors, ShieldCheck, Square, Trash2, UploadCloud, X } from "lucide-react";
import { FULL_CROP, cropPixels, normalizeCrop, type CropRegion } from "@/lib/screen-capture";
import { extractVideoFrames, formatVideoTime, loadVideoMetadata, seekVideoFrame, validateVideoFile, validateVideoRange, videoFileId, type ImportedVideoFrame, type VideoImportContext, type VideoExtraction, type VideoImportProgress } from "@/lib/video-import";
import styles from "./VideoImport.module.css";
export type { ImportedVideoFrame, VideoImportContext } from "@/lib/video-import";

export function VideoImport({ disabled = false, sessionKey = "", onReady }: { disabled?: boolean; sessionKey?: string; onReady: (frames: ImportedVideoFrame[], context: VideoImportContext) => Promise<void> }) {
  const video = useRef<HTMLVideoElement>(null), fileInput = useRef<HTMLInputElement>(null), url = useRef(""), controller = useRef<AbortController | null>(null), generation = useRef(0), mounted = useRef(false), session = useRef(sessionKey), currentSession = useRef(sessionKey), disabledRef = useRef(disabled), pointerStart = useRef<{x:number;y:number}|null>(null);
  currentSession.current = sessionKey; disabledRef.current = disabled;
  const [file, setFile] = useState<File | null>(null), [meta, setMeta] = useState<{duration:number;width:number;height:number;videoId:string}|null>(null), [loading,setLoading] = useState(false), [processing,setProcessing] = useState(false), [saving,setSaving] = useState(false), [saved,setSaved] = useState(false), [start,setStart] = useState(0), [end,setEnd] = useState(0), [playhead,setPlayhead] = useState(0), [crop,setCrop] = useState<CropRegion>(FULL_CROP), [frames,setFrames] = useState<ImportedVideoFrame[]>([]), [result,setResult] = useState<VideoExtraction|null>(null), [progress,setProgress] = useState<VideoImportProgress|null>(null), [error,setError] = useState(""), [note,setNote] = useState(""), [large,setLarge] = useState<ImportedVideoFrame|null>(null);
  const locked = disabled || loading || processing || saving;
  function cancelOperation() { generation.current++; controller.current?.abort(); controller.current = null; video.current?.pause(); }
  function release() { cancelOperation(); if (video.current) { video.current.removeAttribute("src"); video.current.load(); } if (url.current) URL.revokeObjectURL(url.current); url.current = ""; }
  function reset() { release(); setFile(null); setMeta(null); setFrames([]); setResult(null); setProgress(null); setError(""); setNote(""); setLarge(null); setCrop(FULL_CROP); setLoading(false); setProcessing(false); setSaving(false); setSaved(false); setStart(0); setEnd(0); setPlayhead(0); if (fileInput.current) fileInput.current.value = ""; }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; release(); }; }, []);
  useEffect(() => { if (session.current !== sessionKey) { session.current = sessionKey; reset(); } }, [sessionKey]);
  useEffect(() => { if (disabled) { cancelOperation(); setLoading(false); setProcessing(false); } }, [disabled]);
  const valid = (ticket: number, scope: string) => mounted.current && ticket === generation.current && currentSession.current === scope && !disabledRef.current;
  async function choose(next: File) {
    if (locked) return; reset();
    try { validateVideoFile(next); } catch (e) { setError(e instanceof Error ? e.message : "无法读取文件。"); return; }
    const player = video.current; if (!player) return;
    const abort = new AbortController(), ticket = generation.current, scope = currentSession.current; controller.current = abort;
    setLoading(true); setFile(next); url.current = URL.createObjectURL(next); player.src = url.current;
    try { const info = await loadVideoMetadata(player, abort.signal), videoId = await videoFileId(next, info.duration); if (!valid(ticket, scope)) return; setMeta({...info,videoId}); setEnd(Math.min(90,info.duration)); setNote("视频已在本机打开。先选时间段，再框选要分析的区域。"); }
    catch(e) { if (valid(ticket,scope)) { setError(e instanceof Error ? e.message : "无法读取录屏，请换用 MP4（H.264）或截图。"); release(); setMeta(null); } }
    finally { if (mounted.current && currentSession.current === scope && (ticket === generation.current || !controller.current)) setLoading(false); }
  }
  function clearFrames() { setFrames([]); setResult(null); setProgress(null); setNote(""); setSaved(false); }
  function range(which: "start"|"end", value: number) { if (!meta || locked) return; const n = Math.max(0,Math.min(meta.duration,Number.isFinite(value)?value:0)); which === "start" ? setStart(n) : setEnd(n); clearFrames(); }
  async function preview(time: number) { if (locked || !video.current || !meta) return; cancelOperation(); const abort = new AbortController(), ticket = generation.current, scope = currentSession.current; controller.current = abort; setPlayhead(time); try { await seekVideoFrame(video.current,time,abort.signal); } catch(e) { if(valid(ticket,scope))setError(e instanceof Error?e.message:"无法预览这一帧。"); } }
  function pointer(event: PointerEvent<HTMLDivElement>) { const box = event.currentTarget.getBoundingClientRect(); return { x:(event.clientX-box.left)/box.width, y:(event.clientY-box.top)/box.height }; }
  async function extract() {
    if(locked || !meta || !video.current) return;
    try { validateVideoRange(start,end,meta.duration); cropPixels(meta.width,meta.height,crop); } catch(e) { setError(e instanceof Error?e.message:"请核对时间与裁剪范围。"); return; }
    cancelOperation(); const abort = new AbortController(), ticket = generation.current, scope = currentSession.current; controller.current=abort;
    setProcessing(true); setError(""); setNote(""); clearFrames();
    try { const output = await extractVideoFrames(video.current,{start,end,crop,signal:abort.signal,onProgress:value=>{if(valid(ticket,scope)){setProgress(value);setPlayhead(value.time);}}}); if(!valid(ticket,scope))return; setFrames(output.frames);setResult(output);setPlayhead(output.lastTime); if(!output.frames.length) setError("没有找到足够稳定的清晰画面。请重新录屏，慢慢滑动，并在每屏停顿 1–2 秒；也可以直接上传截图。"); else setNote(output.limited ? `本批处理到 ${formatVideoTime(output.lastTime)}，已达到截图数量或大小上限。后面的内容请分段提取。` : `已检查所选时间段，提取 ${output.frames.length} 张截图。请放大检查文字，再确认顺序。`); }
    catch(e) { if(valid(ticket,scope))setError(e instanceof Error?e.message:"提取未完成，请换用更短的录屏或截图。"); }
    finally { if(valid(ticket,scope)){setProcessing(false);controller.current=null;} }
  }
  function cancel() { if(loading){reset();setNote("已取消读取录屏，可以重新选择文件。");return;} cancelOperation(); setLoading(false);setProcessing(false);setProgress(null);setNote("已取消提取。视频仍留在本机，可以缩短时间段后重新开始。"); }
  function move(index:number,offset:number){setFrames(items=>{const copy=[...items], target=index+offset;if(target<0||target>=copy.length)return items;[copy[index],copy[target]]=[copy[target],copy[index]];return copy;});}
  async function done(){if(locked||!file||!meta||!result||!frames.length)return;const scope=currentSession.current;setSaving(true);setError("");try{await onReady([...frames],{videoId:meta.videoId,fileName:file.name,duration:meta.duration,start,end:result.lastTime,processedUntil:result.lastTime});if(mounted.current&&currentSession.current===scope)setSaved(true);}catch(e){if(mounted.current&&currentSession.current===scope)setError(e instanceof Error?e.message:"截图暂未保存，请重试。");}finally{if(mounted.current&&currentSession.current===scope)setSaving(false);}}
  return <section className={styles.panel} aria-label="手机录屏导入" data-video-import>
    <header className={styles.heading}><span><Film size={24}/></span><div><h2>导入手机录屏</h2><p>iPhone / Android · 本机提取截图</p></div></header>
    <p className={styles.intro}>打开聊天或朋友圈录屏，慢慢滑动，在每屏停顿 1–2 秒。选择录屏后，在这里提取清晰截图。</p>
    <input ref={fileInput} type="file" accept="video/*,.mp4,.mov,.m4v,.webm" className={styles.fileInput} aria-label="选择手机录屏文件" disabled={locked} onChange={event=>{const next=event.currentTarget.files?.[0];if(next)void choose(next);event.currentTarget.value="";}}/>
    <button className={styles.upload} disabled={locked} onClick={()=>fileInput.current?.click()}><UploadCloud size={31}/><strong>{file ? "重新选择录屏" : "选择手机录屏"}</strong><span>最大 200 MB · 5 分钟以内 · 每次处理最多 90 秒</span></button>
    <p className={styles.privacy}><ShieldCheck size={18}/>原视频不上传，也不读取音频。确认截图后才进入分析。</p>
    {file && <div className={styles.fileInfo}><Film size={18}/><span>{file.name}</span>{meta && <strong>{formatVideoTime(meta.duration)}</strong>}</div>}
    {loading && <div role="status" className={styles.loading}><p className={styles.status}><LoaderCircle size={18} className={styles.spin}/>正在本机读取录屏…</p><button className={styles.secondary} onClick={cancel}><Square size={16}/>取消读取</button></div>}
    <div className={styles.editor} hidden={!meta}>
      <div className={styles.sectionTitle}><Scissors size={20}/><h3>1. 选择时间与画面</h3></div>
      <div className={styles.range}><label>开始（秒）<input type="number" min={0} max={meta?.duration||0} step={.1} value={Number(start.toFixed(2))} disabled={locked} onChange={event=>range("start",Number(event.target.value))}/></label><span>至</span><label>结束（秒）<input type="number" min={0} max={meta?.duration||0} step={.1} value={Number(end.toFixed(2))} disabled={locked} onChange={event=>range("end",Number(event.target.value))}/></label></div>
      <p className={styles.hint}>选中 {Math.max(0,end-start).toFixed(1)} 秒。每批最多 9 张截图，较长录屏请分段处理。</p>
      <div className={styles.videoWrap} style={meta?{aspectRatio:`${meta.width}/${meta.height}`,maxWidth:`${Math.min(620,480*meta.width/meta.height)}px`}:undefined} onPointerDown={event=>{if(locked||!meta||event.button!==0)return;pointerStart.current=pointer(event);event.currentTarget.setPointerCapture(event.pointerId);}} onPointerMove={event=>{if(pointerStart.current&&!locked)setCrop(normalizeCrop(pointerStart.current,pointer(event)));}} onPointerUp={event=>{if(!pointerStart.current||locked||!meta)return;const next=normalizeCrop(pointerStart.current,pointer(event));pointerStart.current=null;try{cropPixels(meta.width,meta.height,next);setCrop(next);clearFrames();setError("");}catch{setCrop(FULL_CROP);clearFrames();setError("框选范围太小，请至少保留一整条清晰消息。");}}} onPointerCancel={()=>{pointerStart.current=null;setCrop(FULL_CROP);clearFrames();}}>
        <video ref={video} muted playsInline preload="auto" aria-label="录屏本机预览"/>
        {meta&&<div className={styles.selection} style={{left:`${crop.x*100}%`,top:`${crop.y*100}%`,width:`${crop.width*100}%`,height:`${crop.height*100}%`}}/>}
      </div>
      <label className={styles.scrub}>预览位置 {formatVideoTime(playhead)}<input type="range" min={0} max={meta?.duration||0} step={.1} value={playhead} disabled={locked} onChange={event=>void preview(Number(event.target.value))}/></label>
      <p className={styles.cropHint}><Crop size={18}/>在画面上拖动，框选聊天或动态区域。<button className={styles.textButton} disabled={locked} onClick={()=>{setCrop(FULL_CROP);clearFrames();}}><RotateCcw size={16}/>恢复全图</button></p>
      {processing ? <div className={styles.processing} role="status"><div><LoaderCircle className={styles.spin} size={19}/><strong>正在提取 · {progress?.frames||0} / 9 张</strong></div><progress value={progress?.inspected||0} max={progress?.total||180}/><p>已检查到 {formatVideoTime(progress?.time||start)} / {formatVideoTime(end)}</p><button className={styles.secondary} onClick={cancel}><Square size={16}/>取消提取</button></div> : <button className={styles.primary} disabled={locked} onClick={()=>void extract()}><Camera size={19}/>提取这一段的截图</button>}
    </div>
    {error&&<p className={styles.error} role="alert">{error}</p>}
    {note&&<p className={styles.notice} role="status">{note}</p>}
    {result&&<p className={styles.hint}>跳过重复画面 {result.duplicates} 次、滑动中的画面 {result.moving} 次、黑屏 {result.blank} 次。这是画面核对，不代表消息已经全部去重。{result.moving>0&&"快速滑动可能遗漏内容，请检查并补充截图。"}</p>}
    {frames.length>0&&<div className={styles.results}>
      <div className={styles.resultHead}><div className={styles.sectionTitle}><Check size={20}/><h3>2. 检查这 {frames.length} 张截图</h3></div><button className={styles.secondary} disabled={locked} onClick={()=>setFrames(items=>[...items].reverse())}><ArrowUpDown size={17}/>倒序排列</button></div>
      <p className={styles.hint}>点图片放大，确认文字清晰完整；自动提取不能保证文字都可读。聊天请按「最早 → 最新」排列；往上翻录屏后，通常需要倒序。时间标签是录屏位置。</p>
      <div className={styles.frames}>{frames.map((frame,index)=><article key={frame.id}><button className={styles.thumbnail} onClick={()=>setLarge(frame)} aria-label={`放大第 ${index+1} 张截图`}><img src={`data:image/jpeg;base64,${frame.data}`} alt={`录屏 ${formatVideoTime(frame.videoTime)} 的截图`}/></button><div className={styles.frameLabel}><strong>第 {index+1} 张</strong><span>{formatVideoTime(frame.videoTime)}</span></div><div className={styles.frameButtons}><button disabled={locked||index===0} aria-label={`前移第 ${index+1} 张`} onClick={()=>move(index,-1)}><ArrowUp size={17}/></button><button disabled={locked||index===frames.length-1} aria-label={`后移第 ${index+1} 张`} onClick={()=>move(index,1)}><ArrowDown size={17}/></button><button disabled={locked} aria-label={`删除第 ${index+1} 张`} onClick={()=>setFrames(items=>items.filter(item=>item.id!==frame.id))}><Trash2 size={17}/></button></div></article>)}</div>
      <button className={styles.primary} disabled={locked} onClick={()=>void done()}>{saving?<><LoaderCircle className={styles.spin} size={18}/>正在保存截图…</>:<>确认截图，进入分析<ArrowRight size={18}/></>}</button>
      {result?.limited&&<button className={styles.nextRange} disabled={locked||!saved} onClick={()=>{setStart(Math.max(start,result.lastTime-.2));setEnd(Math.min(meta?.duration||end,result.lastTime+90-.2));clearFrames();setNote("已切换到后续时间段，上一批截图已保存在本机原文中。");}}>{saved?"继续后续时间段（本批已保存）":"先保存本批截图，再继续后续时间段"}</button>}
    </div>}
    {large&&<div className={styles.modal} role="dialog" aria-modal="true" aria-label="录屏截图预览" onClick={()=>setLarge(null)}><button aria-label="关闭截图预览" onClick={()=>setLarge(null)}><X size={24}/></button><img src={`data:image/jpeg;base64,${large.data}`} alt="录屏截图完整画面" onClick={event=>event.stopPropagation()}/></div>}
  </section>;
}



