const { contextBridge, ipcRenderer } = require('electron');

const call = (name) => (...args) => ipcRenderer.invoke(name, ...args);
contextBridge.exposeInMainWorld('psmcp', {
  state: call('state'),
  connect: call('connect'),
  disconnect: call('disconnect'),
  copyJson: call('copyJson'),
  doctor: call('doctor'),
  activity: call('activity'),
  gallery: call('gallery'),
  checkpoints: call('checkpoints'),
  reveal: call('reveal'),
  open: call('open'),
  openExternal: call('openExternal'),
  openPhotoshop: call('openPhotoshop'),
  pause: call('pause'),
  history: call('history'),
  settings: call('settings'),
  onChange: (fn) => ipcRenderer.on('activity:changed', () => fn()),
  onTab: (fn) => ipcRenderer.on('ui:tab', (_e, tab) => fn(tab)),
});
