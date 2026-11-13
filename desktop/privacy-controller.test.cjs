const test = require('node:test');
const assert = require('node:assert/strict');
const { createPrivacy } = require('./privacy-controller.cjs');

test('window protection is requested for existing and new windows; hide restores only visible windows', () => {
  const events = {}; let shortcut;
  const make = (id, visible) => ({ id, visible, protected: false, isDestroyed: () => false, isVisible() { return this.visible; },
    setContentProtection(value) { this.protected = value; }, isContentProtected() { return this.protected; }, hide() { this.visible = false; }, showInactive() { this.visible = true; }, on() {} });
  const windows = [make(1, true), make(2, false)];
  const privacy = createPrivacy({ app: { on: (name, fn) => events[name] = fn }, appState: { windowHelper: { getLauncherWindow: () => windows[0] } },
    BrowserWindow: { getAllWindows: () => windows }, globalShortcut: { register: (_key, fn) => { shortcut = fn; return true; }, unregister() {} }, platform: 'darwin' });
  privacy.apply(true); assert.equal(windows[0].protected, true);
  const created = make(3, false); windows.push(created); events['browser-window-created']({}, created); assert.equal(created.protected, true);
  shortcut(); assert.equal(windows[0].visible, false);
  shortcut(); assert.equal(windows[0].visible, true); assert.equal(windows[1].visible, false);
  assert.match(privacy.status().warning, /ScreenCaptureKit/);
  assert.equal(privacy.status().shortcutRegistered, true);
});

test('shortcut conflicts and missing OS protection are reported without claiming verified concealment', () => {
  const privacy = createPrivacy({ app: { on() {} }, appState: { windowHelper: {} }, BrowserWindow: { getAllWindows: () => [] }, globalShortcut: { register: () => false }, platform: 'win32' });
  assert.equal(privacy.status().shortcutRegistered, false);
  assert.match(privacy.status().warning, /不等于实际共享验证/);
  assert.equal(privacy.status().selfTest, undefined);
});
