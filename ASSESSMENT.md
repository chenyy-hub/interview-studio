# GitHub 备选底座评估与升级决定

核对日期：2026-11-13。对比目标：首字延迟、会议音频、易用性、可维护性、
窗口共享保护、Windows 实际发布情况。以下为源码/发布记录/问题单评估；
没有在同一批真实会议与音频设备上做过各项目的对照稳定性测试。

## 结论

**现阶段保留 Pika 底座并加固，不直接整体迁移。Pluely 列为首选备选。**
Pluely 的跨平台发布证据更充分，但不是 Electron 的直接替换，需要重新迁移
音频、资料、历史与配置。尚无证据证明迁移后在用户的飞书/腾讯会议环境
中更稳定。保留当前已定位并修复的问题，比现在把所有模块推倒重来可控。

| 项目 | 已核实的优点 | 风险或不足 | 本次判断 |
| --- | --- | --- | --- |
| [royisme/pikabaka](https://github.com/royisme/pikabaka) | 活跃维护；原生双路音频、多 STT 服务、资料与会议记录；现有版本已完成本机启动修复 | 官方说明 Windows 源码存在，但无 Windows 发布包；原依赖与功能链较重 | 保留，加独立快答链路与真正 Windows 构建 |
| [iamsrikanthnani/pluely](https://github.com/iamsrikanthnani/pluely) | Tauri/Rust；1.2.0 发布有 Windows x64 EXE/MSI 与 macOS；历史 Windows 键盘/音源问题有修复记录 | 需要跨技术栈迁移；发布包存在不等于实际会议兼容性已通过；“完全隐身”的宣传不能直接采信 | 最值得做下一轮实机候选验证，暂不迁移 |
| [ericwang915/interview-copilot](https://github.com/ericwang915/interview-copilot) | 简单 Electron 链路，双路转写、DeepSeek 等兼容接口、资料背景 | README 的 Windows 支持表与 roadmap 有不一致，不能据此当作成熟 Windows 发布；凭证的本地文件方案也需审查 | 可借鉴简化链路，不替换整体 |
| [pnksvr/interview-copilot](https://github.com/pnksvr/interview-copilot) | 较小的 Electron/TypeScript 工程，兼容接口、系统回环、快捷键 | 项目较早期，未见成熟发布记录；README 默认约 4 秒 Whisper 分片，不利于追求更低转写触发延迟 | 不作为主底座 |
| Glass / Cheating Daddy 系列 | 有 Windows 与实时辅助的历史实现 | 原 Glass 仓库本轮访问返回 404，未确认可用的规范上游；多个 fork 和旧模型兼容问题增加维护不确定性 | 不依据 fork 的功能宣传整体迁移 |

相关证据：

- Pika README 与 Windows 缺失问题：
  https://github.com/royisme/pikabaka/issues/15
- Pluely 发布记录（本轮 API 核对最新为 app-v1.2.0，2026-10-26）：
  https://github.com/iamsrikanthnani/pluely/releases
- Pluely 历史音源问题 #142 已关闭，不能说它仍是当前 bug：
  https://github.com/iamsrikanthnani/pluely/issues/142
- Pluely 历史屏幕权限问题 #204 已关闭：
  https://github.com/iamsrikanthnani/pluely/issues/204

## 回复速度：改结构而不是伪造耗时

原链路包含全文背景、重复资料检索，再进入通用模型封装。此次文本快答改成：

1. 在本机索引资料片段；极速快答资料预算约 6,000 字符，近期对话约 4,500
   字符。简历任务和深答使用更大的预算，不把所有文档每次全部发送。
2. OpenAI 兼容的文字回答直接流式请求服务端，复用 Node 的连接池。
   官方 DeepSeek 快答明确关闭思考；兼容代理不发送不属于它的额外参数。
3. 直接文字链路不进行静默多轮重试或自动换模型，其他协议保留上游 SDK 行为。首字/闲置超时有明确错误；取消请求
   不再被不响应 abort 的旧迭代器阻塞。
4. 双栏分别输出，部分成功也保存；渲染按动画帧合并，减少每个 token 的
   DOM 写入。资料准备、响应头、首字、完成分阶段记时，不记录正文或 Key。

这消除了可确认的本地冗余，**没有真实模型测试前不声明“快了多少倍”**。
完整端到端测量还需加入实际 STT 服务的断句、网络、服务排队和输出速度。

DeepSeek 官方参数依据：
https://api-docs.deepseek.com/guides/thinking_mode/

## 共享保护：按真实接收画面验收

参考面试精灵 1.1.220 的桌面层，已观测到系统音频 loopback、窗口内容保护、
悬浮/鼠标穿透和全局快捷键调用。此次增强保护设置、已有/新建窗口的保护
请求、一键隐藏/恢复、自测记录。没有注入或修改飞书/腾讯会议进程。

Electron 的官方说明明确：Windows 使用 WDA_EXCLUDEFROMCAPTURE；新版
macOS 的 ScreenCaptureKit 可能仍能捕获设置了普通窗口保护的窗口。
因此不承诺“完全隐身”，也不把 isContentProtected=true 当作会议测试通过。

验收必须覆盖：飞书/腾讯会议各自版本、整屏/窗口共享、多显示器、窗口移动、
悬浮窗展开、弹出设置、系统切换与蓝牙音频。自测记录仅标为用户报告，
系统/客户端/App 更新后需要重新确认。

官方依据：
https://www.electronjs.org/docs/latest/api/browser-window#winsetcontentprotectionenable-macos-windows

## Windows

目标为 Windows 10/11 x64。使用 Windows runner 编译 WASAPI 原生模块、
打包 NSIS 安装版与便携版；不是把 macOS 包改扩展名。编译与启动验证
结果以 workflow 和 `windows-verification.json` 为准。没有真实设备测试前，
不把 Windows 的音频或会议共享兼容性标为通过。

当前状态：源码已获授权推送至私有仓库，Windows x64 的安装版和便携版
均已实际生成，浏览器进程启动及打包依赖/配置恢复检查通过。
真实会议音频和共享保护仍未实机验证。
源码：https://github.com/chenyy-hub/interview-studio
v0.8 构建（2026-11-14）：https://github.com/chenyy-hub/interview-studio/actions/runs/43575457925
固定安装入口：https://github.com/chenyy-hub/interview-studio/releases/latest/download/InterviewStudio-Windows-Setup.exe
