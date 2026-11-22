'use strict';

const { EventEmitter } = require('node:events');
const { randomUUID } = require('node:crypto');
const { gzipSync, gunzipSync } = require('node:zlib');

const ENDPOINT = 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async';
const RESOURCE = 'volc.seedasr.sauc.duration';
const SAMPLE_RATE = 16000;
const PACKET_MS = 200;
const PACKET_BYTES = SAMPLE_RATE * 2 * PACKET_MS / 1000;
// A slow initial handshake may take up to 10s. Keep its audio within a bounded 12s queue.
const MAX_PENDING = PACKET_BYTES * 60;
const MAX_RESPONSE = 1024 * 1024;

function packet(type, sequence, data) {
  const body = gzipSync(data);
  const header = Buffer.from([0x11, (type << 4) | (sequence < 0 ? 3 : 1), 0x11, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  header.writeInt32BE(sequence, 4);
  header.writeUInt32BE(body.length, 8);
  return Buffer.concat([header, body]);
}

function responseOf(data) {
  if (data.length < 4 || data[0] >> 4 !== 1 || (data[0] & 15) === 0) throw new Error('Invalid header');
  const type = data[1] >> 4, flags = data[1] & 15;
  const compression = data[2] & 15, serialization = data[2] >> 4;
  let offset = (data[0] & 15) * 4;
  if (flags & 1) offset += 4;
  if (flags & 4) offset += 4;
  if (type !== 9 && type !== 15) throw new Error('Invalid type');
  const code = type === 15 ? data.readUInt32BE(offset) : 0;
  if (type === 15) offset += 4;
  const size = data.readUInt32BE(offset);
  const raw = data.subarray(offset + 4);
  if (raw.length !== size || compression > 1) throw new Error('Invalid payload');
  const body = size && compression === 1 ? gunzipSync(raw, { maxOutputLength: MAX_RESPONSE }) : raw;
  const result = body.length && serialization === 1 ? JSON.parse(body.toString('utf8'))?.result : undefined;
  return { code, result, last: !!(flags & 2) };
}

class DoubaoStreamingSTT extends EventEmitter {
  constructor(apiKey, WebSocket = require('ws')) {
    super();
    this.apiKey = apiKey;
    this.WebSocket = WebSocket;
    this.sampleRate = 48000;
    this.pending = Buffer.alloc(0);
  }

  setSampleRate(rate) {
    if (Number.isInteger(rate) && rate >= 8000 && rate <= 192000 && this.sampleRate !== rate) {
      this.sampleRate = rate;
      this.phase = this.sum = this.samples = 0;
    }
  }

  // In the real-time endpoint, Chinese and English are detected by the service.
  setRecognitionLanguage() {}

  start() {
    if (this.enabled) return;
    this.enabled = true;
    this.phase = this.sum = this.samples = 0;
    this.lastFinalEnd = -1;
    this.lastFinalText = this.lastPartial = '';
    this.sequence = 2;
    this.reconnectAttempts = 0;
  }

  write(chunk) {
    if (!this.enabled || this.finishPromise || chunk.length < 2) return;
    const audio = this.toMono16k(chunk);
    if (this.pending.length + audio.length > MAX_PENDING) {
      this.fail('豆包语音发送积压，请结束采音后重试。');
      return;
    }
    this.pending = Buffer.concat([this.pending, audio]);
    if (!this.socket && !this.reconnectTimer) this.connect();
  }

  // Keep fractional phase across native chunks (including 44.1 kHz input).
  // The capture pipeline already supplies one interleaved PCM16 mono sample per frame.
  toMono16k(chunk) {
    const count = Math.floor(chunk.length / 2);
    if (this.sampleRate === SAMPLE_RATE) return chunk.subarray(0, count * 2);
    const out = Buffer.allocUnsafe(Math.ceil(count * SAMPLE_RATE / this.sampleRate) * 2);
    let written = 0;
    for (let i = 0; i < count; i++) {
      const sample = chunk.readInt16LE(i * 2);
      this.sum += sample;
      this.samples++;
      this.phase += SAMPLE_RATE;
      if (this.phase < this.sampleRate) continue;
      const average = Math.round(this.sum / this.samples);
      while (this.phase >= this.sampleRate) {
        out.writeInt16LE(average, written);
        written += 2;
        this.phase -= this.sampleRate;
      }
      this.sum = this.samples = 0;
    }
    return out.subarray(0, written);
  }

  connect() {
    this.sequence = 2;
    this.lastFinalEnd = -1;
    this.lastFinalText = this.lastPartial = '';
    let socket;
    try {
      socket = new this.WebSocket(ENDPOINT, { handshakeTimeout: 8000, maxPayload: MAX_RESPONSE, headers: {
        'X-Api-Key': this.apiKey, 'X-Api-Resource-Id': RESOURCE, 'X-Api-Request-Id': randomUUID(),
      } });
    } catch {
      this.fail('无法建立豆包语音连接，请检查语音 API Key 格式。');
      return;
    }
    this.socket = socket;
    this.initTimeout = setTimeout(() => this.fail('豆包语音连接或初始化超时。'), 10000);
    socket.on('open', () => {
      if (this.socket !== socket) return;
      this.send(packet(1, 1, Buffer.from(JSON.stringify({
        user: { uid: 'interview-studio' },
        audio: { format: 'pcm', codec: 'raw', rate: SAMPLE_RATE, bits: 16, channel: 1 },
        request: { model_name: 'bigmodel', result_type: 'single', show_utterances: true, enable_nonstream: true },
      }))));
    });
    socket.on('message', data => {
      if (this.socket !== socket) return;
      try { this.receive(responseOf(data)); }
      catch { this.fail('豆包语音返回了无法解析的响应。'); }
    });
    socket.on('unexpected-response', (_request, response) => {
      response.resume();
      if (this.socket !== socket) return;
      const status = response.statusCode;
      const logId = response.headers['x-tt-logid'];
      const reference = typeof logId === 'string' && /^[a-z0-9]{1,100}$/i.test(logId) ? `，Log ID ${logId}` : '';
      const detail = status === 401 ? '请检查豆包语音产品的 API Key' : status === 403 ? '请核对 Key 所属项目的流式识别 2.0 小时版授权' : '请检查服务状态';
      this.fail(`豆包语音 HTTP ${status}，${detail}${reference}。`);
    });
    socket.on('error', () => { if (this.socket === socket) this.reconnect(); });
    socket.on('close', () => { if (this.socket === socket) this.reconnect(); });
  }

  reconnect() {
    if (this.finishPromise || !this.enabled) { this.stop(true); return; }
    if (++this.reconnectAttempts > 3) { this.fail('豆包语音多次重连失败，请检查网络，再暂停并继续转写。'); return; }
    const socket = this.socket;
    this.socket = null;
    clearInterval(this.timer); clearTimeout(this.initTimeout);
    this.initTimeout = null;
    socket?.terminate();
    this.emit('reconnecting');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.enabled) this.connect();
    }, 250 * this.reconnectAttempts);
  }

  send(data) {
    const socket = this.socket;
    if (!socket) return;
    if (socket.bufferedAmount > MAX_PENDING) {
      this.fail('豆包语音网络发送积压，请结束采音后重试。');
      return;
    }
    try { socket.send(data, error => { if (error && this.socket === socket) this.reconnect(); }); }
    catch { if (this.socket === socket) this.reconnect(); }
  }

  pump() {
    if (!this.socket || this.initTimeout) return;
    const last = !!this.finishPromise && this.pending.length <= PACKET_BYTES;
    const audio = last ? this.pending : Buffer.alloc(PACKET_BYTES);
    if (!last) this.pending.copy(audio, 0, 0, PACKET_BYTES);
    this.pending = this.pending.subarray(audio.length);
    const sequence = this.sequence++;
    if (last) clearInterval(this.timer);
    this.send(packet(2, last ? -sequence : sequence, audio));
  }

  receive({ code, result, last }) {
    if (code) {
      this.fail(`豆包语音服务返回错误 ${code}。`);
      return;
    }
    if (this.initTimeout) {
      clearTimeout(this.initTimeout);
      this.initTimeout = null;
      this.emit('ready');
      if (!this.socket) return;
      this.timer = setInterval(() => this.pump(), PACKET_MS);
    }
    const utterances = Array.isArray(result?.utterances) ? result.utterances : [];
    for (const sentence of utterances) {
      const text = typeof sentence?.text === 'string' ? sentence.text.trim() : '';
      if (!sentence?.definite || !text) continue;
      const end = sentence.end_time;
      if (Number.isFinite(end) ? end <= this.lastFinalEnd : text === this.lastFinalText && !this.lastPartial) continue;
      if (Number.isFinite(end)) this.lastFinalEnd = end;
      this.lastFinalText = text;
      this.reconnectAttempts = 0;
      this.lastPartial = '';
      this.emit('transcript', { text, isFinal: true, confidence: 1, boundary: true });
    }
    const partial = utterances.length ? utterances.findLast(sentence => !sentence?.definite)?.text : result?.text;
    const text = typeof partial === 'string' ? partial.trim() : '';
    if (text && text !== this.lastPartial && (utterances.length || text !== this.lastFinalText)) {
      this.lastPartial = text;
      this.emit('transcript', { text, isFinal: false, confidence: 1 });
    }
    if (last && this.lastPartial) {
      const finalText = this.lastPartial;
      this.lastPartial = '';
      this.emit('transcript', { text: finalText, isFinal: true, confidence: 1, boundary: true });
    }
    // A service-side stream end must not silently disable an ongoing capture.
    if (last) this.finishPromise ? this.stop(true) : this.reconnect();
  }

  drainFinal() {
    if (!this.socket) return Promise.resolve();
    if (!this.finishPromise) {
      this.finishPromise = new Promise(resolve => {
        this.resolveFinish = resolve;
        this.finishTimeout = setTimeout(() => this.stop(), 2200);
      });
    }
    return this.finishPromise;
  }

  stop(graceful = false) {
    const socket = this.socket;
    this.socket = null;
    this.enabled = false;
    this.pending = Buffer.alloc(0);
    clearInterval(this.timer);
    clearTimeout(this.initTimeout);
    clearTimeout(this.finishTimeout);
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.initTimeout = null;
    this.resolveFinish?.();
    this.resolveFinish = this.finishPromise = null;
    if (graceful) socket?.close();
    else socket?.terminate();
  }

  fail(message) {
    this.stop();
    if (this.listenerCount('error')) this.emit('error', new Error(message));
  }
}

function checkDoubaoConnection(apiKey, WebSocket) {
  const provider = new DoubaoStreamingSTT(apiKey, WebSocket);
  return new Promise((resolve, reject) => {
    provider.once('ready', () => { provider.stop(true); resolve(); });
    provider.once('error', reject);
    provider.start();
    provider.connect();
  });
}

module.exports = { DoubaoStreamingSTT, checkDoubaoConnection };
