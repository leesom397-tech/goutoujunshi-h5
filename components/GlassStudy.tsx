"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Pause, Play } from "lucide-react";
import styles from "./GlassStudy.module.css";

const vertex = `attribute vec2 position; void main(){ gl_Position=vec4(position,0.,1.); }`;
// The vertical ribs move in coordinated groups. Their horizontal displacement
// depends only on x, so the dense glass stays upright as the refraction changes.
const fragment = `
precision highp float;
uniform vec2 resolution;
uniform float time;
uniform float materialAspect;
uniform float materialWidth;
uniform float reportStyle;
uniform sampler2D material;
void main(){
 vec2 uv=gl_FragCoord.xy/resolution;
 float ratio=resolution.x/resolution.y;
 float crop=ratio<1.2?ratio/materialAspect:1.;
 vec2 framing=mix(vec2(crop,1.),vec2(min(1.,ratio/materialAspect),min(1.,materialAspect/ratio)),reportStyle);
 float strength=mix(1.,.3,reportStyle);
 float field=uv.x;
 float depth=smoothstep(.08,.48,field);
 float motion=time*.5625;
 float glide=.012*sin(field*12.+motion*.62)+.006*sin(field*23.-motion*.41);
 float lift=.047*sin(field*11.-motion*.55)+.019*sin(field*22.+motion*.38);
 // Overscan keeps both ends filled as neighbouring ribs rise and settle.
 vec2 tex=(uv-.5)*framing*vec2(.95,.85)+.5;
 tex.x+=glide*framing.x*depth*strength;
 tex.y+=lift*framing.y*(.45+.55*depth)*strength;
 vec3 col=texture2D(material,tex).rgb;
 float stepX=1.3/materialWidth;
 vec3 left=texture2D(material,tex-vec2(stepX,0.)).rgb;
 vec3 right=texture2D(material,tex+vec2(stepX,0.)).rgb;
 float slope=dot(right-left,vec3(.299,.587,.114))*5.;
 // Facet tilt follows the same displacement as the ribs, coupling light to motion.
 vec3 normal=normalize(vec3(-slope+glide*9.,.12+lift*3.,1.));
 // A changing angle lights the individual glass faces, never a travelling beam.
 vec3 light=normalize(vec3(.65*sin(motion*.47)+.3,.32,1.));
 float diffuse=max(dot(normal,light),0.);
 float edge=smoothstep(.035,.28,abs(slope));
 float glint=pow(max(dot(normal,normalize(light+vec3(0.,0.,1.))),0.),18.);
 col*=.91+.14*diffuse;
 col+=vec3(1.,.88,.75)*glint*edge*.13;
 gl_FragColor=vec4(clamp(col,0.,1.),1.);
}`;

export function GlassStudy({imageSrc="/images/aurora-fluted-light-v5.webp",variant="home"}:{imageSrc?:string;variant?:"home"|"report"}={}) {
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
  gl.uniform1f(gl.getUniformLocation(program,'reportStyle'),variant==='report'?1:0);
  const asset=new Image();let disposed=false,loaded=false;
  let visible=true,elapsed=0,previous=0,lastDraw=0,raf=0,dirty=true,lost=false;
  const resize=()=>{const rect=node.getBoundingClientRect();const scale=Math.min(window.devicePixelRatio||1,2,1800/Math.max(rect.width,1));const width=Math.max(1,Math.round(rect.width*scale)),height=Math.max(1,Math.round(rect.height*scale));if(node.width!==width||node.height!==height){node.width=width;node.height=height;}gl.viewport(0,0,node.width,node.height);dirty=true;if(loaded&&!lost)draw();};
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
  asset.onload=()=>{if(disposed||lost)return;gl.bindTexture(gl.TEXTURE_2D,texture);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,gl.RGB,gl.UNSIGNED_BYTE,asset);gl.uniform1f(gl.getUniformLocation(program,'materialAspect'),asset.naturalWidth/asset.naturalHeight);gl.uniform1f(gl.getUniformLocation(program,'materialWidth'),asset.naturalWidth);loaded=true;resize();draw();setReady(true);wake();};
  asset.src=imageSrc;
  return()=>{disposed=true;asset.onload=null;gl.deleteTexture(texture);cancelAnimationFrame(raf);observer.disconnect();intersection.disconnect();media.removeEventListener('change',change);document.removeEventListener('visibilitychange',visibility);node.removeEventListener('webglcontextlost',contextLost);node.removeEventListener('glass-resume',resume);gl.deleteBuffer(buffer);gl.deleteProgram(program);gl.deleteShader(vs);gl.deleteShader(fs);};
 },[imageSrc,variant]);
 const toggle=()=>{pauseRef.current=!isPaused;setPaused(!isPaused);canvas.current?.dispatchEvent(new Event('glass-resume'));};
 return <div className={styles.study} style={{'--glass-material':`url("${imageSrc}")`} as CSSProperties} data-glass-variant={variant} data-glass-ready={ready} data-motion={isPaused?"paused":"playing"} data-motion-explicit={paused!==null}>
  <img className={styles.fallback} src={imageSrc} alt="" aria-hidden="true" fetchPriority="high"/>
  <canvas ref={canvas} className={`${styles.canvas} ${ready?styles.ready:''}`} aria-hidden="true"/>
  <div className={styles.fallbackRibs} aria-hidden="true">{Array.from({length:36},(_,index)=><i key={index} style={{'--rib':index} as CSSProperties}/>)}</div>
  <button type="button" className={styles.control} onClick={toggle} aria-label={isPaused?'播放光影':'暂停光影'} aria-pressed={isPaused}>{isPaused?<Play size={16} aria-hidden="true"/>:<Pause size={16} aria-hidden="true"/>}</button>
 </div>;
}
