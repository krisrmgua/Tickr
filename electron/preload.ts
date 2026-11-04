import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("tickr", {
  getState: () => ipcRenderer.invoke("tickr:getState"),
  addSymbol: (symbol: string) => ipcRenderer.invoke("tickr:addSymbol", symbol),
  removeSymbol: (symbol: string) => ipcRenderer.invoke("tickr:removeSymbol", symbol),
  openNews: (symbol: string) => ipcRenderer.invoke("tickr:openNews", symbol),
  refresh: () => ipcRenderer.invoke("tickr:refresh"),
  setPrefs: (patch: unknown) => ipcRenderer.invoke("tickr:setPrefs", patch),
  saveDailystocker: (input: unknown) => ipcRenderer.invoke("tickr:saveDailystocker", input),
  setMode: (mode: string) => ipcRenderer.invoke("tickr:setMode", mode),
  setOpenAtLogin: (value: boolean) => ipcRenderer.invoke("tickr:setOpenAtLogin", value),
  onChanged: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on("tickr:changed", handler);
    return () => ipcRenderer.removeListener("tickr:changed", handler);
  },
  hide: () => ipcRenderer.invoke("tickr:hide"),
  quit: () => ipcRenderer.invoke("tickr:quit"),
  fitHeight: (height: number) => ipcRenderer.invoke("tickr:fitHeight", height),
});
