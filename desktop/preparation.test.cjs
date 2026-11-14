const test = require('node:test');
const assert = require('node:assert/strict');
const { preparation, preparationContext, documentHash, documentVersion } = require('./preparation.cjs');
test('preparation accepts bounded explicit settings and rejects invalid input', () => {
  const p = preparation({ company: ' Synthetic ', role: 'Driver', language: 'English', programmingLanguage: 'C++' });
  assert.equal(p.company, 'Synthetic'); assert.equal(p.language, 'English'); assert.equal(p.style, 'natural');
  assert.throws(() => preparation({ jobDescription: 'x'.repeat(12001) }));
  assert.throws(() => preparation({ language: 'unknown' }));
  assert.throws(() => preparation({ company: { nested: true } }));
  assert.match(preparationContext(p), /Synthetic/);
  assert.equal(preparationContext(preparation()), '');
});
test('document hashes deduplicate line endings without merging different code spacing', () => {
  assert.equal(documentHash('A\r\nB\n'), documentHash('A\nB'));
  assert.notEqual(documentHash('x y'), documentHash('xy'));
  assert.notEqual(documentVersion('A\r\nB'), documentVersion('A\nB'));
});
