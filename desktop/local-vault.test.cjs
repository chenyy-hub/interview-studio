const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createVault } = require('./local-vault.cjs');
const { attach } = require('./credential-session.cjs');
function temp(t) { const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-vault-test-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true })); return directory; }
function manager(directory) {
  const cm = { credentials: {}, init() { throw new Error('must not unlock keychain'); }, saveCredentials() { throw new Error('must not use upstream storage'); }, getStorageStatus() {}, writeCredentials() {}, clearAll() { this.credentials = {}; this.scrubbed = true; } };
  attach(cm, { directory }); cm.init(); return cm;
}
test('saved endpoint, model, chat and speech keys survive a fresh manager with no keychain call', t => {
  const directory = temp(t), cm = manager(directory);
  const data = { chatModel: 'synthetic-model', chatConnectionId: 'custom-test', openaiCompatibleProviders: [{ id: 'custom-test', baseUrl: 'https://example.test/v1', apiKey: 'synthetic-chat-secret' }], deepgramApiKey: 'synthetic-speech-secret', sttProvider: 'deepgram' };
  cm.credentials = data; cm.saveCredentials();
  assert.deepEqual(manager(directory).credentials, data);
  assert.equal(cm.studioCredentialSession.state().mode, 'local');
  assert.ok(!fs.readFileSync(path.join(directory, 'connections.enc'), 'utf8').includes('synthetic-chat-secret'));
  if (process.platform !== 'win32') { assert.equal(fs.statSync(directory).mode & 0o777, 0o700); assert.equal(fs.statSync(path.join(directory, 'device.key')).mode & 0o777, 0o600); }
});
test('missing key and corrupted vault block writes and preserve the stored file', t => {
  const directory = temp(t), vault = createVault(directory);
  vault.save({ apiKey: 'synthetic-secret' });
  const file = path.join(directory, 'connections.enc'), previous = fs.readFileSync(file);
  fs.unlinkSync(path.join(directory, 'device.key'));
  const cm = manager(directory);
  assert.match(cm.studioCredentialSession.state().error, /无法读取/);
  cm.credentials = { apiKey: 'replacement-must-not-be-saved' };
  assert.throws(() => cm.saveCredentials(), /无法读取/);
  assert.deepEqual(fs.readFileSync(file), previous); assert.deepEqual(cm.credentials, {});
  cm.studioCredentialSession.clearLocal(); cm.credentials = { apiKey: 'synthetic-new-secret' }; cm.saveCredentials();
  const envelope = JSON.parse(fs.readFileSync(file)); envelope.tag = Buffer.alloc(16).toString('base64'); fs.writeFileSync(file, JSON.stringify(envelope));
  assert.throws(() => createVault(directory).load(), /无法读取/);
});
test('explicit clearing removes local keys and a subsequent session starts without credentials', t => {
  const directory = temp(t), cm = manager(directory);
  cm.credentials = { apiKey: 'synthetic-clear-secret' }; cm.saveCredentials(); cm.clearAll();
  assert.equal(cm.scrubbed, false);
  assert.equal(fs.existsSync(path.join(directory, 'connections.enc')), false);
  assert.equal(fs.existsSync(path.join(directory, 'device.key')), false);
  assert.deepEqual(manager(directory).credentials, {});
});
