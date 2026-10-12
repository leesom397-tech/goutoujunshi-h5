"use client";
import {useEffect,useRef} from "react";
import {ImagePlus,X} from "lucide-react";
import {ArchiveAvatar} from "./ArchiveAvatar";
import styles from "./PersonAvatarChoice.module.css";
export function PersonAvatarChoice({subjectId,name,sources,candidates,autoOpen=false,onSaved,disabled=false}:{subjectId:string;name:string;sources?:File[];candidates?:Array<{imageIndex:number;x:number;y:number;width:number;height:number}>;autoOpen?:boolean;onSaved?:()=>Promise<void>;disabled?:boolean}){
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{if(autoOpen&&subjectId&&!dialog.current?.open)dialog.current?.showModal();},[autoOpen,subjectId]);
 return <><button className={styles.trigger} type="button" disabled={disabled} onClick={()=>dialog.current?.showModal()}><ImagePlus size={18}/>选择人物头像<span>选填</span></button><dialog ref={dialog} className={styles.dialog}><header><div><h2>{autoOpen?'给新人物选个头像？':'选择人物头像'}</h2><p>用于认人，可以现在选择，也可以稍后再加。</p></div><button type="button" aria-label="关闭人物头像选择" onClick={()=>dialog.current?.close()}><X size={20}/></button></header><ArchiveAvatar expanded subjectId={subjectId} name={name} sources={sources} candidates={candidates} disabled={disabled} onSaved={async()=>{await onSaved?.();dialog.current?.close();}}/><footer><button type="button" onClick={()=>dialog.current?.close()}>暂时跳过</button></footer></dialog></>;
}
