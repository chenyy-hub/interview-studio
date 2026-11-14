const test = require('node:test');
const assert = require('node:assert/strict');
const { runAnswers, validateRequest, applyGlossary } = require('./answer-engine.cjs');

test('single mode calls the model once; dual mode isolates both streams', async () => {
  for (const dual of [false, true]) {
    const events = []; let calls = 0;
    const request = { id: 'test-stream', task: 'interview', question: 'Synthetic test question', dual };
    const result = await runAnswers({ request, context: '', signal: new AbortController().signal, send: event => events.push(event),
      stream: async function* () { calls++; yield '中文'; await Promise.resolve(); yield '响应'; } });
    assert.equal(calls, dual ? 2 : 1);
    assert.equal(result.quick, '中文响应');
    assert.equal(result.deep, dual ? '中文响应' : undefined);
    assert.equal(events.filter(e => e.kind === 'first').length, calls);
    assert.equal(events.at(-1).ok, true);
  }
});
test('upstream failures never return authored fallback answers', async () => {
  const events = [];
  const result = await runAnswers({ request: { id: 'failed', task: 'resume', question: 'test', dual: false }, context: '', signal: new AbortController().signal,
    stream: async function* () { throw new Error('provider failed'); }, send: e => events.push(e) });
  assert.deepEqual(result, {});
  assert.equal(events.find(e => e.kind === 'error').message, 'provider failed');
  assert.equal(events.at(-1).ok, false);
});
test('stop prevents subsequent tokens and never reports a successful answer', async () => {
  const controller = new AbortController(); const events = [];
  const result = await runAnswers({ request: { id: 'cancelled', task: 'written', question: 'test', dual: false }, context: '', signal: controller.signal,
    stream: async function* () { yield 'first'; controller.abort(); yield 'must not appear'; }, send: e => events.push(e) });
  assert.deepEqual(result, {});
  assert.equal(events.filter(e => e.kind === 'token').length, 1);
  assert.equal(events.at(-1).ok, false);
});
test('empty answers remain failures; partial dual success is retained separately', async () => {
  const events = []; let call = 0;
  const result = await runAnswers({ request: { id: 'partial', task: 'interview', question: 'test', dual: true }, context: '', signal: new AbortController().signal,
    stream: async function* () { if (++call === 1) yield 'useful'; }, send: e => events.push(e) });
  assert.equal(result.quick, 'useful'); assert.equal(result.deep, undefined);
  assert.equal(events.at(-1).ok, false);
});
test('validation rejects malformed requests and inherited task names', () => {
  assert.throws(() => validateRequest({ id: '../bad', question: 'test', task: 'interview' }));
  assert.throws(() => validateRequest({ id: 'ok', question: '', task: 'interview' }));
  assert.throws(() => validateRequest({ id: 'ok', question: 'test', task: '__proto__' }));
  assert.equal(validateRequest({ id: 'ok', question: ' test ', task: 'resume' }).question, 'test');
});
test('glossary applies explicit longest replacements without changing other speech', () => {
  assert.equal(applyGlossary('普肉比函数和 I2C', '普肉比函数 => probe 函数\n普肉比 => probe'), 'probe 函数和 I2C');
});
test('cancel releases an iterator that ignores the provider abort signal', async () => {
  const controller = new AbortController(); const events = [];
  const result = runAnswers({ request: { id: 'stuck', task: 'interview', question: 'fixture', dual: false }, context: '', signal: controller.signal,
    stream: () => ({ [Symbol.asyncIterator]() { return this; }, next: () => new Promise(() => {}), return: async () => ({ done: true }) }), send: value => events.push(value) });
  controller.abort();
  await result;
  assert.equal(events.at(-1).kind, 'done');
  assert.equal(events.at(-1).ok, false);
});

test('saved answer language and programming preferences reach both actual provider prompts', async () => {
  const prompts = [];
  await runAnswers({ request: { id: 'language', task: 'written', question: 'fixture', dual: true }, context: '', preparation: { language: 'English', style: 'structured', programmingLanguage: 'C++' }, signal: new AbortController().signal, send() {},
    stream: async function* (_q,_i,_c,system) { prompts.push(system); yield 'synthetic'; } });
  assert.equal(prompts.length,2);
  for (const prompt of prompts) { assert.match(prompt,/Answer in English/); assert.match(prompt,/C\+\+/); assert.ok(!prompt.includes('用中文作答')); }
});
