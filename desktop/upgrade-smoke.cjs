'use strict';
async function run() {
  const { app, BrowserWindow, ipcMain, nativeImage } = require('electron');
  const path = require('node:path'), fs = require('node:fs'), assert = require('node:assert/strict');
  const imagePath = path.join(app.getPath('userData'), 'ocr-fixture.png');
  fs.copyFileSync(path.join(__dirname, 'ocr-fixture.png'), imagePath);
  const state = { platform: 'win32', appVersion: '0.8.7', speech: { configured: false },
    permissions: {}, credentialStorage: { mode: 'local' }, transcripts: [], preparation: {},
    transcription: { mode: 'auto', silenceMs: 30000, paused: false }, appearance: {}, preferences: {} };
  const imported = { path: imagePath, preview: nativeImage.createFromPath(imagePath).toDataURL() };
  let pauseCalls = 0, finishCalls = 0;
  ipcMain.handle('studio:status', () => state);
  ipcMain.handle('studio:transcription-pause', (_, input) => { pauseCalls++; state.transcription.paused = input.paused; return { success: true }; });
  ipcMain.handle('studio:transcription-finish', () => { finishCalls++; return { success: true }; });
  ipcMain.handle('studio:image-import', () => imported);
  ipcMain.handle('studio:records', () => [{ task: 'written', question: '历史练习题：12 + 30', answers: { quick: '42' }, date: 'synthetic', model: 'fixture' }]);
  ipcMain.handle('get-recent-meetings', () => []);
  ipcMain.handle('studio:capture', () => ({ cancelled: true }));
  let ocrAvailable = true, ocrGate = null;
  ipcMain.handle('studio:image-recognize', async () => {
    if (ocrGate) await ocrGate;
    try { return await require('./local-ocr.cjs').recognizeImage(imagePath); }
    catch (error) {
      if (process.env.STUDIO_ALLOW_OCR_UNAVAILABLE !== '1') throw error;
      ocrAvailable = false;
      return { text: 'Synthetic OCR fixture: 12 + 30; 32, 42, 52', engine: 'fixture' };
    }
  });
  const win = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false } });
  const failures = [];
  win.webContents.on('console-message', details => { if (details.level === 'error') failures.push(details.message); });
  await win.loadFile(path.join(__dirname, 'index.html'));
  async function until(expression) {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      if (await win.webContents.executeJavaScript(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    throw new Error('UI fixture timed out: ' + expression);
  }
  await until("document.querySelector('#app-version').textContent.includes('0.8.7')");
  assert.equal(await win.webContents.executeJavaScript("document.querySelector('#transcription-mode').value"), '30000');
  state.sessionActive = true;
  await win.webContents.executeJavaScript("window.dispatchEvent(new Event('focus'))");
  await until("!document.querySelector('#pause-transcription').disabled");
  assert.match(await win.webContents.executeJavaScript("document.querySelector('#status').textContent"), /系统声音（对方）.*我的麦克风关闭/);
  await win.webContents.executeJavaScript("document.dispatchEvent(new KeyboardEvent('keydown', {key:'p',ctrlKey:true,shiftKey:true,bubbles:true,isComposing:true}))");
  assert.equal(pauseCalls, 0, 'IME composition must not invoke a shortcut');
  await win.webContents.executeJavaScript("document.dispatchEvent(new KeyboardEvent('keydown', {key:'p',ctrlKey:true,shiftKey:true,bubbles:true}))");
  await until("document.querySelector('#pause-transcription').textContent === '继续转写'");
  assert.equal(pauseCalls, 1);
  await win.webContents.executeJavaScript("document.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter',ctrlKey:true,shiftKey:true,bubbles:true}))");
  await until("document.querySelector('#notice').textContent.includes('已提交确认的文字')");
  assert.equal(finishCalls, 1);
  await win.webContents.executeJavaScript("document.querySelector('[data-view=written]').click()");
  assert.deepEqual(await win.webContents.executeJavaScript("({ title: document.querySelector('#task-title').textContent, controls: !document.querySelector('#written-controls').hidden, transcript: getComputedStyle(document.querySelector('.work-grid > .card')).display })"), { title: '笔试助手', controls: true, transcript: 'none' });
  await win.webContents.executeJavaScript("document.querySelector('#import-question-image').click()");
  await until("document.querySelectorAll('#attachments img').length === 1");
  await win.webContents.executeJavaScript("document.querySelector('#recognize-question').click()");
  await until("document.querySelector('#question').value.includes('42')");
  const recognized = await win.webContents.executeJavaScript("document.querySelector('#question').value");
  assert.ok(recognized.includes('30') && recognized.includes('32'));
  assert.equal(await win.webContents.executeJavaScript("document.querySelector('#written-input-mode').value"), 'text');
  await win.webContents.executeJavaScript("document.querySelector('[data-view=interview]').click()");
  assert.equal(await win.webContents.executeJavaScript("document.querySelector('#question').value"), '');
  assert.equal(await win.webContents.executeJavaScript("document.querySelectorAll('#attachments img').length"), 0);
  await win.webContents.executeJavaScript("document.querySelector('[data-view=written]').click()");
  assert.equal(await win.webContents.executeJavaScript("document.querySelector('#question').value"), recognized);
  let releaseOCR;
  ocrGate = new Promise(resolve => { releaseOCR = resolve; });
  await win.webContents.executeJavaScript("document.querySelector('#recognize-question').click()");
  await until("document.querySelector('#recognize-question').disabled");
  assert.equal(await win.webContents.executeJavaScript("document.querySelector('#ask').disabled && document.querySelector('#import-question-image').disabled && document.querySelector('[data-remove-image]').disabled"), true);
  await win.webContents.executeJavaScript("document.querySelector('[data-view=interview]').click()");
  await until("document.querySelector('#notice').textContent.includes('图片处理')");
  assert.equal(await win.webContents.executeJavaScript("document.querySelector('#task-title').textContent"), '笔试助手');
  await win.webContents.executeJavaScript("document.querySelector('#question').value = '用户手工校对后的题目'");
  releaseOCR(); ocrGate = null;
  await until("document.querySelector('#notice').textContent.includes('未覆盖')");
  assert.equal(await win.webContents.executeJavaScript("document.querySelector('#question').value"), '用户手工校对后的题目');
  assert.equal(await win.webContents.executeJavaScript("document.querySelector('#ask').disabled || document.querySelector('#recognize-question').disabled"), false);
  await win.webContents.executeJavaScript("document.querySelector('#capture').click()");
  await until("!document.querySelector('#capture').disabled");
  assert.equal(await win.webContents.executeJavaScript("document.querySelectorAll('#attachments img').length"), 1);
  await win.webContents.executeJavaScript("document.querySelector('[data-view=records]').click()");
  await until("!!document.querySelector('[data-answer]')");
  await win.webContents.executeJavaScript("document.querySelector('[data-answer]').click()");
  await until("document.querySelector('#question').value === '历史练习题：12 + 30'");
  assert.equal(await win.webContents.executeJavaScript("document.querySelectorAll('#attachments img').length"), 0);
  assert.match(await win.webContents.executeJavaScript("document.querySelector('#notice').textContent"), /重新附加/);
  assert.equal(failures.length, 0, failures.join('\n'));
  win.destroy();
  console.log('STUDIO_LOCAL_OCR=' + (ocrAvailable ? 'passed' : 'unavailable; explicit synthetic UI fixture used'));
  console.log('STUDIO_UPGRADE_CHECK_OK: real renderer/preload/CSP, 30s default, keyboard controls, isolated drafts, local OCR, pending-operation guard, preserved manual edits, capture cancellation and history recovery; synthetic IPC state, no cloud model or actual screen capture');
}
module.exports = { run };
