'use strict';

function createFloating({ app, appState, globalShortcut, onChange = () => {} }) {
  const helper = appState.windowHelper;
  let collapsed = false, expandedHeight = 460;
  const registered = new Map(), failed = new Set();
  const definitions = [
    ['toggle','O','开启 / 退出悬浮'], ['passthrough','U','鼠标穿透 / 恢复'],
    ['quick','A','AI 快答'], ['retry','R','重新生成'], ['capture','V','截图并提问'],
    ['scroll-up','Up','向上滚动'], ['scroll-down','Down','向下滚动'], ['quick-tab','Left','快答栏'], ['deep-tab','Right','解释栏'],
  ];
  const mode = () => helper.getCurrentWindowMode?.() || 'launcher';
  const overlay = () => helper.getOverlayWindow?.();
  const status = () => ({ collapsed, mode: mode(), visible: !!overlay()?.isVisible?.(), passthrough: appState.getOverlayMousePassthrough?.() === true,
    shortcuts: definitions.map(([id,key,label]) => ({ id,label,accelerator:'CommandOrControl+Shift+'+key,registered: registered.has(id),conflict: failed.has(id) })) });
  const emit = () => onChange(status());
  const setPassthrough = enabled => { appState.setOverlayMousePassthrough?.(enabled); emit(); };
  const resize = value => {
    const win = overlay(); if (!win || win.isDestroyed()) return;
    const [width,height] = win.getSize();
    if (value && height > 180) expandedHeight = height;
    collapsed = value; win.setMinimumSize(320,44); win.setSize(width,value ? 48 : expandedHeight); emit();
  };
  const targetAction = action => {
    const win = mode() === 'overlay' ? overlay() : helper.getLauncherWindow();
    if (win && !win.isDestroyed()) win.webContents.send('studio:event', { kind: 'shortcut', action });
  };
  const refreshShortcuts = () => {
    if (!globalShortcut?.register) return;
    for (const [id,key] of definitions) {
      const accelerator = 'CommandOrControl+Shift+'+key, wanted = mode() === 'overlay' || !['scroll-up','scroll-down','quick-tab','deep-tab'].includes(id);
      if (!wanted && registered.has(id)) { globalShortcut.unregister(accelerator); registered.delete(id); failed.delete(id); }
      if (!wanted || registered.has(id)) continue;
      try {
        if (globalShortcut.register(accelerator, () => {
          try {
            if (id === 'toggle') run({ action: status().visible && mode() === 'overlay' ? 'main' : 'open' });
            else if (id === 'passthrough') run({ action: 'passthrough', enabled: !status().passthrough });
            else targetAction(id);
          } catch (error) { const win = overlay(); win?.webContents.send('studio:event', { kind: 'error', message: error.message }); }
        })) { registered.set(id, accelerator); failed.delete(id); } else failed.add(id);
      } catch { failed.add(id); }
    }
  };
  const afterMode = next => {
    if (next === 'overlay' && collapsed) resize(true);
    refreshShortcuts(); emit();
  };
  const hasDirectModes = typeof helper.switchToOverlay === 'function' && typeof helper.switchToLauncher === 'function';
  if (hasDirectModes) {
    for (const [method,next] of [['switchToOverlay','overlay'],['switchToLauncher','launcher']]) {
      const original = helper[method].bind(helper);
      helper[method] = (...args) => { if (next !== 'overlay') setPassthrough(false); original(...args); afterMode(next); };
    }
  } else if (helper.setWindowMode) {
    const originalMode = helper.setWindowMode.bind(helper);
    helper.setWindowMode = (next,inactive) => {
    if (next !== 'overlay') setPassthrough(false);
    originalMode(next,inactive);
    afterMode(next);
    };
  }
  function run(data) {
    const win = overlay();
    if (!['open','main','hide','collapse','passthrough'].includes(data?.action)) throw new Error('悬浮窗操作无效');
    if (!win || win.isDestroyed() || !helper.setWindowMode) throw new Error('悬浮窗尚未就绪');
    if (data.action === 'open') helper.setWindowMode('overlay',true);
    if (data.action === 'main') helper.setWindowMode('launcher',false);
    if (data.action === 'hide') win.hide();
    if (data.action === 'collapse') { if (typeof data.enabled !== 'boolean') throw new Error('收起设置不正确'); resize(data.enabled); }
    if (data.action === 'passthrough') {
      if (typeof data.enabled !== 'boolean') throw new Error('鼠标穿透设置不正确');
      if (data.enabled && (mode() !== 'overlay' || !win.isVisible())) throw new Error('请先打开悬浮窗，再开启鼠标穿透');
      // A recovery route is mandatory before making the window unclickable.
      if (data.enabled && !registered.has('passthrough') && !appState.tray) throw new Error('恢复快捷键被占用，暂不开启穿透；请先解决快捷键冲突');
      setPassthrough(data.enabled);
    }
    return status();
  }
  appState.setOverlayMousePassthrough?.(false);
  overlay()?.on?.('show',emit); overlay()?.on?.('hide',emit);
  refreshShortcuts();
  app.on('will-quit', () => { for (const accelerator of registered.values()) globalShortcut?.unregister(accelerator); registered.clear(); });
  return { status, run };
}
module.exports = { createFloating };
