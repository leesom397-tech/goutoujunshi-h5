/** Topic words alone ("结婚", "暧昧") are not a description of this relationship. */
function hasSituation(text: string) {
  return /[“「"][^”」"]{3,}[”」"]|(?:对方|他|她|TA)说[：:]?[^？?]{3,}/i.test(text)
    || /(?:认识|交往|相处|恋爱|在一起|结婚|分手)(?:了|已经)?[一二三四五六七八九十百两几半\d]+(?:个)?(?:天|周|星期|月|年)/.test(text)
    || /(?:我们|我和(?:他|她|TA)|我跟(?:他|她|TA))(?:现在|目前)?(?:是|算是|在)(?:同事|同学|朋友|夫妻|恋爱|交往|暧昧)/i.test(text)
    || /(?:昨天|前天|昨晚|上周|上次|最近|刚刚)[^？?\n]{0,35}(?:说|问|约|见|聊|回复|拒绝|取消|吵|分手|表白)/.test(text)
    || /(?:他|她|对方|TA)[^？?\n]{0,12}(?:(?:总是|每次|一直|经常|很少|突然|主动)(?:找我|联系|约|回复|回我|取消|见面)|回复(?:很)?(?:少|慢)|不再联系)/i.test(text);
}

/** Read only the person-specific blocks emitted by loadProfileContext. An empty
 * person label or the user's own profile cannot fill in the other person's story. */
export function hasQuestionPersonContext(context: string) {
  return context.split("\n").some(line => {
    let payload = "";
    if (line.startsWith("当前人物：") && line.includes("；已保存资料：")) payload = line.split("；已保存资料：")[1];
    else if (/^(?:已授权微信原话摘录|已确认事件原记录|已确认资料原记录|用户确认保留的资料线索|用户主动记录的行动反馈摘录)/.test(line)) payload = line.slice(line.indexOf("：") + 1);
    if (!payload) return false;
    try {
      const value = JSON.parse(payload);
      if (Array.isArray(value)) return value.some(row => typeof row === "string" ? !!row.trim() : row && typeof row === "object" && [row.value, row.evidence, row.userFeedback].some(item => typeof item === "string" && item.trim()));
      return value && typeof value === "object" && Object.values(value).some(item => typeof item === "string" && item.trim());
    } catch { return false; }
  });
}

/** Ask only when a personal judgment has no usable situation to work with. */
export function needsQuestionBackground(body: Record<string, unknown>, available: { history: boolean; profile: boolean; images: boolean }) {
  if (body.mode !== "conversation" || body.skipIntake === true || available.history || available.profile || available.images) return false;
  if (typeof body.background === "string" && body.background.trim()) return false;
  if (Array.isArray(body.history) && body.history.slice(-6).some(row => row && typeof row === "object" && row.role === "user" && typeof row.content === "string" && (hasSituation(row.content) || /^【(?:本次导入原文|用户主动带入的分析摘要)/.test(row.content)))) return false;
  const question = typeof body.self === "string" ? body.self.trim() : "";
  if (!question || hasSituation(question)) return false;
  return /他|她|对方|我们|这段关系|追到|追她|复合|冷淡|喜欢我|爱我|不回我|渣男|渣女|有没有风险|是否喜欢|ta/i.test(question);
}
