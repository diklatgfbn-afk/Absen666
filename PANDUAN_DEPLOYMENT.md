# Panduan Deployment Absensi-Web ke Cloud

## Status Saat Ini
- ✅ Database PostgreSQL sudah jalan di Neon
- ✅ Backend code sudah siap untuk Vercel
- ❌ Backend belum deploy ke Vercel (API endpoint belum ada)
- ❌ Frontend config.js masih placeholder
- ❌ Cloudflare Pages Build output directory stuck di `/`

---

## LANGKAH 1: Deploy Backend ke Vercel

### 1.1 Install Vercel CLI (jika belum)
```bash
npm install -g vercel
```

### 1.2 Login ke Vercel
```bash
vercel login
```

### 1.3 Deploy dari folder Absensi-web
```bash
cd "C:\Users\Waket skibidi\Downloads\Absensi-web"
vercel
```

**Jawab pertanyaan setup:**
- Set up and deploy? → **Y**
- Which scope? → Pilih akun Anda
- Link to existing project? → **N**
- Project name? → **absensi-web** (atau nama lain)
- In which directory is your code located? → **./** (tekan Enter)
- Want to override settings? → **N**

Vercel akan deploy dan memberikan URL seperti: `https://absensi-web-xxxx.vercel.app`

### 1.4 Set Environment Variables di Vercel

Setelah deploy pertama, set environment variables:

```bash
vercel env add DATABASE_URL
```
Paste value: `postgresql://neondb_owner:npg_VZ5SCm4oiYsE@ep-spring-wave-b3fzlpri-pooler.c-4.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`

```bash
vercel env add SESSION_SECRET
```
Value: `absensihub-secret-2026`

```bash
vercel env add NODE_ENV
```
Value: `production`

```bash
vercel env add FRONTEND_URL
```
Value: URL Cloudflare Pages Anda, contoh: `https://absensi-web.pages.dev`

### 1.5 Deploy Production
```bash
vercel --prod
```

**SIMPAN URL PRODUCTION INI!** Contoh: `https://absensi-web-xxxx.vercel.app`

---

## LANGKAH 2: Update Frontend Config

### 2.1 Edit public/config.js

Ganti placeholder dengan URL Vercel yang didapat di langkah 1.5:

```javascript
window.API_BASE_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? '' // Local development
  : 'https://absensi-web-xxxx.vercel.app'; // ← GANTI INI dengan URL Vercel Anda
```

### 2.2 Commit & Push ke GitHub

```bash
git add public/config.js
git commit -m "Update API URL to Vercel backend"
git push origin main
```

Cloudflare Pages akan auto-rebuild setelah push.

---

## LANGKAH 3: Fix Cloudflare Pages Build Output Directory

### Solusi 1: Buat wrangler.toml (Recommended)

File `wrangler.toml` sudah ada di project, pastikan isinya:

```toml
name = "absensi-web"
compatibility_date = "2024-01-01"

[site]
bucket = "./public"
```

### Solusi 2: Manual via Cloudflare Dashboard

1. Buka Cloudflare Pages dashboard
2. Pilih project Absensi-web
3. Klik **Settings** → **Builds & deployments**
4. Scroll ke **Build configuration**
5. Jika "Build output directory" tidak bisa diedit:
   - Klik **Edit configuration**
   - Ubah dari `/` ke `public`
   - Klik **Save**

### Solusi 3: _redirects File (Fallback)

Jika tetap stuck, buat file `public/_redirects`:

```
/* /index.html 200
```

File ini akan handle routing di Cloudflare Pages.

---

## LANGKAH 4: Test Koneksi

### 4.1 Test Backend API
```bash
curl https://absensi-web-xxxx.vercel.app/api/auth/session
```

Response harusnya: `{"authenticated":false}`

### 4.2 Test Frontend
1. Buka URL Cloudflare Pages
2. Seharusnya redirect ke `/login.html`
3. Coba login dengan: `admin` / `admin123`
4. Jika berhasil, redirect ke dashboard admin

---

## Troubleshooting

### Error: "Koneksi server gagal"
**Penyebab:** Frontend tidak bisa reach backend API

**Solusi:**
1. Pastikan backend sudah deploy ke Vercel (langkah 1)
2. Pastikan `public/config.js` sudah update dengan URL Vercel yang benar (langkah 2)
3. Push update ke GitHub agar Cloudflare rebuild (langkah 2.2)
4. Check CORS: pastikan `FRONTEND_URL` di Vercel env match dengan URL Cloudflare Pages

### Error: CORS blocked
**Penyebab:** Backend tidak allow origin dari frontend

**Solusi:**
```bash
vercel env add FRONTEND_URL
```
Value: `https://your-cloudflare-pages-url.pages.dev`

Lalu redeploy:
```bash
vercel --prod
```

### Build output directory tetap `/`
**Solusi:**
1. Gunakan `wrangler.toml` (sudah ada di project)
2. Atau buat file `public/_redirects` dengan content `/* /index.html 200`
3. Push ke GitHub

### Database connection timeout
**Penyebab:** Vercel tidak bisa connect ke Neon

**Solusi:**
1. Pastikan `DATABASE_URL` di Vercel environment variables benar
2. Pastikan pake connection string dengan `-pooler` suffix
3. Check Neon dashboard apakah database aktif

---

## File Penting

- `server.js` - Backend Express server
- `database-pg.js` - PostgreSQL connection handler
- `vercel.json` - Vercel deployment config
- `public/config.js` - Frontend API configuration
- `.env` - Local environment variables (JANGAN commit ke Git!)
- `.gitignore` - Protect sensitive files

---

## Checklist Deployment

### Backend (Vercel)
- [ ] Vercel CLI installed
- [ ] Login ke Vercel
- [ ] Deploy dengan `vercel`
- [ ] Set environment variables (DATABASE_URL, SESSION_SECRET, NODE_ENV, FRONTEND_URL)
- [ ] Deploy production dengan `vercel --prod`
- [ ] Simpan URL production

### Frontend (Cloudflare Pages)
- [ ] Update `public/config.js` dengan URL Vercel
- [ ] Commit & push ke GitHub
- [ ] Tunggu Cloudflare Pages rebuild
- [ ] Verify build output directory = `public`
- [ ] Test akses website

### Testing
- [ ] Test backend API endpoint dengan curl
- [ ] Test login admin
- [ ] Test navigation dashboard
- [ ] Test upload data absensi
- [ ] Test pengajuan cuti karyawan

---

## URL Reference

Setelah deployment, catat URL berikut:

- **Backend API (Vercel):** `https://_____________________.vercel.app`
- **Frontend (Cloudflare Pages):** `https://_____________________.pages.dev`
- **Database (Neon):** `https://console.neon.tech` (dashboard)

---

## Support

Jika masih error:
1. Check Vercel logs: `vercel logs`
2. Check Cloudflare Pages build logs di dashboard
3. Check browser console (F12) untuk error detail
4. Check Network tab untuk melihat request/response API
