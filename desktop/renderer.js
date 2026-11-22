(() => {
'use strict';
const $ = s => document.querySelector(s);
const native = window.electronAPI;
const studio = window.studio;
const state = { view: 'interview', request: null, images: [], transcripts: new Map(), quick: '', deep: '', status: null, pairUrl: '', devices: { inputs: [], outputs: [] } };
const taskDrafts = new Map();
state.task = 'interview';
const escapeText = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const message = text => { $('#notice').textContent = String(text || ''); };
const action = fn => async () => { try { message(''); await fn(); } catch (error) { message(error.message || error); } };
let paintPending = false;
const paintAnswers = () => { $('#quick').textContent = state.quick; $('#deep').textContent = state.deep; };
function scheduleAnswerPaint() {
  if (paintPending) return;
  paintPending = true;
  (window.requestAnimationFrame || (callback => callback()))(() => { paintPending = false; paintAnswers(); });
}
async function call(name, data) { const result = await studio.invoke(name, data); if (result?.success === false) throw new Error(result.error); return result; }
function checked(result) { if (result?.success === false) throw new Error(result.error || '操作失败'); return result; }
function openSection(section) { return call('settings', { section }); }
function applyAppearance(value = {}) {
  if (document.documentElement?.dataset) document.documentElement.dataset.theme = value.theme || 'light';
}
function captureLabel(s) {
  if (s.sessionActive && s.transcription?.paused) return '转写已暂停 · 点击继续后重新听题';
  if (!s.sessionActive) return s.systemAudioBlocker ? '当前未采音 · 系统权限待开启' : '当前未采音';
  if (s.audio?.lastError) return '采音或语音连接异常';
  if (s.audio?.lastThemTranscriptAt) return '正在采音 · 已收到转写';
  return s.audio?.lastSystemAudioChunkAt ? '已收到系统声音 · 等待出字' : '面试进行中 · 等待系统声音';
}
function paintCapture(s) {
  const status = $('#status');
  const mic = $('#source-dialog').open && $('#session-mic').checked;
  const blocker = s.systemAudioBlocker || (mic && ['denied','restricted'].includes(s.permissions?.microphone) ? {
    permission: 'microphone', message: '麦克风权限未开启。请授权，或取消勾选麦克风后继续。',
  } : null);
  status.textContent = `${captureLabel(s)}  ·  ${s.model ? '回答：' + s.model.model : '回答待配置'}  ·  ${s.speech?.configured ? '语音配置已保存' : '语音待配置'}`;
  status.textContent += `  ·  转写来源：系统声音（对方）${s.sessionActive ? s.captureMicrophoneActive ? ' + 我的麦克风' : ' · 我的麦克风关闭' : s.captureSettings?.captureMicrophone ? ' · 下次额外记录麦克风' : ' · 我的麦克风默认关闭'}`;
  if (status.dataset) status.dataset.active = String(s.sessionActive);
  $('#capture-permission').hidden = !s.systemAudioBlocker;
  $('#source-check').textContent = blocker?.message || (!mic ? '只听会议播放的对方声音。本应用不打开麦克风，你仍可在会议软件中正常讲话。' : s.permissions?.microphone === 'granted' ? '本次采集系统声音和麦克风。' : '首次使用麦克风时，系统会请求授权。');
  $('#source-permission').hidden = !blocker || s.platform !== 'darwin';
  $('#source-permission').onclick = action(() => call('capture-permission', blocker.permission));
  $('#source-start').disabled = !!blocker || !!state.startingCapture;
}
async function refresh(restore = false) {
  state.status = await call('status');
  const s = state.status;
  applyAppearance(s.appearance);
  $('#app-version').textContent = s.appVersion ? 'Interview Studio · v' + s.appVersion : 'Interview Studio';
  document.body?.classList?.add('platform-' + s.platform);
  const prep = s.preparation || {};
  $('#preparation-summary').textContent = [prep.company, prep.role, prep.language === 'English' ? '英文回答' : '中文回答'].filter(Boolean).join(' · ');
  paintCapture(s);
  $('#pause-transcription').disabled = !s.sessionActive || !!s.transcription?.busy;
  $('#pause-transcription').textContent = s.transcription?.paused ? '继续转写' : '暂停转写';
  $('#finish-turn').disabled = !s.sessionActive || !!s.transcription?.busy;
  $('#transcription-mode').value = s.transcription?.mode === 'manual' ? 'manual' : String(s.transcription?.silenceMs || 30000);
  $('#transcription-hint').textContent = s.transcription?.mode === 'manual' ? '点击「本段说完」提交发言；采音保持运行。' : '停顿只影响分段，采音持续到你手动结束。';
  $('#start').disabled = s.sessionActive;
  $('#stop').disabled = !s.sessionActive;
  $('#stop').hidden = !s.sessionActive;
  $('#credential-status').textContent = s.credentialStorage?.error || (s.credentialStorage?.mode === 'local' ? 'API 配置保存在本机，下次打开自动使用。' : s.credentialStorage?.mode === 'encrypted' ? 'API Key：系统加密保存已启用' : 'API Key：仅本次使用，退出后不保存。');
  if (restore) {
    state.transcripts = new Map((s.transcripts || []).map(t => [t.segmentId || `${t.speaker}-${t.timestamp}`, t]));
    renderTurns();
    const generation = s.generation;
    if (generation && (!generation.task || generation.task === state.task)) {
      state.request = generation.running ? generation.id : null;
      renderSources(generation.sources);
      state.quick = generation.quick; state.deep = generation.deep; state.lastQuestion = generation.question;
      $('#quick').textContent = generation.quick;
      $('#deep').textContent = generation.deep;
      $('#question-title').textContent = generation.question;
      $('#ask').disabled = generation.running;
      $('#dual').checked = generation.dual; $('#dual').onchange();
      for (const column of ['quick','deep']) if (generation.first[column] != null) $('#' + column + '-time').textContent = `首字 ${generation.first[column]} ms`;
      if (generation.error) message(generation.error);
    }
  }
  if (!restore && !state.transcripts.size) renderTurns();
  if (restore && s.needsConfiguration) { await selectView('connect'); message(s.speech.reason); }
}
async function testConnection(button, output, run, pending, success) {
  button.disabled = true;
  output.textContent = pending;
  try { await run(); output.textContent = success; }
  catch (error) { output.textContent = error.message || '连接测试失败。'; }
  finally { button.disabled = false; }
}
function renderTurns() {
  const rows = [...state.transcripts.values()];
  const container = $('#transcripts');
  const follow = container.scrollHeight - container.scrollTop - container.clientHeight < 45;
  const s = state.status;
  const empty = !s?.speech?.configured ? '请先在设置中保存语音配置。' : s.systemAudioBlocker ? '授权系统录音后，就可以开始转写。' : s.sessionActive ? '等待语音，识别结果会显示在这里。' : '点击「开始面试」获取实时转写。';
  container.innerHTML = rows.length ? rows.map((t, i) => `<div class="turn"><b>${t.speaker === 'user' ? '我' : '对方'} · ${new Date(t.timestamp || Date.now()).toLocaleTimeString()}</b><p>${escapeText(t.text)}</p>${t.translatedText ? `<p><small>翻译：${escapeText(t.translatedText)}</small></p>` : ''}${t.originalText !== t.text ? `<small>原始：${escapeText(t.originalText)}</small>` : ''}<div><button data-ask-line="${i}">用这句提问</button> <button data-edit-line="${i}">编辑后提问</button></div></div>`).join('') : `<p class="empty">${empty}</p>`;
  container.querySelectorAll('[data-ask-line]').forEach(b => b.onclick = () => { $('#question').value = rows[+b.dataset.askLine].text; $('#question').focus(); });
  container.querySelectorAll('[data-edit-line]').forEach(b => b.onclick = () => { $('#question').value = rows[+b.dataset.editLine].text; $('#question').focus(); message('可以在输入框纠正文字后提问；原始转写仍保留。'); });
  if (follow) container.scrollTop = container.scrollHeight;
}
async function ask(questionOverride, taskOverride) {
  if (state.request) { message('当前正在生成，可以先停止。'); return; }
  const recent = [...state.transcripts.values()].filter(t => t.speaker !== 'user' && t.text?.trim()).at(-1)?.text || '';
  const question = typeof questionOverride === 'string' ? questionOverride : $('#question').value.trim() || (state.view === 'written' ? state.images.length ? '请识别并分析附图中的练习题，给出答案、推理和检查方法。' : '' : state.themPartial || recent);
  if (state.view === 'written' && $('#written-input-mode').value === 'text' && !$('#question').value.trim()) throw new Error('纯文字模式需要题目文字，请先识别或输入题目');
  if (!question) throw new Error('请先输入问题或点选一条转写');
  if (!state.status) await refresh();
  if (!state.status.model) { await selectView('connect'); throw new Error('先在「服务配置」选择回答服务和模型；文字提问不需要先开采音。'); }
  const id = 'studio-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  state.lastQuestion = question;
  if (state.view === 'written' && state.images.length && !state.ocrPaths?.length) message('图片将发送给所选模型。若模型不支持图片，请先点击本机识别。');
  state.request = id; state.quick = ''; state.deep = ''; state.lastError = '';
  renderSources(null);
  $('#quick').textContent = '正在请求模型…'; $('#deep').textContent = $('#dual').checked ? '正在请求模型…' : '';
  $('#quick-time').textContent = ''; $('#deep-time').textContent = '';
  $('#question-title').textContent = question.slice(0, 70); $('#ask').disabled = true;
  state.extracting = taskOverride === 'ocr';
  try { await call('ask', { id, task: taskOverride || (['interview','written','resume','review'].includes(state.view) ? state.view : 'interview'), question, dual: state.extracting ? false : $('#dual').checked, programmingLanguage: state.view === 'written' ? $('#written-language').value : undefined, images: state.view === 'written' && $('#written-input-mode').value === 'text' ? [] : state.images.map(i => i.path) }); }
  catch (error) { state.request = null; $('#ask').disabled = false; $('#quick').textContent = ''; $('#deep').textContent = ''; throw error; }
}
function renderImages() {
  $('#attachments').innerHTML = state.images.map((image, i) => `<figure><img src="${escapeText(image.preview)}" alt="截图附件"><figcaption><button data-remove-image="${i}">移除截图 ${i + 1}</button></figcaption></figure>`).join('');
  document.querySelectorAll('[data-remove-image]').forEach(b => b.onclick = () => { state.images.splice(+b.dataset.removeImage, 1); renderImages(); });
}
async function capture(area, repeat = false) {
  if (state.images.length >= 4) throw new Error('一次最多附加 4 张截图');
  const result = await call('capture', { area, repeat });
  if (!result.cancelled) { state.images.push(result); renderImages(); message('截图已附加，生成回答时才发送给模型。需要支持图片的模型。'); }
}
async function selectView(view) {
  const tasksWithDrafts = ['interview','written','resume','review'];
  if (tasksWithDrafts.includes(view) && state.task !== view) {
    if (state.request) throw new Error('请先停止或等待当前回答完成，再切换任务');
    taskDrafts.set(state.task, { question: $('#question').value, images: [...state.images], quick: state.quick, deep: state.deep, lastQuestion: state.lastQuestion, sources: state.sources, dual: $('#dual').checked, inputMode: $('#written-input-mode').value, code: $('#written-language').value });
    const draft = taskDrafts.get(view) || { question: '', images: [], quick: '', deep: '', lastQuestion: '', dual: false, inputMode: 'images', code: 'auto' };
    Object.assign(state, { images: [...draft.images], quick: draft.quick, deep: draft.deep, lastQuestion: draft.lastQuestion, task: view });
    $('#question').value = draft.question; $('#dual').checked = draft.dual; $('#dual').onchange();
    $('#written-input-mode').value = draft.inputMode; $('#written-language').value = draft.code;
    paintAnswers(); renderImages(); renderSources(draft.sources); $('#question-title').textContent = draft.lastQuestion || '回答';
    $('#quick-time').textContent = ''; $('#deep-time').textContent = '';
  }
  state.view = view; message('');
  document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === view || b.dataset.view === 'connect' && ['setup','performance','privacy','diagnostics'].includes(view)));
  $('#settings-back').hidden = !['setup','performance','privacy','diagnostics'].includes(view);
  $('#capture-ask').hidden = view !== 'written';
  $('#written-controls').hidden = view !== 'written';
  $('#transcription-controls').hidden = view === 'written';
  $('#work').classList.toggle('written-workspace', view === 'written');
  $('#ask').textContent = view === 'written' ? '分析解题 Ctrl ↵' : 'AI 快答 Ctrl ↵';
  $('#start').textContent = view === 'written' ? '听题（可选）' : '开始听对方';
  if (view === 'written' && !$('#written-language').value) $('#written-language').value = 'auto';
  const tasks = { interview:['面试助手','实时转写、资料增强、流式回答，在一个 App 中完成。'], written:['笔试助手','无需开始采音。输入或识别练习题，校对后选择文字或图文分析。'], resume:['简历优化','先导入简历或填写真实经历，再输入目标岗位与修改要求。'], review:['记录与复盘','根据真实问答整理改进方向与后续练习。'] };
  const isTask = !!tasks[view]; $('#work').hidden = !isTask; $('#other').hidden = isTask;
  if (isTask) { $('#task-title').textContent = tasks[view][0]; $('#task-description').textContent = tasks[view][1]; $('#question').placeholder = view === 'resume' ? '例如：根据已导入的简历，优化 BSP 驱动工程师岗位的项目经历，不添加虚构内容。' : view === 'written' ? '输入练习题，或导入图片后先识别。可核对题干，再点击分析解题。' : '输入问题，或点选左边的转写…'; return; }
  if (view === 'preparation') await renderPreparation();
  if (view === 'materials') await renderMaterials();
  if (view === 'records') await renderRecords();
  if (view === 'setup') await renderSetup();
  if (view === 'connect') await renderConnections();
  if (view === 'diagnostics') await renderDiagnostics();
  if (view === 'pair') await renderPair();
  if (view === 'performance') await renderPerformance();
  if (view === 'privacy') await renderPrivacy();
}

