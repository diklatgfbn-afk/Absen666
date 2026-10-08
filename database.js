const Database = require('better-sqlite3');
const path = require('path');
const XLSX = require('xlsx');

const dbPath = path.join(__dirname, 'absensi.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─────────────────────────────────────────────
// CREATE TABLES (no potongan columns)
// ─────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL DEFAULT 'password123',
    role TEXT CHECK(role IN ('admin','karyawan')) NOT NULL DEFAULT 'karyawan',
    full_name TEXT NOT NULL,
    shift_group TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS attendance_daily (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_name TEXT NOT NULL,
    month TEXT NOT NULL DEFAULT '2024-06',
    day_number INTEGER NOT NULL,
    day_name TEXT,
    check_in TEXT,
    check_out TEXT,
    shift_detected TEXT,
    late_minutes INTEGER DEFAULT 0,
    status TEXT,
    imported_at TEXT DEFAULT (datetime('now')),
    UNIQUE(employee_name, day_number, month)
  );

  CREATE TABLE IF NOT EXISTS attendance_recap (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_name TEXT NOT NULL,
    month TEXT NOT NULL DEFAULT '2024-06',
    days_recorded INTEGER DEFAULT 0,
    days_on_time INTEGER DEFAULT 0,
    days_late_toleransi INTEGER DEFAULT 0,
    days_late_potongan INTEGER DEFAULT 0,
    days_early_leave INTEGER DEFAULT 0,
    days_no_checkin INTEGER DEFAULT 0,
    days_no_checkout INTEGER DEFAULT 0,
    total_late_minutes INTEGER DEFAULT 0,
    no_schedule INTEGER DEFAULT 0,
    imported_at TEXT DEFAULT (datetime('now')),
    UNIQUE(employee_name, month)
  );

  CREATE TABLE IF NOT EXISTS import_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    month TEXT NOT NULL,
    total_employees INTEGER,
    total_records INTEGER,
    imported_at TEXT DEFAULT (datetime('now'))
  );

  DROP TABLE IF EXISTS leave_balance;
  DROP TABLE IF EXISTS leave_history;
  DROP TABLE IF EXISTS leave_applications;
  DROP TABLE IF EXISTS notifications;
  DROP TABLE IF EXISTS announcements;

  CREATE TABLE IF NOT EXISTS leave_balance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_name TEXT UNIQUE NOT NULL,
    total_days INTEGER NOT NULL DEFAULT 12,
    used_days INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS leave_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_name TEXT NOT NULL,
    days_used INTEGER NOT NULL DEFAULT 1,
    reason TEXT,
    used_at TEXT DEFAULT (datetime('now'))
  );

  -- Leave Applications (pengajuan izin/cuti/sakit)
  CREATE TABLE IF NOT EXISTS leave_applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_name TEXT NOT NULL,
    application_type TEXT NOT NULL CHECK(application_type IN ('izin','cuti','sakit')),
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    reason TEXT,
    screenshot_path TEXT,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
    admin_note TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  -- Notifications
  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    message TEXT,
    target_role TEXT DEFAULT 'all' CHECK(target_role IN ('all','admin','karyawan')),
    type TEXT DEFAULT 'info' CHECK(type IN ('info','warning','success')),
    is_read INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- Announcements (pengumuman admin)
  CREATE TABLE IF NOT EXISTS announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// ─────────────────────────────────────────────
// REUSABLE IMPORT FUNCTION
// ─────────────────────────────────────────────

const SHIFT_GROUPS = {
  'A': ['WAKIT','LISNA','WULAN','YUNITA','GUPITA','PRISCA','WASIS','PUJI','RAHMAN','RIKA','ANJAS','SHARA','RIFAH','DIKA','TYAS','MARUF','AZMI','dhila','endah','huda','rizky','zulfi'],
  'B': ['PRAS','cesar'],
  'C': ['MAYA','CITRA','ROSSY','fifi','FARDA','SITA','devi','jihan','PUPUT','FINA','LINA','wulan n','nur'],
};

function getShiftGroup(name) {
  for (const [g, members] of Object.entries(SHIFT_GROUPS)) {
    if (members.some(m => m.toLowerCase() === name.toLowerCase())) return g;
  }
  return 'Unknown';
}

