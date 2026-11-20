const { contextBridge, ipcRenderer } = require('electron');
const fixture = require('./fixture.cjs');
const state = structuredClone(fixture.state);
let changed;
const notify = () => { if (changed) changed(structuredClone(state)); };
const noOp = async () => ({ ok: true });
const api = {
  getState: async () => structuredClone(state),
  addSymbol: noOp,
  removeSymbol: noOp,
  openNews: noOp,
  refresh: async () => structuredClone(state),
  setPrefs: async patch => { Object.assign(state.prefs, patch); notify(); return structuredClone(state); },
  setOpenAtLogin: noOp,
  onChanged: callback => { changed = callback; return () => {}; },
  hide: noOp,
  quit: noOp,
  fitHeight: async height => ipcRenderer.send('capture:fit', fixture.width, height),
};
ipcRenderer.on('capture:update', (_event, patch) => { Object.assign(state, patch); notify(); });
contextBridge.exposeInMainWorld(fixture.bridge, api);
window.addEventListener('error', event => ipcRenderer.send('capture:error', event.message));
window.addEventListener('unhandledrejection', event => ipcRenderer.send('capture:error', String(event.reason)));
