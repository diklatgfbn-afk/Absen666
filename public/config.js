// API Configuration
// Change this to your Vercel deployment URL in production
window.API_BASE_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? '' // Local development (relative to same host)
  : 'https://absen666.vercel.app/'; // Production Vercel URL
