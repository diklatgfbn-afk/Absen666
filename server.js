require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('./database-pg');
const { pool, importFromExcel } = db;

const app = express();
const PORT = process.env.PORT || 3000;

// ─────────────────────────────────────────────
// MIDDLEWARE
// ─────────────────────────────────────────────

const allowedOrigins = process.env.NODE_ENV === 'production'
  ? [process.env.FRONTEND_URL]
  : ['http://localhost:3000', 'http://localhost:5173', 'http://127.0.0.1:5173'];

app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
  store: new pgSession({
    pool,
    tableName: 'session'
  }),
  secret: process.env.SESSION_SECRET || 'absensihub-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
  }
}));

app.use(express.static('public'));
app.use('/public', express.static('public'));

// Uploads folder
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
app.use('/uploads', express.static(uploadsDir));

// Multer config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e6);
    cb(null, unique + '-' + file.originalname);
  }
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.xlsx', '.xls', '.png', '.jpg', '.jpeg'].includes(ext)) cb(null, true);
    else cb(new Error('Hanya file Excel, PNG, JPG yang diperbolehkan'));
  },
  limits: { fileSize: 10 * 1024 * 1024 }
});

const { google } = require('googleapis');
const { JWT } = require('google-auth-library');

async function uploadToGoogleDrive(filePath, fileName) {
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  const serviceAccountKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

  if (!folderId || !serviceAccountKey) {
    console.log('[GoogleDrive] Credentials not configured, saving locally only');
    return { success: true, localPath: filePath };
  }

  try {
    const auth = new JWT({
      email: JSON.parse(serviceAccountKey).client_email,
      key: JSON.parse(serviceAccountKey).private_key,
      scopes: ['https://www.googleapis.com/auth/drive.file'],
    });

    const drive = google.drive({ version: 'v3', auth });
    const res = await drive.files.create({
      requestBody: {
        name: fileName,
        parents: [folderId],
      },
      media: {
        mimeType: getMimeType(path.extname(fileName).toLowerCase()),
        body: fs.createReadStream(filePath),
      },
    });

    console.log('[GoogleDrive] Uploaded:', fileName, '->', res.data.id);
    return { success: true, fileId: res.data.id };
  } catch (e) {
    console.error('[GoogleDrive] Upload failed:', e.message);
    return { success: false, error: e.message, localPath: filePath };
  }
}

function getMimeType(ext) {
  const map = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };
  return map[ext] || 'application/octet-stream';
}

const screenshotUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
      const unique = Date.now() + '-' + Math.round(Math.random() * 1e6);
      cb(null, unique + '-screenshot-' + file.originalname);
    }
  }),
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.png', '.jpg', '.jpeg'].includes(ext)) cb(null, true);
    else cb(new Error('Hanya gambar PNG, JPG, JPEG yang diperbolehkan'));
  },
  limits: { fileSize: 5 * 1024 * 1024 }
});

app.get('/', (req, res) => res.redirect('/login.html'));

// ─────────────────────────────────────────────
// AUTH MIDDLEWARE
// ─────────────────────────────────────────────

function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  res.status(401).json({ error: 'Login diperlukan' });
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.userRole === 'admin') return next();
  res.status(403).json({ error: 'Akses admin diperlukan' });
}

// ─────────────────────────────────────────────
// AUTH ROUTES
// ─────────────────────────────────────────────

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username dan password diperlukan' });

    const user = await db.prepare('SELECT * FROM users WHERE username = $1').get(username);
    if (!user) return res.status(401).json({ error: 'Username tidak ditemukan' });
    if (user.password !== password) return res.status(401).json({ error: 'Password salah' });

    req.session.userId = user.id;
    req.session.userRole = user.role;
    req.session.username = user.username;

    res.json({
      success: true,
      user: { id: user.id, username: user.username, full_name: user.full_name, role: user.role, shift_group: user.shift_group }
    });
  } catch (e) {
    console.error('Login error:', e);
    res.status(500).json({ error: 'Login gagal: ' + e.message });
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

app.get('/api/auth/session', async (req, res) => {
  try {
    if (req.session && req.session.userId) {
      const user = await db.prepare('SELECT id, username, full_name, role, shift_group FROM users WHERE id = $1').get(req.session.userId);
      if (user) return res.json({ authenticated: true, user });
    }
    res.json({ authenticated: false });
  } catch (e) {
    console.error('Session check error:', e);
    res.json({ authenticated: false });
  }
});

app.post('/api/auth/change-password', requireAuth, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) return res.status(400).json({ error: 'Password lama dan baru diperlukan' });
    if (newPassword.length < 4) return res.status(400).json({ error: 'Password baru minimal 4 karakter' });

    const user = await db.prepare('SELECT * FROM users WHERE id = $1').get(req.session.userId);
    if (!user) return res.status(404).json({ error: 'User tidak ditemukan' });
    if (user.password !== oldPassword) return res.status(401).json({ error: 'Password lama salah' });

    await db.prepare('UPDATE users SET password = $1 WHERE id = $2').run(newPassword, req.session.userId);
    res.json({ success: true, message: 'Password berhasil diubah' });
  } catch (e) {
    console.error('Change password error:', e);
    res.status(500).json({ error: 'Gagal ubah password: ' + e.message });
  }
});

