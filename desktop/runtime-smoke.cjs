'use strict';
// Run in ELECTRON_RUN_AS_NODE mode: no window, permission or provider request.
const { createRequire } = require('node:module');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const [archiveArgument, fixtureArgument] = process.argv.slice(2);
  if (!archiveArgument || !fixtureArgument) throw new Error('Usage: runtime-smoke.cjs APP_ASAR FIXTURE_DIRECTORY');
  const archive = path.resolve(archiveArgument), fixtureDirectory = path.resolve(fixtureArgument);
  const packaged = createRequire(path.join(path.resolve(archive), 'package.json'));
  const Database = packaged('better-sqlite3');
  const db = new Database(':memory:');
  try { assert.equal(db.prepare('SELECT 1 AS ready').get().ready, 1); } finally { db.close(); }
  console.log('Packaged SQLite: passed');
  assert.equal(typeof packaged('ws').WebSocketServer, 'function');
  console.log('Packaged pairing dependency: passed');
  // The pure local pairing server lives beside Electron IPC code. In headless
  // Node mode Electron is unavailable; supply only its unused top-level import.
  const Module = require('node:module'), originalLoad = Module._load;
  let pairing, CredentialsManager;
  try {
    Module._load = function (name, ...args) { return name === 'electron' ? {} : originalLoad.call(this, name, ...args); };
    pairing = packaged('./desktop/native.cjs');
    ({ CredentialsManager } = packaged('./dist-electron/electron/services/CredentialsManager.js'));
  } finally { Module._load = originalLoad; }
  const { createPairRoom, isPrivateIPv4 } = pairing;
  const vaultDirectory = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'studio-runtime-vault-'));
  try {
    const attach = packaged('./desktop/credential-session.cjs').attach;
    const first = new CredentialsManager(); attach(first, { directory: vaultDirectory }); first.init();
    const saved = first.saveConnection({ name: 'Synthetic provider', type: 'openai', baseUrl: 'https://example.test/v1', apiKey: 'synthetic-runtime-chat-secret' });
    assert.ok(saved.id);
    first.setModelUse('chat', { connectionId: saved.id, model: 'synthetic-runtime-model' });
    first.setDeepgramApiKey('synthetic-runtime-speech-secret'); first.setSttProvider('deepgram');
    const next = new CredentialsManager(); attach(next, { directory: vaultDirectory }); next.init();
    assert.equal(next.resolveModelUse('chat').connection.apiKey, 'synthetic-runtime-chat-secret');
    assert.equal(next.resolveModelUse('chat').model, 'synthetic-runtime-model');
    assert.equal(next.getDeepgramApiKey(), 'synthetic-runtime-speech-secret');
    assert.equal(next.getSttProvider(), 'deepgram');
    next.studioCredentialSession.clearLocal();
    const cleared = new CredentialsManager(); attach(cleared, { directory: vaultDirectory }); cleared.init();
    assert.ok(cleared.resolveModelUse('chat').error);
  } finally { fs.rmSync(vaultDirectory, { recursive: true, force: true }); }
  console.log('Packaged credential manager: chat endpoint/model and speech keys survive reload, then clear; synthetic configuration only');
  const keyDirectory = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'studio-runtime-keys-'));
  try {
    const keys = new Map();
    const fakeElectron = { app: { getPath: () => keyDirectory, name: 'Synthetic Window Check' }, BrowserWindow: { getAllWindows: () => [] }, Menu: { buildFromTemplate: value => value, setApplicationMenu() {} },
      globalShortcut: { register: (key, callback) => { if (keys.has(key)) return false; keys.set(key, callback); return true; }, unregister: key => keys.delete(key), unregisterAll: () => keys.clear(), isRegistered: key => keys.has(key) } };
    let KeybindManager;
    try {
      Module._load = function(name, ...args) { return name === 'electron' ? fakeElectron : originalLoad.call(this, name, ...args); };
      ({ KeybindManager } = packaged('./dist-electron/electron/services/KeybindManager.js'));
    } finally { Module._load = originalLoad; }
    const manager = KeybindManager.getInstance();
    manager.registerGlobalShortcuts();
    keys.set('CommandOrControl+Shift+O', () => {});
    keys.set('CommandOrControl+Shift+U', () => {});
    manager.setMode('overlay');
    assert.equal(keys.has('CommandOrControl+Shift+O'), true);
    assert.equal(keys.has('CommandOrControl+Shift+U'), true);
    manager.setMode('launcher');
    assert.equal(keys.has('CommandOrControl+Shift+O'), true);
    assert.equal(keys.has('CommandOrControl+Shift+U'), true);
  } finally { fs.rmSync(keyDirectory, { recursive: true, force: true }); }
  console.log('Packaged shortcut mode changes preserve floating and recovery keys; synthetic registrations only');
  for (const address of ['10.0.0.1', '172.16.0.1', '192.168.1.5']) assert.equal(isPrivateIPv4(address), true);
  for (const address of ['8.8.8.8', '172.32.1.1', '192.168..1', '10.1.1.999', null]) assert.equal(isPrivateIPv4(address), false);
  const { WebSocket } = packaged('ws');
  let closed = false, asked;
  const room = await createPairRoom({ bindAddress: '127.0.0.1', onAsk: async request => { asked = request; }, onClose: () => { closed = true; },
    snapshot: () => ({ transcripts: [], generation: { id: 'synthetic', quick: 'Synthetic restored answer' } }) });
  const roomUrl = new URL(room.info.url), origin = roomUrl.origin;
  const connect = token => new Promise((resolve, reject) => {
    const socket = new WebSocket(origin.replace('http:', 'ws:') + '/?token=' + token, { origin, handshakeTimeout: 2000 });
    socket.once('error', reject); socket.once('message', data => resolve({ socket, snapshot: JSON.parse(data) }));
  });
  let client;
  try {
    await assert.rejects(connect('synthetic-invalid-token'));
    client = await connect(roomUrl.hash.slice(1));
    assert.equal(client.snapshot.generation.quick, 'Synthetic restored answer');
    await assert.rejects(connect(roomUrl.hash.slice(1)), 'only one phone may pair');
    client.socket.send(JSON.stringify({ kind: 'ask', question: 'Synthetic phone question' }));
    await new Promise((resolve, reject) => {
      const deadline = Date.now() + 2000;
      const check = () => asked ? resolve() : Date.now() >= deadline ? reject(new Error('phone request not delivered')) : setTimeout(check, 10);
      check();
    });
    assert.equal(asked.question, 'Synthetic phone question');
    assert.match(asked.id, /^phone-/);
    const disconnected = new Promise(resolve => client.socket.once('close', resolve));
    client.socket.close(); await disconnected;
    await new Promise(resolve => setTimeout(resolve, 20));
    client = await connect(roomUrl.hash.slice(1));
    assert.equal(client.snapshot.generation.id, 'synthetic');
  } finally { client?.socket.terminate(); room.stop(); }
  assert.equal(closed, true);
  console.log('Packaged phone pairing: token rejection, single client, questions and reconnect snapshot passed on loopback only');
  const mammoth = packaged('mammoth');
  const word = await mammoth.extractRawText({ buffer: fs.readFileSync(path.join(fixtureDirectory, 'synthetic.docx')) });
  assert.match(word.value, /Synthetic Word fixture/);
  console.log('Packaged DOCX extraction: passed');
  const { PDFParse } = packaged('pdf-parse');
  const parser = new PDFParse({ data: new Uint8Array(fs.readFileSync(path.join(fixtureDirectory, 'synthetic.pdf'))) });
  try { assert.match((await parser.getText()).text, /Synthetic PDF fixture/); } finally { await parser.destroy(); }
  console.log('Packaged PDF extraction: passed');
  const audio = packaged('./native-module/index.js');
  assert.equal(typeof audio.SystemAudioCapture, 'function');
  assert.equal(typeof audio.MicrophoneCapture, 'function');
  console.log('Packaged audio module load: passed (capture not started)');
  // RUN_AS_NODE has no Electron app API. Supply the addon already loaded above
  // to the real packaged wrappers; do not let a missing app API fake this check.
  packaged('./dist-electron/electron/audio/nativeModuleLoader.js').loadNativeModule = () => audio;
  const { MicrophoneCapture } = packaged('./dist-electron/electron/audio/MicrophoneCapture.js');
  const mic = new MicrophoneCapture();
  assert.equal(mic.monitor, null, 'constructing the microphone wrapper must not open native input');
  assert.equal(mic.getSampleRate(), 48000);
  const { SystemAudioCapture } = packaged('./dist-electron/electron/audio/SystemAudioCapture.js');
  const system = new SystemAudioCapture();
  system.monitor = { getSampleRate: () => 44100 };
  assert.equal(system.getSampleRate(), 44100, 'use the native camelCase sample-rate API');
  console.log('Packaged lazy microphone and sample-rate accessor: passed (capture not started)');
  const source = fs.readFileSync(path.join(archive, 'dist-electron/electron/main.js'), 'utf8');
  const begin = source.indexOf('async startMeeting(metadata) {');
  const end = source.indexOf('\n    endMeeting()', begin);
  assert.ok(begin > 0 && end > begin);
  const vm = require('node:vm');
  for (const enabled of [false, true]) {
    const counts = { permission: 0, microphone: 0, userSTT: 0, system: 0, systemSTT: 0 };
    let initializeAudio;
    const sandbox = { console: { log() {}, warn() {}, error() {} }, setTimeout: callback => { initializeAudio = callback; },
      logging_1: { ensureMacMicrophoneAccess: async () => { counts.permission++; return true; } },
      audio_stats_1: { audioStats: { reset() {} } }, send_lag_1: { sendLag: { start() {} } },
      audio_pipeline_1: { reconfigureAudio: async () => {} } };
    const entry = vm.runInNewContext('({' + source.slice(begin, end) + '})', sandbox).startMeeting;
    const fake = { endingMeeting: null, currentMeetingId: null, setMicrophoneMuted() {}, resetBufferedTranscriptTurns() {}, broadcastMeetingState() {},
      intelligenceManager: { setMeetingMetadata() {}, startMeeting: () => null }, getWindowHelper: () => ({ getOverlayWindow: () => null, getLauncherWindow: () => null }),
      reconfigureAudio: async () => {}, setupSystemAudioPipeline() {}, interpreting: { reset() {} },
      systemAudioCapture: { start: () => counts.system++ }, googleSTT: { start: () => counts.systemSTT++ },
      microphoneCapture: { start: () => counts.microphone++ }, googleSTT_User: { start: () => counts.userSTT++ } };
    await entry.call(fake, { audio: { captureMicrophone: enabled } }); await initializeAudio();
    assert.deepEqual(counts, { permission: +enabled, microphone: +enabled, userSTT: +enabled, system: 1, systemSTT: 1 });
  }
  console.log('Packaged meeting system-only / optional-microphone branches: passed with synthetic capture stubs');
}
main().catch(error => { console.error('Runtime smoke failed:', error.name, error.code || '', error.message); process.exitCode = 1; });