function importFromExcel(filePath, month) {
  const wb = XLSX.readFile(filePath);

  // Find the recap and detail sheets
  const sheetNames = wb.SheetNames;
  let recapSheetName = sheetNames.find(n => n.toLowerCase().includes('rekap') && n.toLowerCase().includes('karyawan'));
  let detailSheetName = sheetNames.find(n => n.toLowerCase().includes('detail') || n.toLowerCase().includes('harian'));

  if (!recapSheetName) recapSheetName = sheetNames.find(n => n.toLowerCase().includes('rekap'));
  if (!detailSheetName) detailSheetName = sheetNames.find(n => n.toLowerCase().includes('detail') || n.toLowerCase().includes('harian'));

  if (!recapSheetName && !detailSheetName) {
    return { success: false, error: 'Sheet "Rekap" atau "Detail" tidak ditemukan' };
  }

  const result = { success: true, employees: 0, records: 0, month };

  db.transaction(() => {
    // Delete old data for this month
    db.prepare('DELETE FROM attendance_daily WHERE month = ?').run(month);
    db.prepare('DELETE FROM attendance_recap WHERE month = ?').run(month);
    db.prepare('DELETE FROM import_history WHERE month = ?').run(month);

    // Process recap sheet (creates users + recap data)
    if (recapSheetName) {
      const recapData = XLSX.utils.sheet_to_json(wb.Sheets[recapSheetName]);

      const insertUser = db.prepare('INSERT OR IGNORE INTO users (username, password, role, full_name, shift_group) VALUES (?, ?, ?, ?, ?)');
      const insertRecap = db.prepare(`
        INSERT OR IGNORE INTO attendance_recap (employee_name, month, days_recorded, days_on_time, days_late_toleransi, days_late_potongan, days_early_leave, days_no_checkin, days_no_checkout, total_late_minutes, no_schedule)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      let empCount = 0;
      recapData.forEach(r => {
        const name = r['Nama'];
        if (!name || name === 'TOTAL POTONGAN SEMUA KARYAWAN') return;

        empCount++;
        const group = getShiftGroup(name);
        insertUser.run(name.toLowerCase().replace(/\s+/g, '.'), 'password123', 'karyawan', name, group);

        insertRecap.run(
          name, month,
          r['Hari Tercatat'] || 0,
          r['Hari Tepat Waktu'] || 0,
          r['Hari Telat (Toleransi)'] || 0,
          r['Hari Telat (Kena Potongan)'] || 0,
          r['Hari Pulang Cepat'] || 0,
          r['Hari Tanpa Absen Masuk'] || 0,
          r['Hari Tanpa Absen Pulang'] || 0,
          r['Total Menit Telat'] || 0,
          r['Tanpa Jadwal'] || 0
        );
      });
      result.employees = empCount;
    }

    // Process detail sheet
    if (detailSheetName) {
      const detailData = XLSX.utils.sheet_to_json(wb.Sheets[detailSheetName]);
      const insertDaily = db.prepare(`
        INSERT OR IGNORE INTO attendance_daily (employee_name, month, day_number, day_name, check_in, check_out, shift_detected, late_minutes, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      let recCount = 0;
      detailData.forEach(r => {
        insertDaily.run(
          r['Nama'], month,
          r['Tanggal'],
          r['Hari'],
          r['Jam Masuk'] || null,
          r['Jam Pulang'] || null,
          r['Shift Terdeteksi'],
          r['Menit Telat'] || 0,
          r['Status']
        );
        recCount++;
      });
      result.records = recCount;
    }

    // Insert import history
    db.prepare('INSERT INTO import_history (filename, month, total_employees, total_records) VALUES (?, ?, ?, ?)')
      .run(path.basename(filePath), month, result.employees, result.records);
  })();

  return result;
}

// ─────────────────────────────────────────────
// SEED: Import existing Excel on first run
// ─────────────────────────────────────────────

// Seed admin user if not exists
const adminUser = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
if (!adminUser) {
  db.prepare('INSERT INTO users (username, password, role, full_name) VALUES (?, ?, ?, ?)')
    .run('admin', 'admin123', 'admin', 'Administrator');
  console.log('Admin user created: admin / admin123');
}

const userCount = db.prepare('SELECT COUNT(*) as cnt FROM users WHERE role = ?').get('karyawan').cnt;
if (userCount === 0) {
  console.log('First run: importing Excel data...');
  const excelPath = path.join(__dirname, '..', 'Absensi', 'Hasil_Rekap_Absensi.xlsx');
  try {
    const r = importFromExcel(excelPath, '2024-06');
    console.log(`Imported: ${r.employees} employees, ${r.records} daily records for ${r.month}`);
  } catch (e) {
    console.error('Import error:', e.message);
  }
}

module.exports = db;
module.exports.importFromExcel = importFromExcel;