// ─────────────────────────────────────────────
// ADMIN - MONTHS LIST
// ─────────────────────────────────────────────

app.get('/api/admin/months', requireAdmin, async (req, res) => {
  try {
    const months = await db.prepare('SELECT DISTINCT month FROM import_history ORDER BY month DESC').all();
    res.json({ success: true, data: months.map(m => m.month) });
  } catch (e) {
    console.error('Get months error:', e);
    res.status(500).json({ error: 'Gagal: ' + e.message });
  }
});

// ─────────────────────────────────────────────
// ADMIN - UPLOAD EXCEL
// ─────────────────────────────────────────────

app.post('/api/admin/upload', requireAdmin, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'File tidak ditemukan' });

    const month = req.body.month;
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: 'Format bulan tidak valid (contoh: 2024-06)' });
    }

    const result = await importFromExcel(req.file.path, month);
    if (!result.success) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: result.error });
    }
    res.json({
      success: true,
      message: `Data berhasil diimport untuk bulan ${month}`,
      employees: result.employees,
      records: result.records,
      month
    });
  } catch (e) {
    console.error('Upload error:', e);
    res.status(500).json({ error: 'Gagal import: ' + e.message });
  }
});

// ─────────────────────────────────────────────
// ADMIN - DELETE DATA BY MONTH
// ─────────────────────────────────────────────

app.delete('/api/admin/delete-month', requireAdmin, async (req, res) => {
  try {
    const { month } = req.query;
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: 'Format bulan tidak valid' });
    }

    const daily = await db.prepare('DELETE FROM attendance_daily WHERE month = $1').run(month);
    const recap = await db.prepare('DELETE FROM attendance_recap WHERE month = $1').run(month);
    const hist = await db.prepare('DELETE FROM import_history WHERE month = $1').run(month);

    res.json({
      success: true,
      message: `Data bulan ${month} berhasil dihapus`,
      deleted: { daily: daily.changes, recap: recap.changes, history: hist.changes }
    });
  } catch (e) {
    console.error('Delete error:', e);
    res.status(500).json({ error: 'Gagal hapus: ' + e.message });
  }
});

// ─────────────────────────────────────────────
// ADMIN - DASHBOARD STATS
// ─────────────────────────────────────────────

app.get('/api/admin/stats', requireAdmin, async (req, res) => {
  try {
    const { month } = req.query;

    let recap;
    if (month) {
      recap = await db.prepare('SELECT * FROM attendance_recap WHERE month = $1').all(month);
    } else {
      recap = await db.prepare('SELECT * FROM attendance_recap').all();
    }

    const totalEmployees = (await db.prepare('SELECT COUNT(*) as cnt FROM users WHERE role = $1').get('karyawan')).cnt;
    const totalOnTime = recap.reduce((s, r) => s + r.days_on_time, 0);
    const totalLateToleransi = recap.reduce((s, r) => s + r.days_late_toleransi, 0);
    const totalLatePotongan = recap.reduce((s, r) => s + r.days_late_potongan, 0);
    const totalEarlyLeave = recap.reduce((s, r) => s + r.days_early_leave, 0);
    const totalNoCheckin = recap.reduce((s, r) => s + r.days_no_checkin, 0);
    const totalNoCheckout = recap.reduce((s, r) => s + r.days_no_checkout, 0);
    const totalDays = recap.reduce((s, r) => s + r.days_recorded, 0);
    const totalLateMinutes = recap.reduce((s, r) => s + r.total_late_minutes, 0);

    const importHistory = month
      ? await db.prepare('SELECT * FROM import_history WHERE month = $1 ORDER BY imported_at DESC').all(month)
      : await db.prepare('SELECT * FROM import_history ORDER BY imported_at DESC').all();

    res.json({
      success: true,
      totalEmployees,
      totalDays,
      totalOnTime,
      totalLateToleransi,
      totalLatePotongan,
      totalEarlyLeave,
      totalNoCheckin,
      totalNoCheckout,
      totalLateMinutes,
      importHistory,
      attendanceRate: totalDays > 0 ? Math.round((totalOnTime / totalDays) * 1000) / 10 : 0
    });
  } catch (e) {
    console.error('Stats error:', e);
    res.status(500).json({ error: 'Gagal: ' + e.message });
  }
});

