const test = require('node:test');
const assert = require('node:assert/strict');
const { createTranscriptionControl, preferences } = require('./transcription-control.cjs');

test('pause drains speech without stopping native audio; resume keeps the meeting', async () => {
  const actions = []; let finishDrain;
  const state = { getCurrentMeetingId: () => 'one', getIsMeetingActive: () => true,
    systemAudioCapture: { stop: () => assert.fail('Native capture must stay running') },
    googleSTT: { drainFinal: () => new Promise(resolve => { finishDrain = resolve; }), stop: () => actions.push('stop'), start: () => actions.push('start') } };
  const control = createTranscriptionControl({ appState: state, assembler: { flushBufferedTranscriptTurn: async (_, speaker) => actions.push(speaker) } });
  const operation = control.pause(true); await Promise.resolve(); await Promise.resolve();
  assert.equal(state.studioTranscriptionPaused, true);
  await assert.rejects(control.pause(false), /正在切换/);
  finishDrain(); await operation;
  assert.deepEqual(actions, ['stop','them','user']);
  await control.pause(false); assert.equal(actions.at(-1), 'start'); assert.equal(state.studioTranscriptionPaused, false);
  assert.throws(() => preferences({silenceMs:2000}));
});

test('a late pause completion cannot stop or flush a replacement meeting', async () => {
  let meeting = 'old', finishDrain, stopped = 0, flushed = 0;
  const state = { getCurrentMeetingId: () => meeting,
    googleSTT: { drainFinal: () => new Promise(resolve => { finishDrain = resolve; }), stop: () => stopped++ } };
  const control = createTranscriptionControl({ appState: state, assembler: { flushBufferedTranscriptTurn: async () => flushed++ } });
  const operation = control.pause(true); await Promise.resolve(); await Promise.resolve();
  meeting = 'new'; control.reset(); finishDrain(); await operation;
  assert.equal(stopped, 0); assert.equal(flushed, 0); assert.equal(state.studioTranscriptionPaused, false); assert.equal(control.status().busy, false);
});
