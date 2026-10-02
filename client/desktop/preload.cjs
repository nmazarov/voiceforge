const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("voiceforgeDesktop", {
  isDesktop: true,
  platform: process.platform,
  version: "1.1.0",
  getScreenSources: () => ipcRenderer.invoke("vf:get-screen-sources"),
  selectScreenSource: (id) => ipcRenderer.invoke("vf:select-screen-source", id),
});
