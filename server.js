/**
 * One-Time Code Album Download Site — single-file Node.js app
 * ------------------------------------------------------------
 * What this gives you
 * - Redeem page where fans enter a code to unlock your album downloads
 * - Codes are single-use; once redeemed, they can’t be used again
 * - Simple admin endpoints to generate printable codes (CSV) and see stats
 * - Session-protected downloads so links can’t be shared outside the redeemed browser
 * - No external services required (stores codes locally in SQLite)
 *
 * How to run (macOS/Windows/Linux)
 * 1) Install Node.js 18+ from https://nodejs.org
 * 2) In a new folder, save this file as: server.js
 * 3) In the same folder, create a subfolder named: songs  (put your .mp3/.wav in here)
 * 4) Create a file named .env in the same folder with:
 *      ADMIN_KEY=some-long-random-admin-key
 *      SESSION_SECRET=another-long-random-string
 *      SITE_NAME=Travis Dolter — Album Download
 *      BASE_URL=http://localhost:3000
 * 5) Run these in your terminal:
 *      npm init -y
 *      npm i express sqlite3 nanoid express-session dotenv
 * 6) Start the app:
 *      node server.js
 * 7) Visit the site:
 *      http://localhost:3000
 *
 * Admin — generate printable codes (CSV):
 *   GET  /admin/generate?count=100&prefix=TD-&key=YOUR_ADMIN_KEY
 *   → returns a CSV you can download and print as cards with the base URL + code
 *
 * Admin — list stats (JSON):
 *   GET  /admin/stats?key=YOUR_ADMIN_KEY
 *
 * Admin — export all codes (CSV):
 *   GET  /admin/export?key=YOUR_ADMIN_KEY
 *
 * Printing suggestion for cards:
 *   Front:  “Redeem at: https://YOURDOMAIN  |  CODE: TD-AB12CD34”
 *   Back:   “1) Go to the URL  2) Enter the code  3) Download the songs”
 *
 * Deployment tip:
 *   - You can host this on a small VPS (Ubuntu), Railway, Render, Fly.io, or a
 *     Raspberry Pi. For public use, put it behind HTTPS via a reverse proxy like
 *     Nginx + Let’s Encrypt.
 */

const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const { customAlphabet } = require('nanoid');
const dotenv = require('dotenv');
dotenv.config();

// --- Config ---
const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || 'change-me-admin-key';
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-me-session-secret';
const SITE_NAME = process.env.SITE_NAME || 'Album Download';
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const SONGS_DIR = path.join(__dirname, 'songs');
const PUBLIC_DIR = path.join(__dirname, 'public');
const ARTWORK_FILENAME = process.env.ARTWORK_FILENAME || 'artwork.jpg';

// Ensure songs & public directories exist
if (!fs.existsSync(SONGS_DIR)) {
  fs.mkdirSync(SONGS_DIR, { recursive: true });
}
if (!fs.existsSync(PUBLIC_DIR)) {
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });
}

// --- App & Middleware ---
const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Serve static assets (album artwork, etc.)
app.use('/assets', express.static(PUBLIC_DIR));

app.use(
  session({
    name: 'redeem.sid',
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax' },
  })
);

// --- Database (SQLite) ---
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'codes.db');
const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
  db.run(
    `CREATE TABLE IF NOT EXISTS codes (
      code TEXT PRIMARY KEY,
      redeemed INTEGER NOT NULL DEFAULT 0,
      redeemed_at TEXT,
      batch TEXT
    )`
  );
});

// Nanoid alphabet: uppercase letters + digits (omit 0,O,1,I to reduce confusion)
const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const idGen = customAlphabet(alphabet, 10); // 10-char codes, e.g., TD-AB12C3DE4

// --- Helpers ---
function requireAdmin(req, res) {
  const key = req.query.key || req.headers['x-admin-key'];
  if (key !== ADMIN_KEY) {
    res.status(401).send('Unauthorized');
    return false;
  }
  return true;
}

function listSongFiles() {
  const all = fs.readdirSync(SONGS_DIR);
  // Only allow safe audio extensions
  const allowed = new Set(['.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg']);
  return all.filter((f) => allowed.has(path.extname(f).toLowerCase()));
}

