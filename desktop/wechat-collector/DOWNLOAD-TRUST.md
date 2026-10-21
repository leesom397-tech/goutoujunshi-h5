# 下载信誉与正式签名（2026-10-21 核查）

## 已确认

本轮 1.2.19 安装包经 Windows `Get-AuthenticodeSignature` 检查为 `NotSigned`。浏览器“不常下载/可疑下载”和 Windows SmartScreen 是不同检查，不能以安装器签名代替 Chrome 下载检测。当前没有证书，不能承诺消除警告。

- 微软说明：未签名的新版本要重新积累文件信誉，旧版能下载不代表新版不会警告。签名后也可能有初期警告，EV 已不保证直接绕过 SmartScreen。[官方说明](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)
- Chrome 把不常见下载与危险下载区分处理；应先确认具体类别，必要时请求安全复核。[Chrome 帮助](https://support.google.com/chrome/answer/6261569?hl=en)

## 可执行路线

1. **正式主体签名**：为采集器主程序和安装器同时做 Authenticode SHA-256 签名与可信时间戳，再打包和计算最终校验值。已有 `sign_release.ps1` 支持证书存储区/证书文件；硬件令牌需配合供应商驱动。不要只签外层下载器。
2. **云签名**：微软 Artifact Signing 有 [官方 GitHub Action](https://github.com/Azure/artifact-signing-action)。但[公开信任资格](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart)目前不包含中国大陆主体，个人仅支持美国/加拿大。不能为使用服务虚填地址。SSL.com eSigner 等商业服务提供云 HSM，需由供应商确认实际主体能否认证，不能预先保证签发。[产品说明](https://www.ssl.com/products/software-integrity/code-signing/)
3. **开源项目**：SignPath Foundation 有免费签名，但必须满足其开源与构建政策，公开 GitHub 仓库本身不等于符合条件。[申请与条件](https://signpath.org/terms.html)
4. **商店渠道**：另行评估 Microsoft Store 打包、权限和采集功能兼容性；不是把当前 EXE 上传商店就完成签名和审核。

## 发布约束

固定发布者身份；发布文件不可原地重写；保留版本化 HTTPS 地址及 SHA-256。先验证签名再生成校验值，最后上传。不能通过关闭浏览器保护、改扩展名、加密 ZIP、自签名安装根证书来声称问题解决。

采购/身份认证须由主体负责人完成。当前只完成路线核查与现有签名脚本检查，未购买证书、未提交申请、未获得签名。
