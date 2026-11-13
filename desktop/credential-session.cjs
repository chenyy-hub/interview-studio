'use strict';

// Launching the app must not unlock the macOS login keychain. Credentials are
// memory-only unless the user explicitly chooses encrypted persistence.
function attach(manager) {
  if (manager.studioCredentialSession) return manager.studioCredentialSession;
  const initialize = manager.init.bind(manager);
  const save = manager.saveCredentials.bind(manager);
  const storageStatus = manager.getStorageStatus.bind(manager);
  const write = manager.writeCredentials.bind(manager);
  let encrypted = false;
  const memoryStatus = () => ({ mode: 'locked', reason: '当前凭证仅供本次运行使用，退出后不保存；已保存的凭证尚未载入。可在中文工作台主动启用系统加密保存。' });
  manager.init = () => {
    if (encrypted) return initialize();
    manager.scrubbed = false;
    manager.storageStatus = memoryStatus();
    manager.persistedCredentials = structuredClone(manager.credentials);
  };
  manager.getStorageStatus = () => encrypted ? storageStatus() : memoryStatus();
  manager.saveCredentials = () => {
    if (manager.scrubbed) throw new Error('应用已退出，无法保存凭证');
    if (encrypted) return save();
    // Preserve the upstream setter/rollback contract without writing any key.
    manager.persistedCredentials = structuredClone(manager.credentials);
  };
  manager.writeCredentials = (file, useEncryption) => {
    if (!useEncryption) throw new Error('无法使用系统加密，未将 API Key 写入磁盘。可继续选择仅本次使用。');
    return write(file, true);
  };
  const session = {
    state: () => ({ mode: encrypted ? 'encrypted' : 'memory' }),
    enableEncrypted() {
      if (encrypted) return session.state();
      const current = structuredClone(manager.credentials);
      const previous = { persisted: manager.persistedCredentials, blocked: manager.saveBlocked, status: manager.storageStatus };
      try {
        initialize();
        if (storageStatus().mode !== 'encrypted') throw new Error('系统加密未解锁。当前继续仅在本次运行中使用 API Key。');
        manager.credentials = { ...manager.credentials, ...current };
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
  Object.defineProperty(manager, 'studioCredentialSession', { value: session });
  return session;
}

module.exports = { attach };
