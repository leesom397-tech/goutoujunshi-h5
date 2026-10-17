import {
  cleanConversationProfileCandidates,
  type ConversationMemoryLine,
  type ConversationProfileCandidate,
} from "./conversation-profile-memory";

// This deliberately covers only explicit skills and current tasks. The model
// remains responsible for interpreting other profile information. Check the
// whole message before extracting a sentence: quotes and hypotheticals must
// never become someone's own statement after trimming.
const unsafeContext = /[?？“”「」『』"'‘’]|(?:转发|引用|假如|假设|如果|要是|要不是|倘若|否则|吹牛|吹的|开玩笑|反讽|讽刺|装的|骗人的|瞎说|胡说|虚构|编的|否认)|(?:他|她|朋友|同事|客户|对方|别人|有人|家人|老板|妈妈|爸爸).{0,12}(?:说|写|问|表示|告诉)|(?:据说|听说|例如|比如|举例|台词|原话|转述)|我(?:根本|其实|并)?(?:没|没有|并不|从没|从未|不曾)说|(?:是不是|难道|是否|吗|呢)[。！!\s]*$|(?:不一定|也许|或许|可能|好像|似乎|才怪|算不上|谈不上)/;
const privateContext = /1[3-9]\d{9}|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\d{15,18}[Xx]?|身份证|银行卡|银行账号|精确地址|诊断|患有|性经历|月收入|年收入|存款|资产|身价|理财|投资|转账|贷款/;
const oneOffOrFormer = /(?:以前|曾经|过去|当年|小时候|今天|刚才|刚刚|这次|这回|那次|那回|这张|这段|现在不|已经不|不再|其实不|其实没)/;
const formerTask = /(?:以前|曾经|过去|当年|去年|小时候|当时|那时|不再|取消|放弃|没有这个计划)/;
const firstPersonBoundary = "(?:^|[，,；;：:\\s])";
const explicitStrength = new RegExp(`${firstPersonBoundary}(?:我(?:很|比较|挺|特别|最|还算)?擅长[^，,。；;！!\\n]{2,60}|我的长处(?:是|在于)[^，,。；;！!\\n]{2,60})`);
// "Very good at" without 擅长 is limited to recognisable skill descriptions;
// arbitrary adjectives or an isolated successful event are not stable skills.
const skill = "(?:拍照|摄影|修电脑|维修|编程|写代码|剪辑|画画|绘画|写作|做饭|烹饪|唱歌|跳舞|游泳|跑步|弹琴|弹钢琴|弹吉他|设计|策划|组织活动|沟通|谈判|演讲|数学|外语)";
const colloquialStrength = new RegExp(`${firstPersonBoundary}我${skill}(?:很|挺|特别|非常|可|比较)厉害(?:了|的)?(?:[，,。；;！!\\s]|$)`);
const taskAction = "(?:开发|制作|编写|设计|整理|搭建|创作|筹备|研究|学习|学|完成|改进|优化)";
const time = "(?:这周|本周|下周|这个月|下个月|今年|明年|接下来|最近|目前|现在)?";
const explicitGoal = new RegExp(`${firstPersonBoundary}(?:我${time}正在${taskAction}|我的目标是${time}${taskAction}|我${time}计划${time}${taskAction})[^，,。；;！!\\n]{2,100}`);
const ongoingWork = new RegExp(`${firstPersonBoundary}我${time}正在做[^。；;！!\\n]{4,140}`);
const workObject = /(?:项目|工具|应用|软件|程序|网站|视频|作品|课程|论文|模型|系统|产品|功能|流程|方案|课题|原型|报告)/;

/** Conservative local supplement; no network, storage, or profile mutation.
 * Returned candidates still go through the common attribution/privacy cleaner.
 * Values retain the exact self-description, including time and qualifications.
 */
export function extractExplicitConversationProfileCandidates(
  lines: ConversationMemoryLine[],
): ConversationProfileCandidate[] {
  const raw: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  for (const line of lines) {
    if (!line.localId || !["self", "other"].includes(line.senderRole) || line.kind && line.kind !== "text") continue;
    const source = line.text.trim();
    if (!source || unsafeContext.test(source) || privateContext.test(source)) continue;
    // Do not truncate long sentences: their trailing words may negate or
    // qualify a claim. A skipped long statement can still be handled by Qwen.
    for (const sentence of source.match(/[^。；;！!\n]+[。；;！!]?/g) || []) {
      const quote = sentence.trim();
      if (quote.length < 4 || quote.length > 160) continue;
      const field = !oneOffOrFormer.test(source) && (explicitStrength.test(quote) || colloquialStrength.test(quote))
        ? "strengths"
        : !formerTask.test(source) && (explicitGoal.test(quote) || ongoingWork.test(quote) && workObject.test(quote))
          ? "goals" : null;
      if (!field) continue;
      const target = line.senderRole === "self" ? "self" : "subject";
      const key = `${line.localId}:${target}:${field}`;
      if (seen.has(key)) continue;
      seen.add(key);
      raw.push({ target, field, value: quote, quote, basis: "statement", sourceId: line.localId });
    }
  }
  return cleanConversationProfileCandidates(raw, lines).slice(0, 12);
}