// ─────────────────────────────────────────────
// ADMIN - REKAP PER KARYAWAN
// ─────────────────────────────────────────────

app.get('/api/admin/recap', requireAdmin, async (req, res) => {
  try {
    const { search, sort = 'employee_name', order = 'asc', month } = req.query;

    let query = 'SELECT * FROM attendance_recap WHERE 1=1';
    const params = [];
    let paramIndex = 1;

    if (month) {
      query += ` AND month = $${paramIndex++}`;
      params.push(month);
    }
    if (search) {
      query += ` AND employee_name ILIKE $${paramIndex++}`;
      params.push(`%${search}%`);
    }

    const allowedSorts = ['employee_name', 'days_recorded', 'days_on_time', 'days_late_toleransi', 'days_late_potongan', 'total_late_minutes'];
    if (allowedSorts.includes(sort)) {
      const sortOrder = order === 'desc' ? 'DESC' : 'ASC';
      query += ` ORDER BY ${sort} ${sortOrder}`;
    } else {
      query += ' ORDER BY employee_name ASC';
    }

    const data = await pool.query(query, params).then(res => res.rows);
    res.json({ success: true, data });
  } catch (e) {
    console.error('Recap error:', e);
    res.status(500).json({ error: 'Gagal: ' + e.message });
  }
});

// ─────────────────────────────────────────────
// ADMIN - DETAIL HARIAN
// ─────────────────────────────────────────────

app.get('/api/admin/detail', requireAdmin, async (req, res) => {
  try {
    const { employee, day, month } = req.query;

    let query = 'SELECT * FROM attendance_daily WHERE 1=1';
    const params = [];
    let paramIndex = 1;

    if (month) {
      query += ` AND month = $${paramIndex++}`;
      params.push(month);
    }
    if (employee) {
      query += ` AND employee_name = $${paramIndex++}`;
      params.push(employee);
    }
    if (day) {
      query += ` AND day_number = $${paramIndex++}`;
      params.push(parseInt(day));
    }
    query += ' ORDER BY employee_name, day_number';

    const data = await pool.query(query, params).then(res => res.rows);
    res.json({ success: true, data });
  } catch (e) {
    console.error('Detail error:', e);
    res.status(500).json({ error: 'Gagal: ' + e.message });
  }
});

app.get('/api/admin/employees-list', requireAdmin, async (req, res) => {
  try {
    const data = await db.prepare('SELECT DISTINCT employee_name FROM attendance_recap ORDER BY employee_name').all();
    res.json({ success: true, data: data.map(d => d.employee_name) });
  } catch (e) {
    console.error('Employees list error:', e);
    res.status(500).json({ error: 'Gagal: ' + e.message });
  }
});

// ─────────────────────────────────────────────
// ADMIN - LEAVE BALANCE MANAGEMENT
// ─────────────────────────────────────────────

app.get('/api/admin/leave-balance', requireAdmin, async (req, res) => {
  try {
    const { search } = req.query;
    let query = 'SELECT * FROM leave_balance WHERE 1=1';
    const params = [];
    if (search) {
      query += ' AND employee_name ILIKE $1';
      params.push('%' + search + '%');
    }
    query += ' ORDER BY employee_name ASC';
    const data = await pool.query(query, params).then(res => res.rows);
    res.json({ success: true, data });
  } catch (e) {
    console.error('GET leave-balance error:', e.message);
    res.status(500).json({ error: 'Gagal mengambil data cuti: ' + e.message });
  }
});

