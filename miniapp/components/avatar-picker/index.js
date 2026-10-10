const api=require('../../lib/api');
Component({
  properties:{sources:{type:Array,value:[]},candidates:{type:Array,value:[]},people:{type:Array,value:[]},subjectId:{type:String,value:''},self:{type:Boolean,value:false},current:{type:String,value:''}},
  data:{choices:[],selected:-1,preview:'',busy:false,error:'',saved:false,editing:false,x:50,y:50,size:100,currentAvatar:''},
  observers:{'sources,candidates':function(){if(this._ready)this.prepare();},'subjectId,self,current':function(){this.setData({saved:false,currentAvatar:this.properties.current||''});}},
  lifetimes:{ready(){this._ready=true;this.prepare();},detached(){this._ready=false;this._generation=(this._generation||0)+1;}},
  methods:{
    async crop(path,box){
      const info=await new Promise((resolve,reject)=>wx.getImageInfo({src:path,success:resolve,fail:reject}));
      const sx=box.x*info.width,sy=box.y*info.height,sw=box.width*info.width,sh=box.height*info.height;
      const ctx=wx.createCanvasContext('avatarCrop',this);
      ctx.clearRect(0,0,160,160);ctx.drawImage(info.path,sx,sy,sw,sh,0,0,160,160);
      await new Promise(resolve=>ctx.draw(false,resolve));
      return new Promise((resolve,reject)=>wx.canvasToTempFilePath({canvasId:'avatarCrop',x:0,y:0,width:160,height:160,destWidth:160,destHeight:160,fileType:'jpg',quality:.75,success:r=>resolve(r.tempFilePath),fail:reject},this));
    },
    async prepare(){
      const generation=this._generation=(this._generation||0)+1;
      const sources=this.properties.sources.slice(),candidates=this.properties.candidates.slice(0,6);
      this.setData({choices:[],selected:-1,preview:'',saved:false,error:''});
      // Serialize canvas work across observers; late completions never change a new selection.
      this._queue=(this._queue||Promise.resolve()).catch(()=>{}).then(async()=>{
        const choices=[];
        for(const candidate of candidates){
          if(generation!==this._generation||!this._ready)return;
          const source=sources[candidate.imageIndex];const path=typeof source==='string'?source:source?.path;
          if(!path)continue;
          try{const crop=await this.crop(path,candidate);choices.push({path:crop,label:'图 '+(candidate.imageIndex+1)});}catch{/* A cleared source can be reselected by the user. */}
        }
        if(generation===this._generation&&this._ready)this.setData({choices});
      });
      await this._queue;
    },
    select(event){if(this.data.busy)return;const index=Number(event.currentTarget.dataset.index),choice=this.data.choices[index];if(choice)this.setData({selected:index,preview:choice.path,saved:false,error:'',editing:false});},
    choose(){if(this.data.busy)return;wx.chooseMedia({count:1,mediaType:['image'],sourceType:['album'],success:async result=>{
      try{this._manual=result.tempFiles[0].tempFilePath;const info=await new Promise((resolve,reject)=>wx.getImageInfo({src:this._manual,success:resolve,fail:reject}));this._manualInfo=info;this.setData({editing:true,x:50,y:50,size:100,error:'',saved:false});await this.updateCrop();}catch{this.setData({error:'图片未能打开，请重新选择。'});}
    }});},
    adjust(event){const field=event.currentTarget.dataset.field;if(!['x','y','size'].includes(field)||this.data.busy)return;this.setData({[field]:Number(event.detail.value)});this.updateCrop();},
    async updateCrop(){
      const info=this._manualInfo;if(!info)return;
      const path=this._manual,side=Math.min(info.width,info.height)*Math.max(.04,this.data.size/100);
      const box={x:(info.width-side)*this.data.x/100/info.width,y:(info.height-side)*this.data.y/100/info.height,width:side/info.width,height:side/info.height};
      const generation=this._generation=(this._generation||0)+1;
      this.setData({busy:true});
      this._queue=(this._queue||Promise.resolve()).catch(()=>{}).then(async()=>{
        try{const preview=await this.crop(path,box);if(generation===this._generation&&this._ready)this.setData({preview,selected:-1,saved:false});}
        catch{if(this._ready)this.setData({error:'裁剪未完成，请重试。'});}
        finally{if(generation===this._generation&&this._ready)this.setData({busy:false});}
      });await this._queue;
    },
    async save(){
      if(this.data.busy||!this.data.preview)return;
      if(!this.properties.self&&!this.properties.subjectId)return this.setData({error:'请先建立或选择人物档案，再确认头像。'});
      const target=this.properties.self?'self':'subject',subjectId=this.properties.subjectId;
      this.setData({busy:true,error:''});
      try{
        const session=await api.session();
        const state=await api.request('/api/miniapp/profile','GET',null,session.token);
        const person=target==='self'?state.self:(state.subjects||[]).find(p=>p.id===subjectId);
        if(!state.enabled||state.paused||!person)throw new Error('请先建立并启用对应档案。');
        this.setData({currentAvatar:person.avatar||''});
        const name=target==='self'?'我的档案':person.label;
        const confirm=await new Promise(resolve=>wx.showModal({title:person.avatar?'替换头像？':'确认头像',content:'将选中的小头像保存到「'+name+'」，可在档案中更换。完整截图不会随头像长期保存。',success:r=>resolve(r.confirm),fail:()=>resolve(false)}));
        if(!confirm)return;
        const encoded=await new Promise((resolve,reject)=>wx.getFileSystemManager().readFile({filePath:this.data.preview,encoding:'base64',success:r=>resolve(r.data),fail:reject}));
        const avatar='data:image/jpeg;base64,'+encoded;
        await api.request('/api/miniapp/avatar','POST',{target,subjectId:target==='self'?null:subjectId,avatar,confirmed:true},session.token);
        this.setData({saved:true,currentAvatar:avatar});this.triggerEvent('saved',{avatar,target,subjectId});
      }catch(error){this.setData({error:error.message||'头像保存未完成，请重试。'});}finally{this.setData({busy:false});}
    }
  }
});
