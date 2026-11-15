# 面试工作室 v0.8.1

Mac 与 Windows 使用同一份悬浮窗修复代码。

- 取消鼠标悬停、点击输入框时上下操作栏自动增亮。
- 「整体不透明度」统一作用于悬浮窗文字和操作栏，沿用原来的保存数值。
- 「纯透明淡字」设置背景 0%、整体 35%，主浮层去掉底色、边框和阴影。
- 新增「清晰编辑」：主动点击才暂时恢复清晰显示；结束编辑、隐藏浮层或返回主窗口后恢复原来的不透明度。
- API、语音服务和资料配置继续保存在本机，无需重新填写。

下载：

- Windows 10/11 x64：`InterviewStudio-Windows-Setup.exe`，可选免安装版 `InterviewStudio-Windows-Portable.exe`。
- Mac Apple Silicon：`InterviewStudio-macOS-arm64.zip`，退出旧程序后解压、替换 `InterviewStudio.app`。此包不适用于 Intel Mac。

升级前先完整退出旧程序；Windows 请从托盘菜单退出。
当前仍为开发签名版本。附件包含 SHA256 和各平台构建检查记录。
实际音频设备、真实模型、飞书和腾讯会议共享效果仍需实测；不透明度调整不保证屏幕共享不可见。
