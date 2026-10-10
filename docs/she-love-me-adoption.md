# 她不一样方法接入

已实际接入共享检索与提示层，具体内容、固定来源、去重依据、许可证和真实测试证据统一记录在 [skills-adoption.md](skills-adoption.md)。其中第 1 节对应她不一样，第 2 节为用户随后追加的 wechat-chat-analysis。

正式指南：knowledge/references/practical/互动循环与修复复盘：从具体片段到下一步.md。

完整 MIT 许可证：third-party/she-love-me/LICENSE。

验证：node scripts/test-skills-adoption.mjs 已通过，包含真实 quickJudgment 与网页/小程序共用 text POST 三种模式的提示注入；模型与数据库全为本地 stub，无付费调用。
