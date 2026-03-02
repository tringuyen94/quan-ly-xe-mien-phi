const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  getTableConfig: () => ipcRenderer.invoke("get-table-config"),
  getOwners: (tableName) => ipcRenderer.invoke("get-owners", tableName),
  getVehicles: (tableName, owner) => ipcRenderer.invoke("get-vehicles", tableName, owner),
  updateExpiry: (tableName, ids, newValue) => ipcRenderer.invoke("update-expiry", tableName, ids, newValue),
  updateStatus: (tableName, ids, newStatus) => ipcRenderer.invoke("update-status", tableName, ids, newStatus),
  testConnection: () => ipcRenderer.invoke("test-connection"),
});
