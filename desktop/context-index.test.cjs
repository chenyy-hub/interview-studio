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

test('a selected short resume is included whole once with exact provenance', () => {
  const text = 'Synthetic resume beginning.\n' + '真实项目经历。'.repeat(400) + '\nUnique final project result.';
  const index = new ContextIndex([{ id: 'resume', name: 'resume.txt', text }], 'Short background');
  const selected = index.select('项目', 6000, { resumeDocumentId: 'resume' });
  assert.match(selected.text, /Unique final project result/);
  assert.equal(selected.sources.filter(s => s.id === 'resume').length, 1);
  const source = selected.sources.find(s => s.id === 'resume');
  assert.equal(source.complete, true); assert.equal(source.start, 1); assert.equal(source.end, text.length);
  assert.equal(source.hash.length, 64);
  assert.ok(selected.characters <= 6000);
});
test('long materials remain bounded and selected ranges do not overlap or claim completeness', () => {
  const text = 'Synthetic kernel driver data. '.repeat(1000);
  const index = new ContextIndex([{ id: 'long', name: 'long.txt', text }]);
  const selected = index.select('driver', 2200, { resumeDocumentId: 'long' });
  assert.ok(selected.characters <= 2200); assert.ok(selected.sources.length > 0);
  for (let i=0;i<selected.sources.length;i++) {
    const s=selected.sources[i]; assert.equal(s.complete,false); assert.ok(selected.text.includes(text.slice(s.start-1,s.end)));
    for (const other of selected.sources.slice(i+1)) assert.ok(s.end < other.start || other.end < s.start);
  }
});
