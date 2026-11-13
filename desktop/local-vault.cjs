'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');

// This is account-local storage, not an OS keychain. The encryption key is in
// the same private directory; programs with access to this account can read it.
function createVault(directory) {
  const file = path.join(directory, 'connections.enc');
  const keyFile = path.join(directory, 'device.key');
  const key = create => {
    if (create) {
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      if (process.platform !== 'win32') fs.chmodSync(directory, 0o700);
      if (!fs.existsSync(keyFile)) {
        if (fs.existsSync(file)) throw new Error('missing key');
        fs.writeFileSync(keyFile, crypto.randomBytes(32), { flag: 'wx', mode: 0o600 });
      }
    }
    const stat = fs.lstatSync(keyFile);
    if (!stat.isFile() || stat.size !== 32) throw new Error('invalid key');
    return fs.readFileSync(keyFile);
  };
  const decode = data => {
    const envelope = JSON.parse(data);
    if (envelope.version !== 1) throw new Error('unknown vault format');
    const iv = Buffer.from(envelope.iv, 'base64'), tag = Buffer.from(envelope.tag, 'base64');
    if (iv.length !== 12 || tag.length !== 16) throw new Error('invalid envelope');
    const cipher = crypto.createDecipheriv('aes-256-gcm', key(false), iv);
    cipher.setAuthTag(tag);
    const value = JSON.parse(Buffer.concat([cipher.update(Buffer.from(envelope.data, 'base64')), cipher.final()]).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid configuration');
    return value;
  };
  return {
    load() {
      try {
        if (!fs.existsSync(file)) return {};
        if (!fs.lstatSync(file).isFile() || fs.statSync(file).size > 2097152) throw new Error('invalid file');
        return decode(fs.readFileSync(file, 'utf8'));
      } catch { throw new Error('本地服务配置无法读取，原文件已保留。请恢复备份或在设置中清除后重新填写。'); }
    },
    save(value) {
      let temporary;
      try {
        const plaintext = JSON.stringify(value);
        if (Buffer.byteLength(plaintext) > 1048576) throw new Error('configuration too large');
        const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key(true), iv);
        const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
        const envelope = JSON.stringify({ version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') });
        if (!isDeepStrictEqual(decode(envelope), JSON.parse(plaintext))) throw new Error('verification failed');
        temporary = file + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
        fs.writeFileSync(temporary, envelope, { flag: 'wx', mode: 0o600 });
        fs.renameSync(temporary, file);
      } catch { throw new Error('本地服务配置保存失败，已有配置未被覆盖。请检查磁盘空间和用户目录权限。'); }
      finally { if (temporary && fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    },
    clear() { for (const target of [file, keyFile]) if (fs.existsSync(target)) fs.unlinkSync(target); },
  };
}

module.exports = { createVault };
