'use strict';
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function recognizeImage(filename) {
  if (process.platform !== 'win32') return Promise.reject(new Error('本机 OCR 当前支持 Windows；其他平台可选择支持图片的模型'));
  const script = fs.readFileSync(path.join(__dirname, 'windows-ocr.ps1'), 'utf8');
  const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  return new Promise((resolve, reject) => {
    execFile(executable, ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true, timeout: 30000, maxBuffer: 512 * 1024, encoding: 'utf8',
      env: { ...process.env, STUDIO_OCR_IMAGE: filename },
    }, (error, stdout) => {
      if (error) return reject(new Error('本机文字识别失败，请裁剪图片后重试，或使用支持图片的模型'));
      try {
        const result = JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
        if (!result.text?.trim()) throw new Error();
        resolve({ text: result.text.trim(), language: result.language, engine: 'Windows OCR' });
      } catch { reject(new Error('没有识别到清晰文字，请裁剪题目区域后重试')); }
    });
  });
}
module.exports = { recognizeImage };
