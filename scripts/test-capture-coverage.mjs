import assert from "node:assert/strict";
import {build} from "esbuild";
const bundle=await build({entryPoints:["lib/capture-coverage.ts"],bundle:true,write:false,format:"esm",platform:"node"});
const {captureCoverage,captureMediaNotice}=await import("data:text/javascript;base64,"+Buffer.from(bundle.outputFiles[0].text).toString("base64"));
const row=(kind,text,rest={})=>({kind,text,senderRole:"other",source:{label:"合成测试"},...rest});
for(const label of ["[语音]","【语音】12秒","语音消息 9”","[Voice message] 12s","語音 00:12"]){
 assert.equal(captureCoverage([row("other",label)]).unreadVoice,1,label+" must be an exact voice placeholder");
 assert.match(captureMediaNotice(row("other",label)),/语音尚未转成文字/);
}
for(const text of ["我等下发语音给你","刚才听了12秒语音","[语音] 你今天几点下班？"]){
 assert.equal(captureCoverage([row("text",text)]).readableText,1,"a conversation about voice is still readable");
 assert.equal(captureCoverage([row("other",text)]).unreadVoice,0,"do not infer voice from a word inside unknown content");
}
const unknown=captureCoverage([row("text","周六一起看展吗？",{senderRole:"unknown"})]);
assert.equal(unknown.readableText,1);assert.equal(unknown.unknownSpeaker,1,"unknown speaker must not erase extracted text");
const media=[row("image","[图片]"),row("sticker","[动画表情]"),row("sticker","真的好开心",{ocrTextVerified:true}),row("sticker","[表情包]",{ocrTextVerified:true}),row("other","[视频]"),row("other","撤回了一条消息")];
assert.deepEqual(captureCoverage(media),{total:6,readableText:1,unknownSpeaker:0,voiceTotal:0,transcribed:0,unreadVoice:0,voiceAvailable:0,voiceMissingLocal:0,voiceFailed:0,unreadImage:1,unreadSticker:2,other:2,frames:0,postImages:0});
const transcribed=row("text","明天六点碰面。",{source:{mediaKind:"voice",transcriptionStatus:"visible-text"}});
assert.equal(captureCoverage([transcribed]).transcribed,1);assert.equal(captureCoverage([transcribed]).unreadVoice,0);
assert.match(captureMediaNotice(transcribed),/转写文字.*语调/);
const reviewedVoice={...transcribed,source:{...transcribed.source,transcriptionNeedsReview:true}};
assert.equal(captureMediaNotice(reviewedVoice),"微信转写已读，建议核对易错字。");
assert.equal(captureCoverage([reviewedVoice]).transcribed,1,"review reminder does not erase readable transcript text");
assert.match(captureMediaNotice(row("other","[语音]",{source:{mediaKind:"voice",transcriptionStatus:"failed"}})),/未成功/);
assert.match(captureMediaNotice(row("other","[语音]",{source:{mediaKind:"voice",transcriptionStatus:"pending"}})),/仍在转文字/);
assert.equal(captureCoverage([row("other","[语音]",{source:{transcriptionStatus:"visible-text"}})]).transcribed,0,"status alone cannot invent a transcript");
for(const method of ["screen-capture","video-import"]){
 const frames=captureCoverage([row("image","",{source:{method}})]);
 assert.equal(frames.frames,1);assert.equal(frames.unreadImage,0);assert.equal(captureMediaNotice(row("image","",{source:{method}})),"");
}
const moments=captureCoverage([row("post","周末去看展",{images:[{}]}),row("post","",{images:[{}]}),row("post","今天天气很好")],"moments");
assert.equal(moments.readableText,2);assert.equal(moments.postImages,2);assert.equal(moments.other,0);
const rows=Array.from({length:500},(_,i)=>i<475?row("text","合成文字"+i):i<485?row("text","待核对身份"+i,{senderRole:"unknown"}):i<490?row("other","[语音] 12秒"):i<494?row("image","[图片]"):i<497?row("sticker","[表情包]"):row("other","[视频]"));
const before=JSON.stringify(rows),full=captureCoverage(rows);
assert.equal(full.total,500);assert.equal(full.readableText,485);assert.equal(full.unknownSpeaker,10);assert.equal(full.unreadVoice,5);assert.equal(full.unreadImage,4);assert.equal(full.unreadSticker,3);assert.equal(full.other,3);assert.equal(JSON.stringify(rows),before);
console.log("PASS capture coverage: exact voice placeholders, unknown speaker text, verified stickers, real transcript status, frame/moments distinction, 500-record counts, no mutation.");

// Legacy Windows collector shape: a voice control with duration text, before mediaKind existed.
for(const text of ['语音12"秒','语音5"秒']) { const legacy=row("other",text,{source:{uiClass:"mmui::ChatVoiceItemView"}}); assert.equal(captureCoverage([legacy]).unreadVoice,1); assert.match(captureMediaNotice(legacy),/语音尚未转成文字/); assert.equal(captureCoverage([row("other",text)]).unreadVoice,1,"exact legacy duration label is recognized without class metadata"); }
assert.equal(captureCoverage([row("other","",{source:{uiClass:"mmui::ChatVoiceItemView"}})]).unreadVoice,1,"known voice control remains voice without readable duration label");
const localVoice=(availability,body="")=>row(body?"text":"other",body||"[语音]",{source:{method:"wechat-local-db",mediaKind:"voice",voiceAvailability:availability,transcriptionStatus:body?"visible-text":"not-transcribed",transcriptionSource:body?"local-audio-asr":undefined}});
const localRows=[localVoice("available"),localVoice("missing-local"),localVoice("decode-failed"),localVoice("transcribe-failed"),localVoice("transcribed","明天下午见。"),localVoice("transcribed")];
const localCoverage=captureCoverage(localRows);
assert.equal(localCoverage.voiceTotal,6);assert.equal(localCoverage.transcribed,1);assert.equal(localCoverage.unreadVoice,5);assert.equal(localCoverage.voiceAvailable,1);assert.equal(localCoverage.voiceMissingLocal,1);assert.equal(localCoverage.voiceFailed,2);
assert.match(captureMediaNotice(localRows[0]),/本机已有语音文件/);assert.match(captureMediaNotice(localRows[1]),/还没有这条语音文件/);assert.match(captureMediaNotice(localRows[2]),/无法解码/);assert.match(captureMediaNotice(localRows[3]),/转写未完成/);assert.match(captureMediaNotice(localRows[4]),/本机语音已转成文字/);
assert.equal(captureCoverage([localVoice("transcribed")]).transcribed,0,"availability alone must not claim text was transcribed");
const legacy506=[...Array.from({length:328},(_,i)=>row("text","合成文字"+i)),...Array.from({length:72},()=>row("image","[图片]")),...Array.from({length:9},()=>row("sticker","[表情包]")),...Array.from({length:72},()=>row("other",'语音12"秒',{source:{uiClass:"mmui::ChatVoiceItemView"}})),...Array.from({length:25},()=>row("other","[视频]"))];
const legacySummary=captureCoverage(legacy506);assert.equal(legacySummary.total,506);assert.equal(legacySummary.readableText,328);assert.equal(legacySummary.unreadImage,72);assert.equal(legacySummary.unreadSticker,9);assert.equal(legacySummary.unreadVoice,72);assert.equal(legacySummary.other,25);console.log("PASS legacy 506-record shape: voice72/other25, strict duration headers and ChatVoiceItemView.");
