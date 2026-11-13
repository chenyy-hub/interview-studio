'use strict';

function speechReadiness(cm) {
  const provider = cm.getSttProvider();
  const methods = { groq: 'getGroqSttApiKey', openai: 'getOpenAiSttApiKey', deepgram: 'getDeepgramApiKey', elevenlabs: 'getElevenLabsApiKey', azure: 'getAzureApiKey', ibmwatson: 'getIbmWatsonApiKey', soniox: 'getSonioxApiKey', gemini: 'getGeminiApiKey' };
  const configured = provider === 'google' ? !!cm.getGoogleServiceAccountPath?.() : !!cm[methods[provider]]?.()?.trim();
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

module.exports = { speechReadiness, audioPreferences, capturePermissions };
