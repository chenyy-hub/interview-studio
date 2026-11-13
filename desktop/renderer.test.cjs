const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

test('renderer boots with the non-configurable contextBridge global and navigation responds', async () => {
  const elements = new Map();
  const element = selector => {
    if (!elements.has(selector)) elements.set(selector, { classList: { toggle() {} }, querySelectorAll: () => [], addEventListener() {}, checked: true });
    return elements.get(selector);
  };
  const nav = { dataset: { view: 'diagnostics' }, classList: { toggle() {} } };
  const calls = [];
  const status = { sessionActive: false, model: null, sttProvider: 'unconfigured', permissions: {}, transcripts: [], generation: null, metrics: [], credentialStorage: { mode: 'memory' } };
  const context = { document: { querySelector: element, querySelectorAll: selector => selector === '[data-view]' ? [nav] : [] },
    electronAPI: { onNativeAudioTranscript() {}, onMeetingStateChanged() {}, onSessionReset() {}, onGlobalShortcut() {} },
    addEventListener() {} };
  context.window = context;
  // Electron contextBridge creates a read-only, non-configurable global. A
  // top-level `const studio` conflicts with it before any handler can execute.
  Object.defineProperty(context, 'studio', { configurable: false, value: { onEvent() {}, invoke: async name => { calls.push(name); return status; } } });
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  assert.match(element('#status').textContent, /当前未采音/);
  assert.match(element('#credential-status').textContent, /仅本次使用/);
  await nav.onclick();
  assert.equal(element('#work').hidden, true);
  assert.match(element('#other').innerHTML, /链路诊断/);
  assert.deepEqual(calls, ['status', 'status']);
});

test('Chinese connection form saves to the native registry without a model call or key echo', async () => {
  const elements = new Map();
  const element = selector => {
    if (!elements.has(selector)) elements.set(selector, { value: '', children: [], insertBefore() {}, classList: { toggle() {} }, querySelectorAll: () => [], addEventListener() {}, checked: true });
    return elements.get(selector);
  };
  const calls = []; let selected = { connectionId: '', model: '' };
  const status = { sessionActive: false, model: null, sttProvider: 'google', permissions: {}, transcripts: [], generation: null, metrics: [], speech: { configured: false, reason: '先配置语音服务' }, preferences: { glossary: '', autoAnswer: false }, captureSettings: { backend: 'sck', captureMicrophone: false, inputDeviceId: 'default', outputDeviceId: 'default' } };
  const native = { onNativeAudioTranscript() {}, onMeetingStateChanged() {}, onSessionReset() {}, onGlobalShortcut() {},
    aiConnectionsList: async () => [], chatModelGet: async () => selected, getStoredCredentials: async () => ({ sttProvider: 'google' }),
    aiConnectionSave: async value => { calls.push(['connection', value]); return { success: true, id: 'synthetic-connection' }; },
    chatModelSet: async value => { calls.push(['model', value]); selected = value; return { success: true }; },
    setAiResponseLanguage: async value => { calls.push(['language', value]); return { success: true }; },
    startMeeting: async () => { throw new Error('unconfigured speech must not start capture'); },
    modelTest: async () => { throw new Error('saving must not make a paid model request'); } };
  const context = { URL, document: { querySelector: element, querySelectorAll: () => [], createElement: () => ({}) }, electronAPI: native, addEventListener() {} };
  context.window = context;
  const deviceCalls = [];
  Object.defineProperty(context, 'studio', { configurable: false, value: { onEvent() {}, invoke: async name => {
    if (name === 'audio-devices') { deviceCalls.push(name); return { success: false, error: '未能读取设备列表；可继续使用系统默认设备。' }; }
    return status;
  } } });
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  await element('#settings').onclick();
  assert.match(element('#other').innerHTML, /回答模型/);
  element('#connection-key').value = 'synthetic-test-key'; element('#answer-language').value = 'Chinese';
  await element('#save-connection').onclick();
  assert.equal(calls[0][1].apiKey, 'synthetic-test-key');
  assert.equal(calls[0][1].baseUrl, 'https://api.deepseek.com');
  assert.equal(calls[1][1].model, 'deepseek-flash');
  assert.equal(element('#connection-key').value, '');
  assert.ok(!element('#other').innerHTML.includes('synthetic-test-key'));
  await element('#start').onclick();
  assert.match(element('#notice').textContent, /先配置语音服务/);
  await element('#capture-settings').onclick();
  assert.deepEqual(deviceCalls, [], 'opening speech settings must not enumerate native devices');
  assert.equal(element('#audio-backend').value, 'sck');
  await element('#refresh-devices').onclick();
  assert.deepEqual(deviceCalls, ['audio-devices']);
  assert.match(element('#notice').textContent, /可继续使用系统默认设备/);
  assert.equal(element('#refresh-devices').disabled, false);
});
