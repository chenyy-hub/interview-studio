const test = require('node:test');
const assert = require('node:assert/strict');
const { ContextIndex } = require('./context-index.cjs');

test('large mixed-language materials stay bounded while selecting a relevant technical passage', () => {
  const index = new ContextIndex([
    { id: 'one', name: 'driver-notes', text: '无关内容。'.repeat(5000) + '\nI2C probe 驱动初始化，设备树匹配，regmap 寄存器访问。\n' },
    { id: 'two', name: 'resume', text: 'Synthetic résumé facts.' },
  ], 'Synthetic user background.');
  const result = index.select('I2C probe 驱动如何初始化？', 3000);
  assert.ok(result.characters <= 3000);
  assert.match(result.text, /regmap/);
  assert.match(result.text, /Synthetic résumé/);
  assert.ok(result.text.length < 3100);
  assert.ok(result.totalChunks > result.chunks);
});

test('reindexing removes deleted material and does not reuse obsolete private notes', () => {
  const index = new ContextIndex([{ id: 'old', name: 'old', text: 'obsolete material' }], 'old notes');
  index.reset([{ id: 'new', name: 'new', text: 'current material' }], 'current notes');
  const result = index.select('material');
  assert.match(result.text, /current material/);
  assert.ok(!result.text.includes('obsolete'));
});
