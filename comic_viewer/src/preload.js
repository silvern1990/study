const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('viewer', {
  readPage: (i) => ipcRenderer.invoke('read-page', i),
  openDialog: () => ipcRenderer.invoke('open-dialog'),
  openFile: (file) => ipcRenderer.send('open-path', webUtils.getPathForFile(file)),
  toggleFullscreen: () => ipcRenderer.send('toggle-fullscreen'),
  on: (channel, cb) => {
    if (['opened', 'loading', 'error'].includes(channel)) {
      ipcRenderer.on(channel, (_e, payload) => cb(payload));
    }
  },
});