app.post('/api/admin/leave-balance', requireAdmin, async (req, res) => {
  try {
    const { employee_name, total_days } = req.body;
    if (!employee_name) return res.status(400).json({ error: 'Nama karyawan wajib diisi' });
    const days = parseInt(total_days) || 12;

    const existing = await db.prepare('SELECT * FROM leave_balance WHERE employee_name = $1').get(employee_name);
    if (existing) {
      await db.prepare(`UPDATE leave_balance SET total_days = $1, updated_at = NOW() WHERE id = $2`).run(days, existing.id);
    } else {
      await db.prepare('INSERT INTO leave_balance (employee_name, total_days) VALUES ($1, $2)').run(employee_name, days);
    }
    res.json({ success: true, message: 'Data cuti berhasil disimpan' });
  } catch (e) {
    console.error('POST leave-balance error:', e.message);
    res.status(500).json({ error: 'Gagal menyimpan data cuti: ' + e.message });
  }
});

app.post('/api/admin/leave-balance/deduct', requireAdmin, async (req, res) => {
  try {
    const { employee_name, days, month, year, reason } = req.body;
    if (!employee_name) return res.status(400).json({ error: 'Nama karyawan wajib diisi' });
    const deductDays = parseInt(days) || 1;

    const bal = await db.prepare('SELECT * FROM leave_balance WHERE employee_name = $1').get(employee_name);
    if (!bal) return res.status(404).json({ error: 'Data cuti tidak ditemukan untuk karyawan ini' });
    if (bal.used_days + deductDays > bal.total_days) {
      return res.status(400).json({ error: 'Sisa cuti tidak mencukupi (sisa: ' + (bal.total_days - bal.used_days) + ' hari)' });
    }

    const m = parseInt(month) || (new Date().getMonth() + 1);
    const y = parseInt(year) || new Date().getFullYear();
    const usedAt = y + '-' + String(m).padStart(2, '0') + '-01';

    await db.transaction(async (tx) => {
      await tx.prepare(`UPDATE leave_balance SET used_days = used_days + $1, updated_at = NOW() WHERE id = $2`).run(deductDays, bal.id);
      await tx.prepare('INSERT INTO leave_history (employee_name, days_used, reason, used_at) VALUES ($1, $2, $3, $4)').run(employee_name, deductDays, reason || '-', usedAt);
    })();

    res.json({ success: true, message: 'Cuti berhasil dikurangi ' + deductDays + ' hari' });
  } catch (e) {
    console.error('POST leave-balance/deduct error:', e.message);
    res.status(500).json({ error: 'Gagal memotong cuti: ' + e.message });
  }
});

app.delete('/api/admin/leave-balance', requireAdmin, async (req, res) => {
  try {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'ID tidak valid' });
    const row = await db.prepare('SELECT employee_name FROM leave_balance WHERE id = $1').get(id);
    if (row) {
      await db.prepare('DELETE FROM leave_history WHERE employee_name = $1').run(row.employee_name);
    }
    await db.prepare('DELETE FROM leave_balance WHERE id = $1').run(id);
    res.json({ success: true, message: 'Data cuti berhasil dihapus' });
  } catch (e) {
    console.error('DELETE leave-balance error:', e.message);
    res.status(500).json({ error: 'Gagal menghapus data cuti: ' + e.message });
  }
});

app.get('/api/admin/leave-history', requireAdmin, async (req, res) => {
  try {
    const { employee_name } = req.query;
    let query = 'SELECT * FROM leave_history WHERE 1=1';
    const params = [];
    if (employee_name) {
      query += ' AND employee_name = $1';
      params.push(employee_name);
    }
    query += ' ORDER BY used_at DESC';
    const data = await pool.query(query, params).then(res => res.rows);
    res.json({ success: true, data });
  } catch (e) {
    console.error('GET leave-history error:', e.message);
    res.status(500).json({ error: 'Gagal mengambil riwayat cuti: ' + e.message });
  }
});

