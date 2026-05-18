#!/usr/bin/env node
/**
 * Renumber toàn bộ maKhachHang trong tblKhachHang về dạng 1..N liên tục.
 * Đồng thời update tblXeMienPhi.maKhachHang theo mapping.
 *
 * Sắp xếp: numeric ASC trước, non-numeric (vd 'O2-24') xếp cuối.
 *
 * Cách dùng:
 *   node scripts/renumber-customers.js --dry-run   # In mapping, không UPDATE
 *   node scripts/renumber-customers.js --apply     # Backup + UPDATE thật
 *
 * ⚠️ Phải đóng app quan-ly-xe trước khi chạy --apply để tránh race.
 */

const path = require("path");
const fs = require("fs");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const sql = require("mssql");

const DRY_RUN = process.argv.includes("--dry-run");
const APPLY = process.argv.includes("--apply");

if (!DRY_RUN && !APPLY) {
  console.log("Usage: node scripts/renumber-customers.js --dry-run | --apply");
  process.exit(1);
}
if (DRY_RUN && APPLY) {
  console.log("Chọn 1 trong 2 flag: --dry-run hoặc --apply, không cả hai.");
  process.exit(1);
}

const dbConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  port: parseInt(process.env.DB_PORT, 10) || 1433,
  database: process.env.DB_DATABASE,
  options: { encrypt: false, trustServerCertificate: true },
  connectionTimeout: 15000,
  requestTimeout: 120000,
};

const ORDER_BY_SQL = `
  CASE WHEN TRY_CAST(maKhachHang AS INT) IS NULL THEN 1 ELSE 0 END,
  TRY_CAST(maKhachHang AS INT),
  maKhachHang
`;

const ORPHAN_SQL = `
  SELECT COUNT(*) AS c FROM tblXeMienPhi x
  WHERE x.maKhachHang IS NOT NULL AND x.maKhachHang != ''
    AND NOT EXISTS (SELECT 1 FROM tblKhachHang k WHERE k.maKhachHang = x.maKhachHang)
`;

function tsTag() {
  const d = new Date();
  return (
    d.getFullYear().toString() +
    String(d.getMonth() + 1).padStart(2, "0") +
    String(d.getDate()).padStart(2, "0") +
    "_" +
    String(d.getHours()).padStart(2, "0") +
    String(d.getMinutes()).padStart(2, "0")
  );
}