async function renderPreparation() {
  await refresh(); const p = state.status.preparation || {};
  const documents = state.status.documents || [];
  $('#other').innerHTML = `<h1>面试准备</h1><p>保存一次，下次继续使用。生成回答时，这些背景会发送给你配置的模型。</p><div class="box"><div class="data-grid"><label>目标公司（可选）<input id="prep-company" maxlength="100" value="${escapeText(p.company)}"></label><label>目标岗位（可选）<input id="prep-role" maxlength="150" value="${escapeText(p.role)}"></label></div><label>本次使用的简历<select id="prep-resume"><option value="">暂不指定简历</option>${documents.map(d => `<option value="${escapeText(d.id)}">${escapeText(d.name)}</option>`).join('')}</select></label><p>4,000 字符以内的指定简历会完整加入背景；更长的简历选取相关片段。其他资料继续按相关性使用。</p><button id="prep-materials">导入或管理简历</button><label>岗位描述 JD（可选）<textarea id="prep-jd" maxlength="12000">${escapeText(p.jobDescription)}</textarea></label><details><summary>回答偏好</summary><label>回答语言<select id="prep-language"><option value="Chinese">中文</option><option value="English">English</option></select></label><label>表达方式<select id="prep-style"><option value="natural">自然口语</option><option value="structured">条理分明</option></select></label><label>编程题语言<select id="prep-programming">${['auto','C','C++','Python','Java','JavaScript','TypeScript','Go','Rust','C#','SQL'].map(v => `<option value="${v}">${v === 'auto' ? '按题目要求' : v}</option>`).join('')}</select></label></details><div class="row"><button id="save-preparation" class="primary">保存并返回面试</button></div></div>`;
  $('#prep-resume').value = p.resumeDocumentId || ''; $('#prep-language').value = p.language || 'Chinese'; $('#prep-style').value = p.style || 'natural'; $('#prep-programming').value = p.programmingLanguage || 'auto';
  $('#prep-materials').onclick = action(() => selectView('materials'));
  $('#save-preparation').onclick = action(async () => { await call('preparation', { company: $('#prep-company').value, role: $('#prep-role').value, jobDescription: $('#prep-jd').value, resumeDocumentId: $('#prep-resume').value, language: $('#prep-language').value, style: $('#prep-style').value, programmingLanguage: $('#prep-programming').value }); await refresh(); await selectView('interview'); message('面试准备已保存在本机。'); });
}
async function showDocument(source) {
  const doc = await call('document-text', { id: source.id, ...(source.hash ? { hash: source.hash } : {}) });
  $('#document-title').textContent = doc.name;
  $('#document-range').textContent = source.start ? `本次使用的文本区间 ${source.start}–${source.end}` : '资料全文';
  $('#document-content').textContent = source.start ? doc.text.slice(source.start - 1, source.end) : doc.text;
  $('#document-dialog').showModal();
}
function renderSources(sources) {
  state.sources = sources || { quick: [], deep: [] };
  const rows = [...(state.sources.quick || []).map(s => ({ ...s, column: '快答' })), ...(state.sources.deep || []).map(s => ({ ...s, column: '解释' }))];
  $('#answer-sources').hidden = !rows.length;
  $('#source-items').innerHTML = rows.map((s,i) => `<button data-source="${i}">${s.column} · ${escapeText(s.name)} · ${s.complete ? '全文' : `${s.start}–${s.end}`}</button>`).join('');
  $('#source-items').querySelectorAll('[data-source]').forEach(b => b.onclick = action(() => showDocument(rows[+b.dataset.source])));
}

