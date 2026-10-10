# 产品参考：让洞察接续到真实问题

查阅日期：2026-10-09。使用已认证 Firecrawl CLI，原始结果保存在 `.firecrawl/research-{rosebud,dayone,headspace,notion-evidence}-20261009.json`。本次只读官方产品页面；没有下载或复用第三方图片，没有根据营销文案推断临床效果。

| 官方资料 | 实际观察 | 成子可迁移方向 |
| --- | --- | --- |
| [Rosebud](https://www.rosebud.app/) | 官网把过去记录关联、语音表达、每周进展报告拆成不同功能段；页面为记忆、语音和周报提供分别标注的界面示例，并搭配锁、心、目标等功能图标。 | 图标承担入口识别；各页面配图表达对应任务。记忆体验应说明当前判断关联了什么历史材料，不能仅显示一个笼统的记忆标志。 |
| [Day One Daily Chat](https://dayoneapp.com/features/daily-chat/) | 追问帮助补齐情境；对话先形成可编辑草稿，由用户决定保存；可以回到过去日期补充；AI 功能需主动启用。 | 对报告中的某一疑问继续问，先把问题带入可编辑输入框。反馈与归档继续使用现有明确确认，避免替用户把推测保存成事实。 |
| [Headspace Ebb](https://www.headspace.com/ai-mental-health-companion) | 支持语音、文字以及两者切换；根据当下讨论推荐具体应用内活动，记住既往话题以便接续。 | 将“继续聊”拆成核实判断、其他解释、自然问法等具体下一步；沿用已有语音转文字追问。这里不移植其医疗定位或疗效宣传。 |
| [Notion Enterprise Search](https://www.notion.com/help/guides/find-answers-and-generate-reports-with-enterprise-search) / [Notion Agent](https://www.notion.com/help/notion-agent) | 回答可以查看来源并收窄来源范围；Agent 可围绕用户选中的页面块聊天。 | 用户选中哪条推测和其中哪一步，就优先带那部分证据去咨询，避免长报告摘要挤掉真正的问题。后续可做明确的材料来源定位，前提是有真实引用关联。 |

## 代码现状审查

- `ReportView.tsx` 已有结论、下一步、推荐回复、整体报告追问、逐句分析、资料适配及复盘入口。
- `InsightExplorer.tsx` 是当前的“互动洞察画布”；仓库没有独立的 `InsightCanvas` 文件。
- 已有观察依据 / 深层推测 / 另一种解释 / 验证观察四步切换、多假设选择、真实消息构成环图、适配维度覆盖及减少动画支持。
- `ReportFollowUp.tsx` 已可明确保存六类实际结果，再携带已保存结果继续聊。不能把这些既有能力描述为本轮新增。

## 本轮真实增量

在用户当前选中的洞察下提供三个追问动作：核实这个判断、还有哪些解释、帮我想个自然问法。使用 `followup(report, owner, source, focus)`，其中 `focus` 明确包含被选中的标题、步骤、现有依据与可编辑问题。

进入聊天本身不发送请求、不扣积分；由用户在聊天页确认发送。上下文仍限定当前账号、当前人物与 30 分钟有效期；没有验证观察的旧报告不会被前端补造验证结果。

新 UI 继续使用暖米白和现有 Lucide 线性图标。参考第三方产品的结构和操作关系，不直接使用它们的插画、截图或商标作为产品素材。
