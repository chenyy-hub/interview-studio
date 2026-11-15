'use strict';

function appearance(value = {}) {
  const theme = value.theme ?? 'light', overlayOpacity = value.overlayOpacity ?? 0.88;
  // Legacy key now controls the whole floating surface, preserving saved values.
  const overlayTextOpacity = value.overlayTextOpacity ?? 1, overlayFontSize = value.overlayFontSize ?? 15;
  if (!['light', 'dark'].includes(theme) || typeof overlayOpacity !== 'number' || !Number.isFinite(overlayOpacity) || overlayOpacity < 0 || overlayOpacity > 1 || typeof overlayTextOpacity !== 'number' || !Number.isFinite(overlayTextOpacity) || overlayTextOpacity < 0.15 || overlayTextOpacity > 1 || !Number.isInteger(overlayFontSize) || overlayFontSize < 12 || overlayFontSize > 24) throw new Error('背景范围 0%–100%，整体范围 15%–100%，字号范围 12–24');
  return { theme, overlayOpacity: Math.round(overlayOpacity * 100) / 100, overlayTextOpacity: Math.round(overlayTextOpacity * 100) / 100, overlayFontSize };
}

// Override the upstream semantic palette, including component inline variables.
// Only background alpha changes; transcript and answer text remain fully opaque.
function upstreamCSS(settings) {
  const { theme, overlayOpacity: alpha } = appearance(settings), dark = theme === 'dark';
  const rgb = dark ? '35,37,35' : '252,251,247', surface = dark ? '#202220' : '#f6f5f0', card = dark ? '#292c29' : '#ffffff';
  const text = dark ? '#f1f1ea' : '#282d28', muted = dark ? '#b9c0b7' : '#687265', accent = dark ? '#9bc5aa' : '#366b50';
  const variables = {
    '--surface': surface, '--surface-container-low': surface, '--surface-container-high': card, '--surface-variant': card,
    '--bg-primary': surface, '--bg-secondary': surface, '--bg-elevated': card, '--bg-sidebar': surface, '--bg-main': surface, '--bg-card': card, '--bg-input': card, '--bg-component': card,
    '--text-primary': text, '--text-secondary': muted, '--text-tertiary': muted, '--text-accent': accent,
    '--primary': accent, '--accent-primary': accent, '--brand-action': '#366b50', '--brand-blue': '#4c8060', '--on-primary': '#ffffff', '--accent-muted': dark ? '#354638' : '#e9f0e7',
    '--overlay-opacity': alpha, '--overlay-bg': `rgba(${rgb},${alpha})`, '--overlay-panel-bg': `rgba(${rgb},${alpha})`,
    '--overlay-menu-bg': card, '--overlay-pill-bg': `rgba(${rgb},${Math.min(1, alpha + 0.06)})`, '--overlay-transcript-bg': dark ? '#1b1e1b44' : '#e6ebe344',
    '--overlay-chip-bg': dark ? '#384038' : '#eef1e9', '--overlay-chip-hover-bg': dark ? '#465146' : '#e1e8dc',
    '--overlay-input-bg': dark ? '#303630' : '#ffffffbb', '--overlay-input-hover-bg': card, '--overlay-input-focus-bg': card,
    '--overlay-control-bg': dark ? '#384038' : '#eef1e9', '--overlay-control-hover-bg': dark ? '#465146' : '#e1e8dc',
    '--overlay-border': dark ? '#68726766' : '#9da99666', '--overlay-border-soft': dark ? '#68726744' : '#9da99644',
    '--overlay-panel-shadow': dark ? '#00000033' : '#414b3522', '--overlay-action': '#366b50',
    '--overlay-code-bg': dark ? '#1d221d' : '#eef1e9', '--overlay-code-header-bg': dark ? '#303630' : '#e6ecdf', '--overlay-inline-code-bg': dark ? '#39463b' : '#e5edde',
    '--overlay-text-primary': text, '--overlay-text-secondary': muted, '--overlay-text-muted': muted, '--overlay-text-placeholder': muted, '--overlay-text-strong': text,
  };
  return `:root,:root .dark,:root .light,:root [style*="--overlay-"]{${Object.entries(variables).map(([key, value]) => `${key}:${value}!important`).join(';')}}`;
}

function createAppearance({ app, BrowserWindow, settings }) {
  let current = appearance(settings);
  const queues = new WeakMap(), keys = new WeakMap(), watched = new WeakSet();
  const applyWindow = win => {
    if (!win || win.isDestroyed() || typeof win.webContents?.insertCSS !== 'function' || !win.webContents.getURL().includes('/dist/index.html')) return Promise.resolve();
    const contents = win.webContents, css = upstreamCSS(current);
    const pending = (queues.get(contents) || Promise.resolve()).catch(() => {}).then(async () => {
      if (win.isDestroyed()) return;
      const previous = keys.get(contents);
      if (previous) await contents.removeInsertedCSS(previous).catch(() => {});
      if (!win.isDestroyed()) keys.set(contents, await contents.insertCSS(css, { cssOrigin: 'user' }));
    });
    queues.set(contents, pending);
    return pending;
  };
  const watch = win => {
    if (watched.has(win)) return; watched.add(win);
    win.webContents?.on?.('did-finish-load', () => { void applyWindow(win).catch(() => {}); });
  };
  app.on('browser-window-created', (_event, win) => watch(win));
  for (const win of BrowserWindow.getAllWindows()) watch(win);
  return { apply: async next => { current = appearance(next); await Promise.all(BrowserWindow.getAllWindows().map(applyWindow)); } };
}

module.exports = { appearance, upstreamCSS, createAppearance };
