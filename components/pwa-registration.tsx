"use client";
import {useEffect} from "react";
export function PwaRegistration(){
  useEffect(()=>{
    if("serviceWorker" in navigator&&(location.protocol==="https:"||location.hostname==="localhost"||location.hostname==="127.0.0.1"))
      void navigator.serviceWorker.register("/sw.js",{scope:"/"}).then(()=>navigator.serviceWorker.ready).then(registration=>registration.active?.postMessage({type:"prune-local-shares"})).catch(()=>{});
  },[]);
  return null;
}
