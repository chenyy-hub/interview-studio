'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');

const root = path.resolve(process.argv[2]);
const binary = path.join(root, 'InterviewStudio.exe');
const archive = path.join(root, 'resources/app.asar');
assert.ok(fs.existsSync(binary), 'Windows executable is missing');
const result = spawnSync(binary, ['--studio-launch-check'], { encoding: 'utf8', timeout: 30000 });
assert.equal(result.status, 0, (result.stderr || '') + (result.error?.message || ''));
assert.match(result.stdout || '', /STUDIO_LAUNCH_CHECK_OK/);
const windowResult = spawnSync(binary, ['--studio-window-check'], { encoding: 'utf8', timeout: 45000 });
assert.equal(windowResult.status, 0, (windowResult.stdout || '') + (windowResult.stderr || '') + (windowResult.error?.message || ''));
assert.match(windowResult.stdout || '', /STUDIO_WINDOW_CHECK_OK/);
assert.match(windowResult.stdout || '', /STUDIO_FLOATING_CHECK_OK/);
const native = spawnSync(binary, [path.join(__dirname, 'runtime-smoke.cjs'), archive, path.join(__dirname, '../test-fixtures')], {
  encoding: 'utf8', timeout: 45000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
});
assert.equal(native.status, 0, (native.stdout || '') + (native.stderr || '') + (native.error?.message || ''));
const report = { platform: process.platform, arch: process.arch, nativeBrowserStartup: 'passed', packagedDependencies: 'passed', windowControls: 'passed: real native launcher maximize/restore, minimize and close', floatingRenderer: 'passed: actual preload, CSP, zero background and independent text opacity/font with synthetic state',
  audioCapture: 'not tested with actual devices', meetingSharingPrivacy: 'not tested in Feishu or Tencent Meeting',
  stdout: native.stdout, at: new Date().toISOString() };
fs.writeFileSync(path.join(root, '../windows-verification.json'), JSON.stringify(report, null, 2));
console.log('Windows packaged browser startup, real window controls and native dependency smoke passed');
