const { app, BrowserWindow, Menu, ipcMain, dialog, protocol, net } = require("electron");
const { autoUpdater } = require("electron-updater");
const log = require("electron-log");
const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");
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

// Thư mục gốc ảnh cổng — máy Windows ở chợ map share \\192.168.10.101\imgs
// THẲNG thành ổ Y: (file nằm ở Y:\<YYMMDD>\..., KHÔNG có tầng \imgs).
// Cấu trúc: <IMG_ROOT>\<YYMMDD>\<id lượt vào><số camera>.jpg
// Override bằng IMG_ROOT trong .env nếu máy nào map khác. Giữ dấu \ cuối:
// "Y:" không có \ là đường dẫn tương-đối-theo-ổ, trỏ sai chỗ.
const IMG_ROOT = process.env.IMG_ROOT || "Y:\\";

// Scheme phục vụ ảnh cho renderer — phải đăng ký trước app ready
protocol.registerSchemesAsPrivileged([
  { scheme: "imgx", privileges: { standard: true, stream: true } },
]);

function registerImgProtocol() {
  protocol.handle("imgx", (request) => {
    // imgx://img/<YYMMDD>/<tên file>.jpg
    const u = new URL(request.url);
    const rel = decodeURIComponent(u.pathname).replace(/^\//, "");
    const safe = /^[0-9]{6}\/[0-9A-Za-z]+\.jpg$/i.test(rel);
    const full = path.join(IMG_ROOT, rel);
    if (!safe || !path.normalize(full).startsWith(path.normalize(IMG_ROOT))) {
      return new Response("Forbidden", { status: 403 });
    }
    return net.fetch(pathToFileURL(full).toString());
  });
}

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
  tblKhachHang: {
    idCol: "maKhachHang",
    displayCols: ["maKhachHang", "ho", "ten", "tenCuaHang", "ghiChu"],
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
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "Sửa",
        submenu: [
          { role: "undo", label: "Hoàn tác" },
          { role: "redo", label: "Làm lại" },
          { type: "separator" },
          { role: "cut", label: "Cắt" },
          { role: "copy", label: "Sao chép" },
          { role: "paste", label: "Dán" },
          { role: "selectAll", label: "Chọn tất cả" },
        ],
      },
    ])
  );

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

ipcMain.handle("get-next-customer-id", async () => {
  try {
    const db = await getPool();
    const result = await db.request().query(`
      DECLARE @next INT = ISNULL((
        SELECT MAX(TRY_CAST(maKhachHang AS INT))
        FROM tblKhachHang
        WHERE TRY_CAST(maKhachHang AS INT) BETWEEN 1 AND 9999
      ), 0) + 1;
      WHILE EXISTS (SELECT 1 FROM tblKhachHang WHERE maKhachHang = CAST(@next AS NVARCHAR(50)))
        SET @next = @next + 1;
      SELECT @next AS nextId;
    `);
    return { nextId: result.recordset[0].nextId };
  } catch (err) {
    console.error("GET NEXT CUSTOMER ID ERROR:", err.message);
    return { nextId: null };
  }
});

ipcMain.handle("search-customers", async (_event, searchQuery) => {
  try {
    const db = await getPool();
    const q = (searchQuery || "").trim();
    const result = await db
      .request()
      .input("q", sql.NVarChar, `%${q}%`)
      .query(
        `SELECT TOP 50 maKhachHang, ho, ten, tenCuaHang
         FROM tblKhachHang
         WHERE ho LIKE @q OR ten LIKE @q OR tenCuaHang LIKE @q
            OR CAST(maKhachHang AS NVARCHAR) LIKE @q
         ORDER BY maKhachHang`
      );
    return result.recordset;
  } catch (err) {
    console.error("SEARCH CUSTOMERS ERROR:", err.message);
    throw err;
  }
});

