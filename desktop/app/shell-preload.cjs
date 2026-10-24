const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('desktopShell',Object.freeze({
  navigate:(target)=>ipcRenderer.invoke('shell:navigate',target),
  action:(action)=>ipcRenderer.invoke('shell:action',action),
  setupAction:(action,jobId)=>ipcRenderer.invoke('shell:setup-action',action,jobId),
  state:()=>ipcRenderer.invoke('shell:state'),
  subscribe:(callback)=>{const listener=(_event,value)=>callback(value);ipcRenderer.on('shell:state',listener);return()=>ipcRenderer.removeListener('shell:state',listener);}
}));
