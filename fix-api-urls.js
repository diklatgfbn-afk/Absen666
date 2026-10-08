// Script to fix all fetch API URLs in public/*.html files
// Run: node fix-api-urls.js

const fs = require('fs');
const path = require('path');

const publicDir = path.join(__dirname, 'public');
const htmlFiles = ['login.html', 'admin.html', 'karyawan.html', 'setting.html'];

// Pattern: fetch('/api/...') -> fetch(window.API_BASE_URL + '/api/...')
// But NOT fetch('http...') or fetch('https...')

htmlFiles.forEach(file => {
  const filePath = path.join(publicDir, file);
  let content = fs.readFileSync(filePath, 'utf8');
  let changes = 0;

  // Replace fetch('/api/...') with fetch(window.API_BASE_URL + '/api/...')
  // But skip if already has window.API_BASE_URL
  content = content.replace(/fetch\('\/api\/([^']+)'\)/g, (match, apiPath) => {
    changes++;
    return `fetch(window.API_BASE_URL + '/api/${apiPath}')`;
  });

  // Also handle fetch("/api/...") with double quotes
  content = content.replace(/fetch\("\/api\/([^"]+)"\)/g, (match, apiPath) => {
    changes++;
    return `fetch(window.API_BASE_URL + "/api/${apiPath}")`;
  });

  if (changes > 0) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`✓ ${file}: ${changes} fetch calls updated`);
  } else {
    console.log(`- ${file}: no changes needed`);
  }
});

console.log('\nDone! All fetch API URLs now use window.API_BASE_URL');