app.delete('/api/admin/leave-history', requireAdmin, async (req, res) => {
  try {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'ID tidak valid' });
    const row = await db.prepare('SELECT * FROM leave_history WHERE id = $1').get(id);
    if (!row) return res.status(404).json({ error: 'Riwayat tidak ditemukan' });

    await db.transaction(async (tx) => {
      const bal = await tx.prepare('SELECT * FROM leave_balance WHERE employee_name = $1').get(row.employee_name);
      if (bal) {
        const newUsed = Math.max(0, bal.used_days - row.days_used);
        await tx.prepare(`UPDATE leave_balance SET used_days = $1, updated_at = NOW() WHERE id = $2`).run(newUsed, bal.id);
      }
      await tx.prepare('DELETE FROM leave_history WHERE id = $1').run(id);
    })();

    res.json({ success: true, message: 'Riwayat cuti berhasil dihapus' });
  } catch (e) {
    console.error('DELETE leave-history error:', e.message);
    res.status(500).json({ error: 'Gagal menghapus riwayat: ' + e.message });
  }
});

app.post('/api/admin/leave-balance/batch', requireAdmin, async (req, res) => {
  try {
    const { total_days } = req.body;
    const days = parseInt(total_days) || 12;

    const employees = await db.prepare('SELECT DISTINCT full_name FROM users WHERE role = $1').all('karyawan');

    await db.transaction(async (tx) => {
      for (const emp of employees) {
        await tx.prepare(`
          INSERT INTO leave_balance (employee_name, total_days) VALUES ($1, $2)
          ON CONFLICT(employee_name) DO UPDATE SET total_days = EXCLUDED.total_days, updated_at = NOW()
        `).run(emp.full_name, days);
      }
    })();

    res.json({ success: true, message: 'Jatah cuti ' + days + ' hari berhasil diatur untuk ' + employees.length + ' karyawan' });
  } catch (e) {
    console.error('POST leave-balance/batch error:', e.message);
    res.status(500).json({ error: 'Gagal mengatur cuti batch: ' + e.message });
  }
});

// ─────────────────────────────────────────────
// KARYAWAN - MY ATTENDANCE
// ─────────────────────────────────────────────

app.get('/api/karyawan/my-recap', requireAuth, async (req, res) => {
  try {
    const user = await db.prepare('SELECT full_name FROM users WHERE id = $1').get(req.session.userId);
    const name = user ? user.full_name : req.session.username;
    const { month } = req.query;

    let recap;
    if (month) {
      recap = await db.prepare('SELECT * FROM attendance_recap WHERE LOWER(employee_name) = LOWER($1) AND month = $2').get(name, month);
    } else {
      recap = await db.prepare('SELECT * FROM attendance_recap WHERE LOWER(employee_name) = LOWER($1) ORDER BY month DESC LIMIT 1').get(name);
    }
    res.json({ success: true, data: recap || null });
  } catch (e) {
    console.error('My recap error:', e);
    res.status(500).json({ error: 'Gagal: ' + e.message });
  }
});

app.get('/api/karyawan/my-leave', requireAuth, async (req, res) => {
  try {
    const user = await db.prepare('SELECT full_name FROM users WHERE id = $1').get(req.session.userId);
    const name = user ? user.full_name : req.session.username;

    const balance = await db.prepare('SELECT * FROM leave_balance WHERE LOWER(employee_name) = LOWER($1)').get(name);
    const history = await db.prepare('SELECT * FROM leave_history WHERE LOWER(employee_name) = LOWER($1) ORDER BY used_at DESC').all(name);

    res.json({
      success: true,
      balance: balance || { employee_name: name, total_days: 12, used_days: 0 },
      history
    });
  } catch (e) {
    console.error('GET my-leave error:', e.message);
    res.status(500).json({ error: 'Gagal mengambil data cuti: ' + e.message });
  }
});

app.get('/api/karyawan/my-detail', requireAuth, async (req, res) => {
  try {
    const user = await db.prepare('SELECT full_name FROM users WHERE id = $1').get(req.session.userId);
    const name = user ? user.full_name : req.session.username;
    const { month } = req.query;

    let data;
    if (month) {
      data = await db.prepare('SELECT * FROM attendance_daily WHERE LOWER(employee_name) = LOWER($1) AND month = $2 ORDER BY day_number').all(name, month);
    } else {
      data = await db.prepare('SELECT * FROM attendance_daily WHERE LOWER(employee_name) = LOWER($1) ORDER BY month DESC, day_number').all(name);
    }
    res.json({ success: true, data });
  } catch (e) {
    console.error('My detail error:', e);
    res.status(500).json({ error: 'Gagal: ' + e.message });
  }
});

