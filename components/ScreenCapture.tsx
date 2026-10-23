"use client";
import { useEffect, useRef, useState } from "react";
import { Monitor, Play, Square, Trash2, Crop, RotateCcw, ArrowRight, Camera, GripVertical, LoaderCircle } from "lucide-react";
import { FULL_CROP, normalizeCrop, changedFrame, blankFrame, cropPixels, encodeCapture, type CropRegion } from "@/lib/screen-capture";
import styles from "./ScreenCapture.module.css";

export type CapturedFrame = { id: string; data: string; at: string; width: number; height: number };
type FrameSample = { width: number; height: number; pixels: Uint8ClampedArray };
export function ScreenCapture({ disabled = false, sessionKey = "", onReady }: { disabled?: boolean; sessionKey?: string; onReady: (frames: CapturedFrame[]) => Promise<void> }) {
  const video = useRef<HTMLVideoElement>(null), stream = useRef<MediaStream | null>(null), timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const active = useRef(false), mounted = useRef(false), generation = useRef(0), pending = useRef<object | null>(null), requestingRef = useRef(false), captureFrames = useRef<CapturedFrame[]>([]), samples = useRef<FrameSample[]>([]);
  const disabledRef = useRef(disabled), savingRef = useRef(false), sessionRef = useRef(sessionKey), cropRef = useRef<CropRegion>(FULL_CROP), start = useRef<{x:number;y:number}|null>(null);
  disabledRef.current = disabled;
  const [sharing, setSharing] = useState(false), [ready, setReady] = useState(false), [requesting, setRequesting] = useState(false), [recording, setRecording] = useState(false), [frames, setFrames] = useState<CapturedFrame[]>([]), [skipped, setSkipped] = useState(0), [crop, setCrop] = useState(FULL_CROP), [error, setError] = useState(""), [saving, setSaving] = useState(false);
  function stopRecording() { generation.current++; active.current = false; pending.current = null; if (timer.current) clearInterval(timer.current); timer.current = null; if (mounted.current) setRecording(false); }
  function stopSharing() {
    stopRecording(); requestingRef.current = false;
    const old = stream.current; stream.current = null; old?.getTracks().forEach(track => track.stop());
    if (video.current) { video.current.pause(); video.current.srcObject = null; }
    if (mounted.current) { setSharing(false); setReady(false); setRequesting(false); }
  }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; stopSharing(); }; }, []);
  useEffect(() => { if (disabled) stopSharing(); }, [disabled]);
  useEffect(() => {
    if (sessionRef.current === sessionKey) return;
    sessionRef.current = sessionKey; stopSharing(); captureFrames.current = []; samples.current = []; savingRef.current = false;
    setFrames([]); setSkipped(0); setError(""); setSaving(false); setCrop(FULL_CROP); cropRef.current = FULL_CROP;
  }, [sessionKey]);
  async function share() {
    if (disabledRef.current || savingRef.current || requestingRef.current || captureFrames.current.length >= 9) return;
    setError("");
    if (!window.isSecureContext || !navigator.mediaDevices?.getDisplayMedia) { setError("窗口采集需要 HTTPS 页面和支持屏幕共享的桌面浏览器。请在电脑上使用 Chrome、Edge，或支持此功能的 Safari。"); return; }
    stopSharing(); const current = generation.current; requestingRef.current = true; setRequesting(true);
    try {
      const next = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 4 }, audio: false, ...({ monitorTypeSurfaces: "exclude", selfBrowserSurface: "exclude", surfaceSwitching: "exclude" } as object) });
      if (!mounted.current || current !== generation.current || disabledRef.current) { next.getTracks().forEach(track => track.stop()); return; }
      const track = next.getVideoTracks()[0];
      if (!track || track.readyState === "ended" || track.getSettings().displaySurface === "monitor") { next.getTracks().forEach(item => item.stop()); throw Error("请只选择微信窗口，不要共享整块屏幕。"); }
      stream.current = next; setSharing(true); setCrop(FULL_CROP); cropRef.current = FULL_CROP;
      track.addEventListener("ended", () => { if (stream.current === next) stopSharing(); }, { once: true });
      const preview = video.current;
      if (!preview) { stopSharing(); throw Error("预览暂未就绪，请重新选择窗口。"); }
      preview.srcObject = next;
      let deadline: ReturnType<typeof setTimeout> | undefined;
      try { await Promise.race([preview.play(), new Promise<never>((_, reject) => { deadline = setTimeout(() => reject(Error("共享窗口没有送来画面。请保持窗口可见，并检查系统屏幕录制权限。")), 10000); })]); }
      finally { if (deadline) clearTimeout(deadline); }
      if (!mounted.current || current !== generation.current || stream.current !== next || disabledRef.current) { next.getTracks().forEach(item => item.stop()); return; }
      setReady(preview.videoWidth > 0 && preview.videoHeight > 0);
    } catch (cause) {
      if (!mounted.current || current !== generation.current || disabledRef.current) return;
      stopSharing();
      const name = cause instanceof Error ? cause.name : "";
      setError(name === "NotAllowedError" ? "未取得窗口共享权限。请重新选择微信窗口；Mac 可在系统设置「隐私与安全性 → 屏幕与系统音频录制」中允许当前浏览器。" : name === "NotReadableError" ? "系统没有提供窗口画面。请保持微信窗口可见，并检查系统屏幕录制权限后重试。" : cause instanceof Error ? cause.message : "窗口采集暂未启动。");
    } finally { if (mounted.current && current === generation.current) { requestingRef.current = false; setRequesting(false); } }
  }
  async function snapshot() {
    const preview = video.current;
    if (pending.current || !active.current || disabledRef.current || !preview?.videoWidth || preview.readyState < 2 || !stream.current) return;
    const operation = {}; pending.current = operation; const current = generation.current;
    try {
      const region = cropPixels(preview.videoWidth, preview.videoHeight, cropRef.current);
      const small = document.createElement("canvas"), sampleScale = Math.min(1, 960 / Math.max(region.width, region.height));
      small.width = Math.max(1, Math.round(region.width * sampleScale)); small.height = Math.max(1, Math.round(region.height * sampleScale));
      const context = small.getContext("2d", { willReadFrequently: true });
      if (!context) throw Error("浏览器无法读取共享画面。");
      context.drawImage(preview, region.x, region.y, region.width, region.height, 0, 0, small.width, small.height);
      const pixels = context.getImageData(0, 0, small.width, small.height).data;
      if (blankFrame(pixels)) throw Error("共享画面目前是黑屏，已暂停截图。请恢复微信窗口、检查录屏权限后再开始。");
      if (samples.current.some(previous => previous.width === small.width && previous.height === small.height && !changedFrame(previous.pixels, pixels))) { setSkipped(value => value + 1); return; }
      const canvas = document.createElement("canvas"), scale = Math.min(1, 2400 / Math.max(region.width, region.height));
      canvas.width = Math.round(region.width * scale); canvas.height = Math.round(region.height * scale);
      const output = canvas.getContext("2d"); if (!output) throw Error("浏览器无法生成截图。");
      output.drawImage(preview, region.x, region.y, region.width, region.height, 0, 0, canvas.width, canvas.height);
      const data = encodeCapture(canvas), digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
      if (current !== generation.current || !active.current || disabledRef.current || !mounted.current) return;
      const id = Array.from(new Uint8Array(digest), item => item.toString(16).padStart(2, "0")).join("");
      if (captureFrames.current.some(frame => frame.id === id)) { setSkipped(value => value + 1); return; }
      samples.current.push({ pixels, width: small.width, height: small.height });
      captureFrames.current = [...captureFrames.current, { id, data, at: new Date().toISOString(), width: canvas.width, height: canvas.height }]; setFrames(captureFrames.current);
      if (captureFrames.current.length >= 9) stopSharing();
    } catch (cause) { if (mounted.current && current === generation.current) { setError(cause instanceof Error ? cause.message : "当前窗口暂时无法截图，请保持微信窗口可见后重试。"); stopRecording(); } }
    finally { if (pending.current === operation) pending.current = null; }
  }
  function begin() { if (disabledRef.current || savingRef.current || !stream.current || !ready || captureFrames.current.length >= 9) return; stopRecording(); setError(""); active.current = true; setRecording(true); void snapshot(); timer.current = setInterval(() => void snapshot(), 1800); }
  const pointer = (event: React.PointerEvent<HTMLDivElement>) => { const rect = event.currentTarget.getBoundingClientRect(); return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height }; };
  async function done() {
    if (disabledRef.current || savingRef.current || !captureFrames.current.length) return;
    const selected = [...captureFrames.current], session = sessionRef.current; stopSharing(); savingRef.current = true; setSaving(true); setError("");
    try { await onReady(selected); }
    catch (cause) { if (mounted.current && session === sessionRef.current) setError(cause instanceof Error ? cause.message : "截图暂未保存，请重试。"); }
    finally { if (mounted.current && session === sessionRef.current) { savingRef.current = false; setSaving(false); } }
  }
  return <section className={styles.panel} aria-label="微信窗口自动截图">
    <div className={styles.heading}><span><Monitor size={23}/></span><div><h2>窗口采集</h2><p>Windows / Mac · 自动截取，手动滚动</p></div></div>
    <p>打开要分析的聊天或朋友圈，选择微信窗口。框选内容后开始采集，缓慢滚动即可，重复画面会跳过。</p>
    <div className={styles.actions}>{!sharing ? <button onClick={() => void share()} disabled={disabled || saving || requesting || frames.length >= 9}>{requesting ? <LoaderCircle className={styles.spin} size={18}/> : <Monitor size={18}/>} {requesting ? "正在等待窗口选择…" : "选择微信窗口"}</button> : <><button onClick={recording ? stopRecording : begin} disabled={disabled || saving || !ready || frames.length >= 9}>{recording ? <><Square size={17}/>暂停截图</> : <><Play size={18}/>{ready ? "开始自动截取" : "等待窗口画面…"}</>}</button><button className={styles.secondary} onClick={stopSharing}>结束共享</button></>}</div>
    <div className={styles.screen} data-visible={sharing} onPointerDown={event => { if (recording || !ready || disabled || event.button !== 0) return; start.current = pointer(event); event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={event => { if (!start.current || recording || disabled) return; setCrop(normalizeCrop(start.current, pointer(event))); }} onPointerUp={event => { if (!start.current || recording || disabled) return; const next = normalizeCrop(start.current, pointer(event)); start.current = null; try { cropPixels(video.current?.videoWidth || 0, video.current?.videoHeight || 0, next); setCrop(next); cropRef.current = next; setError(""); } catch { setCrop(cropRef.current); setError("框选范围太小，请至少包含一整条清晰消息。"); } }} onPointerCancel={() => { start.current = null; setCrop(cropRef.current); }}>
      <video ref={video} muted playsInline aria-label="共享窗口预览" onLoadedData={() => { if (stream.current && !disabledRef.current) setReady(!!video.current?.videoWidth); }}/>
      {sharing && <div className={styles.selection} style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.width * 100}%`, height: `${crop.height * 100}%` }}/>}
    </div>
    {sharing && <p className={styles.hint}><Crop size={16}/>{recording ? "正在截取框内内容；每次滚动保留几条重叠消息，短回复也会保留。" : "截图已暂停，共享预览仍在。拖动框选内容，可排除左侧联系人。"}<button className={styles.reset} disabled={recording || disabled} onClick={() => { setCrop(FULL_CROP); cropRef.current = FULL_CROP; }}><RotateCcw size={14}/>重置</button></p>}
    {(sharing || frames.length > 0) && <p className={styles.count} aria-live="polite"><Camera size={18}/>已截取 <strong>{frames.length} / 9 张</strong><span>跳过重复画面 {skipped} 次</span></p>}
    {frames.length >= 9 && <p className={styles.hint}>本批已满 9 张，已结束共享。确认截图后继续分析，或删除不需要的截图。</p>}
    {frames.length > 0 && <><div className={styles.thumbnails}>{frames.map((frame, index) => <article key={frame.id}><img src={`data:image/jpeg;base64,${frame.data}`} alt={`采集截图 ${index + 1}`}/><div><span>第 {index + 1} 张</span><button aria-label={`删除第${index + 1}张`} disabled={recording || saving || disabled} onClick={() => { captureFrames.current = captureFrames.current.filter(item => item.id !== frame.id); samples.current.splice(index, 1); setFrames(captureFrames.current); }}><Trash2 size={15}/></button></div></article>)}</div><button className={styles.finish} onClick={() => void done()} disabled={saving || disabled}>{saving ? "正在整理…" : "保存截图，继续预览"}<ArrowRight size={18}/></button><p className={styles.hint}><GripVertical size={15}/>进入截图分析后可调整顺序；聊天建议从旧消息向新消息滚动。</p></>}
    {error && <p className={styles.error} role="alert">{error}</p>}
  </section>;
}
