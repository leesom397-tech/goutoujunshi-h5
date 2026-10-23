# 使用自己的 Mac，通过网易 UU 远程持续调试

核查日期：2026-10-24。用户已选择自己的 Apple Silicon Mac，已有 UU 远程。本方案替代云 Mac 租赁方案，不产生云服务器租赁费用。本次只核实文档，没有安装软件、连接远端或修改远端设置。

## 结论

UU 远程有官方 CLI、Mac 远程终端及端口映射，可以作为程序化构建、修复通道。首选 **Windows 官方 CLI → 已授权 Mac 的命名终端会话**。远程桌面用于查看程序和系统授权提示；命令通过 CLI 的交互式终端执行。

旧六月博客中的“终端仅支持 Windows 被控端”已经落后于后续更新。当前正式 CLI 帮助明确列出 Windows、macOS 被控端；10 月终端说明也明确介绍 Mac 会话继承。仍需用用户的实际版本和登录状态检验通道，不能仅凭文档宣称连接成功。[正式 CLI 帮助](https://uuyc.163.com/help/cli.html)、[2026-10-10 终端更新](https://uuyc.163.com/blog/20261010-zdgx.html)

## 正式下载及版本

- 官方下载页：<https://uuyc.163.com/download/>
- Windows 官网下载入口：<https://adl.netease.com/d/g/uuremote/c/gw?type=pc>
- 该入口 HTML 明确给出的 Windows 下载接口：<https://api.nrd.nie.163.com/api/v1/release/dl/1?channel=gwqd>
- 核查时上述接口经 HTTP 302 指向网易 CDN 的 `UURemote_Setup_4.44.0.3919_1021133122_gwqd.exe`，返回 200，文件大小 92,252,208 字节。CDN URL 带时效参数，不固定保存成长期下载地址。
- 官网显示 Windows、macOS 均为 **4.44.0，2026-10-21 更新**。正式新版 CLI 帮助要求 Windows 主控至少 4.43.0；新版终端要求双方至少 4.39.0。后续以实际 `--version` 和 `--help` 为准。

只使用上述网易域名入口。搜索结果中的仿官网、第三方重打包下载、非官方 VS Code 扩展不是本方案依赖。

## 最短执行路径

### 1. 在 Windows 核对客户端和 CLI

官方文档要求读取实际安装目录，不假定固定 `Program Files` 路径：

```powershell
$uuInstallDir = (Get-ItemProperty 'HKLM:\SOFTWARE\Netease\GameViewerSetup' -Name instDir).instDir
$uuCli = Join-Path $uuInstallDir 'bin\uuyc-cli.exe'
& $uuCli --version
& $uuCli echo
& $uuCli status --json
& $uuCli term --help
```

`status --json` 核对主程序连接、网络和登录状态。大多数命令依赖主程序保持运行；版本查询不依赖主程序。本步骤没有登录或修改设置。

### 2. 定位唯一授权的 Mac

优先使用用户自己的同账号设备：在 Windows UU 客户端由用户本人完成登录，Mac 保持同账号在线。随后查询：

```powershell
& $uuCli device list --json
```

只使用目标 Mac 对应的 `data.items[].deviceId`，确认 `isOnline=true`。不把全部设备列表、账户信息或验证码写入项目日志。

若用户选择“远程协助”，只需要其指定 Mac 的协助 ID 与当前验证码；通过官方界面或 `assist start` 建立授权。协助 ID 与终端用的内部 `deviceId` 不能凭字符串猜测为同一个值，连接后从实际状态返回值核对。当前文档没有承诺跨账号协助的所有终端状态字段，需要实测。

官方支持从标准输入传入验证码。调用前核对该安装版本的 `assist start --help`，避免验证码出现在命令参数、进程列表及共享日志里。[远程协助说明](https://uuyc.163.com/help/20241204/40220_1197664.html)

### 3. 建立命名终端会话

Windows 主控新版语法：

```powershell
& $uuCli term -d DEVICE_ID list --json
& $uuCli term -d DEVICE_ID new chengzi-mac-test
```

`new` / `attach` 接管交互式终端，必须通过工具的 TTY/PTY 调用，不支持 `--json`。Mac 默认 Shell 以实际客户端为准；确需指定时先查看帮助，并使用远端真实存在的路径（例如 `/bin/zsh`），不套用旧教程默认的 PowerShell。

断线后先查询，然后续接已有会话：

```powershell
& $uuCli term -d DEVICE_ID has chengzi-mac-test --json
& $uuCli term -d DEVICE_ID attach chengzi-mac-test
```

不重新创建同名会话，不批量断开其他设备，也不调用 `kill` 终止正在进行的构建。官方说明关闭远控窗口会保留终端任务，删除会话才会终止。

### 4. 身份验证和系统权限

- Mac 必须已经进入自己的 macOS 登录会话。未登录时先由用户完成系统登录。
- 官方说明：进入终端前可能需要被控端系统账户验证，锁屏时尤其如此。由用户在 UU 官方验证界面输入，不在聊天、脚本、参数或报告中传递系统密码。
- “自动解锁被控端”是可选设置，不为了省一次输入擅自启用。已有验证是否被 CLI 会话复用，要用该版本实际测试。
- Mac 的“允许本设备被控”、辅助功能与录屏权限按官方要求由用户确认；授权后可能需要重启 UU。现有权限足够时不额外修改。[Mac 被控设置](https://uuyc.163.com/help/macos.html)

### 5. 一次连通后持续工作

先只读取 `sw_vers`、`uname -m`、微信 Info.plist 的版本/构建号以及开发工具版本，记录不含账号信息的能力清单。然后在用户指定的项目目录同步代码、安装项目依赖、构建应用、执行合成回归，再做单一指定联系人的采集验收。

源代码和构建文件通过已授权 CLI 通道或后续 SSH/SFTP 通道传输；不依赖用户反复复制命令。终端没有非交互 `exec` 子命令的公开保证，可以维护 PTY 会话并使用唯一完成标记读取每轮输出。文件传输和会话稳定性先以小文件验证。

## 端口映射 / SSH 备选

网易 UU 官方账号在 2026-07-11 宣布 Mac 端口映射上线，8 月再次确认 Mac 终端与端口映射可用。[官方 Mac 端口映射公告](https://www.sina.cn/news/detail/5319539031017130.html)、[官方 Mac 功能更新](https://weibo.com/2/detail/5334412033788413)

当前正式 CLI 帮助没有列出端口映射子命令，不能编造 `uuyc-cli port-forward`。若直接 CLI 终端不稳定，可在授权的 UU 图形设置中创建 Mac 本机 SSH 服务到 Windows 本地端口的映射，再使用标准 OpenSSH/SFTP。仅作为备选，尚未配置：

1. 在 Mac 正常开启系统“远程登录”，只允许指定用户。
2. UU 映射目标 `127.0.0.1:22`，Windows 监听只绑定 `127.0.0.1`，选择空闲本地端口。
3. 用专用 SSH 公钥认证，核对主机指纹；私钥留在 Windows。
4. Windows 执行 `ssh -p LOCAL_PORT USER@127.0.0.1`。不把 SSH 暴露到公网，不配置路由器公网转发。

前两项是否需要管理员确认和实际字段名称，以当前客户端为准。未取得用户针对新增服务的授权前，不改变远端共享、登录或安全设置。

## 用户只需一次提供 / 完成什么

优先同账号方案需要：

1. 在这台 Windows 的 UU 官方客户端完成登录，指出列表中哪台 Mac 用于测试；设备名或唯一设备 ID 即可。
2. Mac 保持联网、已登录桌面，并确认 UU 必需权限；不必发送任何系统密码。
3. 若终端弹出系统账户验证，在官方窗口完成一次；后续命令由已建立的会话执行。
4. 指定允许验收的一个微信联系人，以及可用项目目录；若此前已有明确授权目标，直接沿用，不重复询问。

协助方案则把第 1 项替换为该 Mac 的协助 ID 和当前验证码。验证过期、系统弹出新权限或微信要求扫码时才请用户处理，不能保证所有系统验证永远只出现一次。

本方案只打通开发和验收通道。微信 270135 授权、原音频、聊天图片与完整相册是否兼容，仍由后续真实测试逐项确认，不把远控连接成功计为采集验收通过。
