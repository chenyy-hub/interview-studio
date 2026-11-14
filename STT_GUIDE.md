# 语音转写怎么选、怎么配置

核对日期：2026-11-14。以下建议针对本软件当前已接入的服务，不是同一音频集的准确率排行榜。

| 方案 | 官方参考费用（美元） | 本软件的接法与取舍 |
| --- | --- | --- |
| Soniox `stt-rt-v6` | 实时转写约 $0.12/小时；实际按音频及文字 token 计费 | 优先尝试：原生实时流式，中英混合场景可用，只需填自己的 Soniox Key |
| Deepgram `nova-3` | 流式单语 $0.0077/分钟，约 $0.46/小时；多语 $0.0092/分钟，约 $0.55/小时 | 实时流式备选，当前 Nova-3 支持中文；与 Soniox 用同一段录音对比更有意义 |
| Groq `whisper-large-v3-turbo` | 标价 $0.04/音频小时；每次请求至少按 10 秒计费 | 标价低，但当前是断句或缓冲后上传文件；短句频繁上传会增加等待和有效费用 |

我的建议是先试 Soniox，原因是实时接法、配置难度与参考费用的组合适合这条链路。
“中文一定最准”尚无本软件实测支持。已有其他服务账号且效果稳定，可以继续沿用。
免费额度、税费、网络条件、额外功能与实际账单应以自己的服务商账户为准。
同时录系统声音和麦克风会产生两路转写用量；只听对方时，保持麦克风关闭。

## 最省事的起步配置

1. 在「设置 → 回答模型」沿用自己的回答服务，填写它的 Key，保存。默认地址与模型可在折叠项中查看、更改。
2. 在「语音转写」选择 Soniox，填写 Soniox Key，保存。程序预填 `stt-rt-v6` 和中文；回答服务的 Key 不能代替语音 Key。
3. 使用「系统声音 + 中文 + 单栏快答」。飞书、腾讯会议保持原来的播放和麦克风设备；需要记录自己说的话时再开启麦克风。

文字提问只需回答 API，实时听题才需要语音 API。保存不会自动请求模型或启动录音。
开始面试会先展示数据源确认。采样率、后端和设备可以保持默认。

## 官方依据

- Soniox 价格：https://soniox.com/pricing
- Soniox 当前模型及 API 兼容说明：https://docs.soniox.com/stt/models
- Soniox 中文说明：https://soniox.com/speech-to-text/use-cases/voice-agents/chinese
- Deepgram 价格：https://deepgram.com/pricing
- Deepgram 语言与模型：https://developers.deepgram.com/docs/models-languages-overview
- Groq 价格、语言和最低计费时长：https://console.groq.com/docs/speech-to-text

尚未进行真实中文 CER、专业词汇准确率或端到端延迟的对照评测。
