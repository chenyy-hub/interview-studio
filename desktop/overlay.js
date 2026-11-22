(() => {
'use strict';
const $ = selector => document.querySelector(selector), bridge = window.studio, native = window.electronAPI;
const state = { request: null, quick: '', deep: '', tab: 'quick', lastQuestion: '', transcripts: new Map(), images: [], first: {}, status: null, editing: false };
const escapeText = text => String(text ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function call(name,data) { const result = await bridge.invoke(name,data); if (result?.success === false) throw new Error(result.error); return result; }
const notice = text => { $('#floating-notice').textContent = text || ''; };
const action = callback => async () => { try { notice(''); await callback(); } catch(error) { notice(error.message || '操作失败'); } };
function applyAppearance(value = {}) {
  const root = document.documentElement;
  root.dataset.theme = value.theme || 'light';
  root.style.setProperty('--background-alpha',String(value.overlayOpacity ?? 0.88));
  // Retain the saved preference key so existing installations keep their value.
  root.style.setProperty('--ui-alpha',String(value.overlayTextOpacity ?? 1));
  root.style.setProperty('--answer-size',(value.overlayFontSize ?? 15)+'px');
  $('#floating-window').dataset.ghost = String((value.overlayOpacity ?? 0.88) === 0);
  $('#background-opacity').value = Math.round((value.overlayOpacity ?? 0.88)*100);
  $('#text-opacity').value = Math.round((value.overlayTextOpacity ?? 1)*100);
  $('#font-size').value = value.overlayFontSize ?? 15;
  $('#background-value').textContent = $('#background-opacity').value+'%';
  $('#text-value').textContent = $('#text-opacity').value+'%';
  $('#font-value').textContent = $('#font-size').value;
}
function setEditing(enabled) {
  state.editing = enabled;
  $('#floating-window').classList.toggle('is-editing',enabled);
  $('#readable-editing').textContent = enabled ? '结束编辑' : '清晰编辑';
  $('#readable-editing').setAttribute('aria-pressed',String(enabled));
}
function renderFloating(value = {}) {
  if (value.mode !== 'overlay' || value.visible === false) setEditing(false);
  $('#floating-window').classList.toggle('is-collapsed',!!value.collapsed);
  $('#collapse').textContent = value.collapsed ? '⌄' : '⌃';
  $('#collapse').setAttribute('aria-label',value.collapsed ? '展开悬浮窗' : '收起悬浮窗');
  $('#passthrough-badge').hidden = !value.passthrough;
  $('#click-through').textContent = value.passthrough ? '关闭鼠标穿透' : '开启鼠标穿透';
  const display = accelerator => accelerator.replace('CommandOrControl','Ctrl/⌘').replace(/\+/g,' + ');
  $('#shortcut-list').innerHTML = (value.shortcuts || []).map(s=>`<div class="${s.conflict ? 'conflict' : ''}">${escapeText(s.label)}：${escapeText(display(s.accelerator))}${s.conflict ? ' · 被占用' : ''}</div>`).join('');
  if (state.status) state.status.floating = value;
}
function paint() {
  $('#quick-tab').classList.toggle('selected',state.tab==='quick'); $('#deep-tab').classList.toggle('selected',state.tab==='deep');
  $('#answer-text').textContent = state[state.tab] || (state.request ? '正在请求模型…' : state.tab==='deep' ? '勾选设置中的「同时生成详细解释」，下一次快答会增加解释栏。' : '点「AI 快答」使用最新转写，或在下方输入问题。\n拖动顶部调整位置，窗口边缘可调整大小。');
  $('#question-label').textContent = state.lastQuestion;
  $('#answer-timing').textContent = state.first[state.tab] != null ? `首字 ${state.first[state.tab]} ms` : '';
  $('#quick-answer').disabled = !!state.request; $('#send-question').disabled = !!state.request;
  $('#pause-transcription').disabled = !state.status?.sessionActive || !!state.status?.transcription?.busy;
  $('#finish-turn').disabled = !state.status?.sessionActive || !!state.status?.transcription?.busy;
  $('#pause-transcription').textContent = state.status?.transcription?.paused ? '继续转写' : '暂停转写';
  $('#session-status').textContent = state.status?.transcription?.paused ? '转写已暂停' : state.request ? '生成中' : state.status?.sessionActive ? '正在听题' : '未采音';
}
let scheduled = false;
function schedulePaint() { if(scheduled) return; scheduled=true; (window.requestAnimationFrame || (fn=>fn()))(()=>{scheduled=false;paint();}); }
function latest() { return [...state.transcripts.values()].filter(t=>t.speaker!=='user' && t.text?.trim()).at(-1)?.text || ''; }
function transcript() { $('#last-transcript').textContent=latest() || '开始面试后，这里显示对方最新的发言。'; }
function restoreGeneration(generation) {
  if(!generation) return;
  state.request=generation.running ? generation.id : null; state.quick=generation.quick || ''; state.deep=generation.deep || '';
  state.lastQuestion=generation.question || ''; state.first=generation.first || {}; $('#dual-answer').checked=!!generation.dual;
  paint(); if(generation.error) notice(generation.error);
}
async function refresh() {
  state.status=await call('status'); applyAppearance(state.status.appearance); renderFloating(state.status.floating);
  state.transcripts=new Map((state.status.transcripts || []).map(t=>[t.segmentId || `${t.speaker}-${t.timestamp}`,t])); transcript(); restoreGeneration(state.status.generation); paint();
  $('#listen').textContent=state.status.sessionActive ? '面试进行中' : '开始面试';
}
async function ask(question) {
  if(state.request) throw new Error('正在生成，可以先点停止。');
  const text=question || $('#question-input').value.trim() || $('#partial-transcript').textContent.replace(/^(我|对方)：/, '').trim() || latest();
  if(!text) throw new Error('还没有题目。输入问题，或开始面试获取转写。');
  const status=await call('status'); state.status=status;
  if(status.generation?.running) { restoreGeneration(status.generation); throw new Error('已有回答正在生成。'); }
  if(!status.model) throw new Error('请在「设置 → API 与语音设置」保存回答模型。');
  state.request='float-'+Date.now()+'-'+Math.random().toString(36).slice(2,8); state.quick='';state.deep='';state.first={};state.lastQuestion=text; paint();
  try { await call('ask',{id:state.request,task:state.images.length ? 'written' : 'interview',question:text,dual:$('#dual-answer').checked,images:state.images.map(i=>i.path)}); }
  catch(error) { state.request=null;paint();throw error; }
  $('#question-input').value='';
}
function images() { $('#attached-images').innerHTML=state.images.map((item,i)=>`<span><img src="${escapeText(item.preview)}" alt="截图附件"><button data-remove="${i}" aria-label="移除截图">×</button></span>`).join(''); $('#attached-images').querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>{state.images.splice(+b.dataset.remove,1);images();}); }
async function captureAndAsk(repeat = false) { if(state.request) throw new Error('请先停止当前生成。'); const captured=await call('capture',{area:true,repeat}); if(captured.cancelled) return; state.images=[captured];images();await ask($('#question-input').value.trim() || '请识别截图中的题目，直接给出答案与必要解释。'); }
async function repeatCapture() { if(state.request) throw new Error('请先停止当前生成。'); const captured=await call('capture',{area:true,repeat:true}); if(captured.cancelled) return; state.images=[captured];images();notice('选区截图已附加，点击快答才发送给模型。'); }
$('#pause-transcription').onclick=action(async()=>{await call('transcription-pause',{paused:!state.status?.transcription?.paused});await refresh();});
$('#finish-turn').onclick=action(async()=>{await call('transcription-finish');await refresh();notice('本段已提交，继续监听。');});
const shortcuts = {
  quick:()=>ask(), retry:()=>{ if(!state.lastQuestion) throw new Error('还没有可重新生成的问题。'); return ask(state.lastQuestion); }, capture:()=>captureAndAsk(), 'capture-repeat':repeatCapture,
  pause:()=>$('#pause-transcription').onclick(), finish:()=>$('#finish-turn').onclick(),
  'scroll-up':()=>$('#answer-scroll').scrollBy({top:-180,behavior:'auto'}), 'scroll-down':()=>$('#answer-scroll').scrollBy({top:180,behavior:'auto'}),
  'quick-tab':()=>{state.tab='quick';paint();}, 'deep-tab':()=>{state.tab='deep';paint();},
};
bridge.onEvent(data=>{
  if(data.kind==='transcription-state') {if(state.status) state.status.transcription=data.value;paint();return;}
  if (data.kind === 'speech-recovered') { notice('语音连接已恢复'); void refresh().catch(() => {}); return; }
  if(data.kind==='speech-error') {notice(data.message);return;}
  if(data.kind==='appearance') { if(state.status) state.status.appearance=data.value;applyAppearance(data.value);return; }
  if(data.kind==='floating-state') {renderFloating(data.value);return;}
  if(data.kind==='shortcut' && shortcuts[data.action]) {void action(shortcuts[data.action])();return;}
  if(data.kind==='transcript') {state.transcripts.set(data.segment.segmentId,data.segment);transcript();$('#partial-transcript').textContent='';return;}
  if(data.kind==='reset') {state.transcripts.clear();transcript();return;}
  if(data.kind==='started') {state.request=data.id;state.quick='';state.deep='';state.first={};state.lastQuestion=data.question;$('#dual-answer').checked=!!data.dual;paint();return;}
  if(data.id && data.id!==state.request) return;
  if(data.kind==='token') {state[data.column]+=data.text;schedulePaint();}
  if(data.kind==='first') {state.first[data.column]=data.ms;schedulePaint();}
  if(data.kind==='error') notice(data.message);
  if(data.kind==='done') {state.request=null;paint();if(!data.ok) notice('已收到的内容保留，可重试或调整配置。');}
});
native.onNativeAudioTranscript?.(data=>{if(!data.final && data.speaker!=='user') $('#partial-transcript').textContent=data.text;});
native.onMeetingStateChanged?.(()=>{void refresh().catch(error=>notice(error.message));});
native.onOverlayMousePassthroughChanged?.(()=>{void refresh().catch(error=>notice(error.message));});
native.onGlobalShortcut?.(data=>{if(data?.action==='reply') void action(async()=>{const s=await call('status');if(s.floating?.mode==='overlay') await ask();})();if(data?.action==='resetCancel') void action(()=>call('cancel',{id:state.request}))();});
native.onScreenshotAttached?.(item=>{state.images=[item];images();notice('截图已附加，点击 AI 快答发送。');});
$('#quick-answer').onclick=action(()=>ask());$('#capture-answer').onclick=action(()=>captureAndAsk());$('#retry-answer').onclick=action(shortcuts.retry);$('#repeat-capture').onclick=action(repeatCapture);
$('#stop-answer').onclick=action(()=>call('cancel',{id:state.request}));
$('#quick-tab').onclick=shortcuts['quick-tab'];$('#deep-tab').onclick=shortcuts['deep-tab'];
$('#show-transcript').onclick=()=>{$('#transcript-panel').hidden=!$('#transcript-panel').hidden;$('#show-transcript').setAttribute('aria-expanded',String(!$('#transcript-panel').hidden));};
$('#use-transcript').onclick=()=>{$('#question-input').value=latest();$('#question-input').focus();};
$('#copy-answer').onclick=action(async()=>{if(!state[state.tab]) throw new Error('还没有回答。');await navigator.clipboard.writeText(state[state.tab]);notice('已复制。');});
$('#question-form').onsubmit=event=>{event.preventDefault();void action(()=>ask())();};
$('#question-input').addEventListener('keydown',event=>{if(!event.isComposing && event.keyCode!==229 && event.key==='Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey){event.preventDefault();void action(()=>ask())();}});
$('#panel-settings').onclick=action(async()=>{if(state.status?.floating?.collapsed) await call('floating',{action:'collapse',enabled:false});$('#settings-panel').hidden=!$('#settings-panel').hidden;});$('#close-settings').onclick=()=>{$('#settings-panel').hidden=true;};
$('#readable-editing').onclick=()=>setEditing(!state.editing);
$('#close-overlay').onclick=action(()=>call('floating',{action:'hide'}));$('#open-main').onclick=action(()=>call('floating',{action:'main'}));
$('#open-app-settings').onclick=action(()=>call('floating',{action:'settings'}));
$('#listen').onclick=action(()=>call('floating',{action:'prepare-session'}));
$('#collapse').onclick=action(()=>call('floating',{action:'collapse',enabled:!state.status?.floating?.collapsed}));
$('#click-through').onclick=action(async()=>{await call('floating',{action:'passthrough',enabled:!state.status?.floating?.passthrough});$('#settings-panel').hidden=true;});
function readAppearance() {return {...state.status?.appearance,overlayOpacity:Number($('#background-opacity').value)/100,overlayTextOpacity:Number($('#text-opacity').value)/100,overlayFontSize:Number($('#font-size').value)};}
async function saveAppearance(value=readAppearance()) {await call('appearance',value);if(state.status) state.status.appearance=value;applyAppearance(value);}
for(const id of ['background-opacity','text-opacity','font-size']) {$('#'+id).oninput=()=>applyAppearance(readAppearance());$('#'+id).onchange=action(()=>saveAppearance());}
$('#ghost-preset').onclick=action(()=>{setEditing(false);return saveAppearance({...state.status.appearance,overlayOpacity:0,overlayTextOpacity:0.35});});
$('#clear-preset').onclick=action(()=>saveAppearance({...state.status.appearance,overlayOpacity:0.92,overlayTextOpacity:1}));
window.addEventListener('keydown',event=>{if(event.key==='Escape') $('#settings-panel').hidden=true;});
window.addEventListener('unhandledrejection',event=>{notice(event.reason?.message || '操作失败');event.preventDefault();});
refresh().catch(error=>notice('悬浮窗未就绪：'+error.message));
})();