async function renderPerformance() {
  await refresh();
  $('#other').innerHTML = `<h1>回复速度</h1><div class="box"><h2>回答模式</h2><label>模式<select id="speed-mode"><option value="fast">极速快答</option><option value="balanced">更多资料背景</option></select></label><p>极速模式：在本机选取相关资料，缩短对话背景，直接流式请求兼容服务；官方 DeepSeek 快答关闭思考模式。其他模型使用其支持的参数。更多资料模式会附加更多背景，可能增加首字等待。</p><button id="save-speed" class="primary">保存回答模式</button></div><div class="box"><h2>先看到要点，再决定是否展开</h2><p>默认生成一栏快答。需要深答时勾选工作台的双栏模式，会发起两次模型请求。快答与深答独立返回，某一栏失败不会丢弃已完成的一栏。</p><p>这不是速度承诺：网络、服务商排队和模型仍会影响首字时间。诊断页显示真实的资料准备、响应头、首字和完成时间。未使用真实 Key 测速前，不显示虚构的提升比例。</p><button id="speed-diagnostics">查看链路计时</button></div>`;
  $('#speed-mode').value = state.status.performance?.mode || 'fast';
  $('#save-speed').onclick = action(async () => { await call('performance', { mode: $('#speed-mode').value }); await refresh(); message('回答模式已保存，下次提问生效。'); });
  $('#speed-diagnostics').onclick = action(() => selectView('diagnostics'));
}

