# 人物对照 · 两端实现与验证

## 可直接使用

- 网页 `/archive` 人物列表下方和小程序人物列表内，点击“开始对照”。
- 明确选择 2–3 位当前档案中的人物，按选择顺序并排展示；第四位禁用，取消一位即可换人。
- 手机在表格内横向滚动，页面本身不横向溢出。
- 同组字段包括关系阶段、婚恋状态、婚育想法、城市、明确期待与边界、互动参考、可比趋势、资料适配与覆盖、待核对线索、已有下一步建议和一个核对问题。
- 可展开年龄、学历、职业、生活方式，以及既有六项适配解读和依据；可查看自己已填写的关系期待。
- 可从表头进入人物档案，从已有分析来源进入对应报告。

## 数据规则

使用现有 profile API 返回值进行本地只读投影，无新增 API、模型调用、积分扣费、存储写入或综合排名。数据范围始终是当前页面已经读取的本账号档案。

- 选择时过滤已删除、无效、重复或不属于返回人物列表的 ID，上限 3 位；更换数据后失效选择自动消失。
- 已确认档案字段优先；仅 `accepted` 的结构化事实可以补足空字段。`pending` 单独列为待核对，永远不替代已确认资料。
- “未提供”不会转换成零分。兼容已有适配口径，覆盖明确写“有可计分资料”，避免把同城等不计分项误称未知。
- 互动指标沿用原分析，片段及估算明确标注不可比较。聊天日期与保存时间分开展示；无日期的新上传不会被自动当成最新互动。
- 趋势只展示服务端已判定 `connectPrevious` 的日期明确可比记录；否则显示“尚无连续可比记录”。不按上传顺序自造上升/下降结论。
- 每位人物保留各自的依据、来源及可获得的时间。缺少材料日期明确写未提供；人物档案更新时间不冒充事件时间。
- 核对问题由当前待核对线索或用户已填写、对方尚缺的资料字段生成固定模板；不判断谁更好，不把相处推测当事实。

## 文件

- `lib/person-comparison.mjs`：共享投影。
- `miniapp/lib/person-comparison.js`：通过 `scripts/sync-person-comparison.mjs` 同步为小程序 CommonJS；单测逐字验证两份口径一致。
- `components/ArchiveComparison.tsx`、`components/archive-comparison.module.css`：独立网页组件及局部样式。
- `app/archive/page.tsx`：列表仅增加该组件。
- `miniapp/pages/archive/index.js/.wxml/.wxss`：列表内部控件、选择状态、横滚面板；保留原详情内容和事件。

## 验证

- `node scripts/test-person-comparison.mjs`：两端投影一致、来源/日期、未知值、待核对隔离、片段标记、当前数据范围、无修改原状态；执行真实小程序选择处理器验证上限、取消、换人、人物删除后的选择清理。
- `node scripts/test-miniapp.mjs`：既有小程序完整离线流程继续通过。测试加载器增加新模块并更新新增空状态的模板断言。
- `node node_modules/typescript/bin/tsc --noEmit --pretty false`：通过。
- `node scripts/qa-person-comparison.mjs`：隔离 Edge + 最终本地构建 + 合成 API，5 组通过。使用真实 CDP 鼠标事件点选、取消、展开依据；检查 1280/390 宽布局、手机表格内横滚；确认全部请求仅现有 GET，没有分析或 mutation 请求。
- 浏览器结果 `outputs/person-comparison/qa.json`；截图 `comparison-1280.png`、`comparison-390.png`、`comparison-390-scrolled.png`。桌面与手机截图已目视检查。
- 主任务原生模拟器夹具 `.tmp/miniapp-comparison-fixture.json`，用 `node scripts/test-person-comparison.mjs --write-fixture` 可再生成。全部为合成人物，未使用真实客户资料。

实际微信渲染和后续统一字体调整的原生截图由主任务验收。此子任务未部署、未调用付费模型。
