'use strict';
const { app } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const launchCheck = process.argv.includes('--studio-launch-check');
const windowCheck = process.argv.includes('--studio-window-check');
const upgradeCheck = process.argv.includes('--studio-upgrade-check');
const runtimeCheck = process.argv.includes('--studio-runtime-check');
// Isolate this fork's data before any upstream singleton is constructed.
app.setName('Interview Studio');
const studioData = launchCheck || windowCheck || upgradeCheck || runtimeCheck ? fs.mkdtempSync(path.join(os.tmpdir(), 'studio-launch-check-')) : path.join(app.getPath('appData'), 'InterviewStudio');
fs.mkdirSync(studioData, { recursive: true });
app.setPath('userData', studioData);
// Keep startup diagnostics separate from prompts, transcripts and credentials.
// Only JavaScript startup failures are recorded; normal renderer messages are not.
const startupLog = (stage, error) => {
  const detail = String(error?.message || error || '').replace(/https?:\/\/\S+/g, '[url]').slice(0, 700);
  try { fs.appendFileSync(path.join(studioData, 'studio-startup.log'), `${new Date().toISOString()} ${stage}: ${detail}\n`, { mode: 0o600 }); } catch {}
};
app.on('web-contents-created', (_event, contents) => {
  contents.on('preload-error', (_event, _file, error) => startupLog('preload-error', error));
  contents.on('console-message', event => {
    if (/^(Uncaught (TypeError|ReferenceError|SyntaxError)|Unable to load preload|Error: module not found)/.test(event.message)) startupLog('renderer-startup', event.message);
  });
});
if (upgradeCheck) {
  app.whenReady().then(() => require('./upgrade-smoke.cjs').run()).then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1); });
} else if (windowCheck) {
  app.whenReady().then(() => require('./window-smoke.cjs').run()).then(() => app.exit(0)).catch(error => {
    console.error('[Studio] Packaged window check failed:', error); app.exit(1);
  });
} else if (launchCheck) {
  // Exercise the packaged Electron browser-process bootstrap without a window,
  // credentials, microphone, screen capture or network request.
  app.whenReady().then(() => {
    console.log('STUDIO_LAUNCH_CHECK_OK');
    app.exit(0);
  }).catch(() => app.exit(1));
} else {
const { CredentialsManager } = require('../dist-electron/electron/services/CredentialsManager.js');
require('./credential-session.cjs').attach(CredentialsManager.getInstance(), { directory: path.join(studioData, 'private') });
const { SettingsManager } = require('../dist-electron/electron/services/SettingsManager.js');
// An upstream release must not replace this fork's app bundle.
SettingsManager.getInstance().set('autoCheckUpdates', false);
const { AppState } = require('../dist-electron/electron/main.js');
app.whenReady().then(() => require('./native.cjs').install(AppState.getInstance())).catch(error => {
  startupLog('native-install', error);
  console.error('[Studio] Desktop service initialization failed:', error);
});
if (runtimeCheck) app.whenReady().then(async () => {
  const assert = require('node:assert/strict');
  for (let i = 0; i < 80; i++) {
    await new Promise(resolve => setTimeout(resolve, 100));
    const win = AppState.getInstance().windowHelper.getLauncherWindow();
    if (!win || win.webContents.isLoading()) continue;
    const result = await win.webContents.executeJavaScript(`(async () => { const s = await window.studio.invoke('status'); return { version: s.appVersion, timeout: s.transcription?.silenceMs, compatibility: s.meetingCompatibility, notice: document.querySelector('#notice').textContent }; })()`);
    assert.equal(result.version, '0.8.7'); assert.equal(result.timeout, 30000); assert.equal(result.compatibility, true); assert.equal(result.notice, '');
    const all = require('electron').BrowserWindow.getAllWindows();
    for (let attempt = 0; attempt < 50 && all.some(w => w.webContents.isLoading()); attempt++) await new Promise(resolve => setTimeout(resolve, 100));
    const auxiliary = all.filter(w => /window=(cropper|settings)/.test(w.webContents.getURL()));
    assert.ok(auxiliary.length >= 2, 'Cropper and settings windows must load');
    for (const w of auxiliary) assert.equal(await w.webContents.executeJavaScript('document.readyState'), 'complete');
    win.hide();
    app.emit('second-instance', {}, [], process.cwd());
    assert.equal(win.isVisible(), true, 'Opening a second instance must restore a hidden window');
    console.log('STUDIO_RUNTIME_CHECK_OK: actual native handlers, real workbench, isolated credentials, hidden-window restore, no capture or model request'); app.exit(0); return;
  }
  throw new Error('Real runtime did not become ready');
}).catch(error => { console.error(error); app.exit(1); });
}
