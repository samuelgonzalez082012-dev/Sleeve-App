/**
 * The preload script runs before `index.html` is loaded
 * in the renderer. It has access to web APIs as well as
 * Electron's renderer process modules and some polyfilled
 * Node.js functions.
 *
 * https://www.electronjs.org/docs/latest/tutorial/sandbox
 */
const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  splitStems: (filePath) => ipcRenderer.invoke('stems:split', filePath),
  onStemsProgress: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('stems:progress', listener)
    return () => ipcRenderer.removeListener('stems:progress', listener)
  },
  checkStemEngine: () => ipcRenderer.invoke('stems:check-engine'),
  convertToMp3: (filePath) => ipcRenderer.invoke('stems:convert-to-mp3', filePath),
  findExistingStems: (filePath) => ipcRenderer.invoke('stems:find-existing', filePath),
findExistingStemsForSource: (filePath) =>
  ipcRenderer.invoke('stems:find-existing-for-source', filePath),
verifyStems: (stems) => ipcRenderer.invoke('stems:verify', stems),
  showItemInFolder: (path) => ipcRenderer.invoke('shell:show-in-folder', path),
  getPathForFile: (file) => webUtils.getPathForFile(file),
})

window.addEventListener('DOMContentLoaded', () => {
  const replaceText = (selector, text) => {
    const element = document.getElementById(selector)
    if (element) element.innerText = text
  }
  for (const type of ['chrome', 'node', 'electron']) {
    replaceText(`${type}-version`, process.versions[type])
  }
})