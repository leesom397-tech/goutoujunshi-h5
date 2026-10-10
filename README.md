# 成子关系决策智能体 · 网页端

成子是独立产品。客户可直接在 `/register` 注册本站账号，经 `/login` 登录后使用 `/workspace`、`/analyze`、`/chat`、`/voice`、`/archive` 和 `/account`，无需先注册其他产品或等待小程序审核。既有技术域名为 `coach.lovetalk.love`；本说明不代表本次迁移已经发布，实际地址与版本以部署验收记录为准。

## 当前实现

网页已承接小程序的聊天截图、朋友圈、社交主页、文字咨询、语音转写、实时语音、人物档案、资料适配、关系趋势和行动反馈。批量截图支持 1–9 张、分片上传、后台处理、部分进度和刷新后恢复；报告包含原话依据、另一种解释、深度洞察及可复制回复。手机与电脑共用同一套网页功能。

新账号使用本站数据库注册、密码校验及 HttpOnly 会话 Cookie；服务端按已认证身份读取档案和积分。历史客户的既有登录兼容路径保留，但新注册不调用外部注册服务，也不会因相同显示名称自动合并两个账户。没有生产模拟登录。

代码已实现积分扣费。文字咨询、截图批量分析、资料分析、回复改写、录音转写和实时语音都有服务端扣费校验；发起前显示实际价格，处理时预留，成功后结算，失败释放，重试沿用请求编号。新注册账号不自动赠送积分或开通功能。积分和权限是两个独立操作，管理员需要同时核对余额、功能范围和有效期。

当前售卖方式为人工确认服务和收款后开通：客户在 `/account#contact` 联系微信 `lxlikex`，提供账户页的公开用户编号；管理员在 `/admin/credits` 查询该编号，调整积分并开通功能/有效期，填写原因以保留记录。`/sales` 为销售介绍页。当前没有在线支付下单和自动支付回调，不把“联系开通”表述为已完成付款。

分析、截图、关系档案、择偶定位和录音转写使用阿里云百炼千问；实时语音使用千问实时音频模型。知识核心规则及专题资料随构建打包，运行时按问题召回；来源与第三方许可见 `THIRD_PARTY_NOTICES.md`。小程序到网页的逐项映射、测试入口及验收边界见 [网页迁移发布说明](docs/web-parity-release.md)。

## 保留的既有能力

电脑端聊天档案位于 /history。用户可导入自己已经取得的 TXT／CSV／JSON 单聊文本，核对双方身份，在本机浏览器保存、搜索、删除，并选最近 30／60／120 条可读消息单独交给模型分析。也可自选关键词，从长记录中本地抽样前后原话，逐字核验模型引用并要求说明其他解释；这不是撒谎或骗子判定。单文件上限为 20 MB 或 20 万条；不假装读取微信备份数据库、语音占位正文，也不把整份档案上传服务器。浏览器本地存储未加密，清除浏览器数据后无法恢复。当前不提供 Windows 微信数据库解密或自动全量导出。

聊天副驾支持逐句语气/可能意图标签、证据不足提示、对象级上下文、追加、历史报告续接、临时聊天隔离及删除。千问截图识别先给快判断；用户一次性单独开启完整分布后，新报告可将最多 80 句、每句最多 160 字的可读文字摘录交给 TypeSafe AI 补全情绪与意图，不发送原图或完整关系档案，旧报告只在主动打开时补全，可关闭后续发送。六维互动信号另需单独同意最多 40 条聊天文字摘录的处理范围；该功能复用并改编了 MIT 许可的 Crush Monitor 六维规则和合成逻辑，分数不是好感概率，证据不足不显示总分。来源及版权信息见 vendor/crush-monitor/UPSTREAM.md 和 LICENSE。Jev 原生接口需要单独配置 JEV_API_KEY，不能使用千问 key。

网页逐句页可直接上传本人单聊截图，核对左右身份及单独授权后生成与当前对象绑定的报告；已关联同一账户时，可从微信报告进入网页查看对应报告。网页保存分析图在用户本机生成 JPEG，不需要新的图片账号；手机提供长按保存预览。微信截图先回快判断，再自动发送彩色逐句图；页数超出自动发送上限时可发「第2页」继续。真实微信端的首响、识别尾延迟和图片成功率仍需联调。

材料导入页可在浏览器本机预览微信转发的 ZIP：仅统计文字、说话人／时间标识及媒体占位／附件，不上传原包，也不自动分析。只有纯文字、完整双人标识和时间的 ZIP，才允许用户亲自选择“谁是我”后将文字带入原有分析表单；还需再次核对内容并勾选材料授权和说话人映射。缺失语音或图片正文、身份不完整时停在预览。语音时长占位不是语音正文，未识别的图片附件也不能用于判断对方意图。用 `npm run test:wechat-zip-preview` 验证这些边界。

