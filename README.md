# BDRIS License Server (Node.js)

## আগের ডাটা (tokens/licences) কেন নেই?
এই সার্ভারের সব ডাটা **SQLite ফাইল** এ থাকে: `database.db` (বা `.env` এ `DB_PATH` যেটা সেট করবেন)।

আপনি যে ZIP ডাউনলোড করেছেন, সেখানে **পুরনো `database.db` ফাইলটি ছিল না**, তাই আপনার আগের লাইসেন্স/টোকেন ডাটা দেখা যাচ্ছে না।

### আপনার আগের ডাটা ফিরিয়ে আনতে
- যদি আপনার কাছে আগের সার্ভার/প্রজেক্টের `database.db` থাকে:
  1) ওই `database.db` ফাইলটি এই প্রজেক্টের রুটে কপি করুন (যেখানে `package.json` আছে)
  2) সার্ভার চালান: `npm start`

- যদি ফাইলটি অন্য নামে/অন্য লোকেশনে থাকে:
  - `.env` এ `DB_PATH=/full/path/to/database.db` সেট করুন

> **নোট:** আপনার কাছে যদি আগের `database.db` ফাইলটাই না থাকে, তাহলে আমি জাদু করে পুরনো ডাটা ফিরিয়ে দিতে পারব না। ডাটা ছিল আপনার মেশিন/হোস্টিং এ থাকা ওই ফাইলের ভেতরে।

## Quick Start
```bash
npm install
node scripts/init-db.js
npm start
```

## Useful scripts
### Export DB
```bash
node scripts/export-db.js
```
এটা `backups/database-YYYYMMDD-HHMMSS.db` বানাবে।

### Import DB (restore)
```bash
node scripts/import-db.js /path/to/your/database.db
```

### Generate licenses
```bash
node scripts/generate-licenses.js --count 50 --tokens 100
```

## Admin Panel
- URL: `/admin`
- Login: `.env` এর `ADMIN_USER` / `ADMIN_PASS`

## Stripe
- `/stripe/topup`
- Webhook: `/stripe/webhook`

## bKash
- Default: manual top-up via Admin panel.
