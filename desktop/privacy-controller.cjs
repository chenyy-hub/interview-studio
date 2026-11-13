'use strict';

function createPrivacy({ app, appState, BrowserWindow, globalShortcut, platform = process.platform }) {
  let enabled = true, error = '', hidden = [], shortcutRegistered = false;
  const shortcut = 'CommandOrControl+Shift+Space';
  const protect = window => {
    if (!window || window.isDestroyed()) return;
    try { window.setContentProtection?.(enabled); }
    catch { error = '有窗口未能启用共享保护，请使用实际会议画面自测。'; }
  };
  const apply = value => {
    enabled = value === true; error = '';
    appState.setUndetectable?.(enabled);
    BrowserWindow.getAllWindows().forEach(protect);
    return status();
  };
  const toggleVisibility = () => {
    const visible = BrowserWindow.getAllWindows().filter(w => !w.isDestroyed() && w.isVisible?.());
    if (visible.length) { hidden = visible.map(w => w.id); visible.forEach(w => w.hide()); }
    else {
      let restored = 0;
      for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed() && hidden.includes(w.id)) { protect(w); w.showInactive?.(); restored++; }
      if (!restored) { const w = appState.windowHelper.getLauncherWindow(); protect(w); w?.showInactive?.(); }
      hidden = [];
    }
  };
  const status = () => ({ enabled, shortcut, shortcutRegistered, error,
    platform, supportedMechanism: platform === 'win32' ? 'Windows capture exclusion' : platform === 'darwin' ? 'macOS window sharing flag' : 'not verified',
    warning: platform === 'darwin' ? 'macOS 的 ScreenCaptureKit 可能仍能捕获窗口；必须在飞书/腾讯会议的实际共享画面中自测。' : '窗口保护标志不等于实际共享验证；请测试整屏、窗口共享和多显示器。',
    windows: BrowserWindow.getAllWindows().filter(w => !w.isDestroyed()).map(w => ({ protected: w.isContentProtected?.() === true })),
  });
  app.on('browser-window-created', (_event, window) => { protect(window); window.on?.('show', () => protect(window)); });
  if (globalShortcut?.register) {
    try { shortcutRegistered = globalShortcut.register(shortcut, toggleVisibility); } catch {}
    app.on('will-quit', () => { if (shortcutRegistered) globalShortcut.unregister(shortcut); });
  }
  return { apply, status, toggleVisibility };
}

module.exports = { createPrivacy };
