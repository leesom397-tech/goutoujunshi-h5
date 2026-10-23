"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus } from "lucide-react";
import { archiveRequest } from "@/app/archive/types";
import styles from "@/app/archive/archive.module.css";

type Candidate = { imageIndex: number; x: number; y: number; width: number; height: number };
const noSources: File[] = [];
const noCandidates: Candidate[] = [];
export function ArchiveAvatar({ subjectId, name, disabled, onSaved, sources = noSources, candidates = noCandidates, expanded = false }: { subjectId?: string; name: string; disabled: boolean; onSaved: () => Promise<void>; sources?: File[]; candidates?: Candidate[]; expanded?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const image = useRef<HTMLImageElement | null>(null);
  const [source, setSource] = useState<File | null>(null);
  const [position, setPosition] = useState({ x: 50, y: 50, size: 100 });
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [choices, setChoices] = useState<{ file: File; crop: Candidate; preview: string }[]>([]);
  const [candidateCrop, setCandidateCrop] = useState<Candidate | null>(null);
  const [sourcePreviews,setSourcePreviews]=useState<string[]>([]);
  useEffect(()=>{const urls=sources.map(file=>URL.createObjectURL(file));setSourcePreviews(urls);return()=>urls.forEach(url=>URL.revokeObjectURL(url));},[sources]);
  // Stabilize detector output because callers may compute candidate arrays inline.
  const candidateSignature = JSON.stringify(candidates.slice(0, 6));
  useEffect(() => {
    let active = true;
    const selected = JSON.parse(candidateSignature) as Candidate[];
    void Promise.all(selected.map(async crop => {
      const file = sources[crop.imageIndex];
      if (!file || ![crop.x, crop.y, crop.width, crop.height].every(Number.isFinite) || crop.x < 0 || crop.y < 0 || crop.width <= 0 || crop.height <= 0 || crop.x + crop.width > 1.001 || crop.y + crop.height > 1.001) return null;
      const url = URL.createObjectURL(file);
      try {
        const photo = await new Promise<HTMLImageElement>((resolve, reject) => { const value = new Image(); value.onload = () => resolve(value); value.onerror = reject; value.src = url; });
        const target = document.createElement("canvas"); target.width = target.height = 160;
        const context = target.getContext("2d"); if (!context) return null;
        context.fillStyle = "white"; context.fillRect(0, 0, 160, 160);
        context.drawImage(photo, crop.x * photo.width, crop.y * photo.height, crop.width * photo.width, crop.height * photo.height, 0, 0, 160, 160);
        return { file, crop, preview: target.toDataURL("image/jpeg", .75) };
      } catch { return null; }
      finally { URL.revokeObjectURL(url); }
    })).then(result => { if (active) setChoices(result.filter((item): item is { file: File; crop: Candidate; preview: string } => item !== null)); });
    return () => { active = false; };
  }, [candidateSignature, sources]);
  function draw() {
    const photo = image.current, context = canvas.current?.getContext("2d");
    if (!photo || !context) return;
    const side = Math.min(photo.width, photo.height) * position.size / 100;
    context.fillStyle = "white";
    context.fillRect(0, 0, 160, 160);
    if (candidateCrop) context.drawImage(photo, candidateCrop.x * photo.width, candidateCrop.y * photo.height, candidateCrop.width * photo.width, candidateCrop.height * photo.height, 0, 0, 160, 160);
    else context.drawImage(photo, (photo.width - side) * position.x / 100, (photo.height - side) * position.y / 100, side, side, 0, 0, 160, 160);
  }
  useEffect(() => {
    if (!source) return;
    let active = true;
    const url = URL.createObjectURL(source), photo = new Image();
    setReady(false);
    photo.onload = () => { if (active) { image.current = photo; setReady(true); } };
    photo.onerror = () => { if (active) setError("图片无法打开，请选择 JPG、PNG 或 WebP 图片。"); };
    photo.src = url;
    return () => { active = false; URL.revokeObjectURL(url); image.current = null; };
  }, [source]);
  useEffect(() => { if (ready) draw(); }, [ready, position, candidateCrop]);
  async function save() {
    if (busy || !ready || disabled) return;
    setBusy(true); setError("");
    try {
      const avatar = canvas.current!.toDataURL("image/jpeg", .75);
      if (avatar.length > 48000) throw new Error("头像过大，请缩小裁剪范围后重试。");
      await archiveRequest("avatar", { target: subjectId ? "subject" : "self", subjectId: subjectId || null, avatar, confirmed: true });
      await onSaved(); setSource(null); setReady(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "头像暂未保存。"); }
    finally { setBusy(false); }
  }
  const content = <><p className={styles.muted}>选择照片后调整裁剪，确认保存到「{name}」。只保存裁剪后的小头像。</p>{!!choices.length && <><p className={styles.muted}>从刚才的截图中发现了以下头像，请核对归属后选择。</p><div className={styles.actions}>{choices.map((choice, index) => <button key={index} className={styles.button} type="button" disabled={busy || disabled} aria-label={`选择第 ${choice.crop.imageIndex + 1} 张图片中的候选头像`} onClick={() => { setSource(choice.file); setCandidateCrop(choice.crop); setError(""); }}><img className={styles.avatar} src={choice.preview} alt={`候选头像 ${index + 1}`} /><span>图 {choice.crop.imageIndex + 1}</span></button>)}</div></>}<label className={styles.field}><span>选择图片</span><input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy || disabled} onChange={event => { const file = event.target.files?.[0]; if (!file) return; if (file.size > 12 * 1024 * 1024) { setError("请选择小于 12 MB 的图片。"); return; } setSource(file); setCandidateCrop(null); setPosition({ x: 50, y: 50, size: 100 }); setError(""); }} /></label>{source && <><div className={styles.crop}><canvas ref={canvas} width={160} height={160} aria-label="将要保存的头像预览" /><div>{([["x", "左右位置", 0], ["y", "上下位置", 0], ["size", "取景范围", 4]] as const).map(([key, label, min]) => <label key={key}>{label}<input type="range" min={min} max={100} value={position[key]} disabled={busy || !ready || disabled} onChange={event => { setCandidateCrop(null); setPosition({ ...position, [key]: Number(event.target.value) }); }} /></label>)}</div></div><button type="button" className={styles.primary} disabled={busy || !ready || disabled} onClick={() => void save()}>{busy ? "正在保存…" : `确认保存为${subjectId ? " TA 的" : "我的"}头像`}</button></>}{error && <p className={styles.error} role="alert">{error}</p>}</>;
  const materialChoices=sources.length>0?<div style={{marginBottom:18}}><p className={styles.muted}>也可以从本次上传的截图中裁剪</p><div style={{display:'flex',gap:10,overflowX:'auto',paddingBottom:8}}>{sources.map((file,index)=><button type="button" key={index} disabled={busy||disabled} aria-label={`从第 ${index+1} 张截图裁剪头像`} onClick={()=>{setSource(file);setCandidateCrop(null);setPosition({x:50,y:50,size:25});setError('');}} style={{display:'grid',justifyItems:'center',gap:5,flex:'0 0 84px',padding:6,border:'1px solid #dfc8b6',borderRadius:12,background:'#fffaf4'}}><img src={sourcePreviews[index]} alt={`截图 ${index+1}`} style={{width:70,height:76,objectFit:'cover',borderRadius:7}}/><span style={{fontSize:13}}>截图 {index+1}</span></button>)}</div></div>:null;
  return expanded ? <section>{materialChoices}{content}</section> : <details><summary><ImagePlus size={15} style={{ display: "inline", verticalAlign: "-3px", marginRight: 7 }}/>选择 / 更换头像</summary>{materialChoices}{content}</details>;
}
