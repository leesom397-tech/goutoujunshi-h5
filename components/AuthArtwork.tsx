import { ScanLine, Orbit, ShieldCheck } from "lucide-react";
import { GlassScene } from "@/components/GlassScene";
export function AuthArtwork(){
  return <div className="auth-artwork"><GlassScene className="auth-glass"/><div className="auth-artwork-caption"><span><ScanLine size={15}/> 看见关系里的线索</span><span><Orbit size={15}/> 连接每一次变化</span></div><a href="/privacy"><ShieldCheck size={13}/> 你的资料，由你掌控</a></div>;
}


