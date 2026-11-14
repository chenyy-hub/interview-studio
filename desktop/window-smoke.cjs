'use strict';

// Runs only with --studio-window-check, in an isolated temporary user-data dir.
// Use the real packaged WindowHelper and OS windows; never start a meeting.
async function run() {
  const assert = require('node:assert/strict');
  const { app, screen } = require('electron');
  const { WindowHelper } = require('../dist-electron/electron/helpers/WindowHelper.js');
  const helper = new WindowHelper({ isQuitting: () => true, getUndetectable: () => false,
    getIsMeetingActive: () => false, getOverlayMousePassthrough: () => false,
    settingsWindowHelper: { reposition() {} } });
  helper.switchToLauncher = () => {}; // Keep the check windows hidden until tested.
  helper.createWindow();
  const launcher = helper.getLauncherWindow(), overlay = helper.getOverlayWindow();
  assert.ok(launcher && overlay, 'The real launcher and overlay must be created');
  launcher.webContents.stop(); overlay.webContents.stop();
  // Test windows show a local inert document, without provider requests or app IPC.
  await Promise.all([launcher.loadURL('about:blank'), overlay.loadURL('about:blank')]);
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
