Component({
  properties:{value:{type:Object,value:null},targetSelf:{type:Boolean,value:false}},
  data:{review:null},
  observers:{"value,targetSelf":function(value,targetSelf){const signals=Array.isArray(value?.signals)?value.signals:[];this.setData({review:targetSelf||!signals.length?null:{...value,signals:signals.slice(0,4).map(row=>({...row,label:row.kind==="safety"?"安全提醒":row.kind==="expectation"?"关系预期":"反复出现的线索",icon:row.kind==="safety"?"!":"?"}))}});}},
});
