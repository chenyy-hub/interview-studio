const test = require('node:test');
const assert = require('node:assert/strict');
const { speechReadiness, audioPreferences } = require('./service-readiness.cjs');

test('Google default requires its own credential, and a chat key cannot enable speech', () => {
  const cm = { getSttProvider: () => 'google', getOpenaiApiKey: () => 'synthetic-chat-key' };
  assert.equal(speechReadiness(cm).configured, false);
  assert.match(speechReadiness(cm).reason, /服务账户文件/);
  cm.getGoogleServiceAccountPath = () => '/synthetic/service-account.json';
  assert.equal(speechReadiness(cm).configured, true);
});

test('each speech service requires its own configured key', () => {
  const cm = { getSttProvider: () => 'openai', getOpenAiSttApiKey: () => '   ' };
  assert.equal(speechReadiness(cm).configured, false);
  cm.getOpenAiSttApiKey = () => 'synthetic-speech-key';
  assert.equal(speechReadiness(cm).configured, true);
});

test('audio options are explicit and cannot request an unsupported backend', () => {
  const value = { backend: 'sck', captureMicrophone: false, inputDeviceId: 'default', outputDeviceId: 'default' };
  assert.deepEqual(audioPreferences(value, 'darwin'), value);
  assert.throws(() => audioPreferences({ ...value, backend: 'hog-mode' }));
  assert.throws(() => audioPreferences({ ...value, captureMicrophone: 'false' }));
  assert.equal(audioPreferences({ ...value, backend: 'wasapi' }, 'win32').backend, 'wasapi');
  assert.throws(() => audioPreferences(value, 'win32'));
});
