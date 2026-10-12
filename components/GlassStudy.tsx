"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import styles from "./GlassStudy.module.css";

const vertex = `attribute vec2 position; void main(){ gl_Position=vec4(position,0.,1.); }`;
// Full-bleed optical texture: fixed vertical glass ribs, with a very slow
// light travelling through the scene behind them. Texture coordinates stay fixed.
const fragment = `
precision highp float;
uniform vec2 resolution;
uniform float time;
uniform sampler2D material;
void main(){
 vec2 uv=gl_FragCoord.xy/resolution;
 float ratio=resolution.x/resolution.y;
 vec2 tex=uv;
 if(ratio<1.2) tex.x=(tex.x-.5)*(ratio/2.)+.5;
 float right=smoothstep(.30,.72,tex.x);
 float phase=time*.28;
 vec3 col=texture2D(material,tex).rgb;
 float beam=sin(phase+tex.x*4.4-tex.y*1.8)*.10*right;
 float facets=smoothstep(.67,.98,col.r)*.5+.5;
 col+=vec3(1.,.84,.68)*beam*facets;
 gl_FragColor=vec4(clamp(col,0.,1.),1.);
}`;

export function GlassStudy() {
 const canvas = useRef<HTMLCanvasElement>(null);
 const [ready,setReady]=useState(false);
 const [paused,setPaused]=useState<boolean|null>(null);
 const [reduced,setReduced]=useState(false);
 const pauseRef=useRef<boolean|null>(null);
 const isPaused=paused??reduced;
 useEffect(()=>{pauseRef.current=paused;},[paused]);
 useEffect(()=>{const media=window.matchMedia('(prefers-reduced-motion: reduce)');const update=()=>setReduced(media.matches);update();media.addEventListener('change',update);return()=>media.removeEventListener('change',update);},[]);
 useEffect(()=>{
  const node=canvas.current;if(!node)return;
  const media=window.matchMedia('(prefers-reduced-motion: reduce)');
  let reduce=media.matches;setReduced(reduce);
  const gl=node.getContext('webgl',{alpha:false,antialias:false,powerPreference:'low-power',preserveDrawingBuffer:true});
  if(!gl)return;
  const compile=(kind:number,source:string)=>{const shader=gl.createShader(kind)!;gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){gl.deleteShader(shader);return null;}return shader;};
  const vs=compile(gl.VERTEX_SHADER,vertex),fs=compile(gl.FRAGMENT_SHADER,fragment);
  if(!vs||!fs){if(vs)gl.deleteShader(vs);if(fs)gl.deleteShader(fs);return;}
  const program=gl.createProgram()!;gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);
  if(!gl.getProgramParameter(program,gl.LINK_STATUS)){gl.deleteShader(vs);gl.deleteShader(fs);gl.deleteProgram(program);return;}
  gl.useProgram(program);
  const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
  const position=gl.getAttribLocation(program,'position');gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
  const size=gl.getUniformLocation(program,'resolution'),time=gl.getUniformLocation(program,'time');
  const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.uniform1i(gl.getUniformLocation(program,'material'),0);
  const asset=new Image();let disposed=false,loaded=false;
  let visible=true,elapsed=0,previous=0,lastDraw=0,raf=0,dirty=true,lost=false;
  const resize=()=>{const rect=node.getBoundingClientRect();const scale=Math.min(window.devicePixelRatio||1,2,1800/Math.max(rect.width,1));node.width=Math.max(1,Math.round(rect.width*scale));node.height=Math.max(1,Math.round(rect.height*scale));gl.viewport(0,0,node.width,node.height);dirty=true;};
  const draw=()=>{gl.uniform2f(size,node.width,node.height);gl.uniform1f(time,elapsed);gl.drawArrays(gl.TRIANGLES,0,6);};
  const frame=(now:number)=>{raf=0;if(lost||!loaded||document.hidden||!visible)return;const dt=previous?Math.min(now-previous,100):0;previous=now;const animate=!(pauseRef.current??reduce);if(animate)elapsed+=dt/1000;if(dirty||animate&&now-lastDraw>1000/24){draw();lastDraw=now;dirty=false;}if(animate)raf=requestAnimationFrame(frame);};
  const wake=()=>{previous=0;if(!raf&&!lost)raf=requestAnimationFrame(frame);};
  const observer=new ResizeObserver(()=>{resize();wake();});observer.observe(node);
  const intersection=new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;if(visible)wake();else{cancelAnimationFrame(raf);raf=0;}},{threshold:.01});intersection.observe(node);
  const change=()=>{reduce=media.matches;setReduced(reduce);dirty=true;wake();};
  const visibility=()=>{if(document.hidden){cancelAnimationFrame(raf);raf=0;}else wake();};
  const contextLost=(e:Event)=>{e.preventDefault();lost=true;cancelAnimationFrame(raf);setReady(false);};
  const resume=()=>{dirty=true;wake();};
  node.addEventListener('webglcontextlost',contextLost);node.addEventListener('glass-resume',resume);
  media.addEventListener('change',change);document.addEventListener('visibilitychange',visibility);
  asset.onload=()=>{if(disposed||lost)return;gl.bindTexture(gl.TEXTURE_2D,texture);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,gl.RGB,gl.UNSIGNED_BYTE,asset);loaded=true;resize();draw();setReady(true);wake();};
  asset.src='/images/aurora-fluted-light-v3.webp';
  return()=>{disposed=true;asset.onload=null;gl.deleteTexture(texture);cancelAnimationFrame(raf);observer.disconnect();intersection.disconnect();media.removeEventListener('change',change);document.removeEventListener('visibilitychange',visibility);node.removeEventListener('webglcontextlost',contextLost);node.removeEventListener('glass-resume',resume);gl.deleteBuffer(buffer);gl.deleteProgram(program);gl.deleteShader(vs);gl.deleteShader(fs);};
 },[]);
 const toggle=()=>{pauseRef.current=!isPaused;setPaused(!isPaused);canvas.current?.dispatchEvent(new Event('glass-resume'));};
 return <div className={styles.study} data-glass-ready={ready} data-motion={isPaused?"paused":"playing"} data-motion-explicit={paused!==null}>
  <img className={styles.fallback} src="/images/aurora-fluted-light-v3.webp" alt="" aria-hidden="true" fetchPriority="high"/>
  <canvas ref={canvas} className={`${styles.canvas} ${ready?styles.ready:''}`} aria-hidden="true"/>

  {<button type="button" className={styles.control} onClick={toggle} aria-label={isPaused?'播放光影':'暂停光影'} aria-pressed={isPaused}>{isPaused?<Play size={12}/>:<Pause size={12}/>}<span>{isPaused?'播放光影':'光影播放中'}</span></button>}
 </div>;
}
