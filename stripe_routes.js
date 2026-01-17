const express = require('express');
const Stripe = require('stripe');
const { db } = require('./db');
const bcrypt = require('bcrypt');
const { normalizeKey, fingerprintKey } = require('./license_utils');

const router = express.Router();

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key, { apiVersion: '2024-06-20' });
}

function parsePacks() {
  const raw = process.env.STRIPE_TOKEN_PACKS || '';
  // format: cents:tokens,cents:tokens
  return raw.split(',').map(s => s.trim()).filter(Boolean).map(pair => {
    const [cents, tokens] = pair.split(':').map(n => Number(n));
    return { cents, tokens };
  }).filter(p => Number.isFinite(p.cents) && Number.isFinite(p.tokens) && p.cents > 0 && p.tokens > 0);
}

router.get('/topup', (req, res) => {
  const packs = parsePacks();
  const options = packs.map(p => `<option value="${p.cents}">${p.tokens} tokens - ${(p.cents/100).toFixed(2)} ${String(process.env.STRIPE_CURRENCY||'usd').toUpperCase()}</option>`).join('');

  res.send(`<!doctype html>
  <html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>BDRIS Token Top‑Up</title>
  <style>body{font-family:system-ui,Segoe UI,Roboto,Arial;margin:24px} input,select,button{padding:10px;font-size:15px} .card{max-width:520px;border:1px solid #ddd;border-radius:12px;padding:16px} .muted{color:#666}</style>
  </head><body>
  <div class="card">
    <h2>Top up tokens (Stripe)</h2>
    <p class="muted">Enter your License Key and select a token pack.</p>
    <form method="POST" action="/stripe/create-checkout-session">
      <div style="margin-bottom:10px">
        <label>License Key</label><br>
        <input name="license_key" required style="width:100%" placeholder="BDRIS-XXXX-....">
      </div>
      <div style="margin-bottom:10px">
        <label>Token Pack</label><br>
        <select name="amount_cents" required style="width:100%">
          ${options}
        </select>
      </div>
      <button type="submit">Pay with Stripe</button>
    </form>
    <p class="muted" style="margin-top:12px">If Stripe keys are not configured, this page will not work.</p>
  </div>
  </body></html>`);
});

router.use(express.urlencoded({ extended: false }));

router.post('/create-checkout-session', async (req, res) => {
  const stripe = getStripe();
  if (!stripe) return res.status(500).send('Stripe is not configured.');

  const packs = parsePacks();
  const amountCents = Number(req.body.amount_cents);
  const pack = packs.find(p => p.cents === amountCents);
  if (!pack) return res.status(400).send('Invalid pack');

  const licenseKey = normalizeKey(req.body.license_key);
  if (!licenseKey) return res.status(400).send('Missing license key');

  const fp = fingerprintKey(licenseKey);
  const lic = db.prepare('SELECT id, key_hash, status FROM licenses WHERE key_fingerprint = ?').get(fp);
  if (!lic) return res.status(404).send('License not found');
  if (lic.status !== 'active') return res.status(403).send('License is blocked');

  const ok = await bcrypt.compare(licenseKey, lic.key_hash);
  if (!ok) return res.status(403).send('Invalid license key');

  const baseUrl = process.env.PUBLIC_BASE_URL || 'http://localhost:3000';
  const currency = (process.env.STRIPE_CURRENCY || 'usd').toLowerCase();

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    success_url: `${baseUrl}/stripe/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/stripe/cancel`,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency,
          unit_amount: pack.cents,
          product_data: {
            name: `${pack.tokens} tokens` ,
            description: 'BDRIS extension token top-up'
          }
        }
      }
    ],
    metadata: {
      license_id: String(lic.id),
      tokens: String(pack.tokens)
    }
  });

  res.redirect(303, session.url);
});

router.get('/success', (req, res) => {
  res.send('<h2>Payment received</h2><p>If your payment was successful, tokens will be credited shortly.</p>');
});

router.get('/cancel', (req, res) => {
  res.send('<h2>Payment canceled</h2><p>No changes were made.</p>');
});

// Stripe webhook: must use raw body for signature verification
router.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const stripe = getStripe();
  if (!stripe) return res.status(500).send('Stripe not configured');

  const sig = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return res.status(500).send('Webhook secret not set');

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, secret);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const licenseId = Number(session.metadata?.license_id);
    const tokens = Number(session.metadata?.tokens);
    const ref = session.id;
    const amount = session.amount_total || null;

    if (licenseId && tokens) {
      const exists = db.prepare('SELECT id FROM topups WHERE provider = ? AND provider_ref = ?').get('stripe', ref);
      if (!exists) {
        db.prepare('UPDATE licenses SET tokens = tokens + ? WHERE id = ?').run(tokens, licenseId);
        db.prepare(
          'INSERT INTO topups (license_id, provider, provider_ref, amount_cents, tokens_added, status) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(licenseId, 'stripe', ref, amount, tokens, 'succeeded');
      }
    }
  }

  res.json({ received: true });
});

module.exports = { stripeRouter: router };