ipcMain.handle("insert-customer", async (_event, data) => {
  try {
    const ho = (data?.ho || "").trim();
    const ten = (data?.ten || "").trim();
    const tenCuaHang = (data?.tenCuaHang || "").trim();
    const ghiChu = (data?.ghiChu || "").trim();
    const cmnd = (data?.cmnd || "").trim();
    const diaChi = (data?.diaChi || "").trim();

    if (!ho) return { success: false, message: "Vui lòng nhập Họ" };
    if (!ten) return { success: false, message: "Vui lòng nhập Tên" };
    if (!tenCuaHang) return { success: false, message: "Vui lòng nhập Tên cửa hàng / ô vựa" };

    const db = await getPool();
    const result = await db
      .request()
      .input("ho", sql.NVarChar, ho)
      .input("ten", sql.NVarChar, ten)
      .input("cmnd", sql.Char, cmnd)
      .input("tenCuaHang", sql.NVarChar, tenCuaHang)
      .input("diaChi", sql.NVarChar, diaChi)
      .input("ghiChu", sql.NVarChar, ghiChu)
      .query(`
        BEGIN TRANSACTION;
        DECLARE @next INT = ISNULL((
          SELECT MAX(TRY_CAST(maKhachHang AS INT))
          FROM tblKhachHang WITH (TABLOCKX, HOLDLOCK)
          WHERE TRY_CAST(maKhachHang AS INT) BETWEEN 1 AND 9999
        ), 0) + 1;
        WHILE EXISTS (SELECT 1 FROM tblKhachHang WHERE maKhachHang = CAST(@next AS NVARCHAR(50)))
          SET @next = @next + 1;
        INSERT INTO tblKhachHang (maKhachHang, ho, ten, cmnd, tenCuaHang, diaChi, ghiChu)
        OUTPUT INSERTED.maKhachHang
        VALUES (CAST(@next AS NVARCHAR(50)), @ho, @ten, @cmnd, @tenCuaHang, @diaChi, @ghiChu);
        COMMIT TRANSACTION;
      `);
    const maKhachHang = result.recordset?.[0]?.maKhachHang;
    return { success: true, maKhachHang };
  } catch (err) {
    console.error("INSERT CUSTOMER ERROR:", err.message);
    return { success: false, message: err.message };
  }
});

ipcMain.handle("insert-vehicle", async (_event, data) => {
  try {
    const tableName = data?.tableName;
    validateTable(tableName);

    const bienSo = (data?.bienSo || "").trim();
    const maKhachHang = data?.maKhachHang;
    const ngayHieuLuc = data?.ngayHieuLuc ? new Date(data.ngayHieuLuc) : new Date();
    const ngayHetHan = data?.ngayHetHan ? new Date(data.ngayHetHan) : null;
    const ghiChu = (data?.ghiChu || "").trim();
    const trangThai = data?.trangThai;

    if (!bienSo) return { success: false, message: "Biển số không được trống" };
    if (!maKhachHang) return { success: false, message: "Chưa chọn khách hàng" };
    if (!ngayHetHan) return { success: false, message: "Ngày hết hạn không được trống" };
    if (!trangThai) return { success: false, message: "Chưa chọn trạng thái" };

    const db = await getPool();

    const dup = await db
      .request()
      .input("bienSo", sql.NVarChar, bienSo)
      .query(`SELECT COUNT(*) AS c FROM [${tableName}] WHERE bienSo = @bienSo`);
    if (dup.recordset[0].c > 0) {
      return { success: false, message: `Biển số "${bienSo}" đã tồn tại` };
    }

    await db
      .request()
      .input("bienSo", sql.NVarChar, bienSo)
      .input("maKhachHang", sql.NVarChar, String(maKhachHang))
      .input("ngayHieuLuc", sql.Date, ngayHieuLuc)
      .input("ngayHetHan", sql.Date, ngayHetHan)
      .input("ghiChu", sql.NVarChar, ghiChu)
      .input("trangThai", sql.Int, parseInt(trangThai, 10))
      .query(
        `INSERT INTO [${tableName}] (bienSo, maKhachHang, ngayHieuLuc, ngayHetHan, ghiChu, trangThai)
         VALUES (@bienSo, @maKhachHang, @ngayHieuLuc, @ngayHetHan, @ghiChu, @trangThai)`
      );
    return { success: true };
  } catch (err) {
    console.error("INSERT VEHICLE ERROR:", err.message);
    return { success: false, message: err.message };
  }
});

