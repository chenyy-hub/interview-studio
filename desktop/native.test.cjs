const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const Module = require('node:module');
const { pathToFileURL } = require('node:url');

test('desktop bridge validates senders, persists real documents and uses Pika screenshot methods', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-native-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'fixture.txt');fs.writeFileSync(source, 'Invented local document for the import test.');
  fs.writeFileSync(path.join(directory, 'studio-state.json'), JSON.stringify({ privacy: { enabled: true, selfTest: { version: 'synthetic-saved-version' } } }));
  const handlers = new Map();let captured = 0, holdStream = false, failDeep = false, speechReady = false, meetingId = null;
  const starts = [];
  const sent = [];
  const window = { isDestroyed: () => false, show() {}, focus() {}, loadURL: async () => {}, webContents: { getURL: () => pathToFileURL(path.join(directory, 'desktop/index.html')).href, send: (...args) => sent.push(args) } };
  const electron = { app: { getAppPath: () => directory, getPath: () => directory, on: () => {} }, BrowserWindow: { getAllWindows: () => [window] },
    ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [source] }) },
    systemPreferences: { getMediaAccessStatus: () => 'not-determined' }, Menu: { buildFromTemplate: list => list, setApplicationMenu: () => {} } };
  let modelReady = false;
  const cm = { getSttProvider: () => 'deepgram', getDeepgramApiKey: () => speechReady ? 'synthetic-key' : '', resolveModelUse: () => modelReady ? { model: 'fixture-model', connection: { name: 'Fixture', apiKey: 'not-a-real-key' } } : { error: 'Choose a model' } };
  const contexts = [];
  const llm = { streamChat: async function* (_question, _images, context, _system, options) {
    contexts.push(context);
    if (failDeep && _system.includes('解释原理')) throw new Error('Synthetic deep-column failure');
    if (holdStream) await new Promise(resolve => options.signal.addEventListener('abort', resolve, { once: true }));
    yield 'Synthetic provider text';
  } };
  const originalLoad = Module._load;
  Module._load = function(name, parent, isMain) {
    if (name === 'electron') return electron;
    if (name.replaceAll('\\', '/').endsWith('/services/CredentialsManager.js')) return { CredentialsManager: { getInstance: () => cm } };
    if (name.replaceAll('\\', '/').endsWith('/services/connectionSecrets.js')) return { redactConnectionError: error => error };
    return originalLoad.apply(this, arguments);
  };
  t.after(() => { Module._load = originalLoad; });
  const { install } = require('./native.cjs');
  install({ windowHelper: { getLauncherWindow: () => window }, getCurrentMeetingId: () => meetingId, getNativeAudioStatus: () => ({}), startMeeting: async metadata => starts.push(metadata),
    processingHelper: { getLLMHelper: () => llm }, getIntelligenceManager: () => ({ getFormattedContext: () => 'Synthetic transcript' }),
    takeScreenshot: async () => { captured++;return '/synthetic/screen.png'; }, takeSelectiveScreenshot: async () => { captured++;return '/synthetic/area.png'; },
    getImagePreview: async () => 'data:image/png;base64,fixture' });
  const frame = { url: pathToFileURL(path.join(directory, 'desktop/index.html')).href };
  const sender = { mainFrame: frame };
  const invoke = (name, data) => handlers.get('studio:' + name)({ senderFrame: frame, sender }, data);
  assert.equal((await invoke('status')).model, null);
  assert.equal((await invoke('status')).privacy.selfTest.version, 'synthetic-saved-version');
  assert.equal((await invoke('privacy-test', { client: 'feishu', version: '', capture: 'screen', result: 'passed' })).success, false);
  assert.equal((await invoke('performance', { mode: 'invented' })).success, false);
  await invoke('performance', { mode: 'balanced' }); assert.equal((await invoke('status')).performance.mode, 'balanced');
  assert.equal((await invoke('status')).captureSettings.captureMicrophone, false);
  assert.equal((await invoke('start')).success, false);
  assert.equal(starts.length, 0);
  assert.equal((await invoke('status')).needsConfiguration, true);
  speechReady = true;
  assert.equal((await invoke('start')).success, true);
  assert.equal(starts[0].audio.outputDeviceId, process.platform === 'win32' ? 'default' : 'sck');
  assert.equal(starts[0].audio.captureMicrophone, false);
  const audio = { backend: 'auto', captureMicrophone: true, inputDeviceId: 'synthetic-mic', outputDeviceId: 'synthetic-speaker' };
  await invoke('audio-preferences', audio);
  await invoke('start');
  assert.deepEqual(starts[1].audio, { captureMicrophone: true, inputDeviceId: 'synthetic-mic', outputDeviceId: 'synthetic-speaker' });
  meetingId = 'synthetic-meeting';
  assert.equal((await invoke('audio-preferences', { ...audio, captureMicrophone: false })).success, false);
  meetingId = null;
  const denied = await handlers.get('studio:status')({ senderFrame: { url: 'https://untrusted.example' }, sender });
  assert.equal(denied.success, false);
  assert.deepEqual(await handlers.get('get-input-devices')({ senderFrame: { url: 'https://untrusted.example' }, sender }), []);
  const capture = await invoke('capture', { area: true });
  assert.equal(capture.path, '/synthetic/area.png');assert.equal(captured, 1);
  await invoke('preferences', { notes: 'Invented profile', glossary: '', autoAnswer: false });
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'studio-state.json'))).notes, 'Invented profile');
  const imported = await invoke('import');assert.equal(imported.added.length, 1);assert.equal(imported.failed.length, 0);
  assert.equal((await invoke('documents'))[0].name, 'fixture.txt');
  for await (const _part of llm.streamChat('An overlay question', [], 'Existing overlay context')) {}
  assert.ok(contexts.at(-1).includes('Invented profile'));
  assert.ok(contexts.at(-1).includes('Invented local document'));
  assert.ok(contexts.at(-1).includes('Existing overlay context'));
  modelReady = true;
  assert.equal((await invoke('ask', { id: 'native-success', task: 'interview', question: 'Synthetic question' })).success, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((contexts.at(-1).match(/\[STUDIO_CONTEXT\]/g) || []).length, 1);
  assert.equal((await invoke('records'))[0].answers.quick, 'Synthetic provider text');
  assert.equal((await invoke('status')).generation.quick, 'Synthetic provider text');
  assert.equal((await invoke('status')).generation.running, false);
  failDeep = true;
  await invoke('ask', { id: 'partial-answer', task: 'interview', question: 'Synthetic dual question', dual: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await invoke('records'))[0].partial, true);
  assert.equal((await invoke('records'))[0].answers.quick, 'Synthetic provider text');
  failDeep = false;
  window.webContents.send('native-audio-transcript', { segmentId: 'synthetic-turn', speaker: 'them', text: 'Synthetic speech', final: true, timestamp: 1 });
  assert.equal((await invoke('status')).transcripts[0].text, 'Synthetic speech');
  holdStream = true;
  await invoke('ask', { id: 'cancel-on-reset', task: 'interview', question: 'Synthetic question' });
  window.webContents.send('session-reset');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await invoke('status')).transcripts.length, 0);
  assert.equal((await invoke('status')).generation, null);
  assert.ok(sent.some(([, data]) => data?.id === 'cancel-on-reset' && data.kind === 'done' && data.ok === false));
  modelReady = false;
  await invoke('documents', { remove: imported.added[0].id });assert.equal((await invoke('documents')).length, 0);
  const answer = await invoke('ask', { id: 'no-model', task: 'interview', question: 'test' });
  assert.equal(answer.success, false);assert.equal(answer.error, 'Choose a model');
});
