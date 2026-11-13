'use strict';
const { app } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const launchCheck = process.argv.includes('--studio-launch-check');
// Isolate this fork's data before any upstream singleton is constructed.
app.setName('Interview Studio');
const studioData = launchCheck ? fs.mkdtempSync(path.join(os.tmpdir(), 'studio-launch-check-')) : path.join(app.getPath('appData'), 'InterviewStudio');
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
if (launchCheck) {
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
}