ipcMain.handle("update-vehicle", async (_event, data) => {
  try {
    const tableName = data?.tableName;
    validateTable(tableName);
    const bienSo = (data?.bienSo || "").trim();
    if (!bienSo) return { success: false, message: "Thiếu biển số" };

    const maKhachHang = data?.maKhachHang;
    const ngayHieuLuc = data?.ngayHieuLuc ? new Date(data.ngayHieuLuc) : null;
    const ngayHetHan = data?.ngayHetHan ? new Date(data.ngayHetHan) : null;
    const ghiChu = (data?.ghiChu || "").trim();
    const trangThai = data?.trangThai;

    if (!maKhachHang) return { success: false, message: "Chưa chọn khách hàng" };
    if (!ngayHetHan) return { success: false, message: "Ngày hết hạn trống" };
    if (!ngayHieuLuc) return { success: false, message: "Ngày hiệu lực trống" };
    if (!trangThai) return { success: false, message: "Chưa chọn trạng thái" };
    if (!ghiChu) return { success: false, message: "Ghi chú (cột group) trống" };

    const db = await getPool();
    const result = await db
      .request()
      .input("bienSo", sql.NVarChar, bienSo)
      .input("maKhachHang", sql.NVarChar, String(maKhachHang))
      .input("ngayHieuLuc", sql.Date, ngayHieuLuc)
      .input("ngayHetHan", sql.Date, ngayHetHan)
      .input("ghiChu", sql.NVarChar, ghiChu)
      .input("trangThai", sql.Int, parseInt(trangThai, 10))
      .query(
        `UPDATE [${tableName}]
         SET maKhachHang = @maKhachHang,
             ngayHieuLuc = @ngayHieuLuc,
             ngayHetHan = @ngayHetHan,
             ghiChu = @ghiChu,
             trangThai = @trangThai
         WHERE bienSo = @bienSo`
      );
    if (result.rowsAffected[0] === 0) {
      return { success: false, message: "Không tìm thấy xe " + bienSo };
    }
    return { success: true };
  } catch (err) {
    console.error("UPDATE VEHICLE ERROR:", err.message);
    return { success: false, message: err.message };
  }
});

ipcMain.handle("delete-vehicle", async (_event, tableName, bienSo) => {
  try {
    validateTable(tableName);
    if (!bienSo) return { success: false, message: "Thiếu biển số" };
    const db = await getPool();
    const result = await db
      .request()
      .input("bienSo", sql.NVarChar, bienSo)
      .query(`DELETE FROM [${tableName}] WHERE bienSo = @bienSo`);
    return { success: true, affected: result.rowsAffected[0] };
  } catch (err) {
    console.error("DELETE VEHICLE ERROR:", err.message);
    return { success: false, message: err.message };
  }
});

ipcMain.handle("list-customers", async (_event, searchQuery) => {
  try {
    const db = await getPool();
    const q = (searchQuery || "").trim();
    if (!q) {
      const r = await db.request().query(
        `SELECT maKhachHang, ho, ten, cmnd, tenCuaHang, diaChi, ghiChu
         FROM tblKhachHang
         ORDER BY TRY_CAST(maKhachHang AS INT), maKhachHang`
      );
      return r.recordset;
    }
    const r = await db
      .request()
      .input("q", sql.NVarChar, `%${q}%`)
      .query(
        `SELECT TOP 200 maKhachHang, ho, ten, cmnd, tenCuaHang, diaChi, ghiChu
         FROM tblKhachHang
         WHERE ho LIKE @q OR ten LIKE @q OR tenCuaHang LIKE @q OR diaChi LIKE @q
            OR CAST(maKhachHang AS NVARCHAR) LIKE @q OR cmnd LIKE @q
         ORDER BY TRY_CAST(maKhachHang AS INT), maKhachHang`
      );
    return r.recordset;
  } catch (err) {
    console.error("LIST CUSTOMERS ERROR:", err.message);
    throw err;
  }
});

ipcMain.handle("update-customer", async (_event, data) => {
  try {
    const maKhachHang = String(data?.maKhachHang || "").trim();
    if (!maKhachHang) return { success: false, message: "Thiếu mã KH" };

    const ho = (data?.ho || "").trim();
    const ten = (data?.ten || "").trim();
    const tenCuaHang = (data?.tenCuaHang || "").trim();
    const cmnd = (data?.cmnd || "").trim();
    const diaChi = (data?.diaChi || "").trim();
    const ghiChu = (data?.ghiChu || "").trim();

    if (!ho) return { success: false, message: "Vui lòng nhập Họ" };
    if (!ten) return { success: false, message: "Vui lòng nhập Tên" };
    if (!tenCuaHang) return { success: false, message: "Vui lòng nhập Tên cửa hàng" };

    const db = await getPool();
    const result = await db
      .request()
      .input("maKhachHang", sql.NVarChar, maKhachHang)
      .input("ho", sql.NVarChar, ho)
      .input("ten", sql.NVarChar, ten)
      .input("cmnd", sql.Char, cmnd)
      .input("tenCuaHang", sql.NVarChar, tenCuaHang)
      .input("diaChi", sql.NVarChar, diaChi)
      .input("ghiChu", sql.NVarChar, ghiChu)
      .query(
        `UPDATE tblKhachHang
         SET ho = @ho, ten = @ten, cmnd = @cmnd,
             tenCuaHang = @tenCuaHang, diaChi = @diaChi, ghiChu = @ghiChu
         WHERE maKhachHang = @maKhachHang`
      );
    if (result.rowsAffected[0] === 0) {
      return { success: false, message: "Không tìm thấy KH #" + maKhachHang };
    }
    return { success: true };
  } catch (err) {
    console.error("UPDATE CUSTOMER ERROR:", err.message);
    return { success: false, message: err.message };
  }
});

