-- PostgreSQL Schema for Absensi Web
-- Run this in Neon console or via migration script

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL DEFAULT 'password123',
  role TEXT CHECK(role IN ('admin','karyawan')) NOT NULL DEFAULT 'karyawan',
  full_name TEXT NOT NULL,
  shift_group TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS attendance_daily (
  id SERIAL PRIMARY KEY,
  employee_name TEXT NOT NULL,
  month TEXT NOT NULL DEFAULT '2024-06',
  day_number INTEGER NOT NULL,
  day_name TEXT,
  check_in TEXT,
  check_out TEXT,
  shift_detected TEXT,
  late_minutes INTEGER DEFAULT 0,
  status TEXT,
  imported_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(employee_name, day_number, month)
);

CREATE TABLE IF NOT EXISTS attendance_recap (
  id SERIAL PRIMARY KEY,
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
  imported_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(employee_name, month)
);

CREATE TABLE IF NOT EXISTS import_history (
  id SERIAL PRIMARY KEY,
  filename TEXT NOT NULL,
  month TEXT NOT NULL,
  total_employees INTEGER,
  total_records INTEGER,
  imported_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS leave_balance (
  id SERIAL PRIMARY KEY,
  employee_name TEXT UNIQUE NOT NULL,
  total_days INTEGER NOT NULL DEFAULT 12,
  used_days INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS leave_history (
  id SERIAL PRIMARY KEY,
  employee_name TEXT NOT NULL,
  days_used INTEGER NOT NULL DEFAULT 1,
  reason TEXT,
  used_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS leave_applications (
  id SERIAL PRIMARY KEY,
  employee_name TEXT NOT NULL,
  application_type TEXT NOT NULL CHECK(application_type IN ('izin','cuti','sakit')),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  reason TEXT,
  screenshot_path TEXT,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  admin_note TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  message TEXT,
  target_role TEXT DEFAULT 'all' CHECK(target_role IN ('all','admin','karyawan')),
  type TEXT DEFAULT 'info' CHECK(type IN ('info','warning','success')),
  is_read INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS announcements (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Session table for express-session with connect-pg-simple
CREATE TABLE IF NOT EXISTS session (
  sid VARCHAR NOT NULL COLLATE "default" PRIMARY KEY,
  sess JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);

CREATE INDEX IF NOT EXISTS IDX_session_expire ON session (expire);

-- Create admin user
INSERT INTO users (username, password, role, full_name)
VALUES ('admin', 'admin123', 'admin', 'Administrator')
ON CONFLICT (username) DO NOTHING;
