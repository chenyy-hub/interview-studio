const test = require('node:test');
const assert = require('node:assert/strict');
const { attach } = require('./credential-session.cjs');

function fixture() {
  const calls = [];
  const cm = {
    credentials: {}, mode: 'encrypted',
    init() { calls.push('keychain'); this.credentials = { openaiApiKey: 'synthetic-saved-key' }; this.storageStatus = { mode: this.mode }; },
    saveCredentials() { this.writeCredentials('/synthetic/credentials', this.mode === 'encrypted'); },
    getStorageStatus() { return this.storageStatus; },
    writeCredentials(file, encrypted) { calls.push({ file, encrypted, data: structuredClone(this.credentials) }); },
  };
  return { cm, calls, session: attach(cm) };
}

test('startup and default settings use memory with zero keychain access or disk writes', () => {
  const { cm, calls, session } = fixture();
  cm.init(); cm.credentials.groqApiKey = 'synthetic-session-key'; cm.saveCredentials();
  assert.deepEqual(calls, []);
  assert.equal(cm.credentials.groqApiKey, 'synthetic-session-key');
  assert.equal(cm.getStorageStatus().mode, 'locked');
  assert.equal(session.state().mode, 'memory');
});

test('explicit encrypted enable loads saved keys and preserves current session keys', () => {
  const { cm, calls, session } = fixture();
  cm.init(); cm.credentials.groqApiKey = 'synthetic-session-key'; cm.saveCredentials();
  assert.equal(session.enableEncrypted().mode, 'encrypted');
  assert.equal(calls[0], 'keychain');
  assert.equal(calls[1].encrypted, true);
  assert.equal(calls[1].data.openaiApiKey, 'synthetic-saved-key');
  assert.equal(calls[1].data.groqApiKey, 'synthetic-session-key');
  cm.mode = 'plaintext';
  assert.throws(() => cm.saveCredentials(), /未将 API Key 写入磁盘/);
  assert.equal(calls.length, 2);
});

test('refused unlock keeps session usable and never overwrites stored credentials', () => {
  const { cm, calls, session } = fixture();
  cm.init(); cm.credentials.groqApiKey = 'synthetic-session-key'; cm.saveCredentials();
  cm.mode = 'locked';
  assert.throws(() => session.enableEncrypted(), /系统加密未解锁/);
  assert.equal(session.state().mode, 'memory');
  assert.deepEqual(cm.credentials, { groqApiKey: 'synthetic-session-key' });
  cm.saveCredentials();
  assert.deepEqual(calls, ['keychain']);
});