// ─────────────────────────────────────────────
// LEAVE APPLICATIONS ROUTES
// ─────────────────────────────────────────────

app.post('/api/karyawan/apply', requireAuth, screenshotUpload.single('screenshot'), async (req, res) => {
  try {
    const { employee_name, application_type, start_date, end_date, reason } = req.body;
    if (!employee_name || !application_type || !start_date || !end_date) {
      return res.status(400).json({ error: 'Semua field wajib diisi' });
    }
    if (!['izin', 'cuti', 'sakit'].includes(application_type)) {
      return res.status(400).json({ error: 'Type tidak valid' });
    }

    let screenshotPath = null;
    if (req.file) {
      screenshotPath = '/uploads/' + req.file.filename;
      uploadToGoogleDrive(req.file.path, req.file.filename).then(result => {
        if (result.success && result.fileId) {
          console.log('[Apply] Google Drive upload success for', req.file.filename);
        } else {
          console.log('[Apply] Google Drive upload skipped/failed, local file kept');
        }
      }).catch(e => console.error('[Apply] Drive upload error:', e.message));
    }

    const result = await db.prepare('INSERT INTO leave_applications (employee_name, application_type, start_date, end_date, reason, screenshot_path, status) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id')
      .get(employee_name, application_type, start_date, end_date, reason || '-', screenshotPath, 'pending');

    const notifTitleAdmin = 'Pengajuan ' + application_type.charAt(0).toUpperCase() + application_type.slice(1) + ' Baru';
    const notifMsgAdmin = employee_name + ' mengajukan ' + application_type + ' dari ' + start_date + ' s/d ' + end_date;
    await db.prepare('INSERT INTO notifications (title, message, target_role, type) VALUES ($1, $2, $3, $4)').run(notifTitleAdmin, notifMsgAdmin, 'admin', 'warning');
    await db.prepare('INSERT INTO notifications (title, message, target_role, type) VALUES ($1, $2, $3, $4)').run('Pengajuan Terkirim', 'Pengajuan ' + application_type + ' Anda berhasil dikirim dan sedang menunggu persetujuan.', 'karyawan', 'success');

    res.json({ success: true, message: 'Pengajuan ' + application_type + ' berhasil diajukan!', applicationId: result.id });
  } catch (e) {
    console.error('Apply error:', e);
    res.status(500).json({ error: 'Gagal: ' + e.message });
  }
});

app.get('/api/karyawan/my-applications', requireAuth, async (req, res) => {
  try {
    const user = await db.prepare('SELECT full_name FROM users WHERE id = $1').get(req.session.userId);
    const name = user ? user.full_name : req.session.username;
    const data = await pool.query(`
      SELECT la.*, (SELECT full_name FROM users u WHERE LOWER(u.username)=LOWER(la.employee_name) OR LOWER(u.full_name)=LOWER(la.employee_name) LIMIT 1) as employee_full_name
      FROM leave_applications la WHERE la.employee_name = $1 ORDER BY la.created_at DESC`, [name]).then(res => res.rows);
    res.json({ success: true, data });
  } catch (e) {
    console.error('My applications error:', e);
    res.status(500).json({ error: 'Gagal: ' + e.message });
  }
});

app.get('/api/admin/applications', requireAdmin, async (req, res) => {
  try {
    const { status, employee } = req.query;
    let query = `
      SELECT la.*, u.full_name as employee_full_name
      FROM leave_applications la
      LEFT JOIN users u ON u.username = la.employee_name OR LOWER(u.full_name) = LOWER(la.employee_name)
      WHERE 1=1`;
    const params = [];
    let paramIndex = 1;

    if (status && status !== 'semua') {
      query += ` AND la.status = $${paramIndex++}`;
      params.push(status);
    }
    if (employee) {
      query += ` AND (la.employee_name ILIKE $${paramIndex++} OR u.full_name ILIKE $${paramIndex++})`;
      params.push('%' + employee + '%', '%' + employee + '%');
    }
    query += ' ORDER BY la.created_at DESC';

    const data = await pool.query(query, params).then(res => res.rows);
    res.json({ success: true, data });
  } catch (e) {
    console.error('Applications error:', e);
    res.status(500).json({ error: 'Gagal: ' + e.message });
  }
});

