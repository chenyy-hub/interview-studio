'use strict';

// Runs only with --studio-window-check, in an isolated temporary user-data dir.
// Use the real packaged WindowHelper and OS windows; never start a meeting.
async function run() {
  const assert = require('node:assert/strict');
  const { app, screen, ipcMain, BrowserWindow } = require('electron');
  const path = require('node:path');
  const fixture = { platform: process.platform, speech: { configured: false }, credentialStorage: { mode: 'local' }, transcripts: [],
    appearance: { theme: 'light', overlayOpacity: 0, overlayTextOpacity: 0.35, overlayFontSize: 18 }, floating: { mode: 'overlay', collapsed: false, shortcuts: [] } };
  ipcMain.handle('studio:status', () => fixture);
  ipcMain.handle('studio:appearance', (_event, value) => {
    fixture.appearance = value;
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send('studio:event', { kind: 'appearance', value });
    return { success: true };
  });
  const { WindowHelper } = require('../dist-electron/electron/helpers/WindowHelper.js');
  const helper = new WindowHelper({ isQuitting: () => true, getUndetectable: () => false,
    getIsMeetingActive: () => false, getOverlayMousePassthrough: () => false,
    settingsWindowHelper: { reposition() {} } });
  helper.switchToLauncher = () => {}; // Keep the check windows hidden until tested.
  helper.createWindow();
  const launcher = helper.getLauncherWindow(), overlay = helper.getOverlayWindow();
  assert.ok(launcher && overlay, 'The real launcher and overlay must be created');
  launcher.webContents.stop(); overlay.webContents.stop();
  // Exercise the actual floating preload, renderer and CSP with synthetic state.
  // No provider, microphone or screen-capture API is called by this fixture.
  await Promise.all([launcher.loadURL('about:blank'), overlay.loadURL(require('node:url').pathToFileURL(path.join(app.getAppPath(),'desktop/overlay.html')).href)]);
  const floatingUI = await overlay.webContents.executeJavaScript(`(async () => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (document.documentElement.style.getPropertyValue('--ui-alpha') === '0.35') break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    return { background: getComputedStyle(document.querySelector('#floating-window')).backgroundColor,
      text: getComputedStyle(document.querySelector('#answer-text')).opacity,
      font: getComputedStyle(document.querySelector('#answer-text')).fontSize,
      ghost: document.querySelector('#floating-window').dataset.ghost,
      ready: typeof window.studio?.invoke === 'function' && !!document.querySelector('#quick-answer').onclick,
      notice: document.querySelector('#floating-notice').textContent };
  })()`);
  assert.equal(floatingUI.ready, true);
  assert.equal(floatingUI.text, '1'); assert.equal(floatingUI.font, '18px');
  assert.equal(floatingUI.ghost, 'true'); assert.match(floatingUI.background, /rgba\(.+, 0\)/);
  assert.equal(floatingUI.notice, '');
  const appearanceSnapshot = () => overlay.webContents.executeJavaScript(`(() => {
    const style = selector => getComputedStyle(document.querySelector(selector));
    return { alpha: style('#floating-window').opacity,
      controls: ['header','.answer-tabs','footer','#question-form','#quick-answer'].map(selector => ({
        alpha: style(selector).opacity, background: style(selector).backgroundColor, border: style(selector).borderTopColor
      })) };
  })()`);
  const baseline = await appearanceSnapshot();
  assert.equal(baseline.alpha, '0.35', 'Saved opacity must apply once to the entire floating UI');
  for (const control of baseline.controls) {
    assert.equal(control.alpha, '1', 'Controls must inherit the same group alpha without double fading');
    assert.match(control.background, /rgba\(.+, 0\)/);
    assert.match(control.border, /rgba\(.+, 0\)/);
  }
  // Force actual Chromium hover states, then focus the composer. Neither may
  // reveal chrome or increase the saved group alpha, on either desktop OS.
  overlay.webContents.debugger.attach('1.3');
  try {
    await overlay.webContents.debugger.sendCommand('DOM.enable');
    await overlay.webContents.debugger.sendCommand('CSS.enable');
    const { root } = await overlay.webContents.debugger.sendCommand('DOM.getDocument');
    for (const selector of ['#floating-window','#quick-answer']) {
      const { nodeId } = await overlay.webContents.debugger.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector });
      await overlay.webContents.debugger.sendCommand('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['hover'] });
    }
    assert.deepEqual(await appearanceSnapshot(), baseline, 'Hover must not brighten the window or controls');
    await overlay.webContents.executeJavaScript(`document.querySelector('#question-input').focus()`);
    assert.deepEqual(await appearanceSnapshot(), baseline, 'Typing focus must not reveal bars');
    await overlay.webContents.executeJavaScript(`document.querySelector('#readable-editing').click()`);
    assert.equal((await appearanceSnapshot()).alpha, '1', 'Clear editing requires an explicit click');
    await overlay.webContents.executeJavaScript(`document.querySelector('#readable-editing').click()`);
    assert.deepEqual(await appearanceSnapshot(), baseline, 'Ending editing must restore the saved opacity');
  } finally { overlay.webContents.debugger.detach(); }
  console.log('STUDIO_FLOATING_CHECK_OK: actual preload/renderer/CSP, uniform alpha, unchanged hover/focus, explicit editing and font');
  await overlay.loadURL('about:blank');
  assert.equal(launcher.isClosable(), true);
  assert.equal(launcher.isMinimizable(), true);
  assert.equal(launcher.isMaximizable(), true);
  assert.equal(launcher.isResizable(), true);
  const bounds = launcher.getBounds(), area = screen.getPrimaryDisplay().workArea;
  assert.ok(bounds.x >= area.x && bounds.y >= area.y && bounds.x + bounds.width <= area.x + area.width && bounds.y + bounds.height <= area.y + area.height, 'Initial window must fit the available desktop');
  const source = require('node:fs').readFileSync(require('node:path').join(app.getAppPath(), 'dist-electron/electron/helpers/WindowHelper.js'), 'utf8');
  assert.ok(source.includes('{ frame: true, autoHideMenuBar: true }'), 'Launcher must use the OS frame');
  async function transition(name, action, condition) {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { launcher.removeListener(name, done); reject(new Error('Window transition timed out: ' + name)); }, 4000);
      const done = () => { clearTimeout(timer); resolve(); };
      launcher.once(name, done); action();
      if (condition?.()) { launcher.removeListener(name, done); done(); }
    });
  }
  launcher.showInactive();
  await transition('maximize', () => launcher.maximize(), () => launcher.isMaximized());
  await transition('unmaximize', () => launcher.unmaximize(), () => !launcher.isMaximized());
  await transition('minimize', () => launcher.minimize(), () => launcher.isMinimized());
  launcher.restore();
  await transition('closed', () => launcher.close());
  assert.equal(launcher.isDestroyed(), true);
  if (!overlay.isDestroyed()) overlay.destroy();
  console.log('STUDIO_WINDOW_CHECK_OK: native title bar, maximize/restore, minimize, close');
}
module.exports = { run };
