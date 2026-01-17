require('dotenv').config();

const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');

const { db, initDb } = require('./db');
const { auth } = require('./auth');
const { normalizeKey, fingerprintKey } = require('./license_utils');
const { adminRouter } = require('./admin/admin_routes');
const { stripeRouter } = require('./stripe_routes');

if (!process.env.JWT_SECRET) {
  console.error('Missing JWT_SECRET in .env');
  process.exit(1);
}
if (!process.env.ADMIN_USER || !process.env.ADMIN_PASS) {
  console.error('Missing ADMIN_USER/ADMIN_PASS in .env');
  process.exit(1);
}

initDb();

const app = express();
app.use(cors());

// IMPORTANT: Stripe webhook needs raw body. We mount that route before json parser.
app.use('/stripe', stripeRouter);

// JSON parser for rest routes
app.use(express.json({ limit: '1mb' }));

app.get('/', (req, res) => {
  res.send('BDRIS License Server is running. Admin: /admin | Stripe topup: /stripe/topup');
});

// ---------- ACTIVATE ----------
// Body: { license_key, device_id? }
app.post('/activate', async (req, res) => {
  const licenseKeyRaw = req.body?.license_key;
  const deviceId = String(req.body?.device_id || uuidv4());

  const licenseKey = normalizeKey(licenseKeyRaw);
  if (!licenseKey) return res.status(400).json({ error: 'Missing license_key' });

  const fp = fingerprintKey(licenseKey);
  let lic = db.prepare('SELECT id, key_hash, tokens, status FROM licenses WHERE key_fingerprint = ?').get(fp);

  // Optional auto-create for testing
  const autoCreate = String(process.env.AUTO_CREATE_LICENSE || 'false').toLowerCase() === 'true';
  if (!lic && autoCreate) {
    const tokens = Number(process.env.DEFAULT_TOKENS_ON_CREATE || 100);
    const hash = await bcrypt.hash(licenseKey, 10);
    const result = db.prepare(
      'INSERT INTO licenses (key_fingerprint, key_hash, tokens, status) VALUES (?, ?, ?, ?)'
    ).run(fp, hash, tokens, 'active');

    lic = { id: result.lastInsertRowid, key_hash: hash, tokens, status: 'active' };
  }

  if (!lic) return res.status(404).json({ error: 'LICENSE_NOT_FOUND' });
  if (lic.status !== 'active') return res.status(403).json({ error: 'LICENSE_BLOCKED' });

  const ok = await bcrypt.compare(licenseKey, lic.key_hash);
  if (!ok) return res.status(403).json({ error: 'INVALID_LICENSE_KEY' });

  // Device limit
  const limit = Number(process.env.DEVICE_LIMIT || 2);
  const existing = db.prepare('SELECT COUNT(*) AS c FROM devices WHERE license_id = ?').get(lic.id).c;
  const already = db.prepare('SELECT id FROM devices WHERE license_id = ? AND device_id = ?').get(lic.id, deviceId);
  if (!already && existing >= limit) {
    return res.status(429).json({ error: 'DEVICE_LIMIT_REACHED', device_limit: limit });
  }

  // Upsert device
  db.prepare('INSERT OR IGNORE INTO devices (license_id, device_id) VALUES (?, ?)').run(lic.id, deviceId);

  const token = jwt.sign(
    { license_id: lic.id, device_id: deviceId },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );

  return res.json({ token, tokens: lic.tokens, device_id: deviceId });
});

// ---------- BALANCE ----------
app.get('/balance', auth, (req, res) => {
  const row = db.prepare('SELECT tokens, status FROM licenses WHERE id = ?').get(req.user.license_id);
  if (!row) return res.status(404).json({ error: 'LICENSE_NOT_FOUND' });
  if (row.status !== 'active') return res.status(403).json({ error: 'LICENSE_BLOCKED' });
  return res.json({ tokens: row.tokens });
});

// ---------- CONSUME TOKENS ----------
// Body: { action, cost, request_id }
app.post('/consume', auth, (req, res) => {
  const action = String(req.body?.action || 'unknown');
  const cost = Number(req.body?.cost || 0);
  const requestId = String(req.body?.request_id || '');

  if (!requestId || !Number.isFinite(cost) || cost <= 0) {
    return res.status(400).json({ error: 'INVALID_REQUEST' });
  }

  const already = db.prepare('SELECT id FROM transactions WHERE request_id = ?').get(requestId);
  if (already) {
    // idempotent success
    const row = db.prepare('SELECT tokens FROM licenses WHERE id = ?').get(req.user.license_id);
    return res.json({ success: true, duplicated: true, remaining_tokens: row?.tokens ?? null });
  }

  const lic = db.prepare('SELECT tokens, status FROM licenses WHERE id = ?').get(req.user.license_id);
  if (!lic) return res.status(404).json({ error: 'LICENSE_NOT_FOUND' });
  if (lic.status !== 'active') return res.status(403).json({ error: 'LICENSE_BLOCKED' });

  if (lic.tokens < cost) {
    return res.status(402).json({ error: 'INSUFFICIENT_TOKENS', remaining_tokens: lic.tokens });
  }

  db.prepare('UPDATE licenses SET tokens = tokens - ? WHERE id = ?').run(cost, req.user.license_id);
  db.prepare(
    'INSERT INTO transactions (license_id, request_id, action, cost) VALUES (?, ?, ?, ?)'
  ).run(req.user.license_id, requestId, action, cost);

  const updated = db.prepare('SELECT tokens FROM licenses WHERE id = ?').get(req.user.license_id);
  return res.json({ success: true, remaining_tokens: updated.tokens });
});

// ---------- TOPUP INFO (bKash manual) ----------
app.get('/bkash', (req, res) => {
  res.send(`<!doctype html>
  <html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>bKash Top‑Up (Manual)</title>
  <style>body{font-family:system-ui,Segoe UI,Roboto,Arial;margin:24px} .card{max-width:720px;border:1px solid #ddd;border-radius:12px;padding:16px} code{background:#f2f2f2;padding:2px 6px;border-radius:6px}</style>
  </head><body>
  <div class="card">
    <h2>bKash Top‑Up (Manual approval)</h2>
    <p>This server includes a <strong>manual</strong> bKash flow by default:</p>
    <ol>
      <li>Customer sends payment to your bKash number.</li>
      <li>Customer gives you TRXID + License ID (or key).</li>
      <li>You open <code>/admin</code> and use <strong>Manual Top‑Up</strong> to credit tokens.</li>
    </ol>
    <p>If you want the full automated bKash API integration, you can build it on top of the existing <code>topups</code> table and admin tools. (bKash requires merchant credentials and token exchange.)</p>
  </div>
  </body></html>`);
});

// ---------- ADMIN PANEL ----------
app.use('/admin', adminRouter);

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`BDRIS License Server running on http://localhost:${port}`);
  console.log(`Admin panel: /admin`);
  console.log(`Stripe topup: /stripe/topup`);
});