ipcMain.handle("delete-customer", async (_event, maKhachHang) => {
  try {
    const id = String(maKhachHang || "").trim();
    if (!id) return { success: false, message: "Thiếu mã KH" };

    const db = await getPool();
    const refCheck = await db
      .request()
      .input("id", sql.NVarChar, id)
      .query(`SELECT COUNT(*) AS c FROM tblXeMienPhi WHERE maKhachHang = @id`);
    if (refCheck.recordset[0].c > 0) {
      return {
        success: false,
        message: `KH #${id} đang có ${refCheck.recordset[0].c} xe — xóa xe trước hoặc chuyển KH`,
      };
    }

    const result = await db
      .request()
      .input("id", sql.NVarChar, id)
      .query(`DELETE FROM tblKhachHang WHERE maKhachHang = @id`);
    if (result.rowsAffected[0] === 0) {
      return { success: false, message: "Không tìm thấy KH #" + id };
    }
    return { success: true };
  } catch (err) {
    console.error("DELETE CUSTOMER ERROR:", err.message);
    return { success: false, message: err.message };
  }
});

// ---- Thống kê nhập chợ (xe ba gác / biển nội bộ) ----
// Chỉ đếm các biển có đăng ký trong tblXeMienPhi để gắn được với khách hàng.
// Xe ba gác không có lượt RA qua làn kiểm soát nên chỉ quét tblXeVaoCho.

ipcMain.handle("get-bagac-ranking", async (_event, fromDate, toDate) => {
  try {
    const db = await getPool();
    const result = await db
      .request()
      .input("from", sql.Date, new Date(fromDate))
      .input("to", sql.Date, new Date(toDate))
      .query(`
        SELECT TOP 100
          v.bienSo,
          COUNT(*)                   AS soLuot,
          COUNT(DISTINCT v.lanXeVao) AS soLan,
          MAX(v.ngayGioVao)          AS luotGanNhat,
          mp.maKhachHang, kh.ho, kh.ten, kh.tenCuaHang
        FROM tblXeVaoCho v
        JOIN tblXeMienPhi mp ON mp.bienSo = v.bienSo
        LEFT JOIN tblKhachHang kh ON kh.maKhachHang = mp.maKhachHang
        WHERE v.ngayGioVao >= @from AND v.ngayGioVao < DATEADD(day, 1, @to)
          -- Chỉ lấy ba gác/xe nội bộ: loại biển VN chuẩn (xe tải/ô tô)
          -- = 2 số + 1-2 chữ + 4-5 số, cùng regex với detect-fake-plates.js
          AND NOT (
            RTRIM(v.bienSo) LIKE '[0-9][0-9][A-Z][0-9][0-9][0-9][0-9]'
            OR RTRIM(v.bienSo) LIKE '[0-9][0-9][A-Z][0-9][0-9][0-9][0-9][0-9]'
            OR RTRIM(v.bienSo) LIKE '[0-9][0-9][A-Z][A-Z][0-9][0-9][0-9][0-9]'
            OR RTRIM(v.bienSo) LIKE '[0-9][0-9][A-Z][A-Z][0-9][0-9][0-9][0-9][0-9]'
          )
        GROUP BY v.bienSo, mp.maKhachHang, kh.ho, kh.ten, kh.tenCuaHang
        ORDER BY COUNT(*) DESC
      `);
    return result.recordset;
  } catch (err) {
    console.error("GET BAGAC RANKING ERROR:", err.message);
    throw err;
  }
});

ipcMain.handle("get-bagac-entries", async (_event, bienSo, fromDate, toDate) => {
  try {
    const db = await getPool();
    const result = await db
      .request()
      .input("bienSo", sql.NVarChar, String(bienSo || "").trim())
      .input("from", sql.Date, new Date(fromDate))
      .input("to", sql.Date, new Date(toDate))
      .query(`
        SELECT TOP 500 v.ngayGioVao, v.lanXeVao, v.bienSoNhanDang, v.loaive,
               v.maNhanVienLanvao,
               LTRIM(RTRIM(CONCAT(nv.ho, ' ', nv.ten))) AS tenNhanVien
        FROM tblXeVaoCho v
        LEFT JOIN tblNhanVien nv ON nv.maNhanVien = v.maNhanVienLanvao
        WHERE v.bienSo = @bienSo
          AND v.ngayGioVao >= @from AND v.ngayGioVao < DATEADD(day, 1, @to)
        ORDER BY v.ngayGioVao DESC
      `);
    return result.recordset;
  } catch (err) {
    console.error("GET BAGAC ENTRIES ERROR:", err.message);
    throw err;
  }
});

