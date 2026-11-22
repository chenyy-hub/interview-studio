'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');

const root = path.resolve(process.argv[2]);
const binary = path.join(root, 'InterviewStudio.exe');
const archive = path.join(root, 'resources/app.asar');
assert.ok(fs.existsSync(binary), 'Windows executable is missing');
const result = spawnSync(binary, ['--studio-launch-check'], { windowsHide: true, encoding: 'utf8', timeout: 30000 });
assert.equal(result.status, 0, (result.stderr || '') + (result.error?.message || ''));
assert.match(result.stdout || '', /STUDIO_LAUNCH_CHECK_OK/);
const windowResult = spawnSync(binary, ['--studio-window-check'], { windowsHide: true, encoding: 'utf8', timeout: 45000 });
assert.equal(windowResult.status, 0, (windowResult.stdout || '') + (windowResult.stderr || '') + (windowResult.error?.message || ''));
assert.match(windowResult.stdout || '', /STUDIO_WINDOW_CHECK_OK/);
assert.match(windowResult.stdout || '', /STUDIO_FLOATING_CHECK_OK/);
const featureResult = spawnSync(binary, ['--studio-upgrade-check'], { windowsHide: true, encoding: 'utf8', timeout: 45000,
  env: { ...process.env, STUDIO_ALLOW_OCR_UNAVAILABLE: process.env.STUDIO_REQUIRE_LOCAL_OCR === '1' ? '0' : '1' } });
assert.equal(featureResult.status, 0, (featureResult.stdout || '') + (featureResult.stderr || '') + (featureResult.error?.message || ''));
assert.match(featureResult.stdout || '', /STUDIO_UPGRADE_CHECK_OK/);
const runtimeResult = spawnSync(binary, ['--studio-runtime-check'], { windowsHide: true, encoding: 'utf8', timeout: 30000 });
assert.equal(runtimeResult.status, 0, (runtimeResult.stdout || '') + (runtimeResult.stderr || '') + (runtimeResult.error?.message || ''));
assert.match(runtimeResult.stdout || '', /STUDIO_RUNTIME_CHECK_OK/);
const native = spawnSync(binary, [path.join(__dirname, 'runtime-smoke.cjs'), archive, path.join(__dirname, '../test-fixtures')], {
  windowsHide: true, encoding: 'utf8', timeout: 45000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
});
assert.equal(native.status, 0, (native.stdout || '') + (native.stderr || '') + (native.error?.message || ''));
const report = { platform: process.platform, arch: process.arch, nativeBrowserStartup: 'passed', packagedDependencies: 'passed', windowControls: 'passed: real native launcher maximize/restore, minimize and close', floatingRenderer: 'passed: actual preload/CSP, uniform group opacity, unchanged hover/focus, explicit editing and font with synthetic state',
  workbenchFeatures: 'passed: keyboard controls, task drafts and explicit image mode', nativeHandlers: 'passed: real IPC and hidden-window recovery',
  localOCR: /STUDIO_LOCAL_OCR=passed/.test(featureResult.stdout) ? 'passed' : 'unavailable on build host; synthetic UI fixture only',
  audioCapture: 'not tested with actual devices', meetingSharingPrivacy: 'not tested in Feishu or Tencent Meeting',
  stdout: native.stdout, at: new Date().toISOString() };
fs.writeFileSync(path.join(root, '../windows-verification.json'), JSON.stringify(report, null, 2));
console.log('Windows packaged browser startup, real window controls and native dependency smoke passed');
