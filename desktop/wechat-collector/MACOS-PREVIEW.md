# 成子微信助手 · Mac 预览版

版本：1.2.23-mac-preview.1。此包仅面向 Apple Silicon Mac；不替换 Windows 1.2.23 下载。

应用保留原始资料，按你在网页选择的联系人导入。首次准备本机语音模型需要联网下载约 163 MB，之后语音在电脑上转写。

这是开发验证包，尚未使用 Apple Developer ID 签名和公证。系统的来源确认提示可能出现；构建或启动脚本不会关闭 Gatekeeper、SIP，也不会自动移除下载隔离标记。不能把构建通过理解为已经完成真实微信版本、联系人、语音和朋友圈的全流程验收。

包内 `LICENSE-voice-dependencies.txt`、`vendor/CHATLOG_KEEPER_LICENSE`、`vendor/chatlog-keeper-pin.json`、`vendor/NOTICE.md` 和依赖的 dist-info 保存开源许可与固定来源。不要删除。

首次使用由程序探测当前 macOS、芯片、微信版本与所需权限，依界面提示授权。任何系统权限不足或版本尚未适配都应明确显示；不会把未读取的图片或未缓存的朋友圈当成已采集。
