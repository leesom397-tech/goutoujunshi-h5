# 小程序功能迁移到成子网页端

界面最新发布：暖米白与抽象光影版本 `9d599d9a-1ef6-435b-b155-5904c234081f`，详见 [配色、素材与验证](warm-design-release-20261009.md)。功能迁移和专属音色延续下述版本。

最新：2026-10-09 工作台、搜索、洞察图表与专属语音已升级，当前 Worker 版本 `38aa2284-f149-46ef-99e6-8d093e1dacda`；详见 [本轮发布记录](product-upgrade-release-20261009.md)。以下保留此前功能迁移的验收记录。

状态：已于 2026-10-09 发布到 https://coach.lovetalk.love/ 。当前 Worker 版本为 `3e180068-fe81-401b-b3f6-53a74275a1ad`，15 项匿名线上检查全部通过（见 `outputs/web-parity/production.json`）。产品名称统一为「成子关系决策智能体」。新客户直接注册本站账号，历史渠道与旧账户兼容配置不作为新注册前提。

本次发布按小程序全部 9 页重新核对业务与结果字段，补齐截图排序、全部照片线索、12 MB 资料原图本机优化、补图上下文、结构化归档、反馈和趋势；修复账号切换、录音与语音生命周期、缺项价格门禁，并新增免费 2–3 人资料对照。逐项证据见 `web-miniapp-parity-audit.md`，不以源码对照代替真实模型或所有设备验收。

界面保留明亮玻璃、可暂停光影和原始蓝色 Orbit 标志。根据最新反馈整体调整文字主次：正文通常 15px、辅助 12–13px，表单输入 16px，结论与关键数字突出。21 个最终页面/宽度组合含 320px 窄屏，未发现页面溢出或脚本异常；实际颜色/字号与人工判读见 `outputs/readability/review.md`。之前同轮 54 项手机/桌面页面和管理员界面检查通过。

两份参考方法已进入两端共享知识检索，共 50 份文档（49 份参考）；具体采用内容、来源、许可与真实提示构造测试见 `skills-adoption.md`。小程序全部 9 页同步设计和文字层级，官方工具 27 项编译/模拟器检查通过，并实际点选验证 1→2→3 人对照与第四人禁用、横滚项目列。用户已明确同意生成扫码预览，微信开发者工具已成功生成 `outputs/design-refresh/chengzi-miniapp-preview-20261009.jpg`。这是临时预览码；小程序仍未上传体验版或正式发布。

生产库在前次交付已应用 `0017_web_accounts.sql`，网页管理员名单已配置 `chengyi01` 对应的既有账户。本次未变更生产数据库结构或开通名单，管理员登录操作未使用用户密码进行生产验收。

## 页面对应

| 小程序页面 | 网页入口 | 已迁移的主要行为 |
| --- | --- | --- |
| `pages/home/index` | `/workspace` | 分析、军师、人物、语音和账户入口；当前账户状态。 |
| `pages/quick/index` | `/analyze?mode=chat` | 1–9 张聊天截图、左右身份确认、人物关联/就地建档、分片上传、进度、断点续传、部分结果、费用显示、回复改写及头像候选。 |
| `pages/social-profile/index` | `/analyze?mode=moments`、`/analyze?mode=social` | 朋友圈整页、社交资料截图、本人/他人、与自己适配对照、补图、公开主页链接、事实与深度洞察、确认归档；`kind=profile` 链接也兼容。 |
| `pages/chat/index` | `/chat` | 自然咨询、对方原话分析、自我需求定位、人物上下文、报告追问、回复复制、30 秒语音输入、最近对话保留开关、同请求重试。 |
| `pages/voice/index` | `/voice` | 浏览器麦克风、实时双向音频、文字转录、打断/静音、人物资料授权、结束/离页清理。 |
| `pages/report/index` | `/report?id=<报告 UUID>` | 完整逐句报告、依据、情绪/意图、互动参考指数、资料适配、深度洞察、回复与继续追问。 |
| `pages/archive/index` | `/archive`、`/archive?tab=self`、`/archive?subjectId=<人物 UUID>` | 我的资料与偏好、人物编辑/删除、头像裁剪、待确认线索、互动时间线与可比趋势、事件/日期/反馈、导出、暂停/恢复/清除授权数据。 |
| `pages/person-new/index` | `/person-new` | 无截图建档、基础资料与关系背景、幂等创建；分析页也可就地建档。 |
| `pages/account/index` | `/account`、`/admin/credits` | 公开用户编号、积分余额/预留/流水、功能有效期、人工开通；管理员独立调整积分和权限。 |
| 微信平台登录与电话授权 | `/register`、`/login`、`/logout` | 网页使用独立账号与 HttpOnly Cookie。浏览器不模拟微信 `getPhoneNumber`；既有小程序关联在 `/miniapp/manage` 管理。 |
| 销售与说明 | `/sales`、`/privacy`、`/account#contact` | 功能介绍、隐私说明、联系客服和核对开通。 |

好感/互动指数和资料适配分别显示；缺少证据的维度保持待验证。趋势依赖已确认日期、去重和可比的独立互动，不能按分析次数推断关系进展。

## API 对应与身份

网页请求使用同源 Cookie，服务端解析 owner；客户端不能传 owner ID 指定他人数据。小程序 Bearer 会话继续用于小程序端。

