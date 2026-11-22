(() => {
'use strict';
// Foreground-only controls leave the meeting client's global shortcuts alone.
document.addEventListener('keydown', event => {
  if (event.isComposing || event.keyCode === 229 || event.repeat || event.altKey) return;
  const modifier = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();
  const click = id => {
    const button = document.getElementById(id);
    if (!button || button.disabled) return false;
    if (id === 'ask' && document.getElementById('work')?.hidden) return false;
    button.click(); return true;
  };
  let handled = false;
  if (modifier && event.shiftKey && key === 'p') handled = click('pause-transcription');
  else if (modifier && event.shiftKey && key === 'enter') handled = click('finish-turn');
  else if (modifier && !event.shiftKey && key === 'enter' && !event.defaultPrevented) handled = click('ask') || click('quick-answer');
  else if (modifier && !event.shiftKey && ['1','2'].includes(key)) {
    const tab = document.getElementById(key === '1' ? 'quick-tab' : 'deep-tab');
    if (tab) { tab.click(); handled = true; }
  } else if (!modifier && ['pageup','pagedown'].includes(key) && !event.target.closest?.('input,textarea,select,[contenteditable=true]')) {
    const panel = document.getElementById('answer-scroll') || (!document.getElementById('work')?.hidden && document.getElementById('columns'));
    if (panel) { panel.scrollBy({ top: (key === 'pageup' ? -1 : 1) * Math.max(160, panel.clientHeight * 0.8), behavior: 'auto' }); handled = true; }
  }
  if (handled) event.preventDefault();
});
})();
