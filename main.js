const { app, BrowserWindow, ipcMain } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");
const sql = require("mssql");

const isProd = app.isPackaged;

const envPath = isProd
  ? path.join(process.resourcesPath, ".env")
  : path.join(__dirname, ".env");
require("dotenv").config({ path: envPath });

if (!isProd) {
  try {
    require("electron-reload")(path.join(__dirname, "renderer"), {
      electron: path.join(__dirname, "node_modules", ".bin", "electron"),
    });
  } catch (_) {}
}

const dbConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  port: parseInt(process.env.DB_PORT, 10) || 1433,
  database: process.env.DB_DATABASE,
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
};

let pool = null;

async function getPool() {
  if (pool) return pool;
  pool = await sql.connect(dbConfig);
  return pool;
}

const TABLE_CONFIG = {
  tblXeMienPhi: {
    idCol: "bienSo",
    ownerCol: "ghiChu",
    displayCols: ["bienSo", "trangThai", "ngayHieuLuc", "ngayHetHan", "maKhachHang"],
    expiryType: "date",
    expiryCol: "ngayHetHan",
    statusCol: "trangThai",
  },
};

const ALLOWED_TABLES = Object.keys(TABLE_CONFIG);

function validateTable(tableName) {
  if (!ALLOWED_TABLES.includes(tableName)) {
    throw new Error(`Bang khong hop le: ${tableName}`);
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: "Quan Ly Xe - Cho Thu Duc",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, "renderer", "index.html"));

  if (!isProd) {
    win.webContents.openDevTools({ mode: "detach" });
  }

  return win;
}

// ---- IPC Handlers ----

ipcMain.handle("get-table-config", () => {
  return TABLE_CONFIG;
});

ipcMain.handle("get-owners", async (_event, tableName) => {
  validateTable(tableName);
  const cfg = TABLE_CONFIG[tableName];
  const db = await getPool();
  const result = await db.request().query(
    `SELECT DISTINCT [${cfg.ownerCol}] AS owner
     FROM [${tableName}]
     WHERE [${cfg.ownerCol}] IS NOT NULL AND [${cfg.ownerCol}] != ''
     ORDER BY [${cfg.ownerCol}]`
  );
  return result.recordset.map((r) => r.owner);
});

ipcMain.handle("get-vehicles", async (_event, tableName, owner) => {
  validateTable(tableName);
  const cfg = TABLE_CONFIG[tableName];
  const db = await getPool();
  const result = await db
    .request()
    .input("owner", sql.NVarChar, owner)
    .query(
      `SELECT ${cfg.displayCols.map((c) => `[${c}]`).join(", ")}
       FROM [${tableName}]
       WHERE [${cfg.ownerCol}] = @owner
       ORDER BY [${cfg.idCol}]`
    );
  return result.recordset;
});

ipcMain.handle("search-vehicles", async (_event, tableName, searchQuery) => {
  validateTable(tableName);
  const cfg = TABLE_CONFIG[tableName];
  const db = await getPool();
  const cols = cfg.displayCols.includes(cfg.ownerCol)
    ? cfg.displayCols
    : [cfg.ownerCol, ...cfg.displayCols];
  const result = await db
    .request()
    .input("q", sql.NVarChar, `%${searchQuery}%`)
    .query(
      `SELECT ${cols.map((c) => `[${c}]`).join(", ")}
       FROM [${tableName}]
       WHERE [${cfg.idCol}] LIKE @q
       ORDER BY [${cfg.idCol}]`
    );
  return result.recordset;
});

ipcMain.handle("update-expiry", async (_event, tableName, ids, newValue) => {
  try {
    validateTable(tableName);
    const cfg = TABLE_CONFIG[tableName];
    const db = await getPool();

    const idList = ids.map((_, i) => `@id${i}`).join(", ");
    const req = db.request().input("newDate", sql.Date, new Date(newValue));
    ids.forEach((id, i) => req.input(`id${i}`, sql.NVarChar, id));
    const q = `UPDATE [${tableName}] SET [${cfg.expiryCol}] = @newDate WHERE [${cfg.idCol}] IN (${idList})`;
    console.log("SQL:", q, "| ids:", ids, "| date:", newValue);
    const result = await req.query(q);
    return { affected: result.rowsAffected[0] };
  } catch (err) {
    console.error("UPDATE ERROR:", err.message);
    throw err;
  }
});

ipcMain.handle("update-status", async (_event, tableName, ids, newStatus) => {
  try {
    validateTable(tableName);
    const cfg = TABLE_CONFIG[tableName];
    if (!cfg.statusCol) {
      throw new Error("Bang nay khong ho tro cap nhat trang thai");
    }
    const db = await getPool();
    const idList = ids.map((_, i) => `@id${i}`).join(", ");
    const req = db.request().input("newStatus", sql.Int, newStatus);
    ids.forEach((id, i) => req.input(`id${i}`, sql.NVarChar, id));
    const q = `UPDATE [${tableName}] SET [${cfg.statusCol}] = @newStatus WHERE [${cfg.idCol}] IN (${idList})`;
    console.log("SQL:", q, "| ids:", ids, "| status:", newStatus);
    const result = await req.query(q);
    return { affected: result.rowsAffected[0] };
  } catch (err) {
    console.error("UPDATE STATUS ERROR:", err.message);
    throw err;
  }
});

ipcMain.handle("get-app-version", () => {
  return app.getVersion();
});

ipcMain.handle("test-connection", async () => {
  try {
    await getPool();
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// ---- Auto Updater ----

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

function setupAutoUpdater(win) {
  autoUpdater.on("update-available", (info) => {
    win.webContents.send("update-available", info.version);
  });

  autoUpdater.on("update-not-available", () => {
    win.webContents.send("update-not-available");
  });

  autoUpdater.on("download-progress", (progress) => {
    win.webContents.send("update-download-progress", Math.round(progress.percent));
  });

  autoUpdater.on("update-downloaded", () => {
    win.webContents.send("update-downloaded");
  });

  autoUpdater.on("error", (err) => {
    win.webContents.send("update-error", err.message);
  });

  if (isProd) {
    autoUpdater.checkForUpdates().catch(() => {});
  }
}

ipcMain.handle("update-download", () => {
  autoUpdater.downloadUpdate();
});

ipcMain.handle("update-install", () => {
  autoUpdater.quitAndInstall(false, true);
});

ipcMain.handle("update-check", () => {
  autoUpdater.checkForUpdates().catch(() => {});
});

// ---- App lifecycle (Single Instance) ----

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  let mainWindow = null;

  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    mainWindow = createWindow();
    setupAutoUpdater(mainWindow);
  });

  app.on("window-all-closed", async () => {
    if (pool) {
      await pool.close();
      pool = null;
    }
    app.quit();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });
}
