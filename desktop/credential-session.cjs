'use strict';

// Normal app launches use the explicit account-local vault without unlocking
// the login keychain. Omitting a directory keeps the legacy memory-only mode.
function attach(manager, { directory } = {}) {
  if (manager.studioCredentialSession) return manager.studioCredentialSession;
  const initialize = manager.init.bind(manager);
  const save = manager.saveCredentials.bind(manager);
  const storageStatus = manager.getStorageStatus.bind(manager);
  const write = manager.writeCredentials.bind(manager);
  const clearAll = manager.clearAll?.bind(manager);
  const vault = directory ? require('./local-vault.cjs').createVault(directory) : null;
  let localError = '';
  let encrypted = false;
  const memoryStatus = () => ({ mode: 'locked', reason: '当前凭证仅供本次运行使用，退出后不保存；已保存的凭证尚未载入。可在中文工作台主动启用系统加密保存。' });
  manager.init = () => {
    if (vault) {
      manager.scrubbed = false;
      try { manager.credentials = vault.load(); localError = ''; }
      catch (error) { localError = error.message; }
      manager.persistedCredentials = structuredClone(manager.credentials);
      return;
    }
    if (encrypted) return initialize();
    manager.scrubbed = false;
    manager.storageStatus = memoryStatus();
    manager.persistedCredentials = structuredClone(manager.credentials);
  };
  manager.getStorageStatus = () => vault ? { mode: localError ? 'locked' : 'local', reason: localError || '保存在本机用户目录；同一系统账户可读取加密密钥。' } : encrypted ? storageStatus() : memoryStatus();
  manager.saveCredentials = () => {
    if (manager.scrubbed) throw new Error('应用已退出，无法保存凭证');
    if (vault) {
      try {
        if (localError) throw new Error(localError);
        vault.save(manager.credentials);
        manager.persistedCredentials = structuredClone(manager.credentials);
      } catch (error) { manager.credentials = structuredClone(manager.persistedCredentials || {}); throw error; }
      return;
    }
    if (encrypted) return save();
    // Preserve the upstream setter/rollback contract without writing any key.
    manager.persistedCredentials = structuredClone(manager.credentials);
  };
  manager.writeCredentials = (file, useEncryption) => {
    if (!useEncryption) throw new Error('无法使用系统加密，未将 API Key 写入磁盘。可继续选择仅本次使用。');
    return write(file, true);
  };
  const session = {
    state: () => ({ mode: vault ? 'local' : encrypted ? 'encrypted' : 'memory', ...(localError ? { error: localError } : {}) }),
    clearLocal() {
      if (!vault) throw new Error('本地保存未启用');
      vault.clear(); localError = ''; manager.credentials = {}; manager.persistedCredentials = {}; manager.scrubbed = false;
      return session.state();
    },
    enableEncrypted() {
      if (encrypted) return session.state();
      const current = structuredClone(manager.credentials);
      const previous = { persisted: manager.persistedCredentials, blocked: manager.saveBlocked, status: manager.storageStatus };
      try {
        initialize();
        if (storageStatus().mode !== 'encrypted') throw new Error('系统加密未解锁。当前继续仅在本次运行中使用 API Key。');
        manager.credentials = { ...manager.credentials, ...current };
        if (vault) {
          vault.save(manager.credentials);
          localError = ''; manager.persistedCredentials = structuredClone(manager.credentials);
          return session.state();
        }
        // save() retains upstream atomic-write and verification protections.
        save();
        encrypted = true;
        return session.state();
      } catch (error) {
        manager.credentials = current;
        manager.persistedCredentials = previous.persisted;
        manager.saveBlocked = previous.blocked;
        manager.storageStatus = previous.status;
        throw error;
      }
    },
  };
  if (vault && clearAll) manager.clearAll = () => { clearAll(); session.clearLocal(); };
  Object.defineProperty(manager, 'studioCredentialSession', { value: session });
  return session;
}

module.exports = { attach };
