const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopApp", {
  isDesktop: true,
  getInfo: () => ipcRenderer.invoke("desktop:get-info"),
  openDirectory: (directoryKind) => ipcRenderer.invoke("desktop:open-directory", directoryKind),
  chooseRuntimeDirectory: () => ipcRenderer.invoke("desktop:choose-runtime"),
});