// Ảnh các lượt vào của 1 biển: phân trang mới nhất trước, mỗi lượt quét
// tối đa 8 hậu tố camera (<id>1.jpg .. <id>8.jpg) xem file nào tồn tại.
ipcMain.handle("get-bagac-images", async (_event, bienSo, fromDate, toDate, offset, limit) => {
  try {
    const db = await getPool();
    const result = await db
      .request()
      .input("bienSo", sql.NVarChar, String(bienSo || "").trim())
      .input("from", sql.Date, new Date(fromDate))
      .input("to", sql.Date, new Date(toDate))
      .input("offset", sql.Int, Math.max(0, parseInt(offset, 10) || 0))
      .input("limit", sql.Int, Math.min(20, parseInt(limit, 10) || 6))
      .query(`
        SELECT COUNT(*) AS total FROM tblXeVaoCho
        WHERE bienSo = @bienSo AND ngayGioVao >= @from AND ngayGioVao < DATEADD(day, 1, @to);
        SELECT id, ngayGioVao, lanXeVao FROM tblXeVaoCho
        WHERE bienSo = @bienSo AND ngayGioVao >= @from AND ngayGioVao < DATEADD(day, 1, @to)
        ORDER BY ngayGioVao DESC
        OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY;
      `);
    const total = result.recordsets[0][0].total;
    const entries = [];
    for (const r of result.recordsets[1]) {
      const id = String(r.id).trim();
      const folder = id.substring(2, 8); // id = Làn(2) + YYMMDD(6) + HHMMSS(6)
      const images = [];
      for (let cam = 1; cam <= 8; cam++) {
        const file = `${id}${cam}.jpg`;
        try {
          await fs.promises.access(path.join(IMG_ROOT, folder, file));
          images.push(`${folder}/${file}`);
        } catch (_) {}
      }
      entries.push({ id, ngayGioVao: r.ngayGioVao, lanXeVao: r.lanXeVao, images });
    }
    return { total, entries };
  } catch (err) {
    console.error("GET BAGAC IMAGES ERROR:", err.message);
    throw err;
  }
});

// Dùng dialog.showMessageBox thay cho window.confirm() ở renderer:
// confirm()/alert() native trên Windows làm cửa sổ mất focus/chuột
// sau khi đóng dialog (bug Electron đã biết).
ipcMain.handle("confirm-dialog", async (event, { title, message, detail }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showMessageBox(win, {
    type: "warning",
    title: title || "Xác nhận",
    message: message || "",
    detail: detail || "",
    buttons: ["Xóa", "Hủy"],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  });
  return result.response === 0;
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
// false: KHÔNG tự cài silent (/S) khi user đóng app — silent install với
// assisted installer (oneClick: false) fail âm thầm → app relaunch bản cũ.
// Đường cài duy nhất là bấm nút "Cài đặt" → quitAndInstall(false) hiện wizard.
autoUpdater.autoInstallOnAppQuit = false;
// Ghi log updater ra file để chẩn đoán khi lỗi trên máy user:
// Windows: %AppData%\quan-ly-xe\logs\main.log
autoUpdater.logger = log;
log.transports.file.level = "info";

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

ipcMain.handle("update-install", async () => {
  if (pool) {
    await Promise.race([
      pool.close().catch(() => {}),
      new Promise((r) => setTimeout(r, 2000)),
    ]);
    pool = null;
  }
  BrowserWindow.getAllWindows().forEach((w) => {
    try { w.removeAllListeners("close"); w.destroy(); } catch (_) {}
  });
  try { app.releaseSingleInstanceLock(); } catch (_) {}
  // isSilent=false → wizard hiện ra cho user click Next (oneClick: false yêu cầu);
  // silent install qua /S flag suppress wizard → install fail âm thầm, app
  // relaunch lại version cũ → loop "đã có phiên bản mới".
  setImmediate(() => autoUpdater.quitAndInstall(false, true));
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
    registerImgProtocol();
    mainWindow = createWindow();
    setupAutoUpdater(mainWindow);
  });

  app.on("window-all-closed", async () => {
    if (pool) {
      await Promise.race([
        pool.close().catch(() => {}),
        new Promise((r) => setTimeout(r, 2000)),
      ]);
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
