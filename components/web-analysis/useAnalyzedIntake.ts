"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "./client";
import { analyzedReportMatches, checkAnalyzedImages, clearAnalyzedImagesOwner, intakeHistoryKey, type IntakeHistoryScope, type IntakeImageCheck } from "./intake-history";

export function useAnalyzedIntake({scope,files,enabled}:{scope:IntakeHistoryScope;files:File[];enabled:boolean}) {
 const key=intakeHistoryKey(scope),previousOwner=useRef(scope.owner);
 const [state,setState]=useState<{key:string;files:File[];check:IntakeImageCheck}|null>(null);
 useEffect(()=>{if(previousOwner.current&&previousOwner.current!==scope.owner)void clearAnalyzedImagesOwner(previousOwner.current);previousOwner.current=scope.owner;},[scope.owner]);
 useEffect(()=>{let active=true;const controller=new AbortController();setState(null);if(!enabled)return()=>controller.abort();let identity:Promise<boolean>|null=null;
  // History is optional: a slow database/network must not trap the upload form.
  const timer=setTimeout(()=>{controller.abort();if(active)setState({key,files,check:{fresh:files,repeated:[],unavailable:true}});},4000);
  void checkAnalyzedImages(scope,files,{validateReport:async reportId=>{
   identity ||= api('/api/account/credits',undefined,controller.signal).then(value=>value.account?.userId===scope.owner);
   if(!await identity||controller.signal.aborted)return false;
   const value=await api('/api/web/report?id='+encodeURIComponent(reportId),undefined,controller.signal);return analyzedReportMatches(scope,reportId,value);
  }}).then(check=>{clearTimeout(timer);if(active&&!controller.signal.aborted)setState({key,files,check});});
  return()=>{active=false;clearTimeout(timer);controller.abort();};
 },[key,files,enabled]);
 const ready=enabled&&state?.key===key&&state.files===files;
 return {fresh:ready?state.check.fresh:files,repeated:ready?state.check.repeated:[],unavailable:ready?state.check.unavailable:false,checking:enabled&&!ready,ready};
}