async function renderPrivacy() {
  await refresh();
  const p = state.status.privacy;
  const test = p?.selfTest;
  const current = test && test.appVersion === state.status.appVersion && test.platform === state.status.platform;
  $('#other').innerHTML = `<h1>窗口与共享保护</h1><div class="box"><h2>应用窗口保护</h2><label><input id="privacy-enabled" type="checkbox" ${p?.enabled ? 'checked' : ''}> 请求系统从屏幕采集中排除本应用窗口</label><p>${escapeText(p?.warning || '请在实际会议软件中测试。')}</p><p>系统保护标志：${p?.windows?.filter(w => w.protected).length || 0} / ${p?.windows?.length || 0} 个窗口已设置。该数字不等于共享画面验证结果。</p><div class="row"><button id="save-privacy" class="primary">应用保护设置</button><button id="hide-now">隐藏应用窗口</button></div><p>隐藏 / 恢复快捷键：${escapeText(p?.shortcut || '')} · ${p?.shortcutRegistered ? '注册成功' : '未注册成功，请在高级快捷键设置中检查冲突'}。快捷键仅控制本应用，不修改会议程序。</p>${p?.error ? `<p>${escapeText(p.error)}</p>` : ''}</div><div class="box"><h2>实际会议共享自测记录</h2><p>请用另一台设备查看飞书或腾讯会议实际收到的共享画面，并分别检查整屏与窗口共享。这里记录你确认的结果；程序不会自动判定“隐身成功”。更新系统、会议客户端或 App 后应重新检查。</p><label>会议客户端<select id="test-client"><option value="feishu">飞书</option><option value="tencent">腾讯会议</option><option value="other">其他</option></select></label><label>客户端版本<input id="test-version" autocomplete="off" placeholder="填写本次实际测试的版本"></label><label>共享方式<select id="test-capture"><option value="screen">整屏共享</option><option value="window">指定窗口共享</option></select></label><label>实际结果<select id="test-result"><option value="">请选择你实际确认的结果</option><option value="passed">接收端未看到应用窗口</option><option value="failed">接收端仍看到应用窗口</option></select></label><button id="record-test">保存自测记录</button><p>${test ? (current ? '本版本有一条用户自测记录：' : '旧版本自测记录，不代表当前状态：') + escapeText(`${test.client} / ${test.version} / ${test.capture} / ${test.result} / ${test.at}`) : '尚无自测记录，不能认为已验证屏幕共享保护。'}</p></div>`;
  $('#save-privacy').onclick = action(async () => { await call('privacy', { enabled: $('#privacy-enabled').checked }); await renderPrivacy(); message('已应用系统窗口保护请求，请以会议接收端画面为准。'); });
  $('#hide-now').onclick = action(() => call('hide'));
  $('#record-test').onclick = action(async () => { await call('privacy-test', { client: $('#test-client').value, version: $('#test-version').value.trim(), capture: $('#test-capture').value, result: $('#test-result').value }); await renderPrivacy(); message('已保存用户自测记录。'); });
}
async function renderConnections() {
  await refresh();
  const [connections, use, credentials] = await Promise.all([native.aiConnectionsList(), native.chatModelGet(), native.getStoredCredentials()]);
  const compatible = connections.filter(c => c.type === 'openai');
  const selected = compatible.find(c => c.id === use.connectionId);
  $('#other').innerHTML = `<div class="settings-head"><div><h1>面试设置</h1><p>在这里保存和测试两个服务，开始面试前再确认采音权限。</p></div></div>
<div class="setup-grid"><div class="box"><h2>回答模型</h2><p>${state.status.model ? escapeText(state.status.model.model) + " · 配置已保存" : "填写回答服务的 API Key。"}</p><label>服务<select id="answer-preset"><option value="deepseek">DeepSeek</option><option value="openai">OpenAI</option><option value="custom">自定义兼容接口</option></select></label><input id="connection-name" type="hidden" value="DeepSeek"><label>API Key<input id="connection-key" type="password" autocomplete="off" placeholder="填写一次，保存在此电脑"></label><details id="api-advanced"><summary>地址与模型 · 已预填，可按服务商修改</summary><label>API 地址<input id="connection-url" value="https://api.deepseek.com" spellcheck="false" autocomplete="off"></label><label>模型名称<input id="connection-model" value="deepseek-flash" spellcheck="false" autocomplete="off"></label></details><details><summary>管理其他连接</summary><label>已有连接<select id="connection-id"><option value="">新建连接</option>${compatible.map(c => `<option value="${escapeText(c.id)}">${escapeText(c.name)}</option>`).join('')}</select></label><button id="advanced-models">其他模型协议</button></details><div class="row"><button id="save-connection" class="primary">保存回答配置</button><button id="test-connection">测试回答</button></div><p id="answer-test-result" class="connection-result" role="status">测试会发送一条示例请求。</p></div>
<div class="box"><h2>语音转写</h2><p>选择服务，填入对应的语音 API Key。</p><label>语音服务<select id="speech-provider"><option value="doubao">豆包语音 · 实时转写</option><option value="soniox">Soniox · 实时转写</option><option value="deepgram">Deepgram · 流式备选</option><option value="groq">Groq Whisper · 低标价，分段返回</option><option value="openai">OpenAI 语音转写</option><option value="google">Google Cloud · 高级配置</option>${!['doubao','soniox','deepgram','groq','openai','google'].includes(credentials.sttProvider) && state.status.speech?.configured ? `<option value="${escapeText(credentials.sttProvider)}">已保存的 ${escapeText(credentials.sttProvider)} · 高级配置</option>` : ''}</select></label><div id="speech-guidance" class="provider-note" role="status"></div><label>语音 API Key<input id="speech-key" type="password" autocomplete="off" placeholder="填写此语音服务的 Key"></label><details><summary>识别参数 · 已预填</summary><label>识别模型<input id="speech-model" spellcheck="false" autocomplete="off"></label><label>识别语言<select id="speech-language"><option value="chinese">中文</option><option value="auto">自动识别 / 多语言</option><option value="english-us">English (US)</option></select></label><button id="advanced-speech">其他语音服务 / Google 文件</button></details><div class="row"><button id="save-speech-provider" class="primary">保存语音配置</button><button id="test-speech" hidden>测试豆包连接</button></div><p id="speech-test-result" class="connection-result" role="status"></p></div></div>
<div class="capture-settings-row"><div><h2>采音与权限</h2><p>${escapeText(state.status.systemAudioBlocker?.message || "默认采集电脑播放的声音，麦克风可在开始面试时选择。")}</p></div><div class="row"><button id="capture-settings">音频设备</button><button id="check-capture" class="primary">检查并开始</button></div></div>
<div class="box"><h2>外观与悬浮窗</h2><div class="appearance-grid"><div><label>界面配色<select id="appearance-theme"><option value="light">暖白 · 默认</option><option value="dark">炭灰 · 深色</option></select></label><p>主界面和悬浮窗同步配色，自动保存在本机。</p><div class="row"><button id="preview-overlay">打开悬浮窗</button><button id="main-ghost-preset">纯透明淡字</button></div></div><div><label class="range-head" for="overlay-opacity">悬浮窗背景不透明度 <output id="opacity-value" for="overlay-opacity">88%</output></label><input id="overlay-opacity" type="range" min="0" max="100" step="1" aria-label="悬浮窗背景不透明度"><p>背景 0% 去掉底色，整体不透明度统一控制文字和操作栏。鼠标经过或输入时保持不变，松开滑块自动保存。</p><label class="range-head" for="overlay-text-opacity">整体不透明度 <output id="text-opacity-value" for="overlay-text-opacity">100%</output></label><input id="overlay-text-opacity" type="range" min="15" max="100" step="1" aria-label="悬浮窗整体不透明度"><label>文字大小<select id="overlay-font-size"><option value="12">12 px</option><option value="13">13 px</option><option value="14">14 px</option><option value="15">15 px</option><option value="16">16 px</option><option value="17">17 px</option><option value="18">18 px</option><option value="19">19 px</option><option value="20">20 px</option><option value="21">21 px</option><option value="22">22 px</option><option value="23">23 px</option><option value="24">24 px</option></select></label><div class="opacity-sample"><span id="opacity-preview">预览 · 文字与操作栏统一淡化</span></div></div></div></div>
<details class="box"><summary>高级设置</summary><p>日常使用可以保持默认；需要时再调整。</p><div class="settings-links"><button data-settings-view="setup">音频设备与术语</button><button data-settings-view="performance">回复速度</button><button data-settings-view="privacy">窗口与共享保护</button><button data-settings-view="diagnostics">连接与错误诊断</button></div></details><details class="box"><summary>本机配置与清除</summary><p>API 地址、模型和 Key 保存在本机用户目录的加密文件中。加密密钥也在该目录，同一系统账户下的程序可以读取；不等同于系统钥匙串保护。</p><button id="clear-credentials">清除此电脑保存的 API 配置</button><button id="legacy-credentials">导入旧系统加密凭证</button></details>`;
  document.querySelectorAll('[data-settings-view]').forEach(button => button.onclick = action(() => selectView(button.dataset.settingsView)));
  $('#clear-credentials').onclick = action(async () => { if (!window.confirm('清除本机保存的模型与语音 API 配置？下次使用需重新填写。简历和记录会保留。')) return; await call('credentials-clear'); await renderConnections(); message('本机 API 配置已清除。'); });
  $('#legacy-credentials').onclick = action(async () => { await call('credentials-enable'); await renderConnections(); message('旧凭证已导入本机配置。'); });
  $('#connection-id').value = selected?.id || '';
  function fillConnection() {
    const current = compatible.find(c => c.id === $('#connection-id').value);
    $('#connection-name').value = current?.name || 'DeepSeek';
    $('#connection-url').value = current?.baseUrl || 'https://api.deepseek.com';
    $('#connection-key').value = '';
    $('#connection-key').placeholder = current?.hasApiKey ? '已填写，留空沿用；不回显 Key' : '填写对应服务的 API Key';
    $('#connection-model').value = current?.id === use.connectionId ? use.model : current ? '' : 'deepseek-flash';
    $('#answer-preset').value = current?.baseUrl?.includes('api.openai.com') ? 'openai' : !current || current.baseUrl?.includes('api.deepseek.com') ? 'deepseek' : 'custom';
  }
  fillConnection(); $('#connection-id').onchange = fillConnection;
  $('#answer-preset').onchange = () => { const preset = $('#answer-preset').value; $('#connection-id').value = ''; $('#connection-key').value = ''; $('#connection-name').value = preset === 'openai' ? 'OpenAI' : preset === 'deepseek' ? 'DeepSeek' : '自定义接口'; $('#connection-url').value = preset === 'openai' ? 'https://api.openai.com/v1' : preset === 'deepseek' ? 'https://api.deepseek.com' : ''; $('#connection-model').value = preset === 'deepseek' ? 'deepseek-flash' : ''; };
  $('#save-connection').onclick = action(async () => {
    const id = $('#connection-id').value;
    let baseUrl = $('#connection-url').value.trim().replace(/\/+$/, '').replace(/\/chat\/completions$/i, '');
    const name = $('#connection-name').value.trim(), model = $('#connection-model').value.trim(), apiKey = $('#connection-key').value.trim();
    if (!name || !model) throw new Error('请填写连接名称和模型名称');
    let endpoint; try { endpoint = new URL(baseUrl); } catch { throw new Error('API 地址格式不正确'); }
    if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash || (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname)))) throw new Error('请使用 HTTPS API 地址；本机模型可使用 localhost 的 HTTP 地址。');
    if (endpoint.pathname === '/') baseUrl = endpoint.origin + '/v1';
    const current = compatible.find(c => c.id === id);
    if (!apiKey && !current?.hasApiKey && !['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname)) throw new Error('请填写此服务的 API Key');
    const result = checked(await native.aiConnectionSave({ ...(id ? { id } : {}), name, type: 'openai', baseUrl, ...(apiKey ? { apiKey } : {}) }));
    $('#connection-key').value = '';
    checked(await native.chatModelSet({ connectionId: result.id, model }));
    await renderConnections(); message('API 配置已保存在本机，下次打开自动使用。尚未测试连接。');
  });
  $('#test-connection').onclick = () => testConnection($('#test-connection'), $('#answer-test-result'), async () => {
    const current = await native.chatModelGet();
    if (!current.connectionId || !current.model) throw new Error('请先保存回答配置。');
    checked(await native.modelTest({ job: 'chat', ...current }));
  }, '正在发送一条测试请求…', '回答模型连接通过。');
  $('#test-speech').onclick = () => testConnection($('#test-speech'), $('#speech-test-result'),
    () => call('speech-test'), '正在检查豆包连接和授权…', '豆包服务连接与授权通过。');
  $('#api-advanced').open = $('#answer-preset').value !== 'deepseek';
  const presetChanged = $('#answer-preset').onchange;
  $('#answer-preset').onchange = () => { presetChanged(); $('#api-advanced').open = true; };
  $('#speech-provider').value = ['doubao','soniox','deepgram','groq','openai'].includes(credentials.sttProvider) || state.status.speech?.configured ? credentials.sttProvider : 'soniox';
  const keyFlags = { soniox: 'hasSonioxKey', deepgram: 'hasDeepgramKey', groq: 'hasSttGroqKey', openai: 'hasSttOpenaiKey' };
  const hasSpeechKey = provider => provider === 'doubao' ? state.status.speech?.doubaoKeySaved : credentials[keyFlags[provider]];
  const speechPresets = {
    doubao: { model: '流式语音识别 2.0 小时版', note: '使用已开通流式语音识别 2.0 的「豆包语音」项目 API Key。实时识别中文和英语。' },
    soniox: { model: 'stt-rt-v6', note: '<strong>中文实时听题，优先试这个。</strong><br>官方参考约 $0.12/小时，按 token 计费；适合中英混合。需要 Soniox 自己的 Key。准确性仍需用你的录音确认。' },
    deepgram: { model: 'nova-3', note: '<strong>实时流式备选。</strong><br>Nova-3 支持中文，单语参考约 $0.46/小时，多语约 $0.55/小时。需要 Deepgram Key。' },
    groq: { model: 'whisper-large-v3-turbo', note: '<strong>低标价，适合能接受分段等待的场景。</strong><br>标价 $0.04/音频小时，但每次请求至少计费 10 秒。当前接法等语音断句或缓冲后上传，短句频繁请求的费用会高于标价。' },
    openai: { model: '', note: '<strong>沿用你的 OpenAI 语音服务。</strong><br>请使用 OpenAI 的 Key；回答模型的其他服务 Key 不能通用。模型和计费需与账号开通的语音接口一致。' },
    google: { model: '', note: '<strong>Google Cloud 需要服务账户文件。</strong><br>展开识别参数，打开高级配置完成文件与项目设置。第一次使用更建议选择只填 Key 的服务。' },
  };
  function fillSpeech() {
    const provider = $('#speech-provider').value, preset = speechPresets[provider];
    $('#speech-key').value = '';
    $('#speech-key').placeholder = hasSpeechKey(provider) ? '已保存，留空沿用' : '填写此语音服务的 API Key';
    $('#speech-model').value = (provider === 'groq' ? credentials.groqSttModel : credentials.sttModels?.[provider]) || preset?.model || '';
    $('#speech-model').disabled = $('#speech-language').disabled = provider === 'doubao';
    $('#test-speech').hidden = provider !== 'doubao';
    $('#test-speech').disabled = state.status.sessionActive || credentials.sttProvider !== 'doubao' || !hasSpeechKey(provider);
    $('#speech-test-result').textContent = provider !== 'doubao' ? '' : $('#test-speech').disabled ? '保存豆包语音配置后可测试。' : '测试授权，无需采音。';
    $('#speech-guidance').innerHTML = preset?.note || '这是高级语音服务，请打开高级配置管理。';
  }
  fillSpeech(); $('#speech-provider').onchange = fillSpeech;
  $('#speech-language').value = state.status.speech?.language || 'chinese';
  $('#save-speech-provider').onclick = action(async () => {
    if (state.status.sessionActive) throw new Error('请先结束采音，再更换语音服务');
    const provider = $('#speech-provider').value, apiKey = $('#speech-key').value.trim(), model = $('#speech-model').value.trim(), language = $('#speech-language').value;
    if (provider === 'doubao') {
      await call('doubao-config', { apiKey });
      $('#speech-key').value = '';
      await renderConnections(); message('豆包语音已配置，开始采音后建立转写连接。');
      return;
    }
    const setters = { soniox: native.setSonioxApiKey, deepgram: native.setDeepgramApiKey, groq: native.setGroqSttApiKey, openai: native.setOpenAiSttApiKey };
    if (!setters[provider]) throw new Error('请选择语音服务；Google Cloud 文件和其他服务请打开高级配置。');
    if (!apiKey && !hasSpeechKey(provider)) throw new Error('请填写所选语音服务的 API Key');
    if (apiKey) checked(await setters[provider](apiKey));
    $('#speech-key').value = '';
    checked(await native.setSttProvider(provider));
    checked(await native.setSttModel(provider, model));
    checked(await native.setRecognitionLanguage(language, 'them'));
    checked(await native.setRecognitionLanguage(language, 'user'));
    await renderConnections(); message('语音配置已保存在本机，下次打开自动使用。尚未开始采音。');
  });
  $('#check-capture').onclick = () => $('#start').onclick();
  $('#advanced-models').onclick = action(() => openSection('models')); $('#advanced-speech').onclick = action(() => openSection('providers')); $('#capture-settings').onclick = action(() => selectView('setup'));
  $('#appearance-theme').value = state.status.appearance?.theme || 'light';
  $('#overlay-opacity').value = String(Math.round((state.status.appearance?.overlayOpacity ?? 0.88) * 100));
  $('#overlay-text-opacity').value = String(Math.round((state.status.appearance?.overlayTextOpacity ?? 1) * 100));
  $('#overlay-font-size').value = String(state.status.appearance?.overlayFontSize ?? 15);
  const previewAppearance = () => {
    const theme = $('#appearance-theme').value, alpha = Number($('#overlay-opacity').value) / 100;
    $('#opacity-value').textContent = Math.round(alpha * 100) + '%';
    const textAlpha = Number($('#overlay-text-opacity').value) / 100;
    $('#text-opacity-value').textContent = Math.round(textAlpha * 100) + '%';
    if ($('#opacity-preview').style) { $('#opacity-preview').style.backgroundColor = `rgba(${theme === 'dark' ? '35,37,35' : '252,251,247'},${alpha})`; $('#opacity-preview').style.color = `rgba(${theme === 'dark' ? '239,244,236' : '38,53,43'},1)`; $('#opacity-preview').style.opacity = String(textAlpha); $('#opacity-preview').style.fontSize = $('#overlay-font-size').value + 'px'; }
  };
  const saveAppearance = action(async () => {
    const appearance = { theme: $('#appearance-theme').value, overlayOpacity: Number($('#overlay-opacity').value) / 100, overlayTextOpacity: Number($('#overlay-text-opacity').value) / 100, overlayFontSize: Number($('#overlay-font-size').value) };
    await call('appearance', appearance); state.status.appearance = appearance; applyAppearance(appearance); previewAppearance(); message('外观已自动保存在本机。');
  });
  $('#overlay-opacity').oninput = previewAppearance;
  $('#overlay-opacity').onchange = saveAppearance;
  $('#overlay-text-opacity').oninput = previewAppearance;
  $('#overlay-text-opacity').onchange = saveAppearance;
  $('#overlay-font-size').onchange = saveAppearance;
  $('#appearance-theme').onchange = saveAppearance;
  $('#main-ghost-preset').onclick = async () => { $('#overlay-opacity').value = '0'; $('#overlay-text-opacity').value = '35'; await saveAppearance(); };
  $('#preview-overlay').onclick = action(async () => { checked(await native.setWindowMode('overlay')); });
  previewAppearance();
}
async function renderMaterials() {
  await refresh(); const documents = state.status.documents;
  $('#other').innerHTML = `<h1>简历与知识资料</h1><button id="prepare-materials">面试准备</button><button id="import-resume" class="primary">导入并设为简历</button><button id="resume-task">打开简历优化</button><div class="box"><h2>真实背景</h2><p>保存在本机，提问时作为背景送给已配置的模型。不会把示例当成你的经历。</p><textarea id="notes" style="min-height:210px" aria-label="真实背景">${escapeText(state.status.preferences.notes)}</textarea><button id="save-notes" class="primary">保存背景</button></div><div class="box"><div class="row"><h2>资料文件</h2><span class="grow"></span><button id="import" class="primary">导入 PDF / DOCX / TXT / MD</button></div><p>提问时按相关性选取资料，兼顾背景信息与回复速度。</p>${documents.length ? documents.map(d => `<div class="entry"><div class="grow"><b>${escapeText(d.name)}</b><p>${d.characters} 字符${d.id === state.status.preparation?.resumeDocumentId ? ' · 当前简历' : ''}</p></div><button data-view-doc="${d.id}">查看</button><button data-resume-doc="${d.id}">设为简历</button><button data-remove-doc="${d.id}">移除</button></div>`).join('') : '<p class="empty">还没有导入文件。扫描 PDF 需要先做 OCR。</p>'}</div>`;
  $('#prepare-materials').onclick = action(() => selectView('preparation'));
  $('#resume-task').onclick = action(() => selectView('resume'));
  $('#save-notes').onclick = action(async () => { await call('preferences', { ...state.status.preferences, notes: $('#notes').value }); message('真实背景已保存。'); });
  const importFiles = kind => action(async () => { const result = await call('import', { kind }); if (result.cancelled) return; await renderMaterials(); message(`已导入 ${result.added.length} 份，跳过重复 ${result.duplicates?.length || 0} 份。` + result.failed.map(f => `${f.name}：${f.error}`).join('\n')); });
  $('#import').onclick = importFiles('knowledge'); $('#import-resume').onclick = importFiles('resume');
  document.querySelectorAll('[data-view-doc]').forEach(b => b.onclick = action(() => showDocument({ id: b.dataset.viewDoc })));
  document.querySelectorAll('[data-resume-doc]').forEach(b => b.onclick = action(async () => { await call('preparation', { ...state.status.preparation, resumeDocumentId: b.dataset.resumeDoc }); await renderMaterials(); message('已设为当前简历。'); }));
  document.querySelectorAll('[data-remove-doc]').forEach(b => b.onclick = action(async () => { await call('documents', { remove: b.dataset.removeDoc }); await renderMaterials(); }));
}
async function renderRecords() {
  const [answers, meetings] = await Promise.all([call('records'), native.getRecentMeetings()]);
  $('#other').innerHTML = `<h1>记录与复盘</h1><div class="box"><h2>本 App 生成的问答</h2>${answers.length ? answers.map((a,i) => `<div class="entry"><div class="grow"><b>${escapeText(a.question)}</b><p>${escapeText(a.date)} · ${escapeText(a.model)}${a.partial ? ' · 部分完成' : ''}</p></div><button data-answer="${i}">查看</button><button data-answer-export="${i}">导出</button></div>`).join('') : '<p class="empty">还没有真实模型成功返回的问答。</p>'}</div><div class="box"><h2>采音会话</h2>${meetings?.length ? meetings.map((m,i) => `<div class="entry"><div class="grow"><b>${escapeText(m.title || '未命名会话')}</b><p>${escapeText(m.date)} · ${escapeText(m.duration)}</p></div><button data-meeting="${i}">导出转写</button><button data-review="${i}">生成复盘</button></div>`).join('') : '<p class="empty">暂无真实会话记录。</p>'}</div>`;
  const answerText = a => `# ${a.question}\n\n${a.date}\n\n## 快答\n${a.answers.quick || ''}\n\n## 展开\n${a.answers.deep || ''}`;
  document.querySelectorAll('[data-answer]').forEach(b => b.onclick = action(async () => { const a = answers[+b.dataset.answer]; await selectView(a.task); state.quick = a.answers.quick || ''; state.deep = a.answers.deep || ''; $('#quick').textContent = state.quick; $('#deep').textContent = state.deep; $('#question-title').textContent = a.question; state.lastQuestion = a.question; $('#dual').checked = !!a.answers.deep; $('#dual').onchange(); renderSources(a.sources); }));
  document.querySelectorAll('[data-answer-export]').forEach(b => b.onclick = action(() => call('export', { text: answerText(answers[+b.dataset.answerExport]), filename: 'interview-answer.md' })));
  async function meetingText(index) { const m = await native.getMeetingDetails(meetings[index].id); return `# ${m.title}\n\n` + (m.transcript || []).map(t => `${t.speaker}：${t.text}`).join('\n\n'); }
  document.querySelectorAll('[data-meeting]').forEach(b => b.onclick = action(async () => call('export', { text: await meetingText(+b.dataset.meeting), filename: 'meeting-transcript.md' })));
  document.querySelectorAll('[data-review]').forEach(b => b.onclick = action(async () => { const text = await meetingText(+b.dataset.review); await selectView('review'); $('#question').value = '请根据以下真实转写生成复盘，指出回答不足并给出改进建议：\n\n' + text; message('已放入转写，点击生成会调用模型。'); }));
}
async function renderSetup() {
  await refresh();
  $('#other').innerHTML = `<h1>语音与术语</h1><div class="box"><h2>语音服务与输入设备</h2><p>App 复用 Pika 的原生麦克风、系统音频与 STT 服务。回答模型和语音服务需分别配置。</p><div class="row"><button id="provider-settings">配置服务商</button><button id="audio-settings">语音与翻译设置</button><button id="shortcuts">自定义全局快捷键</button></div></div><div class="box"><h2>专业术语纠正</h2><p>每行「常见错词 =&gt; 正确写法」。这是转写后的确定性文字纠正，不等同于提升原始语音识别准确率。原文会保留。</p><textarea id="glossary" placeholder="常见错词 => 正确术语">${escapeText(state.status.preferences.glossary)}</textarea><label><input id="auto-answer" type="checkbox" ${state.status.preferences.autoAnswer ? 'checked' : ''}> 对含提问特征的对方发言自动快答（可能误触发；每次会产生模型调用）</label><button id="save-speech" class="primary">保存设置</button></div>`;
  const credentialCard = document.createElement('div'); credentialCard.className = 'box';
  credentialCard.innerHTML = `<h2>本地保存</h2><p>API 配置在设置中保存，下次启动自动读取，无需钥匙串密码。</p><button id="enable-secrets">导入旧的系统加密凭证（可选）</button><p>只有导入旧凭证可能要求系统钥匙串授权；日常启动和保存不调用钥匙串。</p>`;
  $('#other').insertBefore(credentialCard, $('#other').children[1]);
  $('#enable-secrets').onclick = action(async () => { await call('credentials-enable'); await renderSetup(); message('旧凭证已导入本地配置。'); });
  const options = (list, selected) => list.filter(d => d.id !== 'default' && d.id !== 'sck').map(d => `<option value="${escapeText(d.id)}" ${d.id === selected ? 'selected' : ''}>${escapeText(d.name)}</option>`).join('');
  const audio = state.status.captureSettings;
  const audioCard = document.createElement('div'); audioCard.className = 'box';
  audioCard.innerHTML = `<h2>电脑音频 · 会议共存</h2><p>减少鼠标操作：首次选区后可用「重用选区截图」。关闭下面的兼容模式后，可用 Ctrl+Shift+F8 暂停/继续、F7 提交本段、F11 重用选区截图。共享端的光标显示仍由会议软件决定。</p><p>${(state.status.floating?.shortcuts || []).map(s => escapeText(s.label) + '：' + (state.status.meetingCompatibility ? '全局已暂停' : s.registered ? '已启用 ' + escapeText(s.accelerator) : '注册失败，请检查占用')).join('<br>')}</p><label><input id="meeting-compatible" type="checkbox" ${state.status.meetingCompatibility ? 'checked' : ''}> 会议兼容模式（暂停截图、回答等全局快捷键）</label><p>截图结束后不主动抢回焦点。导入或粘贴题目图片可避免新增选区窗口。腾讯会议是否退出共享，仍需在实际会议中复测。</p><p>系统声音一路接收电脑正在播放的音频；飞书、腾讯会议继续使用原有设备。此设置不修改系统或会议软件的默认设备。</p><label>系统音频采集方式<select id="audio-backend">${state.status.platform === 'win32' ? '<option value="wasapi">WASAPI 系统回环（共享模式）</option>' : '<option value="sck">ScreenCaptureKit · 系统混音（默认）</option><option value="auto">Core Audio Tap · 指定播放设备，失败时回退</option>'}</select></label><label>会议播放使用的扬声器 / 耳机（与会议软件一致）<select id="audio-output"><option value="default">系统默认播放设备</option>${options(state.devices.outputs, audio.outputDeviceId)}</select></label><label><input id="audio-mic-enabled" type="checkbox" ${audio.captureMicrophone ? 'checked' : ''}> 同时采集我的麦克风（可选；关闭时不打开麦克风）</label><label>麦克风设备<select id="audio-input"><option value="default">系统默认麦克风</option>${options(state.devices.inputs, audio.inputDeviceId)}</select></label><div class="row"><button id="save-audio" class="primary">保存采音方式</button><button id="refresh-devices">刷新可用音频设备</button></div><p>系统混音会包含其他 App 的播放声音。${state.status.platform === 'win32' ? 'Windows 使用 WASAPI 回环读取播放设备，不修改系统默认设备。' : 'ScreenCaptureKit 需要 macOS 的屏幕与系统音频录制授权。'}仅系统音频模式不打开麦克风。蓝牙耳机和会议共存尚待实际通话测试。</p>`;
  $('#other').insertBefore(audioCard, credentialCard);
  $('#meeting-compatible').onchange = action(async () => { await call('meeting-compatibility', { enabled: $('#meeting-compatible').checked }); await refresh(); message('会议兼容模式已更新。'); });
  $('#audio-backend').value = audio.backend;
  $('#audio-backend').onchange = () => { $('#audio-output').disabled = $('#audio-backend').value === 'sck'; }; $('#audio-backend').onchange();
  $('#audio-mic-enabled').onchange = () => { $('#audio-input').disabled = !$('#audio-mic-enabled').checked; }; $('#audio-mic-enabled').onchange();
  $('#save-audio').onclick = action(async () => { await call('audio-preferences', { backend: $('#audio-backend').value, captureMicrophone: $('#audio-mic-enabled').checked, inputDeviceId: $('#audio-input').value, outputDeviceId: $('#audio-output').value }); await refresh(); message('采音方式已保存，下次开始采音时生效。'); });
  $('#refresh-devices').onclick = action(async () => { $('#refresh-devices').disabled = true; message('正在读取设备列表，最多等待 8 秒…'); try { state.devices = await call('audio-devices'); await renderSetup(); message('设备列表已更新。'); } finally { if ($('#refresh-devices')) $('#refresh-devices').disabled = false; } });
  $('#provider-settings').onclick = action(() => openSection('providers')); $('#audio-settings').onclick = action(() => openSection('audio')); $('#shortcuts').onclick = action(() => openSection('keybinds'));
  $('#save-speech').onclick = action(async () => { await call('preferences', { ...state.status.preferences, glossary: $('#glossary').value, autoAnswer: $('#auto-answer').checked }); message('术语与自动快答设置已保存。'); });
}
async function renderDiagnostics() {
  await refresh(); const s = state.status;
  const names = { granted: '已允许', denied: '未允许', restricted: '受系统限制', 'not-determined': '尚未请求', 'not-applicable': '无需授权' };
  const permission = name => names[s.permissions?.[name]] || '待检查';
  const microphone = s.captureSettings?.captureMicrophone ? permission('microphone') : '默认关闭';
  $('#other').innerHTML = `<h1>链路诊断</h1><div class="box"><h2>${captureLabel(s)}</h2><dl class="connection-facts"><div><dt>系统音频权限</dt><dd>${permission('screen')}</dd></div><div><dt>麦克风</dt><dd>${microphone}</dd></div><div><dt>语音服务</dt><dd>${s.speech?.configured ? '配置已保存' : '待配置'}</dd></div><div><dt>回答模型</dt><dd>${escapeText(s.model?.model || '待配置')}</dd></div></dl>${s.systemAudioBlocker ? `<p class="warning">${escapeText(s.systemAudioBlocker.message)}</p>` : ''}${s.audio?.lastError ? `<p class="warning">${escapeText(s.audio.lastError)}</p>` : ''}<div class="row"><button id="refresh-diagnostics">刷新状态</button><button id="test-model">前往设置测试连接</button></div><details><summary>技术详情</summary><pre class="log">${escapeText(JSON.stringify(s.audio, null, 2))}</pre><h3>模型计时</h3><pre class="log">${s.metrics?.length ? escapeText(s.metrics.map(m => `${m.event}  ${m.column || '-'}  ${m.ms} ms`).join('\n')) : '本次尚无回答请求。'}</pre></details></div>`;
  $('#refresh-diagnostics').onclick = action(renderDiagnostics);
  $('#test-model').onclick = action(() => selectView('connect'));
}
async function renderPair() {
  $('#other').innerHTML = `<h1>双端互联</h1><div class="box"><h2>手机作为配对端</h2><p>电脑负责采音和模型请求，手机显示回答。配对后可用「窗口与共享保护」的一键隐藏收起电脑窗口，减少对共享保护标志的依赖。实际会议画面仍应自测。</p><p>当前实现同一局域网配对：电脑采音，手机查看转写和回答，也可发起文字提问。只允许一个客户端，链接一小时后失效；配对不会自动启动。</p><p class="warning">仅限你信任的本地网络。当前使用 HTTP，尚不支持公网房间或跨网络连接。</p><div class="row"><button id="pair-start" class="primary">生成一次性配对链接</button><button id="pair-stop">关闭配对</button></div><textarea id="pair-url" readonly aria-label="配对链接">${escapeText(state.pairUrl)}</textarea><button id="copy-pair">复制链接</button></div>`;
  $('#pair-start').onclick = action(async () => { const result = await call('pair-start'); state.pairUrl = result.url; $('#pair-url').value = result.url; message('请在同网手机上打开此链接。'); });
  $('#pair-stop').onclick = action(async () => { await call('pair-stop'); state.pairUrl = ''; $('#pair-url').value = ''; message('配对服务已关闭。'); });
  $('#copy-pair').onclick = action(async () => { await navigator.clipboard.writeText($('#pair-url').value); message('已复制一次性链接。'); });
}
studio.onEvent(data => {
  if (data.kind === 'transcription-state') { if (state.status) { state.status.transcription = data.value; void refresh().catch(error => message(error.message)); } return; }
  if (data.kind === 'speech-recovered') { message('语音连接已恢复'); void refresh().catch(() => {}); return; }
  if (data.kind === 'speech-error') { if (state.status) { state.status.audio = { ...state.status.audio, lastError: data.message }; paintCapture(state.status); } message(data.message); return; }
  if (data.kind === 'navigate') { void action(async () => { await selectView(data.view); if (data.start) await $('#start').onclick(); })(); return; }
  if (data.kind === 'shortcut') { if (data.action === 'pause') void $('#pause-transcription').onclick(); if (data.action === 'finish') void $('#finish-turn').onclick(); if (data.action === 'capture-repeat') void action(async () => { await capture(true, true); })(); if (data.action === 'quick') void action(() => ask())(); if (data.action === 'retry') void $('#retry-answer').onclick(); if (data.action === 'capture') void $('#capture-ask').onclick(); return; }
  if (data.kind === 'appearance') {
    if (state.status) state.status.appearance = data.value;
    applyAppearance(data.value);
    if (state.view === 'connect' && $('#overlay-opacity')) {
      $('#appearance-theme').value = data.value.theme;
      $('#overlay-opacity').value = String(Math.round(data.value.overlayOpacity * 100));
      $('#overlay-text-opacity').value = String(Math.round((data.value.overlayTextOpacity ?? 1) * 100));
      $('#overlay-font-size').value = String(data.value.overlayFontSize ?? 15);
      $('#overlay-opacity').oninput?.();
    }
    return;
  }
  if (data.kind === 'transcript') { state.transcripts.set(data.segment.segmentId, data.segment); renderTurns(); if (data.segment.speaker === 'them') state.themPartial = ''; $('#partial').textContent = ''; return; }
  if (data.kind === 'reset') { state.transcripts.clear(); state.themPartial = ''; renderTurns(); return; }
  if (data.kind === 'started' && !state.request && ['interview','written','resume','review'].includes(data.task) && data.task !== state.task) void selectView(data.task);
  if (data.kind === 'started' && (!state.request || data.id === state.request)) { renderSources(data.sources); $('#dual').checked = !!data.dual; $('#dual').onchange(); }
  if (data.kind === 'started' && !state.request) { state.request = data.id; state.quick = ''; state.deep = ''; $('#quick').textContent = ''; $('#deep').textContent = ''; $('#question-title').textContent = data.question; $('#ask').disabled = true; }
  if (data.id && data.id !== state.request) return;
  if (data.kind === 'token') { state[data.column] += data.text; scheduleAnswerPaint(); }
  if (data.kind === 'first') $('#' + data.column + '-time').textContent = `首字 ${data.ms} ms`;
  if (data.kind === 'error') { state.lastError = data.message; message(data.message); if (data.column && !state[data.column]) $('#' + data.column).textContent = '生成未成功，请检查错误提示后重试。'; }
  if (data.kind === 'done') { paintAnswers(); state.request = null; $('#ask').disabled = false; if (state.extracting && data.ok) { $('#question').value = state.quick; $('#question').focus(); message('题目已识别到输入框，请校对后点击「分析解题」。'); } else if (data.ok) message(`生成完成 · 总耗时 ${data.ms} ms`); else if (data.partial) message('已保留收到的部分内容。' + (state.lastError || '')); state.extracting = false; }
});
native.onNativeAudioTranscript(data => {
  if (!data.final && data.speaker === 'them') state.themPartial = data.text;
  if (!data.final) $('#partial').textContent = (data.speaker === 'user' ? '我：' : '对方：') + data.text;
  if (state.status?.sessionActive && data.speaker === 'them' && data.text && !state.status.audio?.lastThemTranscriptAt) {
    state.status.audio = { ...state.status.audio, lastThemTranscriptAt: Date.now(), lastError: null };
    paintCapture(state.status);
  }
});
native.onMeetingStateChanged(() => refresh().catch(error => message(error.message)));
native.onSessionReset(() => { state.transcripts.clear(); state.themPartial = ''; renderTurns(); });
native.onGlobalShortcut(data => { if (['reply','answer','manual-answer'].includes(data?.action)) void action(async () => { const s = await call('status'); if (s.floating?.mode !== 'overlay') await ask(); })(); });
$('#capture-permission').onclick = action(() => call('capture-permission', 'screen'));
$('#start').onclick = action(async () => { await refresh(); if (!state.status.speech?.configured) { const reason = state.status.speech?.reason; await selectView('connect'); throw new Error(reason || '请先配置语音转写服务'); } $('#session-mic').checked = state.status.captureSettings.captureMicrophone; $('#session-screen').checked = state.view === 'written'; $('#source-dialog').showModal(); paintCapture(state.status); });
$('#session-mic').onchange = () => paintCapture(state.status);
$('#source-cancel').onclick = () => $('#source-dialog').close();
$('#source-start').onclick = action(async () => {
  if ($('#source-start').disabled) return;
  state.startingCapture = true; paintCapture(state.status);
  try {
    await call('start', { captureMicrophone: $('#session-mic').checked });
    $('#source-dialog').close();
    if ($('#session-screen').checked) await selectView('written');
    await refresh();
  } catch (error) { $('#source-dialog').close(); throw error; }
  finally { state.startingCapture = false; paintCapture(state.status); }
});
$('#settings-back').onclick = action(() => selectView('connect'));
$('#retry-answer').onclick = action(() => { if (!state.lastQuestion) throw new Error('还没有可重新生成的问题'); return ask(state.lastQuestion); });
$('#capture-ask').onclick = action(async () => { if (state.request) throw new Error('请先停止当前生成'); if (!state.status?.model) { await selectView('connect'); throw new Error('请先配置支持图片的回答模型'); } const before = state.images.length; await capture(true); if (state.images.length === before) return; await ask($('#question').value.trim() || '请识别并解答截图中的题目，先给结论，再说明思路；代码题请给出代码与复杂度。'); });
$('#pause-transcription').onclick = action(async () => { await call('transcription-pause', { paused: !state.status?.transcription?.paused }); await refresh(); });
$('#finish-turn').onclick = action(async () => { await call('transcription-finish'); await refresh(); message('已提交确认的文字，正在识别的内容会继续接收。'); });
$('#transcription-mode').onchange = action(async () => { const value = $('#transcription-mode').value; await call('transcription-settings', { mode: value === 'manual' ? 'manual' : 'auto', silenceMs: value === 'manual' ? 30000 : Number(value) }); await refresh(); });
async function importQuestionImage(source) {
  if (state.images.length >= 4) throw new Error('一次最多附加 4 张图片');
  const image = await call('image-import', { source });
  if (!image.cancelled) { state.images.push(image); renderImages(); message('图片已附加。点击识别题目，或直接分析解题；届时图片会发送给你选择的模型。'); }
}
$('#import-question-image').onclick = action(() => importQuestionImage('file'));
$('#paste-question-image').onclick = action(() => importQuestionImage('clipboard'));
$('#recognize-question').onclick = action(async () => { if (!state.images.length) throw new Error('请先截图、导入或粘贴题目图片'); const button = $('#recognize-question'); button.disabled = true;
  try { message('正在本机识别题目，不发送图片…'); const result = await call('image-recognize', { paths: state.images.map(i => i.path) }); $('#question').value = result.text; state.ocrPaths = state.images.map(i => i.path); $('#written-input-mode').value = 'text'; $('#question').focus(); message('本机识别完成，请校对题目、公式和代码缩进，再点击分析解题。'); }
  finally { button.disabled = false; } });