app.get('/api/admin/applications/:id/screenshot', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const app = await db.prepare('SELECT screenshot_path FROM leave_applications WHERE id = $1').get(id);
    if (!app || !app.screenshot_path) return res.status(404).json({ error: 'Screenshot tidak ditemukan' });
    const filePath = path.join(__dirname, app.screenshot_path);
    res.download(filePath);
  } catch (e) {
    console.error('Download screenshot error:', e);
    res.status(500).json({ error: 'Gagal: ' + e.message });
  }
});

app.post('/api/admin/applications/:id/status', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { status, admin_note } = req.body;
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Status harus approved atau rejected' });
    }

    const app = await db.prepare('SELECT * FROM leave_applications WHERE id = $1').get(id);
    if (!app) return res.status(404).json({ error: 'Pengajuan tidak ditemukan' });

    await db.prepare(`UPDATE leave_applications SET status = $1, admin_note = $2, updated_at = NOW() WHERE id = $3`).run(status, admin_note || '-', id);

    const notifTitle = status === 'approved' ? 'Pengajuan Disetujui' : 'Pengajuan Ditolak';
    const notifMsg = 'Pengajuan ' + app.application_type + ' Anda (' + app.start_date + ' s/d ' + app.end_date + ') ' + (status === 'approved' ? 'disetujui' : 'ditolak') + '.' + (admin_note && admin_note !== '-' ? ' Catatan: ' + admin_note : '');
    await db.prepare('INSERT INTO notifications (title, message, target_role, type) VALUES ($1, $2, $3, $4)').run(notifTitle, notifMsg, 'karyawan', status === 'approved' ? 'success' : 'warning');

    res.json({ success: true, message: 'Pengajuan ' + status });
  } catch (e) {
    console.error('Approve/reject application error:', e.message);
    res.status(500).json({ error: 'Gagal memperbarui status: ' + e.message });
  }
});

app.delete('/api/admin/applications/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const app = await db.prepare('SELECT * FROM leave_applications WHERE id = $1').get(id);
    if (!app) return res.status(404).json({ error: 'Pengajuan tidak ditemukan' });

    if (app.screenshot_path) {
      const filePath = path.join(__dirname, app.screenshot_path);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }

    await db.prepare('DELETE FROM leave_applications WHERE id = $1').run(id);
    res.json({ success: true, message: 'Pengajuan berhasil dihapus' });
  } catch (e) {
    console.error('Delete application error:', e.message);
    res.status(500).json({ error: 'Gagal menghapus pengajuan: ' + e.message });
  }
});

app.delete('/api/admin/announcements/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const ann = await db.prepare('SELECT * FROM announcements WHERE id = $1').get(id);
    if (!ann) return res.status(404).json({ error: 'Pengumuman tidak ditemukan' });

    await db.prepare('DELETE FROM announcements WHERE id = $1').run(id);
    res.json({ success: true, message: 'Pengumuman berhasil dihapus' });
  } catch (e) {
    console.error('Delete announcement error:', e.message);
    res.status(500).json({ error: 'Gagal menghapus pengumuman: ' + e.message });
  }
});

// ─────────────────────────────────────────────
// NOTIFICATIONS ROUTES
// ─────────────────────────────────────────────

app.get('/api/admin/notifications', requireAdmin, async (req, res) => {
  try {
    const data = await db.prepare('SELECT * FROM notifications WHERE target_role IN ($1, $2) ORDER BY created_at DESC LIMIT 50').all('admin', 'all');
    res.json({ success: true, data });
  } catch (e) {
    console.error('GET admin/notifications error:', e.message);
    res.status(500).json({ error: 'Gagal mengambil notifikasi: ' + e.message });
  }
});

app.get('/api/karyawan/notifications', requireAuth, async (req, res) => {
  try {
    const data = await db.prepare('SELECT * FROM notifications WHERE target_role IN ($1, $2) ORDER BY created_at DESC LIMIT 50').all('karyawan', 'all');
    res.json({ success: true, data });
  } catch (e) {
    console.error('GET karyawan/notifications error:', e.message);
    res.status(500).json({ error: 'Gagal mengambil notifikasi: ' + e.message });
  }
});