(async () => {
  let pool;
  try {
    pool = await sql.connect(dbConfig);
    console.log("✓ Kết nối DB OK\n");

    // 1. Preview mapping
    const mapResult = await pool.request().query(`
      SELECT maKhachHang AS oldId,
             ROW_NUMBER() OVER (ORDER BY ${ORDER_BY_SQL}) AS newId
      FROM tblKhachHang
    `);
    const total = mapResult.recordset.length;
    console.log(`Tổng KH: ${total} → sẽ renumber 1..${total}\n`);

    const head = mapResult.recordset.slice(0, 5);
    const tail = mapResult.recordset.slice(-5);
    const changed = mapResult.recordset.filter((r) => String(r.oldId) !== String(r.newId));
    console.log(`Số dòng thay đổi: ${changed.length}/${total}`);
    console.log("Mapping (5 đầu):", head);
    console.log("Mapping (5 cuối):", tail);

    // 2. Pre-check orphans
    const preOrphan = (await pool.request().query(ORPHAN_SQL)).recordset[0].c;
    console.log(`\nPre-check: ${preOrphan} xe có maKhachHang không khớp KH nào (orphan, sẽ KHÔNG bị ảnh hưởng).`);

    if (DRY_RUN) {
      console.log("\n[DRY-RUN] Không UPDATE gì. Chạy lại với --apply để thực thi.");
      return;
    }

    // 3. Backup ra file JSON local (không dùng SELECT INTO vì có thể không có quyền CREATE TABLE)
    const tag = tsTag();
    const backupDir = path.join(__dirname, "..", "backups");
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
    const bakKhFile = path.join(backupDir, `tblKhachHang_${tag}.json`);
    const bakXeFile = path.join(backupDir, `tblXeMienPhi_${tag}.json`);

    console.log(`\n[APPLY] Backup ra file JSON...`);
    const allKh = (await pool.request().query(`SELECT * FROM tblKhachHang`)).recordset;
    fs.writeFileSync(bakKhFile, JSON.stringify(allKh, null, 2), "utf8");
    console.log(`  ✓ ${bakKhFile} (${allKh.length} rows)`);

    const allXe = (await pool.request().query(`SELECT * FROM tblXeMienPhi`)).recordset;
    fs.writeFileSync(bakXeFile, JSON.stringify(allXe, null, 2), "utf8");
    console.log(`  ✓ ${bakXeFile} (${allXe.length} rows)`);

    console.log(`\n[APPLY] Bắt đầu transaction UPDATE...`);
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      const req = new sql.Request(tx);

      // 3b. Build #map
      await req.batch(`
        SELECT maKhachHang AS oldId,
               ROW_NUMBER() OVER (ORDER BY ${ORDER_BY_SQL}) AS newId
        INTO #map FROM tblKhachHang;
      `);

      // 3c. Update tblKhachHang với TMP- prefix
      const r1 = await req.batch(`
        UPDATE k SET maKhachHang = 'TMP-' + CAST(m.newId AS NVARCHAR(50))
        FROM tblKhachHang k JOIN #map m ON k.maKhachHang = m.oldId;
        SELECT @@ROWCOUNT AS n;
      `);
      console.log(`  ✓ Phase 1: ${r1.recordset[0].n} KH updated (TMP- prefix)`);

      // 3d. Update tblXeMienPhi theo mapping
      const r2 = await req.batch(`
        UPDATE x SET maKhachHang = CAST(m.newId AS NVARCHAR(50))
        FROM tblXeMienPhi x JOIN #map m ON x.maKhachHang = m.oldId;
        SELECT @@ROWCOUNT AS n;
      `);
      console.log(`  ✓ Phase 2: ${r2.recordset[0].n} xe updated`);

      // 3e. Strip TMP- prefix
      const r3 = await req.batch(`
        UPDATE tblKhachHang SET maKhachHang = SUBSTRING(maKhachHang, 5, LEN(maKhachHang) - 4)
        WHERE maKhachHang LIKE 'TMP-%';
        SELECT @@ROWCOUNT AS n;
      `);
      console.log(`  ✓ Phase 3: ${r3.recordset[0].n} KH strip prefix`);

      await req.batch(`DROP TABLE #map`);

      // 3f. Post-check orphan
      const postOrphan = (await req.query(ORPHAN_SQL)).recordset[0].c;
      console.log(`  Post-check orphan: ${postOrphan} (trước: ${preOrphan})`);

      if (postOrphan > preOrphan) {
        throw new Error(
          `Số xe orphan TĂNG sau renumber (${preOrphan} → ${postOrphan}). Rollback.`
        );
      }

      await tx.commit();
      console.log(`\n✅ COMMIT thành công. Backup JSON:`);
      console.log(`   ${bakKhFile}`);
      console.log(`   ${bakXeFile}`);
      console.log(`\nVerify bằng SSMS:`);
      console.log(`  SELECT MIN(TRY_CAST(maKhachHang AS INT)), MAX(TRY_CAST(maKhachHang AS INT)), COUNT(*) FROM tblKhachHang;`);
      console.log(`  -- mong đợi: 1, ${total}, ${total}`);
    } catch (err) {
      console.error(`\n❌ LỖI trong transaction: ${err.message}`);
      console.error(`  Đang rollback...`);
      try {
        await tx.rollback();
        console.error(`  ✓ Rollback xong. DB không bị thay đổi.`);
      } catch (rbErr) {
        console.error(`  ⚠️ Rollback fail: ${rbErr.message}`);
      }
      process.exit(2);
    }
  } catch (err) {
    console.error("LỖI:", err.message);
    process.exit(1);
  } finally {
    if (pool) await pool.close();
  }
})();
