'use strict';

function preferences(value = {}) {
  const mode = value.mode ?? 'auto';
  const silenceMs = value.silenceMs ?? 30000;
  if (!['auto', 'manual'].includes(mode) || ![10000, 30000, 60000].includes(silenceMs)) throw new Error('请选择 10、30、60 秒或手动分段');
  return { mode, silenceMs };
}

function createTranscriptionControl({ appState, assembler, initial, onChange = () => {} }) {
  let settings = preferences(initial), busy = false, generation = 0;
  appState.studioTranscription = settings;
  appState.studioTranscriptionPaused = false;
  const status = () => ({ ...settings, paused: !!appState.studioTranscriptionPaused, busy });
  async function finishTurn() {
    await Promise.all(['them', 'user'].map(speaker => assembler.flushBufferedTranscriptTurn(appState, speaker, { all: true })));
  }
  async function pause(paused) {
    if (typeof paused !== 'boolean') throw new Error('暂停状态不正确');
    if (!appState.getCurrentMeetingId()) throw new Error('请先开始采音');
    if (busy) throw new Error('正在切换转写状态，请稍候');
    if (paused === !!appState.studioTranscriptionPaused) return status();
    busy = true;
    const operation = ++generation;
    const meetingId = appState.getCurrentMeetingId();
    const streams = [appState.googleSTT, appState.studioCaptureMicrophone && appState.googleSTT_User].filter(Boolean);
    try {
      if (paused) {
        // Gate writes first, drain accepted audio, then close only speech connections.
        // Native WASAPI/SCK capture and the meeting session stay in place.
        appState.studioTranscriptionPaused = true;
        onChange(status());
        let timeout;
        try {
          await Promise.race([
            Promise.allSettled(streams.map(stream => Promise.resolve().then(() => stream.drainFinal?.()))),
            new Promise(resolve => { timeout = setTimeout(resolve, 2600); }),
          ]);
        } finally { clearTimeout(timeout); }
        if (generation !== operation || appState.getCurrentMeetingId() !== meetingId) return status();
        streams.forEach(stream => stream.stop());
        await finishTurn();
      } else {
        if (!appState.getIsMeetingActive?.() || appState.getCurrentMeetingId() !== meetingId) throw new Error('采音会话已结束');
        streams.forEach(stream => stream.start());
        appState.studioTranscriptionPaused = false;
      }
      return status();
    } finally { if (generation === operation) { busy = false; onChange(status()); } }
  }
  return {
    status, pause, finishTurn,
    configure(value) { settings = preferences(value); appState.studioTranscription = settings; onChange(status()); return settings; },
    reset() { generation++; busy = false; appState.studioTranscriptionPaused = false; onChange(status()); },
  };
}
module.exports = { preferences, createTranscriptionControl };
