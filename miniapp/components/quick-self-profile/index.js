const {extractQuickSelfProfile}=require("../../lib/personal-context");
const fields={interests:"兴趣与话题",values:"在意的事",communicationStyle:"沟通偏好",preferredRelationship:"关系期待",boundaries:"个人边界",city:"常住城市",ageRange:"年龄"};
const groups=[{field:"interests",title:"喜欢做什么",tags:["摄影","看展","户外","阅读","咖啡","音乐"]},{field:"values",title:"相处时在意",tags:["真诚","独立空间","共同成长"]},{field:"communicationStyle",title:"喜欢怎么聊",tags:["坦诚沟通","慢热","简短直接"]}];
const unique=values=>[...new Set(values.flatMap(value=>String(value||"").split(/[；;、\n]/)).map(value=>value.trim()).filter(Boolean))].join("；").slice(0,800);
Component({
  properties:{value:{type:Object,value:null},owner:{type:String,value:""},disabled:{type:Boolean,value:false},busy:{type:Boolean,value:false}},
  data:{intro:"",groups:groups.map(group=>({...group,tags:group.tags.map(label=>({label,selected:false}))})),preview:[],note:"",saved:false},
  observers:{"owner":function(){this.reset();}},
  methods:{
    reset(){this.setData({intro:"",groups:groups.map(group=>({...group,tags:group.tags.map(label=>({label,selected:false}))})),preview:[],note:"",saved:false});},
    input(event){this.setData({intro:event.detail.value,preview:[],note:""});},
    toggle(event){if(this.data.disabled||this.data.busy)return;const {field,label}=event.currentTarget.dataset;this.setData({groups:this.data.groups.map(group=>group.field!==field?group:{...group,tags:group.tags.map(tag=>tag.label!==label?tag:{...tag,selected:!tag.selected})}),preview:[],note:""});},
    prepare(){
      if(this.data.disabled||this.data.busy)return;
      const extracted=extractQuickSelfProfile(this.data.intro||""),draft={...extracted.draft};
      for(const group of this.data.groups){const chosen=group.tags.filter(tag=>tag.selected).map(tag=>tag.label);if(chosen.length)draft[group.field]=unique([this.data.value?.[group.field],draft[group.field],...chosen]);}
      // New self descriptions augment an existing interest list; editing the
      // preview remains an explicit way to replace or clear that one field.
      if(draft.interests)draft.interests=unique([this.data.value?.interests,draft.interests]);
      this.setData({preview:Object.entries(draft).filter(([field])=>fields[field]).map(([field,value])=>({field,label:fields[field],value})),note:extracted.evidence.length||Object.keys(draft).length?"核对下面的内容，确认后才保存。":"选几个标签，或用“我喜欢…”“我希望…”说说自己。",saved:false});
    },
    edit(event){const field=event.currentTarget.dataset.field;this.setData({preview:this.data.preview.map(row=>row.field===field?{...row,value:event.detail.value}:row)});},
    save(){if(this.data.disabled||this.data.busy||!this.data.preview.length)return;const data=Object.fromEntries(this.data.preview.map(row=>[row.field,row.value]));this.triggerEvent("save",{data,confirmed:true});},
  }
});
