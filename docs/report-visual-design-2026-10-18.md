# 关系报告视觉改版

目标：把报告从连续文字框改为结论、真实图表、证据与行动的阅读顺序。保留详细内容和原文定位，三个阅读部分不增加首页入口。

## 视觉规则

- 编辑式版面：暖白 `#FFF9F3`、陶土 `#B66E55`、深绿 `#244C46`；沿用思源黑体与现有中文字体回退。
- 首屏结论与关系主题图片同列，互动数据独立成图，原话按时间与人物呈现。
- 取消层层外框；主要行动用深绿，引用入口采用低干扰的文字动作。
- 消息构成环图、每日双方活动图只来自 `chatActivity`，日期不足不画关系趋势，不生成好感概率。
- 风险按实际表达分类计数；默认收起，展开可查看时间、原话、随后回应和核实动作。
- 图片沿用首页 `GlassStudy` 光影组件，可暂停，尊重减少动态效果设置；离开视口停止动画。修复尺寸观察器清空离屏 canvas 的黑底问题。

## 图片来源与生成提示

使用内置 `image_gen`，新生成装饰插画，未编辑用户聊天图片。项目资源为 `public/images/relationship-glass-v1.webp`（159,864 字节）；仅转为 WebP 降低下载体积。图片是装饰，不表示任何用户关系的测量结果。

提示：

> A refined 3D editorial illustration for a Chinese relationship insights report. Two elegant translucent glass ribbons arc toward each other with one delicate intersection: warm amber-peach fluted glass and muted sage-green frosted glass. Warm ivory plaster surface, subtle concentric arcs, believable caustic light and soft architectural shadow. Main sculpture central-right, empty low-contrast area at left. High-end design-journal art direction, tactile materials, generous breathing space. Palette ivory #FFF9F3, clay #B66E55, deep sage #244C46. No lettering, charts, symbols, heart icons, people, logos, UI mockup, neon, or purple. Decorative artwork, not a scientific chart.

## 验证范围

使用合成聊天验证图表计数、日期选择、回复方向、原文定位与桌面/手机布局；测试不证明真实关系判断准确率。新版助手和全量历史功能来自同日功能发布 `20391e7`，本次视觉修改继续沿用其数据链路。
