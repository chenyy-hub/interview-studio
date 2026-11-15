const test = require('node:test');
const assert = require('node:assert/strict');
const { appearance, upstreamCSS, createAppearance } = require('./appearance.cjs');

test('appearance preserves saved fields and the advanced upstream palette changes background without dimming text', () => {
  assert.deepEqual(appearance(), { theme: 'light', overlayOpacity: 0.88, overlayTextOpacity: 1, overlayFontSize: 15 });
  assert.equal(appearance({ overlayOpacity: 0, overlayTextOpacity: 0.35 }).overlayOpacity, 0);
  for (const overlayOpacity of [NaN, Infinity, -0.1, 1.1, '0.8']) assert.throws(() => appearance({ overlayOpacity }));
  assert.throws(() => appearance({ overlayTextOpacity: 0 }));
  assert.throws(() => appearance({ theme: 'unknown' }));
  const css = upstreamCSS({ theme: 'light', overlayOpacity: 0.35 });
  assert.match(css, /rgba\(252,251,247,0.35\)/);
  assert.match(css, /--overlay-text-primary:#282d28!important/);
  assert.ok(!css.includes('opacity:0.35;'), 'text must not be faded with the window');
});

test('overlay theme survives reload, excludes the workbench, and the last queued setting wins', async () => {
  const handlers = {}, loads = {}, inserted = [], removed = [];
  let serial = 0;
  const window = { isDestroyed: () => false, webContents: { on: (name, callback) => { loads[name] = callback; },
    getURL: () => 'file:///synthetic/dist/index.html?window=overlay',
    insertCSS: async css => { await new Promise(resolve => setImmediate(resolve)); inserted.push(css); return String(++serial); }, removeInsertedCSS: async key => removed.push(key) } };
  const workbench = { isDestroyed: () => false, webContents: { on() {}, getURL: () => 'file:///synthetic/desktop/index.html', insertCSS: () => assert.fail('Workbench uses its own stylesheet') } };
  const controller = createAppearance({ app: { on: (name, callback) => { handlers[name] = callback; } }, BrowserWindow: { getAllWindows: () => [window, workbench] } });
  await Promise.all([controller.apply({ theme: 'dark', overlayOpacity: 0.45 }), controller.apply({ theme: 'light', overlayOpacity: 1 })]);
  assert.match(inserted.at(-1), /rgba\(252,251,247,1\)/);
  assert.deepEqual(removed, ['1']);
  loads['did-finish-load']();
  await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve));
  assert.match(inserted.at(-1), /rgba\(252,251,247,1\)/);
});