app.post('/api/karyawan/notifications/read', requireAuth, async (req, res) => {
  try {
    await db.prepare('UPDATE notifications SET is_read = 1 WHERE target_role IN ($1, $2)').run('karyawan', 'all');
    res.json({ success: true });
  } catch (e) {
    console.error('Mark read error:', e);
    res.status(500).json({ error: 'Gagal: ' + e.message });
  }
});

app.post('/api/admin/notifications/read', requireAdmin, async (req, res) => {
  try {
    await db.prepare(`UPDATE notifications SET is_read = 1 WHERE target_role IN ($1, 'all')`).run('admin');
    res.json({ success: true });
  } catch (e) {
    console.error('Mark read error:', e);
    res.status(500).json({ error: 'Gagal: ' + e.message });
  }
});

app.get('/api/notifications/unread-count', requireAuth, async (req, res) => {
  try {
    const role = req.session.userRole || 'karyawan';
    const count = (await db.prepare(`SELECT COUNT(*) as cnt FROM notifications WHERE (target_role = $1 OR target_role = 'all') AND is_read = 0`).get(role)).cnt;
    res.json({ success: true, count });
  } catch (e) {
    console.error('GET unread-count error:', e.message);
    res.status(500).json({ error: 'Gagal mengambil jumlah notifikasi: ' + e.message });
  }
});

// ─────────────────────────────────────────────
// ANNOUNCEMENTS ROUTES
// ─────────────────────────────────────────────

app.post('/api/admin/announcements', requireAdmin, async (req, res) => {
  try {
    const { title, content } = req.body;
    if (!title || !content) return res.status(400).json({ error: 'Judul dan konten wajib diisi' });

    const user = await db.prepare('SELECT full_name FROM users WHERE id = $1').get(req.session.userId);
    const name = user ? user.full_name : req.session.username;

    const result = await db.prepare('INSERT INTO announcements (title, content, created_by) VALUES ($1, $2, $3) RETURNING id').get(title, content, name);
    await db.prepare('INSERT INTO notifications (title, message, target_role, type) VALUES ($1, $2, $3, $4)').run('Pengumuman Baru', content.length > 50 ? content.substring(0, 50) + '...' : content, 'karyawan', 'info');

    res.json({ success: true, message: 'Pengumuman berhasil dibuat', announcementId: result.id });
  } catch (e) {
    console.error('Create announcement error:', e);
    res.status(500).json({ error: 'Gagal: ' + e.message });
  }
});

app.get('/api/karyawan/announcements', requireAuth, async (req, res) => {
  try {
    const data = await db.prepare('SELECT * FROM announcements ORDER BY created_at DESC LIMIT 20').all();
    res.json({ success: true, data });
  } catch (e) {
    console.error('Get announcements error:', e);
    res.status(500).json({ error: 'Gagal: ' + e.message });
  }
});

app.delete('/api/admin/announcements/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await db.prepare('DELETE FROM announcements WHERE id = $1').run(id);
    res.json({ success: true, message: 'Pengumuman dihapus' });
  } catch (e) {
    console.error('Delete announcement error:', e);
    res.status(500).json({ error: 'Gagal: ' + e.message });
  }
});

// ─────────────────────────────────────────────
// START SERVER
// ─────────────────────────────────────────────

if (require.main === module) {
  app.listen(PORT, async () => {
    try {
      const empCount = (await db.prepare('SELECT COUNT(*) as cnt FROM users WHERE role = $1').get('karyawan')).cnt;
      const recapCount = (await db.prepare('SELECT COUNT(*) as cnt FROM attendance_recap').get()).cnt;
      const detailCount = (await db.prepare('SELECT COUNT(*) as cnt FROM attendance_daily').get()).cnt;

      console.log(`
  ╔══════════════════════════════════════════════════╗
  ║        AbsensiHub Server Started!                ║
  ║        http://localhost:${PORT}                   ║
  ║                                                  ║
  ║        Database: ${empCount} karyawan, ${recapCount} rekapan, ${detailCount} detail
  ║                                                  ║
  ║        Admin Login:                              ║
  ║        Username: admin / admin123                ║
  ╚══════════════════════════════════════════════════╝
      `);
    } catch (e) {
      console.error('Startup info error:', e);
    }
  });
}

module.exports = app;
