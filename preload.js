const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bsEditor', {
  selectArchive: () => ipcRenderer.invoke('dialog:selectArchive'),
  selectSave: () => ipcRenderer.invoke('dialog:selectSave'),
  loadArchive: (archivePath) => ipcRenderer.invoke('archive:load', archivePath),
  loadSave: (savePath) => ipcRenderer.invoke('save:load', savePath),
  writeSave: (savePath, patch) => ipcRenderer.invoke('save:write', savePath, patch),
  openPath: (targetPath) => ipcRenderer.invoke('open:path', targetPath)
});
