const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { DoubaoStreamingSTT } = require('./doubao-asr.cjs');
class Socket extends EventEmitter {
  static count = 0;
  constructor() { super(); Socket.count++; this.bufferedAmount = 0; }
  send(_, callback) { if (this.failSend) throw new Error('synthetic disconnect'); callback?.(); }
  terminate() { this.emit('close'); }
  close() { this.emit('close'); }
}
test('server end reconnects and stop cancels queued reconnect; final partial is preserved', async () => {
  const provider = new DoubaoStreamingSTT('synthetic',Socket), segments=[];
  provider.on('transcript', s=>segments.push(s)); provider.on('error', e=>assert.fail(e.message));
  const before = Socket.count;
  provider.start(); provider.write(Buffer.alloc(960)); provider.receive({code:0,result:{text:'保留的句子'},last:true});
  assert.equal(segments.at(-1).isFinal,true); assert.equal(provider.enabled,true);
  await new Promise(resolve=>setTimeout(resolve,300)); assert.equal(Socket.count,before+2);
  provider.receive({code:0,result:{},last:true}); provider.stop();
  await new Promise(resolve=>setTimeout(resolve,550)); assert.equal(Socket.count,before+2);
});
test('manual drain closes cleanly and send exceptions become a bounded reconnect', async () => {
  const provider = new DoubaoStreamingSTT('synthetic',Socket);
  provider.start(); provider.write(Buffer.alloc(960));
  provider.socket.failSend=true; assert.doesNotThrow(()=>provider.send(Buffer.alloc(1))); assert.ok(provider.reconnectTimer); provider.stop();
  provider.start(); provider.write(Buffer.alloc(960)); const drained=provider.drainFinal(); provider.receive({code:0,result:{},last:true}); await drained;
  assert.equal(provider.enabled,false); assert.equal(provider.reconnectTimer,null);
});
