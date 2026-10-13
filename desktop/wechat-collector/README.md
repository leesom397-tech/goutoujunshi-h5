# 成子 Windows 微信采集助手

## 使用

1. 下载 `chengzi-wechat-collector-windows.zip`，完整解压，双击 `启动成子助手.cmd`。第一次会从成子网站下载并逐块校验免 Python 的助手；之后直接启动。
2. 打开并登录 Windows 微信，保持桌面未锁定。
3. 在成子网页输入助手窗口的 8 位连接码，选择“聊天”或“朋友圈”，填写好友的完整、唯一备注，选择数量后开始。
4. 采集会打开指定界面并滚动，聊天可能被标为已读。采集期间暂时不要操作微信。可在网页或本机窗口随时停止。
5. 在网页预览采集结果。**只有用户确认后，网页才导入所选材料或调用既有千问分析。助手自身没有云端上传接口。**

关闭助手即断开连接。换码会撤销原网页令牌并清空暂存结果。任务结果仅在本机内存保留最多 15 分钟，不写聊天日志或自动创建内容文件。

## 实际能力与限制

- Windows 10/11 x64，已登录的微信 4.1.6+，实际兼容性仍受微信 UI 更新、缩放和账号 UI 可见性影响。Mac 不运行此助手。
- **1.0.1** 已在微信 **4.1.15.13** 完成用户明确授权的指定联系人实测：两次各 20 条聊天，发送人与原文顺序核对通过；第二次网页本地导入新增 0 条。另验证 3 条当前可见朋友圈；测试材料仅保留本机，不包含在安装包中。
- 通过 UI 自动化读取用户点选的一位好友，不遍历全部联系人，不读取/解密微信数据库，不发送消息、点赞、评论或下载聊天文件。
- 会从本人资料弹窗的**可见微信号**确认账号；采集结束再核对，发生切号即丢弃结果。未读取到账号标识则报错，不使用固定“local”账号合并。
- 目前限一对一聊天；群聊明确拒绝。发送人无法确认时保留 `unknown`，不把未知默认当对方。
- 聊天最多 500 条；朋友圈最多 50 条。聊天从新到旧遍历、结果按旧到新排列；朋友圈保持新到旧。`source.uiIndex`保留原界面次序。保留重复短句和原时间标签，不将“昨天”伪造为精确时间。
- 图片/表情和朋友圈配图保存的是**可见消息/详情区域截图**，可能仅含缩略图。不是原始媒体下载。语音、视频未转写。不绕过朋友圈可见范围。
- 微信不给 UI 消息稳定 ID；`id` 为空，`source.contentFingerprint` 仅供诊断，不能拿它代替消息 ID 去重。网页依靠顺序重叠做增量去重。
- 多账号同时登录、重名好友、不可访问的 UI、锁屏或其他弹窗会导致失败；不会用整屏无差别截图替代指定好友采集。
- 搜索仅接受一个精确匹配的本地联系人；出现多个同名项会停止，不默认选第一人，也不触发网络手机/账号查找。首次采集仍请核对账号、发送人和内容后再确认导入。

## 固定上游与许可

- 源库：[Hello-Mr-Crab/pywechat](https://github.com/Hello-Mr-Crab/pywechat)
- 审查 commit：`8589baa049bb91d3a500602c167f07b2f8397a13`
- 包：`pywechat127==1.9.8`；Windows 微信 4.x 使用其中 `pyweixin`。
- 核查：`src/pyweixin/WeChatAuto.py` 的 `Messages.dump_chat_history`、`Moments.dump_friend_posts`；`WeChatTools.py` 的 `Navigator.open_chat_history`、`Navigator.open_friend_moments`、`Tools.select_chatHistoryList`。
- 原生 `save_detail` 会使用剪贴板并可保存视频，本助手没有调用它。使用固定版本导航方法和有界列表读取，截图只在内存中生成。
- 源仓库 `LICENSE` 是 LGPL 2.1 文本，包 metadata 的 classifier 标为 LGPLv3，存在不一致。这里保留原许可 `LICENSE-pywechat.txt`，并提供固定上游源代码、助手源代码和重建方法；未修改上游库。此说明不替代上游许可。

## 开发与打包

```powershell
py -3.12 -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements-lock.txt
.venv/Scripts/python.exe -m unittest -v test_collector.py
.venv/Scripts/python.exe main.py --probe
.venv/Scripts/python.exe main.py
```

`--probe` 只读取进程、安装版本、顶层窗口类，绝不读聊天正文。`main.py` 启动后仅监听并显示窗口，不自动采集。

```powershell
.venv/Scripts/python.exe -m PyInstaller --noconfirm --onedir --windowed --name ChengziWeChatCollector --collect-all pyweixin --copy-metadata pywechat127 --hidden-import pythoncom --hidden-import pywintypes --collect-submodules comtypes --exclude-module matplotlib --exclude-module pandas main.py
.venv/Scripts/python.exe package_release.py
```

`dist/release/` 下的 bootstrap zip、manifest 与所有 part 文件应一起发布到同一网站的 `/downloads/`。每个 part 不超过 12 MiB，适合静态资源大小限制。禁止只发布 zip 而漏掉 parts。`dist/ChengziWeChatCollector/` 也可完整复制到没有 Python 的 Windows 电脑运行。

## HTTP 协议

只绑定 `127.0.0.1:17863`，不监听局域网。

允许的 Origin 精确为：`https://coach.lovetalk.love`，以及 localhost/127.0.0.1 的 3000、5173、4173 端口；不接受其他域名、端口、空 Origin 或 `null`。所有接口检查 Host。除 health/pair/OPTIONS 外要求 `Authorization: Bearer <token>`，令牌绑定配对来源，8 小时失效。

| 接口 | 输入/返回 |
|---|---|
| `GET /health` | `{version,protocol,ready,message,capabilities:{chat,moments},wechatVersion?}` |
| `POST /pair` | `{code}` → `{token,expiresIn:28800,version}`；码10分钟有效，5次失败后每分钟限流，成功即换码 |
| `POST /capture` | `{kind:'chat'|'moments',friend:string,limit:number}` → HTTP202 `{jobId}` |
| `GET /jobs/{jobId}` | `{jobId,status:'running'|'completed'|'failed'|'cancelled',progress,message,result?,error?:{code,message}}` |
| `POST /jobs/{jobId}/cancel` | `{}` → `{jobId,status}`；终止子进程并丢弃结果 |

`result` 为 `{version:1,kind,friend,account,capturedAt,records,warnings}`；record 为 `{id:'',kind,sender,senderRole,at,text,source,images?}`。`images` 为 `{mime:'image/jpeg',name,data:<base64>}`，不接收本地路径。完整原文保留在 `text`，source 包含界面位置标签、原时间标签、顺序、采集方法及上游版本，不重复存放长段正文。

错误不含聊天正文、路径或上游异常堆栈。请求体最多4 KiB，同一时刻最多一个采集，3分钟强制超时，HTTP并发最多12个连接。无任意文件读取、命令执行或代理接口。
