'use strict';

function speechReadiness(cm) {
  const provider = cm.getSttProvider();
  const methods = { groq: 'getGroqSttApiKey', openai: 'getOpenAiSttApiKey', deepgram: 'getDeepgramApiKey', elevenlabs: 'getElevenLabsApiKey', azure: 'getAzureApiKey', ibmwatson: 'getIbmWatsonApiKey', soniox: 'getSonioxApiKey', gemini: 'getGeminiApiKey' };
  const configured = provider === 'doubao' ? !!cm.credentials?.doubaoApiKey?.trim() :
    provider === 'google' ? !!cm.getGoogleServiceAccountPath?.() : !!cm[methods[provider]]?.()?.trim();
  const reason = configured ? '' : provider === 'google' ? '尚未配置语音转写。当前默认 Google Cloud 需要服务账户文件；也可在中文配置页选择用 API Key 的语音服务。' : '尚未填写当前语音服务的 API Key，请先完成语音转写配置。';
  return { provider, configured, reason };
}

function audioPreferences(value = {}, platform = process.platform) {
  if (!value || !(platform === 'win32' ? ['wasapi', 'auto'] : ['sck', 'auto']).includes(value.backend) || typeof value.captureMicrophone !== 'boolean' ||
      !['inputDeviceId', 'outputDeviceId'].every(k => typeof value[k] === 'string' && value[k].length <= 512)) throw new Error('采音设置不正确');
  return { backend: value.backend, captureMicrophone: value.captureMicrophone, inputDeviceId: value.inputDeviceId, outputDeviceId: value.outputDeviceId };
}

function capturePermissions(preferences, platform = process.platform) {
  const read = type => { try { return preferences.getMediaAccessStatus(type); } catch { return 'unknown'; } };
  return { microphone: read('microphone'), screen: platform === 'darwin' ? read('screen') : 'not-applicable' };
}

function captureBlocker(audio, permissions, platform = process.platform) {
  const blocked = status => status === 'denied' || status === 'restricted';
  if (platform === 'darwin' && audio.backend === 'sck' && blocked(permissions.screen)) {
    return { permission: 'screen', message: '系统声音需要「录屏与系统录音」权限。允许面试工作室后，退出并重新打开应用。' };
  }
  if (audio.captureMicrophone && blocked(permissions.microphone)) {
    return { permission: 'microphone', message: '本次选择了麦克风。请允许麦克风权限，或取消勾选后只采集系统声音。' };
  }
  return null;
}

module.exports = { speechReadiness, audioPreferences, capturePermissions, captureBlocker };
