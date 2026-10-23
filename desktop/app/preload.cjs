const {contextBridge,ipcRenderer}=require('electron');
if(location.origin==='https://coach.lovetalk.love' && window.top===window) {
  ipcRenderer.on('desktop:history',(_event,direction)=>{if(direction==='back')window.history.back();else if(direction==='forward')window.history.forward();});
  ipcRenderer.on('desktop:navigate',(_event,route)=>{if(typeof route==='string'&&route.startsWith('/')&&!route.startsWith('//'))window.dispatchEvent(new CustomEvent('chengzi:desktop-navigate',{detail:route}));});
  contextBridge.exposeInMainWorld('chengziDesktop',Object.freeze({
    apiVersion:1,
    connectCollector:()=>ipcRenderer.invoke('desktop:connect'),
    openCollectorSetup:()=>ipcRenderer.invoke('desktop:setup'),
    getRuntimeState:()=>ipcRenderer.invoke('desktop:runtime')
  }));
}
