'use strict';
const {spawn}=require('node:child_process');
const path=require('node:path');
const fs=require('node:fs');
const {EventEmitter}=require('node:events');
class Collector extends EventEmitter {
  constructor({resources,development=false,platform=process.platform}) { super();this.resources=resources;this.development=development;this.platform=platform;this.status='stopped';this.pending=new Map();this.counter=0;this.child=null;this.starting=null; }
  state() {return {collectorStatus:this.status,message:this.message||''};}
  changed(status,message='') {this.status=status;this.message=message;this.emit('state',this.state());}
  launch() {
    if(this.child && this.status==='ready') return Promise.resolve();
    if(this.starting) return this.starting;
    this.starting=this.start().finally(()=>{this.starting=null;}); return this.starting;
  }
  async start() {
    if(this.child)await this.stop();
    let command,args=['--desktop-service'];
    if(this.development && process.env.CHENGZI_DESKTOP_PYTHON) {
      command=process.env.CHENGZI_DESKTOP_PYTHON;
      args=[path.resolve(__dirname,'../wechat-collector/main.py'),'--desktop-service'];
    } else {
      command=path.join(this.resources,'collector',this.platform==='win32'?'ChengziDesktopService.exe':'ChengziDesktopService.app/Contents/MacOS/ChengziDesktopService');
    }
    if(!fs.existsSync(command)) {this.changed('error','本机采集组件未安装完整，请重新安装桌面版。');throw new Error('COLLECTOR_MISSING');}
    this.changed('starting','正在启动本机采集服务…');
    const child=spawn(command,args,{windowsHide:true,stdio:['pipe','pipe','pipe'],shell:false});this.child=child;
    let buffer='';
    child.stderr.resume(); // Native diagnostics may contain private paths; never persist or forward.
    child.stdin.on('error',()=>{for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('COLLECTOR_EXITED'));}this.pending.clear();});
    await new Promise((resolve,reject)=>{
      let settled=false;
      const finish=(error)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve();};
      const timer=setTimeout(()=>{finish(new Error('COLLECTOR_TIMEOUT'));child.kill();},30000);
      child.stdout.on('data',chunk=>{
        buffer+=chunk.toString('utf8');
        if(Buffer.byteLength(buffer)>65536) {finish(new Error('COLLECTOR_PROTOCOL'));child.kill();return;}
        let i;
        while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);let msg;try{msg=JSON.parse(line);}catch{continue;}
          if(msg.event==='ready'){this.changed('ready','本机采集已就绪');finish();}
          if(msg.event==='error'){this.changed('error',msg.error?.code==='PORT_IN_USE'?'已有独立助手占用连接，请退出独立助手后重试。':'本机采集服务未能启动。');finish(new Error(msg.error?.code||'COLLECTOR_FAILED'));}
          const waiting=this.pending.get(msg.id);if(waiting){this.pending.delete(msg.id);clearTimeout(waiting.timer);msg.ok?waiting.resolve(msg):waiting.reject(new Error(msg.error?.code||'COLLECTOR_FAILED'));}
        }
      });
      child.on('error',()=>{finish(new Error('COLLECTOR_START_FAILED'));});
      child.on('exit',()=>{if(this.child===child){this.child=null;if(this.status!=='error')this.changed('stopped');}finish(new Error('COLLECTOR_EXITED'));for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('COLLECTOR_EXITED'));}this.pending.clear();});
    });
  }
  async request(command) {
    if(!['connect','status','setup','shutdown'].includes(command))throw new Error('INVALID_COMMAND');
    await this.launch();
    const id=String(++this.counter);
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('COLLECTOR_TIMEOUT'));},10000);this.pending.set(id,{resolve,reject,timer});this.child.stdin.write(JSON.stringify({id,command})+'\n');});
  }
  async stop() {
    const child=this.child;if(!child)return;
    if(child.exitCode!==null||child.signalCode!==null)return;
    await new Promise(resolve=>{const timer=setTimeout(()=>{child.kill();resolve();},15000);child.once('exit',()=>{clearTimeout(timer);resolve();});if(!child.stdin.destroyed)child.stdin.end();});
  }
}
module.exports={Collector};