| 小程序接口 | 网页接口或替代 |
| --- | --- |
| `/api/miniapp/login`、`session` | `/api/auth/register`、`/api/auth/login`、`/api/auth/session`、`/api/auth/logout`；`/api/web/session` 提供人物与截图授权状态。 |
| `/api/miniapp/settings` | `/api/web/settings` |
| `/api/miniapp/screenshot`、`screenshot/status` | `/api/web/screenshot`、`/api/web/screenshot/status` |
| `/api/miniapp/screenshot/batch` | `/api/web/screenshot/batch`，完整 Worker 的 Durable Object 任务入口。 |
| `/api/miniapp/social-profile` | `/api/web/social-profile`，使用相同后台分片任务协议。 |
| `/api/miniapp/social-link` | `/api/web/social-link` |
| `/api/miniapp/report`、`rewrite` | `/api/web/report`、`/api/web/rewrite` |
| `/api/miniapp/text`、`transcribe` | `/api/web/text`、`/api/web/transcribe`；语音输入编码为 16 kHz 单声道 WAV。 |
| `/api/miniapp/voice-live`、`voice-live/status`、`voice-live/check` | 同名 `/api/web/voice-live*`；WebSocket 使用浏览器同源 Cookie。 |
| `/api/miniapp/profile`、`avatar`、`relationship-feedback` | 同名 `/api/web/profile`、`/api/web/avatar`、`/api/web/relationship-feedback`。 |
| `/api/miniapp/credits`、`admin/credits` | `/api/account/credits`、`/api/account/admin/credits`。 |
| `/api/miniapp/phone`、`link`、`link-ticket` | 平台专属能力保留原渠道接口；网页注册不依赖微信手机号，已有渠道关联使用 `/miniapp/link`、`/miniapp/manage`。 |

批量任务遵循 `init → part → commit → GET taskId`。POST 的 `taskId` 同时写入 `X-Request-Id`；刷新后沿用账号隔离的 IndexedDB 文件与任务，不重发服务器已接收的分片。`init` 返回已完成状态但未携带结果时，会先 GET 完整结果再清理临时文件。部分批量失败保留已完成报告，整组失败释放预留积分。

文字等付费请求保存同一请求编号与请求内容，成功回执可重试获取；账户改变会清除可见旧数据并停止旧上传/通话。原始文本对话默认只保留当前窗口，用户可选择在本浏览器保存最近 30 条；这不是云端对话历史同步。

## 账户、费用和人工销售

- 新注册建立本站用户和会话，不赠送积分，不启用付费功能。
- 价格由 `/api/account/credits` 读取，当前定义见 `lib/account-credits.mjs`；界面不自行决定收费。
- 客户联系微信 `lxlikex`，提供账户页公开用户编号，确认服务内容和价格后由管理员操作。
- 管理员 allowlist 使用 `COACH_WEB_ADMIN_OWNER_IDS`，兼容原有 `COACH_ADMIN_OWNER_IDS`。内部 owner ID 与客户公开用户编号不同。
- 积分调整与功能/有效期是独立幂等操作，必须各自核对；没有在线支付订单与自动支付回调。
- 已有数据库需包含 `0015_account_credits.sql`、`0016_credit_receipts.sql` 和新增 `0017_web_accounts.sql`；实际生产是否应用须查询目标数据库，不能由文件存在推定。

## 验证入口与已知边界

| 验证 | 覆盖 |
| --- | --- |
| `npx tsc --noEmit`、`npm run build` | 类型、路由与构建集成。 |
| `scripts/test-web-native-auth.mjs` | 原生注册/登录/退出、Cookie、密码验证、账户隔离、无自动赠送、登录限流。 |
| `scripts/test-web-api.mjs`、`test-web-admin.mjs` | 认证、来源、账本与任务路径、管理员权限、旧接口计费门禁。 |
| `scripts/test-account-credits.mjs`、`test-credit-response.mjs` | 积分预留/结算/释放与成功回执重放。 |
| `scripts/qa-web-parity.mjs` | 独立 Edge、本地真实注册与账户、手机/桌面布局、合成管理员操作。 |
| `scripts/qa-web-analysis.mjs` | 合成批量上传、跳过已收分片、完成任务恢复、刷新后相同文字请求重试、麦克风拒绝后的资源清理。 |
| `scripts/qa-web-archive.mjs` | 合成人物资料、自我偏好、线索、事件、日期、反馈与数据管理交互。 |

本地完整 Worker 浏览器回归已通过：分析 8 项、档案 12 项、对话/语音 8 组、人物对照 5 组，分别记录在 `outputs/web-analysis/qa.json`、`outputs/web-archive/qa.json`、`outputs/conversation-parity/qa.json`、`outputs/person-comparison/qa.json`。所有模型响应均为合成数据，真实付费调用为 0。其余测试的执行结果见对应审计文档。浏览器脚本使用 Windows Edge 与 `127.0.0.1:5191`。

目标部署与匿名访问已核对；销售交付仍需按实际客户开通账户，并核对真实材料的模型效果。本轮功能回归使用合成模型响应，未发起生产付费模型调用。实时语音已实现浏览器协议与资源生命周期，麦克风拒绝已验证；真实手机的扬声器回声、打断效果、耳机体验和语音上游连通性仍未完成真机验收。公开主页链接只能读取平台公开返回的文字，遇到平台限制应使用截图；不承诺抓取完整账号历史。所有本机保留内容依赖浏览器存储，清除站点数据会丢失本机记录。
