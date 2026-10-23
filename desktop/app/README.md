# 成子桌面应用（开发预览）

版本 `0.1.0-preview.1`。Windows x64 安装包与 Apple 芯片 Mac 应用内置完整 React 页面、样式和图片，并随包携带本机采集服务。界面从安装包加载，不加载远端网页 HTML。服务通过私有 stdio 接受宿主指令；启动桌面应用不会自行读取微信。

## 能力与验收边界

- 导入、人物、聊天、报告和账户页面均在本地前端构建中；登录、云端资料和分析请求仍使用现有 API，需要网络。打包不等于离线运行完整分析模型。
- 本机采集和语音处理由随包 Python 服务完成。第一次使用语音仍需准备模型。
- Windows 使用当前用户安装，无需管理员权限。关闭窗口与停止采集由宿主明确管理。
- Mac 包是开发预览。当前最新微信构建、真实账号授权、朋友圈完整翻页尚未完成验收；缓存读取不能当作全量朋友圈。
- `setup` 尚未实现嵌入式 Mac 首次授权界面，会明确报告不可用。不能把独立助手的授权状态假定为已跨进程共享。
- 当前没有 Windows 代码签名证书、Apple Developer ID 或 Apple 公证。Mac 预览仅做本地 ad-hoc 完整性签名。安装和下载拦截尚未因此解决。不要通过关闭系统安全功能来验收。
- 构建脚本不发布网站、GitHub Release 或小程序，不覆盖既有助手的下载文件。

## 固定资源路径

Windows：`resources/collector/ChengziDesktopService.exe`，旁边必须保留整个 `_internal` 目录。

Mac：`成子.app/Contents/Resources/collector/ChengziDesktopService.app/Contents/MacOS/ChengziDesktopService`。内嵌 `.app` 的 `Contents/Resources` 和 `Contents/Frameworks` 必须完整保留，不能只复制可执行文件。

Mac 内嵌服务沿用 `love.lovetalk.coach.collector.macpreview` bundle ID，与固定资源校验一致；外层桌面应用使用独立 ID `love.lovetalk.chengzi.desktop`。

## 构建 Windows

在仓库根目录，用已安装 collector 固定依赖的原生 Python 3.12 x64：

```powershell
npm ci
.\desktop\wechat-collector\.venv\Scripts\python.exe desktop/app/scripts/build-desktop-service.py
Set-Location desktop/app
npm ci
npm test
npm run dist -- --win --x64 --publish never
```

默认服务源目录是 `desktop/wechat-collector/dist/desktop-service/ChengziDesktopService`。脚本先构建完整 PyInstaller onedir，再执行合成数据库测试。若输出已经存在，脚本拒绝覆盖；用新的 `--output-dir` 构建，并设置 `CHENGZI_DESKTOP_SERVICE_DIR` 为该目录下 `ChengziDesktopService` 的绝对路径。

只想生成解包目录用于开发验收时：`npm run pack -- --win --x64 --publish never`。直接 `npm start` 不会替你构建本机服务。

## 构建 Mac

必须使用 Apple Silicon 原生 macOS、Python 3.12 和 Xcode Command Line Tools。在仓库根目录：

```sh
npm ci
python3.12 -m venv desktop/wechat-collector/.venv
desktop/wechat-collector/.venv/bin/python -m pip install --only-binary=:all: -r desktop/wechat-collector/requirements-macos.txt
desktop/wechat-collector/.venv/bin/python desktop/app/scripts/build-desktop-service.py
cd desktop/app
npm ci
npm test
npm run dist -- --mac --arm64 --publish never
```

脚本校验固定 vendor、编译随包 arm64 helper、构建完整服务 `.app` 并运行 frozen runtime 测试。图标沿用已确认的主页条纹素材，仅转换格式。服务默认输出在 `dist/desktop-service/ChengziDesktopService.app`；自定义源同样只接受构建主机上的绝对路径环境变量。

`.github/workflows/desktop-app.yml` 在专用 `codex/desktop-app-preview` 分支推送时构建，也可手动触发。创建工作流不代表已执行或通过。它不登录微信，不上传真实聊天或屏幕截图，不部署公开版本。

## 打包检查

`pack` 和 `dist` 先执行 `frontend:build`，编译完整本地页面；核心路由、入口 JS 或样式缺失，以及出现远端网页框架、环境文件、私钥或 sourcemap，都会拒绝打包。`afterPack` 从实际 `app.asar` 逐文件检查前端 SHA-256。

`npm run stage` 或 `beforePack` 会检查本机服务架构和 Python/原生组件，复制批准的 Logo，并记录所有资源的 SHA-256。`afterPack` 对最终安装资源再次校验完整目录，缺失服务、错误架构或资源被裁剪会阻止产出安装包。

输出目录：`outputs/desktop-app/0.1.0-preview.1/`。Windows 文件名以 `Chengzi-Desktop-` 开头，Mac 输出 DMG 与 ZIP。该目录与原助手公开下载目录隔离；再次构建同版本仍可能更新开发预览文件，要留存某次构建请先另存该目录。

第一次远端网页壳安装包保留在该目录的 `superseded-web-wrapper/`，明确标记不可交付；它不代表本地完整应用已通过验收。

交付前仍需验证：实际安装/卸载、单实例、断网恢复、网页返回与滚动位置、服务退出回收，以及每个平台的真实微信账号导入、语音和朋友圈完整流程。不能用合成单测或构建成功代替这些验收。

配置参考：[electron-builder 资源与钩子](https://www.electron.build/configuration/)、[NSIS 安装选项](https://www.electron.build/nsis/)、[Electron 代码签名](https://www.electronjs.org/docs/latest/tutorial/code-signing)。
