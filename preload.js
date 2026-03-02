const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  getTableConfig: () => ipcRenderer.invoke("get-table-config"),
  getOwners: (tableName) => ipcRenderer.invoke("get-owners", tableName),
  getVehicles: (tableName, owner) => ipcRenderer.invoke("get-vehicles", tableName, owner),
  updateExpiry: (tableName, ids, newValue) => ipcRenderer.invoke("update-expiry", tableName, ids, newValue),
  updateStatus: (tableName, ids, newStatus) => ipcRenderer.invoke("update-status", tableName, ids, newStatus),
  testConnection: () => ipcRenderer.invoke("test-connection"),
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),

  onUpdateAvailable: (cb) => ipcRenderer.on("update-available", (_e, version) => cb(version)),
  onUpdateNotAvailable: (cb) => ipcRenderer.on("update-not-available", () => cb()),
  onUpdateDownloadProgress: (cb) => ipcRenderer.on("update-download-progress", (_e, percent) => cb(percent)),
  onUpdateDownloaded: (cb) => ipcRenderer.on("update-downloaded", () => cb()),
  onUpdateError: (cb) => ipcRenderer.on("update-error", (_e, msg) => cb(msg)),
  downloadUpdate: () => ipcRenderer.invoke("update-download"),
  installUpdate: () => ipcRenderer.invoke("update-install"),
  checkForUpdate: () => ipcRenderer.invoke("update-check"),
});