function htmlPage(title, body) {
  return `<!doctype html>
  <html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      :root { --bg:#0b0b10; --card:#12121a; --ink:#e9e9f0; --muted:#a9abb5; --accent:#7fd186; }
      *{box-sizing:border-box} body{margin:0;font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:var(--bg);color:var(--ink)}
      .wrap{min-height:100svh;display:grid;place-items:center;padding:32px}
      .card{width:100%;max-width:560px;background:linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02));border:1px solid rgba(255,255,255,0.08);backdrop-filter:blur(8px);border-radius:20px;box-shadow:0 10px 30px rgba(0,0,0,0.35)}
      .pad{padding:28px}
      h1{font-size:1.4rem;margin:0 0 8px 0}
      .art{width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:16px;margin-bottom:16px;border:1px solid rgba(255,255,255,0.1)}
      p{color:var(--muted);margin:0 0 20px}
      form{display:flex;gap:8px}
      input[type=text]{flex:1; padding:14px 16px; border-radius:12px; background:#0f0f16; color:var(--ink); border:1px solid rgba(255,255,255,0.12); font-size:16px}
      button{padding:14px 18px; border:0; border-radius:12px; background:var(--accent); color:#0b2b11; font-weight:700; cursor:pointer}
      .files{display:grid; gap:10px}
      .file{display:flex; justify-content:space-between; align-items:center; background:#0f0f16; border:1px solid rgba(255,255,255,0.08); padding:14px 16px; border-radius:12px}
      .pill{display:inline-flex;align-items:center;gap:8px;background:#0f0f16;border:1px solid rgba(255,255,255,0.08);padding:8px 10px;border-radius:999px;color:var(--muted);font-size:12px}
      .muted{color:var(--muted)}
      a{color:#b1e7b6;text-decoration:none}
      .center{text-align:center}
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <div class="pad">
          ${body}
        </div>
      </div>
    </div>
  </body>
  </html>`;
}

// --- Routes ---
app.get('/', (req, res) => {
  const body = `
    <img class=\"art\" src=\"/assets/${ARTWORK_FILENAME}\" alt=\"Album artwork\" />
    <h1>${SITE_NAME}</h1>
    <p>Enter the unique code from your card to unlock your downloads.</p>
    <form method=\"POST\" action=\"/redeem\"> 
      <input name=\"code\" type=\"text\" inputmode=\"latin-prose\" autocomplete=\"one-time-code\" placeholder=\"Enter code (e.g., TD-AB12C3DE4)\" required />
      <button type=\"submit\">Unlock</button>
    </form>
    <p class=\"muted\" style=\"margin-top:14px\">Having trouble? Contact the artist or seller with your code.</p>
  `;
  res.send(htmlPage(SITE_NAME, body));
});

app.post('/redeem', (req, res) => {
  const raw = String(req.body.code || '').toUpperCase().trim();
  const code = raw.replace(/[^A-Z0-9\-]/g, '');
  if (!code) return res.send(htmlPage('Invalid Code', `<h1>Invalid code</h1><p>Please go back and try again.</p>`));

  db.get('SELECT code, redeemed FROM codes WHERE code = ?', [code], (err, row) => {
    if (err) return res.status(500).send('Database error');
    if (!row) {
      return res.send(
        htmlPage('Code Not Found', `<h1>Code not found</h1><p>Please check your card and try again.</p>`)
      );
    }
    if (row.redeemed) {
      return res.send(
        htmlPage('Already Redeemed', `<h1>Already redeemed</h1><p>This code has already been used. If you believe this is a mistake, please contact support with the code: <strong>${code}</strong>.</p>`)
      );
    }

    // Mark as redeemed and set session gate
    db.run('UPDATE codes SET redeemed = 1, redeemed_at = ? WHERE code = ?', [new Date().toISOString(), code], (uerr) => {
      if (uerr) return res.status(500).send('Database error');

      req.session.redeemed = true;
      req.session.code = code;

      const files = listSongFiles();
      const list = files
        .map(
          (f) => `<div class="file"><span>${f}</span><a href="/download/${encodeURIComponent(f)}" download>Download</a></div>`
        )
        .join('');

      const body = `
        <img class=\"art\" src=\"/assets/${ARTWORK_FILENAME}\" alt=\"Album artwork\" />
        <h1>Downloads unlocked 🎧</h1>
        <p class="muted">Code: <span class="pill">${code}</span></p>
        <div class="files">${list || '<p>No songs uploaded yet.</p>'}</div>
        <p class="muted center" style="margin-top:16px">Keep this page open while downloading. Links are protected to this browser session.</p>
      `;
      res.send(htmlPage('Downloads', body));
    });
  });
});

