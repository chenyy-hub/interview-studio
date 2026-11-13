const test = require('node:test');
const assert = require('node:assert/strict');
const { streamOpenAI, sseContent, endpointFor } = require('./fast-stream.cjs');

function bytes(text, size = 3) {
  const encoded = new TextEncoder().encode(text);
  return new ReadableStream({ start(controller) { for (let i = 0; i < encoded.length; i += size) controller.enqueue(encoded.slice(i, i + size)); controller.close(); } });
}
async function collect(iterator) { const parts = []; for await (const part of iterator) parts.push(part); return parts.join(''); }
const connection = { baseUrl: 'https://api.deepseek.com', apiKey: 'synthetic-key', headers: { 'X-Test': 'synthetic' } };

test('compatible endpoints preserve gateway prefixes and reject unsafe credential destinations', () => {
  assert.equal(endpointFor('https://api.deepseek.com'), 'https://api.deepseek.com/v1/chat/completions');
  assert.equal(endpointFor('https://example.test/openai/v1/'), 'https://example.test/openai/v1/chat/completions');
  assert.equal(endpointFor('http://127.0.0.1:11434/v1'), 'http://127.0.0.1:11434/v1/chat/completions');
  assert.throws(() => endpointFor('http://remote.example/v1'));
  assert.throws(() => endpointFor('https://user:password@example.test/v1'));
});

test('SSE parser handles UTF-8 packet boundaries, CRLF, heartbeats, usage and DONE', async () => {
  const body = bytes(': heartbeat\r\n\r\ndata: {"choices":[{"delta":{"content":"中文"}}]}\r\n\r\ndata: {"usage":{}}\n\ndata: {"choices":[{"delta":{"content":"回答"}}]}\n\ndata: [DONE]\n\n');
  assert.equal(await collect(sseContent(body, new AbortController().signal)), '中文回答');
  await assert.rejects(collect(sseContent(bytes('data: broken\n\n'))), /格式不正确/);
});

test('fast official DeepSeek requests disable thinking; generic servers receive no foreign parameter', async () => {
  for (const baseUrl of ['https://api.deepseek.com', 'https://example.test/v1']) {
    let request, calls = 0;
    const stages = [];
    const result = await collect(streamOpenAI({ connection: { ...connection, baseUrl }, model: 'deepseek-flash', question: 'synthetic', context: '', system: 'synthetic', signal: new AbortController().signal,
      onStage: stage => stages.push(stage), fetchImpl: async (_url, init) => { calls++; request = init; return new Response(bytes('data: {"choices":[{"delta":{"content":"streamed"}}]}\n\ndata: [DONE]\n\n'), { headers: { 'content-type': 'text/event-stream' } }); } }));
    assert.equal(result, 'streamed'); assert.equal(calls, 1);
    const payload = JSON.parse(request.body);
    assert.equal(payload.max_tokens, 512);
    assert.equal(request.redirect, 'error');
    assert.equal(payload.thinking?.type, baseUrl.includes('deepseek') ? 'disabled' : undefined);
    assert.equal(stages[0].event, 'response-headers');
  }
});

test('first-visible-text timeout aborts even an uncooperative stream', async () => {
  let cancelled = false;
  const body = new ReadableStream({ cancel() { cancelled = true; } });
  await assert.rejects(collect(streamOpenAI({ connection, model: 'fixture', question: 'fixture', system: '', firstTokenMs: 15,
    fetchImpl: async () => new Response(body) })), /首段文字/);
  assert.equal(cancelled, true);
});

test('OpenAI official endpoint uses completion budgets without foreign thinking parameters', async () => {
  let payload;
  await collect(streamOpenAI({ connection: { ...connection, baseUrl: 'https://api.openai.com/v1' }, model: 'gpt-5-mini', question: 'fixture', system: '',
    fetchImpl: async (_url, init) => { payload = JSON.parse(init.body); return new Response(bytes('data: {"choices":[{"delta":{"content":"answer"}}]}\n\ndata: [DONE]\n\n')); } }));
  assert.equal(payload.max_tokens, undefined);
  assert.equal(payload.max_completion_tokens, 4096);
  assert.equal(payload.thinking, undefined);
});

test('truncated and oversized streams surface errors instead of reporting a complete answer', async () => {
  await assert.rejects(collect(sseContent(bytes('data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n'))), /输出上限/);
  await assert.rejects(collect(sseContent(bytes('x'.repeat(1048577), 1048577))), /数据过大/);
});

test('first-text timeout also bounds an uncooperative fetch implementation', async () => {
  await assert.rejects(collect(streamOpenAI({ connection, model: 'fixture', question: 'fixture', system: '', firstTokenMs: 15,
    fetchImpl: () => new Promise(() => {}) })), /首段文字/);
});

test('idle timeout preserves already delivered text and HTTP failures are not retried silently', async () => {
  const body = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"first"}}]}\n\n')); } });
  const received = [];
  await assert.rejects(async () => { for await (const part of streamOpenAI({ connection, model: 'fixture', question: 'fixture', system: '', idleMs: 15, fetchImpl: async () => new Response(body) })) received.push(part); }, /输出中断/);
  assert.deepEqual(received, ['first']);
  let calls = 0;
  await assert.rejects(collect(streamOpenAI({ connection, model: 'fixture', question: 'fixture', system: '', fetchImpl: async () => { calls++; return new Response('{"error":{"message":"synthetic denied"}}', { status: 401 }); } })), /HTTP 401/);
  assert.equal(calls, 1);
});
