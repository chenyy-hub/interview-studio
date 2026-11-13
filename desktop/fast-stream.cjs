'use strict';

function abortable(promise, signal) {
  if (signal?.aborted) return Promise.reject(signal.reason || new DOMException('已停止', 'AbortError'));
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason || new DOMException('已停止', 'AbortError')); };
    signal.addEventListener('abort', abort, { once: true });
    promise.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}

async function* sseContent(body, signal) {
  const reader = body.getReader(), decoder = new TextDecoder();
  let buffer = '', data = [];
  function parse(lines) {
    const joined = lines.join('\n');
    if (joined === '[DONE]') return { done: true };
    let payload;
    try { payload = JSON.parse(joined); } catch { throw new Error('模型返回的流式数据格式不正确'); }
    if (payload.error) throw new Error(String(payload.error.message || '模型流返回错误').slice(0, 400));
    if (payload.choices?.[0]?.finish_reason === 'length') throw new Error('回答达到模型输出上限，内容可能不完整；可缩小问题后重试');
    if (payload.choices?.[0]?.finish_reason === 'content_filter') throw new Error('模型停止了本次回答，请调整问题后重试');
    return { text: payload.choices?.[0]?.delta?.content || '' };
  }
  try {
    while (true) {
      const chunk = await abortable(reader.read(), signal);
      buffer += decoder.decode(chunk.value || new Uint8Array(), { stream: !chunk.done });
      if (buffer.length + data.reduce((size, line) => size + line.length, 0) > 1048576) throw new Error('模型返回的单段流式数据过大，请检查服务端');
      if (chunk.done && buffer && !buffer.endsWith('\n')) buffer += '\n\n';
      let at;
      while ((at = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, at).replace(/\r$/, ''); buffer = buffer.slice(at + 1);
        if (!line) {
          if (!data.length) continue;
          const event = parse(data); data = [];
          if (event.done) return;
          if (typeof event.text === 'string' && event.text) yield event.text;
        } else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
      if (chunk.done) {
        if (data.length) { const event = parse(data); if (event.text) yield event.text; }
        return;
      }
    }
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function endpointFor(baseUrl) {
  const url = new URL(baseUrl);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))) throw new Error('模型地址必须是 HTTPS，或本机 HTTP 服务');
  const root = url.href.replace(/\/+$/, '') + (url.pathname === '/' ? '/v1' : '');
  return root + '/chat/completions';
}

async function* streamOpenAI({ connection, model, question, context, system, signal, column = 'quick', mode = 'fast', fetchImpl = fetch, firstTokenMs, idleMs = 15000, onStage = () => {} }) {
  const started = performance.now();
  const controller = new AbortController();
  const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  let firstTimer, idleTimer;
  const timeout = text => { const error = new Error(text); error.name = 'TimeoutError'; controller.abort(error); };
  firstTimer = setTimeout(() => timeout('模型迟迟没有返回首段文字，请检查网络、模型和推理模式后重试'), firstTokenMs ?? (column === 'quick' ? 15000 : 45000));
  const resetIdle = () => { clearTimeout(idleTimer); idleTimer = setTimeout(() => timeout('模型输出中断，请重试；已收到的内容仍保留'), idleMs); };
  const body = {
    model, stream: true,
    messages: [{ role: 'system', content: system }, { role: 'user', content: context ? `CONTEXT:\n${context}\n\nUSER QUESTION:\n${question}` : question }],
    max_tokens: column === 'quick' ? mode === 'fast' ? 512 : 900 : 3000,
  };
  // Official OpenAI has deprecated max_tokens; reasoning tokens also consume
  // its completion budget, so leave headroom rather than returning empty text.
  if (new URL(connection.baseUrl).hostname === 'api.openai.com') {
    body.max_completion_tokens = /^(o\d|gpt-[5-9])/i.test(model) ? (column === 'quick' ? 4096 : 8192) : body.max_tokens;
    delete body.max_tokens;
  }
  // Provider-specific parameters are sent only to the verified official host.
  // Generic compatible servers keep their own documented defaults.
  if (new URL(connection.baseUrl).hostname === 'api.deepseek.com' && column === 'quick' && mode === 'fast') body.thinking = { type: 'disabled' };
  const headers = { ...connection.headers, 'Content-Type': 'application/json', Accept: 'text/event-stream' };
  if (connection.apiKey) headers.Authorization = 'Bearer ' + connection.apiKey;
  try {
    const response = await abortable(fetchImpl(endpointFor(connection.baseUrl), { method: 'POST', headers, body: JSON.stringify(body), signal: combined, redirect: 'error' }), combined);
    onStage({ event: 'response-headers', column, ms: Math.round(performance.now() - started) });
    if (!response.ok) {
      let detail = '';
      try { const error = await abortable(response.json(), combined); detail = error.error?.message || error.message || ''; } catch {}
      throw new Error(`模型请求失败（HTTP ${response.status}）${detail ? '：' + String(detail).slice(0, 300) : ''}`);
    }
    if (!response.body) throw new Error('模型返回了空响应');
    for await (const text of sseContent(response.body, combined)) {
      clearTimeout(firstTimer); resetIdle(); yield text;
    }
  } catch (error) {
    if (signal?.aborted) throw new DOMException('已停止', 'AbortError');
    if (controller.signal.aborted) throw controller.signal.reason;
    throw error;
  } finally { clearTimeout(firstTimer); clearTimeout(idleTimer); controller.abort(); }
}

module.exports = { streamOpenAI, sseContent, endpointFor, abortable };
