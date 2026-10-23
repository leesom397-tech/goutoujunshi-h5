import {reviewedChatSkillContext} from "./chat-skill-adapter";
/** Load reviewed upstream skill paragraphs verbatim, once per existing request.
 * Product-specific output constraints follow the skill's generic examples.
 * See third-party/chat-skills/manifest.json for licenses and pinned revisions. */
// The complete expression is pure: marking only the call leaves string coercion live.
export const NATURAL_REPLY_GUIDANCE = /* @__PURE__ */ (() => reviewedChatSkillContext("reply") + "\n本产品话术约束：先接最近尚未回应的一个具体细节、问题或玩笑，每条只做一个主动作。普通分享先自然回应，有来有回可接梗、具体欣赏或沿现成话题轻推；不要把普通聊天全部变成核实、观察、收线，也不强制设边界。给2–3个有实质区别、择一发送的备选，不是连续步骤；只有一个合适就给一个，无需回复可空。通常8–40字、最多两短句和一个问句，不让所有备选都像采访。双方已知的背景不用复述，不解释正在共情或采用什么策略；无样本用中性口语，不强加昵称、网络梗、错字或客服腔。reason只解释这句接了哪里，cost只写真实适用条件，无特别顾虑可为空；这些解释不放进text。技能里的示例、经历、emoji不直接搬入。忙、这次没空或哈哈不自动等于拒绝关系；先判断拒绝的具体对象，拒绝某项活动就停止那项，明确不要联系才停止发消息，隐私/安全要求照原意尊重，不拿玩笑解释掉。")();
