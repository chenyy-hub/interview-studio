'use strict';
const { app, BrowserWindow, ipcMain, dialog, systemPreferences, Menu, globalShortcut } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const os = require('node:os');
const { fileURLToPath, pathToFileURL } = require('node:url');
const { execFile } = require('node:child_process');
const { runAnswers, validateRequest, applyGlossary } = require('./answer-engine.cjs');
const { speechReadiness, audioPreferences, capturePermissions } = require('./service-readiness.cjs');
const { ContextIndex } = require('./context-index.cjs');
const { streamOpenAI } = require('./fast-stream.cjs');
const { createPrivacy } = require('./privacy-controller.cjs');
const { preparation, preparationContext, documentHash, documentVersion } = require('./preparation.cjs');

function install(appState) {
  const compiled = path.join(app.getAppPath(), 'dist-electron/electron');
  const { CredentialsManager } = require(path.join(compiled, 'services/CredentialsManager.js'));
  const { redactConnectionError } = require(path.join(compiled, 'services/connectionSecrets.js'));
  const cm = CredentialsManager.getInstance();
  const storePath = path.join(app.getPath('userData'), 'studio-state.json');
  let store = { notes: '', glossary: '', autoAnswer: false, documents: [], answers: [] };
  try { store = { ...store, ...JSON.parse(fs.readFileSync(storePath, 'utf8')) }; } catch (error) { if (error.code !== 'ENOENT') console.warn('[Studio] Preferences could not be loaded'); }
  try { store.audio = audioPreferences(store.audio); } catch { store.audio = { backend: process.platform === 'win32' ? 'wasapi' : 'sck', captureMicrophone: false, inputDeviceId: 'default', outputDeviceId: 'default' }; }
  store.performance = { mode: store.performance?.mode === 'balanced' ? 'balanced' : 'fast' };
  store.privacy = { enabled: store.privacy?.enabled !== false, selfTest: store.privacy?.selfTest || null };
  const language = cm.getAiResponseLanguage?.() === 'English' ? 'English' : 'Chinese';
  try { store.preparation = preparation(store.preparation || {}, { language }); }
  catch { store.preparation = preparation({}, { language }); }
  const contextIndex = new ContextIndex(store.documents, store.notes);
  const reindex = () => contextIndex.reset(store.documents, store.notes);
  const privacy = createPrivacy({ app, appState, BrowserWindow, globalShortcut });
  privacy.apply(store.privacy.enabled);
  let needsConfiguration = false;
  let room = null, lastAutoAt = 0, lastGeneration = null;
  const active = new Map(), screenshots = new Set(), transcripts = new Map();
  const deviceWorkers = new Set();
  const metricRows = [];
  const llm = appState.processingHelper?.getLLMHelper();
  // The native overlay and the Chinese workbench share the same saved background.
  // Keep the original provider routing, knowledge lookup and abort signal intact.
  if (llm) {
    const upstreamStream = llm.streamChat.bind(llm);
    llm.streamChat = async function* (question, images, context, system, options) {
      const mode = options?.mode || store.performance.mode;
      const combined = context?.startsWith('[STUDIO_CONTEXT]') ? context : contextIndex.select(question || '', mode === 'fast' ? 6000 : 18000, store.preparation).text + preparationContext(store.preparation) + '\n\n' + (context || '').slice(-6000);
      const use = cm.resolveModelUse('chat');
      if ('connection' in use && use.connection.type === 'openai' && !images?.length) {
        yield* streamOpenAI({ connection: use.connection, model: use.model, question, context: combined,
          system: system || (store.preparation.language === 'English' ? 'Answer briefly in English using only true personal background.' : '根据真实背景用中文简明回答，不编造个人经历。'), signal: options?.signal,
          column: options?.column || 'quick', mode, onStage: options?.onStage });
      } else yield* upstreamStream(question, images, combined, system, { ...options, verbatimPrompt: true });
    };
  }
  const write = () => {
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(storePath + '.tmp', JSON.stringify(store), { mode: 0o600 });
    fs.renameSync(storePath + '.tmp', storePath);
  };
  const send = data => {
    for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed() && win.webContents.getURL().includes('/desktop/index.html')) win.webContents.send('studio:event', data);
    if (room) room.publish(data);
  };
  const handle = (name, fn) => ipcMain.handle('studio:' + name, async (event, payload) => {
    let local = false;
    try { local = fileURLToPath(event.senderFrame.url.split('?')[0]) === path.join(app.getAppPath(), 'desktop/index.html'); } catch {}
    if (!local || event.senderFrame !== event.sender.mainFrame) return { success: false, error: '不受信任的窗口' };
    try { return await fn(payload, event); }
    catch (error) { return { success: false, error: String(error.message || '操作失败') }; }
  });
  const readiness = () => {
    const use = cm.resolveModelUse('chat');
    return { model: 'connection' in use ? { model: use.model, provider: use.connection.name } : null,
      modelError: 'error' in use ? use.error : null, credentialStorage: cm.studioCredentialSession?.state() || { mode: 'memory' },
      performance: store.performance, privacy: { ...privacy.status(), selfTest: store.privacy.selfTest || null },
      platform: process.platform, appVersion: app.getVersion?.() || '0.7.0', preparation: store.preparation,
      speech: speechReadiness(cm), captureSettings: store.audio, needsConfiguration: needsConfiguration && !speechReadiness(cm).configured,
      permissions: capturePermissions(systemPreferences),
      sessionActive: !!appState.getCurrentMeetingId(), preferences: { notes: store.notes, glossary: store.glossary, autoAnswer: store.autoAnswer },
      documents: store.documents.map(({ id, name, text }) => ({ id, name, characters: text.length })),
      metrics: metricRows, pairing: !!room, transcripts: [...transcripts.values()], generation: lastGeneration,
      sttProvider: cm.getSttProvider(), audio: appState.getNativeAudioStatus?.() || null };
  };
  handle('status', readiness);
  handle('preparation', data => {
    const next = preparation(data);
    if (next.resumeDocumentId && !store.documents.some(d => d.id === next.resumeDocumentId)) throw new Error('所选简历已不存在，请重新选择');
    const previous = store.preparation;
    store.preparation = next;
    try { write(); } catch (error) { store.preparation = previous; throw error; }
    return { success: true };
  });
  handle('performance', data => {
    if (!['fast', 'balanced'].includes(data?.mode)) throw new Error('请选择极速或完整模式');
    store.performance = { mode: data.mode }; write(); return { success: true };
  });
  handle('privacy', data => {
    if (typeof data?.enabled !== 'boolean') throw new Error('窗口保护设置不正确');
    store.privacy.enabled = data.enabled; privacy.apply(data.enabled); write(); return { success: true };
  });
  handle('privacy-test', data => {
    if (!['feishu','tencent','other'].includes(data?.client) || !['screen','window'].includes(data?.capture) || !['passed','failed'].includes(data?.result) || typeof data.version !== 'string' || !data.version.trim() || data.version.length > 80) throw new Error('请填写会议客户端、版本、共享方式和实际结果');
    store.privacy.selfTest = { client: data.client, capture: data.capture, result: data.result, version: data.version.trim(), at: new Date().toISOString(), platform: process.platform, appVersion: app.getVersion?.() || '0.7.0', source: 'user-reported' };
    write(); return { success: true };
  });
  handle('hide', () => { privacy.toggleVisibility(); return { success: true }; });
  let deviceQuery;
  const readDevices = () => deviceQuery ||= new Promise((resolve, reject) => {
    const worker = execFile(process.execPath, [path.join(__dirname, 'audio-devices.cjs')], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 8000, killSignal: 'SIGKILL', maxBuffer: 256 * 1024,
    }, (error, stdout) => {
      deviceWorkers.delete(worker);
      if (error) return reject(new Error('未能读取设备列表；可继续使用系统默认设备。'));
      try {
        // Native diagnostics may precede the one JSON object on stdout.
        const begin = stdout.indexOf('{"inputs":');
        const devices = JSON.parse(stdout.slice(begin));
        const valid = list => Array.isArray(list) && list.every(d => typeof d.id === 'string' && typeof d.name === 'string');
        if (!valid(devices.inputs) || !valid(devices.outputs)) throw new Error();
        resolve(devices);
      } catch { reject(new Error('设备列表格式异常；可继续使用系统默认设备。')); }
    });
    deviceWorkers.add(worker);
  }).finally(() => { deviceQuery = null; });
  handle('audio-devices', readDevices);
  // The upstream settings page also asks for devices on mount. Route those
  // requests through the same bounded child so advanced settings stay usable.
  for (const [channel, key] of [['get-input-devices', 'inputs'], ['get-output-devices', 'outputs']]) {
    ipcMain.removeHandler?.(channel);
    ipcMain.handle(channel, async event => {
      try {
        const local = fileURLToPath(event.senderFrame.url.split('?')[0]);
        if (event.senderFrame !== event.sender.mainFrame || !['desktop/index.html', 'dist/index.html'].some(file => local === path.join(app.getAppPath(), file))) return [];
      } catch { return []; }
      try { return (await readDevices())[key]; }
      catch { return [{ id: 'default', name: '系统默认设备' }]; }
    });
  }
  handle('audio-preferences', data => {
    if (appState.getCurrentMeetingId()) throw new Error('请先结束采音，再更换采音设置。');
    store.audio = audioPreferences(data); write(); return { success: true };
  });
  handle('start', async () => { await appState.startMeeting({ title: [store.preparation.company, store.preparation.role].filter(Boolean).join(' · ') || '面试练习' }); return { success: true }; });
  handle('credentials-enable', () => {
    if (!cm.studioCredentialSession) throw new Error('凭证服务未就绪');
    const result = cm.studioCredentialSession.enableEncrypted();
    appState.processingHelper.loadStoredCredentials();
    return { success: true, ...result };
  });
  handle('credentials-clear', () => {
    if (active.size || appState.getCurrentMeetingId()) throw new Error('请先停止生成并结束采音，再清除服务配置。');
    cm.studioCredentialSession.clearLocal();
    appState.processingHelper.loadStoredCredentials();
    return { success: true };
  });
  handle('preferences', data => {
    if (!data || typeof data.notes !== 'string' || data.notes.length > 40000 || typeof data.glossary !== 'string' || data.glossary.length > 12000 || typeof data.autoAnswer !== 'boolean') throw new Error('背景资料最多 40,000 字符，术语表最多 12,000 字符');
    store.notes = data.notes; store.glossary = data.glossary; store.autoAnswer = data.autoAnswer; reindex(); write();
    return { success: true };
  });
  async function ask(raw) {
    const request = validateRequest(raw);
    if (active.has(request.id)) throw new Error('该请求正在进行');
    if (active.size >= 1) throw new Error('请先停止或等待当前请求完成');
    const use = cm.resolveModelUse('chat');
    if ('error' in use) throw new Error(use.error);
    const paths = Array.isArray(raw.images) ? raw.images : [];
    if (paths.length > 4 || paths.some(p => typeof p !== 'string' || !screenshots.has(p))) throw new Error('请选择本次 App 截取的图片');
    const preparedAt = performance.now();
    const mode = store.performance.mode;
    const recent = appState.getIntelligenceManager().getFormattedContext(mode === 'fast' ? 60 : 180);
    const quick = contextIndex.select(request.question, request.task === 'resume' ? 24000 : mode === 'fast' ? 6000 : 16000, store.preparation);
    const deep = request.dual ? contextIndex.select(request.question, 24000, store.preparation) : quick;
    const sources = { quick: quick.sources, deep: request.dual ? deep.sources : [] };
    const context = { quick: quick.text + preparationContext(store.preparation, mode === 'fast' ? 1500 : 6000) + '\n\n当前对话：\n' + recent.slice(-4500), deep: deep.text + preparationContext(store.preparation, 6000) + '\n\n当前对话：\n' + recent.slice(-10000) };
    metricRows.push({ requestId: request.id, event: 'context-ready', ms: Math.round(performance.now() - preparedAt), characters: quick.characters, chunks: quick.chunks, timestamp: Date.now() });
    const controller = new AbortController(); active.set(request.id, controller);
    const timeout = setTimeout(() => controller.abort(), 120000);
    lastGeneration = { id: request.id, question: request.question, task: request.task, dual: request.dual, quick: '', deep: '', first: {}, sources, running: true, error: '' };
    send({ kind: 'started', id: request.id, question: request.question, task: request.task, dual: request.dual, sources });
    let succeeded = false, partial = false;
    const emit = data => {
      if (lastGeneration?.id === data.id) {
        if (data.kind === 'token') lastGeneration[data.column] += data.text;
        if (data.kind === 'first') lastGeneration.first[data.column] = data.ms;
        if (data.kind === 'error') lastGeneration.error = data.message;
        if (data.kind === 'done') lastGeneration.running = false;
      }
      if (data.kind === 'first' || data.kind === 'column-done' || data.kind === 'done' || data.kind === 'metric') {
        metricRows.push({ requestId: request.id, event: data.kind === 'metric' ? data.event : data.kind, column: data.column, ms: data.ms, timestamp: Date.now() });
        if (metricRows.length > 100) metricRows.shift();
      }
      if (data.kind === 'done') { succeeded = data.ok; partial = data.partial; }
      send(data);
    };
    void runAnswers({ request, context, imagePaths: paths, signal: controller.signal, mode, preparation: store.preparation,
      stream: (question, images, ctx, system, options) => appState.processingHelper.getLLMHelper().streamChat(question, images, ctx, system, { ...options, onStage: data => emit({ kind: 'metric', id: request.id, ...data }) }),
      send: data => emit(data.kind === 'error' ? { ...data, message: redactConnectionError(new Error(data.message), use.connection).message } : data),
    }).then(answers => {
      if (!Object.values(answers).some(text => text?.trim())) return;
      store.answers.unshift({ id: request.id, question: request.question, task: request.task, answers, sources, partial: partial || !succeeded, model: use.model, date: new Date().toISOString() });
      store.answers = store.answers.slice(0, 150); write();
    }).catch(() => send({ kind: 'error', id: request.id, message: '保存问答失败，请导出当前回答。' }))
      .finally(() => { clearTimeout(timeout); active.delete(request.id); });
    return { success: true, id: request.id };
  }
  handle('ask', ask);
  handle('cancel', ({ id } = {}) => { if (typeof id !== 'string') throw new Error('请求标识无效'); active.get(id)?.abort(); return { success: true }; });
  handle('capture', async (data = {}) => {
    let imagePath;
    try { imagePath = await (data.area === false ? appState.takeScreenshot() : appState.takeSelectiveScreenshot()); }
    catch (error) { if (error.message === 'Selection cancelled') return { cancelled: true }; throw error; }
    screenshots.add(imagePath);
    return { success: true, path: imagePath, preview: await appState.getImagePreview(imagePath) };
  });
  handle('import', async (data = {}) => {
    const resume = data.kind === 'resume';
    const choice = await dialog.showOpenDialog({ title: resume ? '选择一份简历' : '导入知识资料', properties: resume ? ['openFile'] : ['openFile', 'multiSelections'], filters: [{ name: '资料', extensions: ['txt','md','docx','pdf'] }] });
    if (choice.canceled) return { cancelled: true };
    const added = [], failed = [], duplicates = [];
    for (const filename of choice.filePaths) {
      try {
        if (fs.statSync(filename).size > 15 * 1024 * 1024) throw new Error('文件超过 15 MB');
        const buffer = fs.readFileSync(filename); let text;
        if (/\.docx$/i.test(filename)) text = (await require('mammoth').extractRawText({ buffer })).value;
        else if (/\.pdf$/i.test(filename)) {
          const { PDFParse } = require('pdf-parse'); const parser = new PDFParse({ data: new Uint8Array(buffer) });
          try { text = (await parser.getText()).text; } finally { await parser.destroy(); }
        } else text = buffer.toString('utf8');
        if (!text?.trim()) throw new Error('未提取到文字；扫描 PDF 请先做 OCR');
        if (text.length > 80000) throw new Error('文字超过 80,000 字符，请拆分文件');
        const hash = documentHash(text);
        const existing = store.documents.find(d => (d.hash || documentHash(d.text)) === hash);
        if (existing) { duplicates.push({ id: existing.id, name: path.basename(filename), existingName: existing.name }); if (resume) store.preparation.resumeDocumentId = existing.id; continue; }
        const item = { id: crypto.randomUUID(), name: path.basename(filename), text, hash };
        store.documents.push(item); added.push({ id: item.id, name: item.name });
        if (resume) store.preparation.resumeDocumentId = item.id;
      } catch (error) { failed.push({ name: path.basename(filename), error: String(error.message) }); }
    }
    reindex(); write(); return { success: true, added, failed, duplicates };
  });
  handle('documents', data => {
    if (data?.remove) { store.documents = store.documents.filter(d => d.id !== data.remove); if (store.preparation.resumeDocumentId === data.remove) store.preparation.resumeDocumentId = ''; reindex(); write(); }
    return store.documents.map(({ id, name, text }) => ({ id, name, characters: text.length }));
  });
  handle('records', () => store.answers);
  handle('document-text', data => {
    const doc = data?.id === 'profile' ? { id: 'profile', name: '真实背景', text: store.notes } : store.documents.find(d => d.id === data?.id);
    if (!doc) throw new Error('这份资料已移除，无法查看原文');
    if (data.hash !== undefined && data.hash !== documentVersion(doc.text)) throw new Error('资料已更新，当前原文与本次回答使用的版本不同');
    return { id: doc.id, name: doc.name, text: doc.text };
  });
  handle('export', async ({ text, filename } = {}) => {
    if (typeof text !== 'string' || text.length > 2000000) throw new Error('导出内容不正确');
    const result = await dialog.showSaveDialog({ title: '导出记录', defaultPath: path.basename(filename || 'interview-record.md'), filters: [{ name: 'Markdown', extensions: ['md'] }] });
    if (result.canceled) return { cancelled: true };
    fs.writeFileSync(result.filePath, text, { mode: 0o600 }); return { success: true };
  });
  const showOriginal = section => {
    // Pika's model tab is named ai-providers; "models" renders an empty panel.
    section = section === 'models' ? 'ai-providers' : section;
    const win = appState.windowHelper.getLauncherWindow();
    if (section) win.webContents.once('did-finish-load', () => setTimeout(() => {
      if (!win.isDestroyed()) win.webContents.send('open-settings-section', { section });
    }, 500));
    void win.loadURL(pathToFileURL(path.join(app.getAppPath(), 'dist/index.html')).href + '?window=launcher');
    win.show();win.focus();
    return { success: true };
  };
  handle('original', () => showOriginal());
  handle('settings', data => {
    if (!['models','providers','audio','keybinds','profile','general'].includes(data?.section)) throw new Error('设置页面无效');
    return showOriginal(data.section);
  });
  const showStudio = () => {
    const win = appState.windowHelper.getLauncherWindow();
    void win.loadURL(pathToFileURL(path.join(app.getAppPath(), 'desktop/index.html')).href);
    win.show();win.focus();
  };
  if (typeof appState.startMeeting === 'function') {
    const startMeeting = appState.startMeeting.bind(appState);
    appState.startMeeting = async metadata => {
      const speech = speechReadiness(cm);
      if (!speech.configured) {
        needsConfiguration = true;
        appState.windowHelper.getOverlayWindow?.()?.hide();
        showStudio();
        throw new Error(speech.reason);
      }
      needsConfiguration = false;
      return startMeeting({ ...metadata, audio: { inputDeviceId: store.audio.inputDeviceId,
        outputDeviceId: process.platform === 'win32' ? store.audio.outputDeviceId : store.audio.backend === 'sck' ? 'sck' : store.audio.outputDeviceId,
        captureMicrophone: store.audio.captureMicrophone } });
    };
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: '面试工作室', submenu: [{ role: 'about' }, { type: 'separator' }, { label: '返回中文工作台', accelerator: 'CommandOrControl+Shift+H', click: showStudio }, { label: '模型设置', click: () => showOriginal('models') }, { label: '语音设置', click: () => showOriginal('audio') }, { type: 'separator' }, { role: 'hide' }, { role: 'quit' }] },
    { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: '窗口', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { label: '中文工作台', click: showStudio }, { label: 'Pika 完整功能', click: () => showOriginal() }] },
  ]));
  handle('pair-start', async () => {
    if (room) return room.info;
    room = await createPairRoom({ onAsk: ask, onClose: () => { room = null; }, snapshot: () => ({ transcripts: [...transcripts.values()].slice(-100), generation: lastGeneration }) });
    return { success: true, ...room.info };
  });
  handle('pair-stop', () => { room?.stop(); room = null; return { success: true }; });
  // Mirror actual Pika events without adding a second audio pipeline or changing stored transcripts.
  app.on('web-contents-created', (_event, contents) => observe(contents));
  for (const contents of BrowserWindow.getAllWindows().map(w => w.webContents)) observe(contents);
  function observe(contents) {
    if (contents.__studioObserved) return; contents.__studioObserved = true;
    const original = contents.send.bind(contents);
    contents.send = (channel, ...args) => {
      if (channel === 'native-audio-transcript' && contents === appState.windowHelper.getLauncherWindow()?.webContents) {
        const segment = args[0];
        if (segment?.text && segment.final) {
          const id = segment.segmentId || `${segment.speaker}-${segment.timestamp}`;
          const row = { ...segment, originalText: segment.text, text: applyGlossary(segment.text, store.glossary) };
          const exists = transcripts.has(id); transcripts.set(id, row);
          if (transcripts.size > 500) transcripts.delete(transcripts.keys().next().value);
          send({ kind: 'transcript', segment: { ...row, segmentId: id } });
          if (!exists && store.autoAnswer && segment.speaker === 'them' && /[?？]|什么|如何|为什么|怎么|请介绍|谈谈/.test(row.text) && Date.now() - lastAutoAt > 12000 && !active.size) {
            lastAutoAt = Date.now(); void ask({ id: 'auto-' + Date.now(), task: 'interview', question: row.text, dual: false }).catch(error => send({ kind: 'error', message: error.message }));
          }
        }
      }
      if (contents === appState.windowHelper.getLauncherWindow()?.webContents) {
        if (channel === 'session-reset') {
          for (const controller of active.values()) controller.abort();
          transcripts.clear(); lastGeneration = null; lastAutoAt = 0; send({ kind: 'reset' });
        }
        if (channel === 'meeting-state-changed' && args[0]?.isActive === false) {
          for (const controller of active.values()) controller.abort();
        }
      }
      return original(channel, ...args);
    };
  }
  app.on('before-quit', () => { for (const controller of active.values()) controller.abort(); for (const worker of deviceWorkers) worker.kill('SIGKILL'); room?.stop(); });
}

