// Appended to the upstream sandboxed preload at packaging time.
const studioElectron = require('electron');
studioElectron.contextBridge.exposeInMainWorld('studio', {
  invoke: (name, data) => {
    const allowed = ['status','start','transcription-settings','transcription-pause','transcription-finish','meeting-compatibility','image-import','image-recognize','audio-devices','audio-preferences','capture-permission','speech-test','doubao-config','performance','appearance','floating','preparation','document-text','privacy','privacy-test','hide','credentials-enable','credentials-clear','preferences','capture','ask','cancel','import','documents','export','records','pair-start','pair-stop','original','settings'];
    if (!allowed.includes(name)) return Promise.reject(new Error('Unsupported action'));
    return studioElectron.ipcRenderer.invoke('studio:' + name, data);
  },
  onEvent: callback => {
    const listener = (_event, data) => callback(data);
    studioElectron.ipcRenderer.on('studio:event', listener);
    return () => studioElectron.ipcRenderer.removeListener('studio:event', listener);
  },
});