关系档案只保存用户明确同意的资料和待确认线索。开启聊天副驾后，相关聊天文字与报告短期保留 7 天，连续使用时旧消息也会按到期时间清理。关闭或删除会撤销授权、删除对应数据并取消待发送结果。原截图和录音不写入长期档案。网页批量上传会把待上传图片临时保存在当前浏览器，以恢复中断任务；任务完成或取消后清理临时上传记录。

## 环境与账户配置

部署入口仍为 `wrangler.coach.jsonc` 和 `worker-entry.mjs`，包含 D1、后台截图任务、语音网关和微信队列。普通 Vite 开发预览不等于完整 Worker 集成环境；需要验证后台任务、积分和实时语音时使用完整 Worker 本地预览。

- 模型：`DASHSCOPE_API_KEY`、`DASHSCOPE_WORKSPACE_ID`；可选 `QWEN_VOICE_ID`。Jev 分类另需 `JEV_API_KEY`，不能用千问 key 替代。
- 网页管理员：服务器 secret `COACH_WEB_ADMIN_OWNER_IDS`，填写逗号分隔的已验证内部 owner ID。本站账号形如 `chengzi:<用户 UUID>`，可在该账号认证后的 `/api/auth/session` 返回值 `user.id` 核对；它不是账户页用于客户开通的公开用户编号。既有 `COACH_ADMIN_OWNER_IDS` 管理员配置继续生效。
- 小程序和微信客服仍使用 `.env.example` 中的 `MINIAPP_APPID`、`MINIAPP_APPSECRET`、`WECHAT_CORP_ID`、`WECHAT_KF_SECRET`、`WECHAT_CALLBACK_TOKEN`、`WECHAT_ENCODING_AES_KEY`、`WECHAT_KF_ID` 及可选 `WECHAT_KF_URL`。这些是渠道配置，不是网页注册的前置条件。
- 数据库先核对已有迁移，再应用尚未执行的迁移。积分需要 `drizzle/0015_account_credits.sql`、`0016_credit_receipts.sql`；独立网页注册、会话与登录限流需要 `0017_web_accounts.sql`。不要省略已有业务表的历史迁移。

设置管理员 secret 的命令会交互读取值，不把实际值写进源码：

```sh
npx wrangler secret put COACH_WEB_ADMIN_OWNER_IDS --config wrangler.coach.jsonc
```

已有本地业务库、且 0015/0016 已应用时，可单独执行新增的网页账户迁移：

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config wrangler.coach.jsonc --persist-to .wrangler/state --file drizzle/0017_web_accounts.sql
```

生产库迁移需核对目标和已执行记录，再使用相应的 `--remote` 操作；本说明没有执行生产迁移或授予管理员权限。密钥只放服务端配置，不写入源码、前端变量、截图或聊天消息。

微信渠道使用企业微信「微信客服」官方接口。既有回调路径为 `/api/wechat/callback`。已登录用户可启用档案并绑定渠道；首次截图识别仍须明确同意处理范围并确认左右身份。客服支持「逐句模式」「我叫昵称」「开始分段」「分析」「怎么回」「清空聊天」；换侧后的新截图进入独立会话，旧报告与旧记忆需由用户核对或删除。微信待处理 payload 临时缓存约 1 小时；网络发送结果未知时不自动重复发送。真实微信首响、尾延迟与图片成功率仍需渠道联调。

## 运行和验证

保留现有 npm 依赖及锁文件，要求 Node.js 22.13.0 以上。先停止占用 `dist` 的本地 Worker，再构建：

```sh
npm run build
npx tsc --noEmit
```

完整 Worker 本地预览（只连接本地数据库）：

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js dev --config wrangler.coach.jsonc --local --persist-to .wrangler/state --ip 127.0.0.1 --port 5191 --inspector-port 0
```

主要回归入口：

- `node scripts/test-web-native-auth.mjs`：独立注册、密码、会话、兼容账户隔离和零赠送。
- `node scripts/test-web-api.mjs`：网页身份、来源校验、后台任务、积分及旧接口计费边界。
- `node scripts/test-web-admin.mjs`、`node scripts/test-account-credits.mjs`、`node scripts/test-credit-response.mjs`：管理员权限、账本、失败释放与成功结果重试。
- `node scripts/qa-web-parity.mjs`：以本地 Worker 为目标的独立 Edge 浏览器，验证本地注册登录、手机/桌面页面和合成管理员操作。
- `node scripts/qa-web-analysis.mjs`：合成图片上传、断线恢复、任务结果恢复、聊天重试及麦克风拒绝清理，不调用付费模型。
- `node scripts/qa-web-archive.mjs`：使用合成 API 数据验证人物编辑、线索、事件、日期和档案交互。
- `node scripts/test-crush.mjs`、`npm run test:wechat-zip-preview`：保留的聊天副驾及本地 ZIP 预览回归。