function isPrivateIPv4(address) {
  if (typeof address !== 'string' || !/^\d{1,3}(\.\d{1,3}){3}$/.test(address)) return false;
  const octets = address.split('.').map(Number);
  return octets.length === 4 && octets.every(n => Number.isInteger(n) && n >= 0 && n <= 255) &&
    (octets[0] === 10 || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) || (octets[0] === 192 && octets[1] === 168));
}

async function createPairRoom({ onAsk, snapshot, onClose, bindAddress }) {
  const token = crypto.randomBytes(32).toString('base64url');
  const clients = new Set(); let acceptedHost;
  const server = http.createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'");
    if (req.method !== 'GET' || req.url !== '/') { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', 'text/html;charset=utf-8');res.end(fs.readFileSync(path.join(__dirname, 'remote.html')));
  });
  const { WebSocketServer } = require('ws'); const wsServer = new WebSocketServer({ noServer: true, maxPayload: 24000 });
  server.on('upgrade', (req, socket, head) => {
    let url;
    try { url = new URL(req.url, 'http://' + req.headers.host); } catch { socket.destroy(); return; }
    if (url.searchParams.get('token') !== token || req.headers.origin !== 'http://' + req.headers.host || clients.size >= 1 || req.headers.host !== acceptedHost) { socket.destroy(); return; }
    wsServer.handleUpgrade(req, socket, head, ws => wsServer.emit('connection', ws));
  });
  wsServer.on('connection', ws => {
    clients.add(ws);ws.send(JSON.stringify({ kind: 'snapshot', ...snapshot() }));
    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
    ws.on('message', bytes => {
      try { const data = JSON.parse(bytes.toString()); if (data.kind !== 'ask') return;
        void onAsk({ id: 'phone-' + crypto.randomUUID(), task: 'interview', question: data.question, dual: false }).catch(error => { if (ws.readyState === 1) ws.send(JSON.stringify({ kind: 'error', message: error.message })); });
      } catch { if (ws.readyState === 1) ws.send(JSON.stringify({ kind: 'error', message: '请求格式错误' })); }
    });
  });
  const addresses = Object.entries(os.networkInterfaces()).filter(([name]) => !/^(utun|tun|tap|docker|vbox|vmnet)/i.test(name)).flatMap(([, values]) => values || []).filter(a => a?.family === 'IPv4' && !a.internal && isPrivateIPv4(a.address)).map(a => a.address);
  if (bindAddress === '127.0.0.1') addresses.unshift(bindAddress); // headless smoke tests only; never accepted from IPC
  if (!addresses.length) { wsServer.close(); throw new Error('没有可用于同网配对的 IPv4 地址'); }
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, addresses[0], resolve); });
  acceptedHost = `${addresses[0]}:${server.address().port}`;
  let closed = false;
  const stop = () => { if (closed) return; closed = true; clearTimeout(expiry); for (const ws of clients) ws.terminate(); wsServer.close(); server.close(); onClose(); };
  const expiry = setTimeout(stop, 60 * 60 * 1000);
  return { info: { url: `http://${acceptedHost}/#${token}`, expiresMinutes: 60, mode: '同一局域网' }, stop,
    publish: data => { for (const ws of clients) if (ws.readyState === 1) ws.send(JSON.stringify(data)); } };
}

module.exports = { install, createPairRoom, isPrivateIPv4 };