$('#stop').onclick = action(async () => { checked(await native.endMeeting()); await refresh(); });
$('#overlay').onclick = action(async () => { checked(await native.setWindowMode('overlay')); });
$('#prepare').onclick = action(() => selectView('preparation'));
$('#document-close').onclick = () => $('#document-dialog').close();
$('#settings').onclick = action(() => selectView('connect'));
$('#original').onclick = action(() => call('original'));
$('#ask').onclick = action(() => ask()); $('#capture').onclick = action(() => capture(true)); $('#full-capture').onclick = action(() => capture(false)); $('#repeat-capture').onclick = action(() => capture(true, true));
$('#cancel').onclick = action(async () => { if (state.request) await call('cancel', { id: state.request }); speechSynthesis.cancel(); });
$('#dual').onchange = () => { $('#columns').classList.toggle('single', !$('#dual').checked); $('#deep-column').hidden = !$('#dual').checked; };
$('#copy-quick').onclick = action(async () => { await navigator.clipboard.writeText(state.quick); message('已复制快答。'); });
$('#copy-deep').onclick = action(async () => { await navigator.clipboard.writeText(state.deep); message('已复制解释。'); });
$('#export-answer').onclick = action(() => call('export', { text: `# ${$('#question-title').textContent}\n\n## 快答\n${state.quick}\n\n## 展开\n${state.deep}`, filename: 'interview-answer.md' }));
$('#export-transcript').onclick = action(() => call('export', { text: '# 转写记录\n\n' + [...state.transcripts.values()].map(t => `${t.speaker === 'user' ? '我' : '对方'}：${t.text}`).join('\n\n'), filename: 'interview-transcript.md' }));
$('#speak').onclick = action(async () => { if (!state.quick) throw new Error('还没有可播报的回答'); await refresh(); if (state.status.sessionActive && !state.status.transcription?.paused) throw new Error('请先暂停转写再播报，避免播报声音回流被当作对方发言'); speechSynthesis.cancel(); const speech = new SpeechSynthesisUtterance(state.quick); speech.lang = state.status?.preparation?.language === 'English' ? 'en-US' : 'zh-CN'; speech.onerror = () => message('系统语音播报失败，请检查系统语音资源。'); speechSynthesis.speak(speech); });
$('#question').addEventListener('keydown', event => { if (!event.isComposing && event.keyCode !== 229 && (event.metaKey || event.ctrlKey) && event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); action(() => ask())(); } });
$('#dual').onchange();
document.querySelectorAll('[data-view]').forEach(b => b.onclick = action(() => selectView(b.dataset.view)));
window.addEventListener('unhandledrejection', event => { message(event.reason?.message || '操作失败'); event.preventDefault(); });
window.addEventListener('focus', () => { if (state.status) void refresh().catch(error => message(error.message)); });
refresh(true).catch(error => message('桌面服务未启动：' + error.message));
})();