三个 `qa-web-*.mjs` 浏览器脚本当前固定使用 Windows Edge 和 `http://127.0.0.1:5191`；运行前启动上述完整 Worker 并准备本地迁移。它们使用独立浏览器目录，不操作个人浏览器。模型与管理操作的浏览器测试使用合成数据，不能替代真实付费账号、真实截图质量及手机麦克风/回声体验验收。

正式发布命令为 `npx wrangler deploy --config wrangler.coach.jsonc`。运行构建、测试或阅读本说明不表示已经发布。实际发布前后需核对生产迁移、模型配置、管理员开通和客户访问；实时语音的真机音频质量仍待验证。既有微信详细说明见 `docs/crush-release.md`。

# 模板说明（保留作开发参考，不代表当前产品登录与部署）

# vinext-starter

A clean full-stack starter running on [vinext](https://github.com/cloudflare/vinext), with optional Cloudflare D1 and Drizzle support.

## Prerequisites

- Node.js `>=22.13.0`
- Portable: Windows, macOS, or Linux; no Bash required
- Managed Linux: managed Linux runtime with Bash, `flock`, `curl`, `sha256sum`, and GNU `timeout`
- Git is required only for publishing

## Sites Lifecycle

The Sites initializer copies the shared starter and selects managed-linux only when `SITES_MANAGED_LINUX_CONTAINER=1`; otherwise it selects portable. It saves the selection only in ignored `.sites-runtime/execution-profile.json`. Both profiles copy/configure first, then use the plugin's separate `install-dependencies.mjs` step to measure installation independently. Edit source under `app/` and follow the Sites skill for installation, preview, builds, and publishing.

Run `node <plugin-root>/scripts/configure-execution-profile.mjs` only when the profile is unknown for the current checkout and environment. Profile changes do not alter tracked source or require reinstalling otherwise-valid dependencies; restart an existing preview to use the new selection. Do not commit or upload `.sites-runtime/`.

This starter does not use `wrangler.jsonc`.

`install:ci` runs `npm ci` once against the shared lockfile, disables parent-workspace discovery, and includes required dev/optional dependencies despite production/omit settings. Sharp defaults to prebuilt binaries unless explicitly configured otherwise. Do not overlap installers.

- **Portable:** Preserve host HOME, npm cache, registry, proxy, temporary paths, retry/concurrency settings, and lifecycle-script policy. Use `--prefer-offline --no-audit --no-fund`.
- **Managed Linux:** Use the existing project-local HOME/cache/tmp setup and Linux install lock, tarball preflight, and timeout. Restore the image-seeded npm cache only when its lockfile hash matches; retain network fallback. Builds keep their existing timeout. These helpers are not invoked by the portable profile.

`scripts/sites-env.mjs` preserves the caller's HOME, npm cache, proxy, XDG, and temporary-directory configuration while defaulting Wrangler and Miniflare state to the checkout. If npm reports an unwritable cache, select a writable path with `npm_config_cache` for that install. The `dev` and `start` scripts also keep Wrangler logs inside the checkout. Generated `.sites-runtime/` and `.wrangler/` directories are disposable and ignored by Git.

On portable, `npm run dev` uses `vinext dev` with HMR, starting at port 5173. Vinext records the running server in ignored `.vinext/` state, rejects an ordinary duplicate launch, and recovers stale state after a stopped process; exactly simultaneous starts can race. Pass `--port <port>` or `--hostname <host>` after `npm run dev --` when needed; keep portable previews on loopback.

For browser QA on managed Linux, use `sites-preview start`. The project's dev script runs Vite and accepts the supervisor's `--host 0.0.0.0 --port 4173 --strictPort` arguments. The internal browser uses `http://terminal.local:4173/`; it is not a user-facing URL. The supervisor owns the preview lifecycle. The ignored local profile survives the supervisor's cleared process environment.

The portable profile simulates ChatGPT sign-in only for loopback development requests. Visit `/signin-with-chatgpt?return_to=/` to sign in as `local_seedy` (`seedy@sites.test`, display name `Seedy`) and `/signout-with-chatgpt?return_to=/` to sign out. The development cookie preserves that identity across server restarts. Mock auth is disabled in the managed-linux profile and is not included in production builds; hosted authentication remains dispatch-owned.

The Worker uses `vinext/server/fetch-handler`, including Vinext's config-aware image handling. After building, `npm start` runs that Worker locally through Wrangler on `127.0.0.1`, sharing `.wrangler/state` with dev preview and local D1 migrations; it does not deploy the site or simulate sign-in. Use the URL printed by the server. Pass `npm start -- --port <port>` to select a different built-preview port.

Local previews use Miniflare's placeholder `Request.cf` metadata without a network lookup. Set `CLOUDFLARE_CF_FETCH_ENABLED=true` to opt into fetching preview metadata; this setting does not change hosted request metadata.

Local tool usage metrics are disabled by default. Set `WRANGLER_SEND_METRICS=true` to opt in.

## Included Shape

- edit site code under `app/`
- `app/chatgpt-auth.ts` provides optional dispatch-owned ChatGPT sign-in helpers
- `.openai/hosting.json` declares optional Sites D1 and R2 bindings
- `vite.config.ts` simulates declared bindings for local development
- `db/index.ts` reads the D1 binding from the Cloudflare Worker environment
- `db/schema.ts` starts intentionally empty
- `@cloudflare/workers-types` provides Worker types; `cloudflare-env.d.ts` declares optional `DB`/`BUCKET` bindings—update these declarations if binding names change
- `examples/d1/` contains an optional D1 example surface
- `drizzle.config.ts` supports local migration generation when needed

## Workspace Auth Headers

Signed-in visitors receive both `oai-authenticated-user-id` and `oai-authenticated-user-email`. Private Sites require every visitor to sign in; public Sites may also have anonymous visitors, for whom neither header is present.

The user ID is stable for the same user on the same Site and different across Sites. Use it as the durable user key; use email and name for display or contact purposes.

SIWC-authenticated workspace sites may also receive `oai-authenticated-user-full-name` when the user's SIWC profile has a non-empty `name` claim. The full-name value is percent-encoded UTF-8 and is accompanied by `oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`.

Treat the full name as optional and fall back to email when it is absent:

```tsx
import { headers } from "next/headers";

export default async function Home() {
  const requestHeaders = await headers();
  const userId = requestHeaders.get("oai-authenticated-user-id");
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName =
    encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? decodeURIComponent(encodedFullName)
      : null;

  const displayName = fullName ?? email;
  // ...
}
```

## Optional Dispatch-Owned ChatGPT Sign-In

Import the ready-to-use helpers from `app/chatgpt-auth.ts` when the site needs optional or required ChatGPT sign-in:

- Use `getChatGPTUser()` for optional signed-in UI.
- Use the returned `userId` as the stable user key for user-owned records; do not use email as a durable identifier.
- Use `requireChatGPTUser(returnTo)` for server-rendered pages that should send anonymous visitors through Sign in with ChatGPT.
- In a Server Component, start sign-in with `<a href={chatGPTSignInPath(returnTo)} target="_top">`. The auth helper module is server-only; do not import it into a Client Component.
- Do not use `fetch`, XHR, a client-side router, or a framework link that can prefetch the sign-in route. SIWC must start as a top-level navigation.
- Never request the AuthAPI authorization endpoint directly. The dispatch-owned `/signin-with-chatgpt` route must start the SIWC flow.
- Use `chatGPTSignOutPath(returnTo)` for browser sign-out links or actions.
- Pass a same-origin relative `returnTo` path for the destination after sign-in or sign-out. The helper validates and safely encodes it.
- Mark protected pages with `export const dynamic = "force-dynamic"` because they depend on per-request identity headers.

Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`, the OAuth cookies, and identity header injection. Do not implement app routes for those reserved paths. Routes that do not import and call the helper remain anonymous-compatible.

SIWC establishes identity only; it does not prove workspace membership. Use the Sites hosting platform's access policy controls for workspace-wide restrictions, or enforce explicit server-side membership or allowlist checks.

Use SIWC for account pages, user-specific dashboards, saved records, and write actions tied to the current ChatGPT user. Leave public content anonymous.

## Local D1 migrations

For a D1-backed local preview, generate SQL with `npm run db:generate`. Build once through the Sites skill's build entrypoint (or `npm run build` for standalone use) to generate `dist/server/wrangler.json`, rebuilding if bindings change. From the project root, apply each pending migration in order:

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_example.sql
```

Replace the filename with the pending migration and `DB` with your D1 binding name if different. Use `.wrangler/state`, not `.wrangler/state/v3`; Wrangler adds the versioned directories. Do not replay migrations already applied locally. This updates only the preview database; publishing applies production migrations separately.

## Diagnostic Commands

- `npm run install:ci`: perform the one locked dependency install
- `npm run dev`: start the Vite/Vinext development server
- `npm run build`: build the deployable Sites artifact
- `npm run start`: preview the built Worker locally with D1/R2 support
- `npm run db:generate`: generate Drizzle migrations after schema changes

When using the Sites plugin, follow its skill instructions for installation, builds, and publishing. These npm commands remain available for standalone use.

The portable build runs Vinext directly without a host `timeout` command. The managed-linux build uses `scripts/build-verified.sh` and its existing `SITES_BUILD_TIMEOUT` setting.

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)


