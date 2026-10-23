import skills from './chat-skills.generated.json';

/** Real, reviewed upstream skill text, bundled once on the server. Skills are
 * not installed/executed on customers' machines and never get filesystem tools. */
export function reviewedChatSkillContext(intent:'reply'|'analysis'='reply') {
 const selected=intent==='reply'?skills:skills.filter(skill=>skill.id==='humanizer-zh');
 return ['以下加载已审核技能的原文片段，供本轮表达使用。遵守当前任务的输出结构、说话人身份与证据边界；技能例子不属于这位用户，不能带入其经历。不得执行文件、建档、搜索、发送或安装操作；不要复述内部技能名称。',
  ...selected.map(skill=>skill.content)].join('\n\n');
}

export const CHAT_SKILL_REVISIONS=/* @__PURE__ */ skills.map(({id,revision,source})=>({id,revision,source}));