app.get('/download/:file', (req, res) => {
  // Simple session gate: only accessible right after a successful redemption in this browser
  if (!req.session || !req.session.redeemed) {
    return res.status(403).send('Forbidden – please redeem a valid code first.');
  }
  const file = path.basename(req.params.file);
  const filePath = path.join(SONGS_DIR, file);
  if (!fs.existsSync(filePath)) return res.status(404).send('File not found');

  res.download(filePath);
});

// --- Admin endpoints ---
app.get('/admin/generate', (req, res) => {
  if (!requireAdmin(req, res)) return;

  const count = Math.min(parseInt(req.query.count || '100', 10), 10000);
  const prefix = (req.query.prefix || '').toUpperCase();
  const batch = req.query.batch || new Date().toISOString().slice(0, 10);

  const toInsert = [];
  for (let i = 0; i < count; i++) {
    const code = (prefix ? prefix : '') + idGen();
    toInsert.push({ code, batch });
  }

  db.serialize(() => {
    const stmt = db.prepare('INSERT OR IGNORE INTO codes (code, redeemed, redeemed_at, batch) VALUES (?, 0, NULL, ?)');
    toInsert.forEach((c) => stmt.run(c.code, c.batch));
    stmt.finalize((err) => {
      if (err) return res.status(500).send('Database error');

      // Return CSV for immediate download/printing
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="codes-${batch}.csv"`);
      res.write('code,batch,redeemed,redeemed_at,redeem_url\n');

      // Re-query what actually exists now (in case of IGNORE on duplicates)
      db.all('SELECT code, redeemed, redeemed_at, batch FROM codes WHERE batch = ? ORDER BY code', [batch], (aerr, rows) => {
        if (aerr) return res.status(500).send('Database error');
        rows.forEach((r) => {
          const redeemUrl = `${BASE_URL}`; // Users will enter the code at the base URL
          res.write(`${r.code},${r.batch},${r.redeemed},${r.redeemed_at || ''},${redeemUrl}\n`);
        });
        res.end();
      });
    });
  });
});

app.get('/admin/export', (req, res) => {
  if (!requireAdmin(req, res)) return;
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="all-codes.csv"');
  res.write('code,batch,redeemed,redeemed_at\n');
  db.each('SELECT code, batch, redeemed, redeemed_at FROM codes ORDER BY redeemed, code', (err, row) => {
    if (!err && row) {
      res.write(`${row.code},${row.batch || ''},${row.redeemed},${row.redeemed_at || ''}\n`);
    }
  }, () => res.end());
});

app.get('/admin/stats', (req, res) => {
  if (!requireAdmin(req, res)) return;
  db.get('SELECT COUNT(*) AS total FROM codes', (e1, r1) => {
    db.get('SELECT COUNT(*) AS redeemed FROM codes WHERE redeemed = 1', (e2, r2) => {
      res.json({ total_codes: r1?.total || 0, redeemed: r2?.redeemed || 0, unredeemed: (r1?.total || 0) - (r2?.redeemed || 0) });
    });
  });
});

// Health check
app.get('/healthz', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`
${SITE_NAME} running on ${BASE_URL}
`);
  console.log(`Place your audio files in: ${SONGS_DIR}`);
  console.log(`Place your album artwork image in: ${PUBLIC_DIR}/${ARTWORK_FILENAME}`);
  console.log('Admin generate codes example:');
  console.log(`${BASE_URL}/admin/generate?count=100&prefix=TD-&key=YOUR_ADMIN_KEY`);
});

