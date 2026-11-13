const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

test('creates the isolated data directory before Electron setPath and loads the native bootstrap once', () => {
  const events = [];
  const app = { setName: value => events.push(['name', value]), getPath: () => '/synthetic-app-data',
    setPath: (_name, directory) => { assert.ok(events.some(e => e[0] === 'mkdir' && e[1] === directory)); events.push(['path', directory]); },
    on: () => {}, whenReady: () => ({ then: callback => { callback(); return { catch() {} }; } }) };
  const code = fs.readFileSync(path.join(__dirname, 'bootstrap.cjs'), 'utf8');
  vm.runInNewContext(code, { process: { argv: [] }, require(name) {
    if (name === 'electron') return { app };
    if (name === 'node:path') return path;
    if (name === 'node:os') return require('node:os');
    if (name === 'node:fs') return { mkdirSync: directory => events.push(['mkdir', directory]) };
    if (name.endsWith('/SettingsManager.js')) return { SettingsManager: { getInstance: () => ({ set: (key, value) => events.push([key, value]) }) } };
    if (name.endsWith('/CredentialsManager.js')) return { CredentialsManager: { getInstance: () => 'synthetic-credentials' } };
    if (name === './credential-session.cjs') return { attach: value => events.push(['credentials', value]) };
    if (name.endsWith('/main.js')) return { AppState: { getInstance: () => 'synthetic-state' } };
    if (name === './native.cjs') return { install: value => events.push(['install', value]) };
    throw new Error('Unexpected import');
  } });
  assert.equal(events.filter(e => e[0] === 'install').length, 1);
  assert.ok(events.find(e => e[0] === 'credentials'));
  assert.deepEqual(events.find(e => e[0] === 'autoCheckUpdates'), ['autoCheckUpdates', false]);
});
