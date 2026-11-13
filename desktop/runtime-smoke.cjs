'use strict';
// Run in ELECTRON_RUN_AS_NODE mode: no window, permission or provider request.
const { createRequire } = require('node:module');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const [archive, fixtureDirectory] = process.argv.slice(2);
  if (!archive || !fixtureDirectory) throw new Error('Usage: runtime-smoke.cjs APP_ASAR FIXTURE_DIRECTORY');
  const packaged = createRequire(path.join(path.resolve(archive), 'package.json'));
  const Database = packaged('better-sqlite3');
  const db = new Database(':memory:');
  try { assert.equal(db.prepare('SELECT 1 AS ready').get().ready, 1); } finally { db.close(); }
  console.log('Packaged SQLite: passed');
  assert.equal(typeof packaged('ws').WebSocketServer, 'function');
  console.log('Packaged pairing dependency: passed');
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
      audio_stats_1: { audioStats: { reset() {} } }, send_lag_1: { sendLag: { start() {} } } };
    const entry = vm.runInNewContext('({' + source.slice(begin, end) + '})', sandbox).startMeeting;
    const fake = { endingMeeting: null, currentMeetingId: null, setMicrophoneMuted() {}, resetBufferedTranscriptTurns() {}, broadcastMeetingState() {},
      intelligenceManager: { setMeetingMetadata() {}, startMeeting: () => null }, getWindowHelper: () => ({ getOverlayWindow: () => null, getLauncherWindow: () => null }),
      reconfigureAudio: async () => {}, setupSystemAudioPipeline() {},
      systemAudioCapture: { start: () => counts.system++ }, googleSTT: { start: () => counts.systemSTT++ },
      microphoneCapture: { start: () => counts.microphone++ }, googleSTT_User: { start: () => counts.userSTT++ } };
    await entry.call(fake, { audio: { captureMicrophone: enabled } }); await initializeAudio();
    assert.deepEqual(counts, { permission: +enabled, microphone: +enabled, userSTT: +enabled, system: 1, systemSTT: 1 });
  }
  console.log('Packaged meeting system-only / optional-microphone branches: passed with synthetic capture stubs');
}
main().catch(error => { console.error('Runtime smoke failed:', error.name, error.code || '', error.message); process.exitCode = 1; });
