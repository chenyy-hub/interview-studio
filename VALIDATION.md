# v0.8 验证记录

日期：2026-11-14。生产代码：c0c8c7f88c1b19ce15fd29bf6bd954a2f753b1ab。
固定上游 Pika 3.4.0；macOS arm64 本机构建，Windows x64 由 Windows runner 编译。

| 检查 | 结果与边界 |
| --- | --- |
| Node 自动检查 | 47 项通过，包括透明背景与独立文字、悬浮窗状态/穿透恢复、快捷键冲突、双窗口回答、截图取消、配置保存、上下文与流式错误处理 |
| Python 打包检查 | 4 项通过，检查辅助程序命名与布局 |
| Mac 签名与压缩包 | 本地签名及 ASAR 完整性验证通过；ZIP 完整 CRC 通过，保留 14 个框架符号链接 |
| Mac 实际界面 | 最终生产包已启动；中文悬浮层、0% 背景 / 35% 文字预设、收起展开、返回主设置可用；退出再启动后偏好仍保留，启动回普通主窗口 |
| Mac 快捷键状态 | 进入/退出悬浮、恢复点击、快答、截图、滚动和切栏注册状态已展示；未在真实会议中逐项触发 |
| Windows 运行包 | 编译、Electron 浏览器进程启动与真实打包依赖检查通过 |
| Windows 窗口动作 | 使用真实打包 WindowHelper 创建 OS 窗口，检查工作区范围、关闭/缩放能力，并执行最大化、还原、最小化和关闭；Windows runner 通过 |
| Windows 悬浮渲染 | 真实 preload、CSP 和 overlay.html 启动；在合成配置下检查背景 alpha=0、文字 opacity=0.35、字号 18 px；Windows runner 通过 |
| 快捷键稳定性 | 真实打包 KeybindManager 在合成注册表下切换模式，确认不再清空悬浮与恢复键 |
| 本地 API 保存 | 真实打包凭证管理器使用合成地址、模型及密钥验证重载、清除；未访问钥匙串 |
| 原生音频模块 | 真实模块装载、延迟打开麦克风和采样率读取通过；系统音频/可选麦克风启动分支使用替身，没有真实录音 |
| 配对与文档 | SQLite、DOCX、PDF 与 WebSocket 装载/解析通过；回环地址上的令牌、单客户端与重连快照通过，未在真实手机 Wi-Fi 测试 |
| Windows 安装包 | NSIS 与便携版构建均成功，源产物含 SHA256 与 windows-verification.json；独立 Release 发布另见下方记录 |

Windows 构建：https://github.com/chenyy-hub/interview-studio/actions/runs/43575457925
Release 文件转存：https://github.com/chenyy-hub/interview-studio/actions/runs/43577675531
发布页：https://github.com/chenyy-hub/interview-studio/releases/tag/v0.8.0
源码仓库：https://github.com/chenyy-hub/interview-studio （私有）。

工作流账号不能为含工作流改动的目标提交创建 Release；已由现有授权账号
建立标签及草稿，服务器校验并上传原始文件，再由发布账号完成发布。
没有把个人长期密钥保存在 Actions 中。安装版文件大小 356,567,568 字节，
名称统一为 InterviewStudio-Windows-Setup.exe，后续可使用固定最新版入口。
Release 已发布，固定入口指向 v0.8.0；文件内容与原始构建校验值一致。

所有模型测试使用替身或本地合成流。本机界面验证没有填写真实 API Key、
启动采音或发送模型请求。语音服务建议来自官方当前文档，不是实际中文
准确率横评。真实 CER/WER、模型首字延迟、会议音频共存、蓝牙切换、
Windows 跨虚拟桌面与飞书/腾讯会议接收端的共享保护仍未实测。

Mac 跨桌面/全屏显示与 Windows 置顶是已接入的机制，不等同于全部会议环境
兼容，也不等同于屏幕共享一定不可见。键盘防护、三连击截图、新悬浮快捷键
自定义界面仍未实现。开发包尚未完成 macOS 公证和 Windows 代码签名。

之前的成功构建保留：

- v0.7：https://github.com/chenyy-hub/interview-studio/actions/runs/43550681373
- v0.6：https://github.com/chenyy-hub/interview-studio/actions/runs/43463841916
