const { Pool } = require('pg');
const path = require('path');
const XLSX = require('xlsx');

// PostgreSQL connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 10, // Adjust based on your needs
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Helper to execute queries and release client
async function query(text, params) {
  const client = await pool.connect();
  try {
    const res = await client.query(text, params);
    return res;
  } finally {
    client.release();
  }
}

// Wrapper for better-sqlite3 style usage (prepare + run/get/all)
const db = {
  // prepare returns a statement object with run/get/all methods
  prepare(sql) {
    return {
      run(...params) {
        return query(sql, params).then(res => ({
          changes: res.rowCount,
          lastInsertRowid: res.rows[0]?.id || null
        }));
      },
      get(...params) {
        return query(sql, params).then(res => res.rows[0] || null);
      },
      all(...params) {
        return query(sql, params).then(res => res.rows);
      }
    };
  },
  // exec for multiple statements (DDL)
  exec(sql) {
    return query(sql, []).then(() => {});
  },
  // transaction: run a series of queries in a transaction
  transaction(fn) {
    return async function(...args) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const wrappedClient = {
          prepare(sql) {
            return {
              run(...params) {
                return client.query(sql, params).then(res => ({
                  changes: res.rowCount,
                  lastInsertRowid: res.rows[0]?.id || null
                }));
              },
              get(...params) {
                return client.query(sql, params).then(res => res.rows[0] || null);
              },
              all(...params) {
                return client.query(sql, params).then(res => res.rows);
              }
            };
          }
        };
        const result = await fn(wrappedClient, ...args);
        await client.query('COMMIT');
        return result;
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    };
  }
};

// Import function (adapted from SQLite version)
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

async function importFromExcel(filePath, month) {
  const wb = XLSX.readFile(filePath);
  const sheetNames = wb.SheetNames;
  let recapSheetName = sheetNames.find(n => n.toLowerCase().includes('rekap') && n.toLowerCase().includes('karyawan'));
  let detailSheetName = sheetNames.find(n => n.toLowerCase().includes('detail') || n.toLowerCase().includes('harian'));

  if (!recapSheetName) recapSheetName = sheetNames.find(n => n.toLowerCase().includes('rekap'));
  if (!detailSheetName) detailSheetName = sheetNames.find(n => n.toLowerCase().includes('detail') || n.toLowerCase().includes('harian'));

  if (!recapSheetName && !detailSheetName) {
    return { success: false, error: 'Sheet "Rekap" atau "Detail" tidak ditemukan' };
  }

  const result = { success: true, employees: 0, records: 0, month };

  const transactionFn = async (tx) => {
    // Delete old data for this month
    await tx.prepare('DELETE FROM attendance_daily WHERE month = $1').run(month);
    await tx.prepare('DELETE FROM attendance_recap WHERE month = $1').run(month);
    await tx.prepare('DELETE FROM import_history WHERE month = $1').run(month);

    // Process recap sheet
    if (recapSheetName) {
      const recapData = XLSX.utils.sheet_to_json(wb.Sheets[recapSheetName]);
      const insertUser = tx.prepare('INSERT INTO users (username, password, role, full_name, shift_group) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (username) DO NOTHING');
      const insertRecap = tx.prepare(`
        INSERT INTO attendance_recap (employee_name, month, days_recorded, days_on_time, days_late_toleransi, days_late_potongan, days_early_leave, days_no_checkin, days_no_checkout, total_late_minutes, no_schedule)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (employee_name, month) DO UPDATE SET
          days_recorded = EXCLUDED.days_recorded,
          days_on_time = EXCLUDED.days_on_time,
          days_late_toleransi = EXCLUDED.days_late_toleransi,
          days_late_potongan = EXCLUDED.days_late_potongan,
          days_early_leave = EXCLUDED.days_early_leave,
          days_no_checkin = EXCLUDED.days_no_checkin,
          days_no_checkout = EXCLUDED.days_no_checkout,
          total_late_minutes = EXCLUDED.total_late_minutes,
          no_schedule = EXCLUDED.no_schedule,
          imported_at = NOW()
      `);

      let empCount = 0;
      for (const r of recapData) {
        const name = r['Nama'];
        if (!name || name === 'TOTAL POTONGAN SEMUA KARYAWAN') continue;

        empCount++;
        const group = getShiftGroup(name);
        await insertUser.run(name.toLowerCase().replace(/\s+/g, '.'), 'password123', 'karyawan', name, group);

        await insertRecap.run(
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
      }
      result.employees = empCount;
    }

    // Process detail sheet
    if (detailSheetName) {
      const detailData = XLSX.utils.sheet_to_json(wb.Sheets[detailSheetName]);
      const insertDaily = tx.prepare(`
        INSERT INTO attendance_daily (employee_name, month, day_number, day_name, check_in, check_out, shift_detected, late_minutes, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (employee_name, day_number, month) DO UPDATE SET
          day_name = EXCLUDED.day_name,
          check_in = EXCLUDED.check_in,
          check_out = EXCLUDED.check_out,
          shift_detected = EXCLUDED.shift_detected,
          late_minutes = EXCLUDED.late_minutes,
          status = EXCLUDED.status,
          imported_at = NOW()
      `);

      let recCount = 0;
      for (const r of detailData) {
        await insertDaily.run(
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
      }
      result.records = recCount;
    }

    // Insert import history
    await tx.prepare('INSERT INTO import_history (filename, month, total_employees, total_records) VALUES ($1, $2, $3, $4)')
      .run(path.basename(filePath), month, result.employees, result.records);
  };

  await db.transaction(transactionFn)();
  return result;
}

// Seed admin if not exists (async)
async function seedAdmin() {
  const adminUser = await db.prepare('SELECT id FROM users WHERE username = $1').get('admin');
  if (!adminUser) {
    await db.prepare('INSERT INTO users (username, password, role, full_name) VALUES ($1, $2, $3, $4)')
      .run('admin', 'admin123', 'admin', 'Administrator');
    console.log('Admin user created: admin / admin123');
  }
}

// Test connection
async function testConnection() {
  try {
    await pool.query('SELECT NOW()');
    console.log('PostgreSQL connected');
    await seedAdmin();
  } catch (err) {
    console.error('Database connection error:', err.message);
  }
}

testConnection();

module.exports = db;
module.exports.pool = pool;
module.exports.importFromExcel = importFromExcel;
