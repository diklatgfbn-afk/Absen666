# Instructions for Deploying Absensi-Web

## 1. Database Setup (Neon PostgreSQL)
1. Go to https://neon.tech and create an account / log in.
2. Create a new PostgreSQL project.
3. In the SQL Editor, copy and execute all SQL queries from `schema.sql` (located in the project folder).
4. Copy your Connection String from Neon Dashboard. It looks like:
   `postgres://username:password@ep-something.region.aws.neon.tech/neondb?sslmode=require`

---

## 2. Backend Deployment (Vercel)
1. Push this project to GitHub (or install Vercel CLI locally).
2. Go to https://vercel.com and import the GitHub repository.
3. Configure Environment Variables in Vercel settings:
   - `DATABASE_URL`: (Paste your Neon Connection String)
   - `SESSION_SECRET`: `absensihub-secret-key-2026` (or any random string)
   - `FRONTEND_URL`: `https://your-app.pages.dev` (Cloudflare Pages URL)
   - `NODE_ENV`: `production`
   - `GOOGLE_DRIVE_FOLDER_ID`: (Optional, for screenshots/uploads)
   - `GOOGLE_SERVICE_ACCOUNT_KEY`: (Optional)
4. Deploy to Vercel. Copy the production deployment URL (e.g. `https://absensi-web.vercel.app`).

---

## 3. Frontend Deployment (Cloudflare Pages)
1. Open `public/config.js` in this project.
2. Replace `'https://your-backend-vercel-url.vercel.app'` with your actual Vercel backend URL.
3. Go to https://dash.cloudflare.com and navigate to **Workers & Pages** -> **Pages**.
4. Click **Create a project** -> **Connect to Git** (or Upload assets manually).
5. Select the `public/` directory as the build output directory / root directory for Pages.
6. Deploy! Your app will be live at `https://your-app.pages.dev`.

---

## Default Admin Credentials
- **Username**: `admin`
- **Password**: `admin123`
