const api=require('../../lib/api');
const pickers=[
  {key:'ageRange',label:'年龄',options:['暂不了解',...Array.from({length:83},(_,i)=>(i+18)+'岁')]},
  {key:'education',label:'学历',options:['暂不了解','高中及以下','大专','本科','硕士','博士']},
  {key:'relationshipStatus',label:'婚恋状态',options:['暂不了解','单身','恋爱中','已婚','离异','丧偶']},
  {key:'childrenPlan',label:'婚育想法',options:['暂不了解','希望结婚生育','希望结婚，生育未定','不计划生育','暂不考虑婚育','已有孩子']},
  {key:'howMet',label:'认识方式',options:['暂不了解','朋友介绍','相亲认识','同事','同学','线下活动','工作合作','社交软件','其他']},
  {key:'stage',label:'目前关系',options:['暂不了解','刚认识','普通朋友','正在了解','暧昧中','恋爱中','已婚','分开后重新联系']}
].map(item=>({...item,index:0}));
Page({
  data:{label:'',fields:{},pickers,busy:false,agreed:false,error:''},
  nameInput(e){this.setData({label:e.detail.value});},
  input(e){const key=e.currentTarget.dataset.key;if(['occupation','notes','values','boundaries','lifestyle'].includes(key))this.setData({fields:{...this.data.fields,[key]:e.detail.value}});},
  choose(e){const key=e.currentTarget.dataset.key,index=Number(e.detail.value),row=this.data.pickers.find(item=>item.key===key);if(!row || !Number.isInteger(index) || index<0 || index>=row.options.length)return;this.setData({fields:{...this.data.fields,[key]:index?row.options[index]:''},pickers:this.data.pickers.map(item=>item.key===key?{...item,index}:item)});},
  city(e){if(Array.isArray(e.detail.value))this.setData({fields:{...this.data.fields,city:e.detail.value.filter(Boolean).join(' ')}});},
  clearCity(){this.setData({fields:{...this.data.fields,city:''}});},
  agree(e){this.setData({agreed:e.detail.value.includes('yes')});},
  async save(){
    if(this.data.busy)return;
    const label=this.data.label.trim();
    if(!label || label.length>60){this.setData({error:'先填一个称呼，最多60字。'});return;}
    if(!this.data.agreed){this.setData({error:'请确认保存你有权提供的资料。'});return;}
    this.setData({busy:true,error:''});
    try{
      const session=await api.session();
      if(!session.token)throw new Error('请重新登录后再保存。');
      if(this._ownerToken && this._ownerToken!==session.token){this._requestId=null;this._ownerToken=session.token;throw new Error('账号已变化，请核对资料后重新保存。');}
      this._ownerToken=session.token;
      const profile=await api.request('/api/miniapp/profile','GET',null,session.token);
      if(profile.paused && profile.enabled)throw new Error('档案已暂停，请先到档案页恢复使用。');
      if(!profile.enabled)await api.request('/api/miniapp/profile','POST',{action:'consent',enabled:true},session.token);
      this._requestId ||= await api.newId();
      const result=await api.request('/api/miniapp/profile','POST',{action:'create-manual',id:this._requestId,label,data:this.data.fields,confirmed:true},session.token);
      if(result.createdSubjectId!==this._requestId)throw new Error('未确认建档结果，请返回人物列表核对。');
      wx.redirectTo({url:'/pages/archive/index?subjectId='+encodeURIComponent(result.createdSubjectId)});
    }catch(error){this.setData({error:error.message||'暂未保存，填写内容仍保留。'});}
    finally{this.setData({busy:false});}
  }
});
