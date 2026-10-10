import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import { inspectWechatZip, extractWechatZipText } from "../lib/wechat-zip-preview.ts";

function withoutUtf8FilenameFlag(input) {
  const bytes = Uint8Array.from(input);
  for (let index = 0; index < bytes.length - 12; index++) {
    const local = bytes[index] === 0x50 && bytes[index + 1] === 0x4b && bytes[index + 2] === 3 && bytes[index + 3] === 4;
    const central = bytes[index] === 0x50 && bytes[index + 1] === 0x4b && bytes[index + 2] === 1 && bytes[index + 3] === 2;
    if (local || central) {
      const flagIndex = index + (local ? 6 : 8);
      bytes[flagIndex + 1] &= ~8;
    }
  }
  return bytes;
}

const sparse = withoutUtf8FilenameFlag(zipSync({ "聊天记录.txt": strToU8('·[语音] 3"\n\n·[语音] 10"\n\n·[语音] 8"\n\n·一条虚构文字\n') }));
assert.deepEqual(inspectWechatZip(sparse), {
  totalMessages: 4, textMessages: 1, voicePlaceholders: 3, imageReferences: 0, otherReferences: 0,
  namedMessages: 0, timedMessages: 0, speakerLabels: [], imageFiles: 0, audioFiles: 0, otherFiles: 0,
});
assert.throws(() => extractWechatZipText(sparse, "我"), /不能直接转入分析/);

const blocks = [
  ["甲", "[语音] 3\""], ["乙", "[语音] 5\""], ["甲", "[图片] 微信图片_虚构.jpg"],
  ["甲", "[语音] 4\""], ["乙", "[语音] 6\""],
].map(([speaker, body], index) => `·${speaker}\n2026年09月30日 14:${String(index).padStart(2, "0")}\n${body}`).join("\n\n");
const mediaOnly = zipSync({ "聊天记录.txt": strToU8(blocks), "聊天记录内的图片、视频和文件/微信图片_虚构.jpg": Uint8Array.from([255, 216, 255, 217]) });
const preview = inspectWechatZip(mediaOnly);
assert.deepEqual({ total: preview.totalMessages, text: preview.textMessages, voice: preview.voicePlaceholders, image: preview.imageReferences, named: preview.namedMessages, timed: preview.timedMessages, speakers: preview.speakerLabels.length, files: preview.imageFiles },
  { total: 5, text: 0, voice: 4, image: 1, named: 5, timed: 5, speakers: 2, files: 1 });
assert.throws(() => extractWechatZipText(mediaOnly, "甲"), /不能直接转入分析/);
const textOnly = zipSync({ "聊天记录.txt": strToU8([
  "·甲\n2026年09月30日 14:00\n周日一起看展吗？",
  "·乙\n2026年09月30日 14:01\n我下午有空，你想几点去？",
].join("\n\n")) });
assert.deepEqual(extractWechatZipText(textOnly, "乙"), {
  me: "乙", other: "甲",
  text: "2026年09月30日 14:00 甲：周日一起看展吗？\n2026年09月30日 14:01 乙：我下午有空，你想几点去？",
});
assert.throws(() => extractWechatZipText(textOnly, "陌生人"), /不能直接转入分析/);
const mixed = zipSync({ "聊天记录.txt": strToU8("·甲\n2026年09月30日 14:00\n周日见\n\n·乙\n2026年09月30日 14:01\n[语音] 4秒") });
assert.throws(() => extractWechatZipText(mixed, "甲"), /不能直接转入分析/);
assert.throws(() => inspectWechatZip(zipSync({ "其他.txt": strToU8("not a chat") })), /聊天记录\.txt/);
assert.throws(() => inspectWechatZip(zipSync({ "聊天记录.txt": strToU8("x".repeat(1_120_001)) })), /过大|过长/);
console.log("WeChat ZIP tests passed: preview-only sparse/media records, explicit-self text extraction, missing chat and size limit.");
