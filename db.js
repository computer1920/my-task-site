const Database = require('better-sqlite3');

const db = new Database(process.env.DB_PATH || 'database.db');

function initDb() {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS licenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key_fingerprint TEXT UNIQUE,
      key_hash TEXT NOT NULL,
      tokens INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      license_id INTEGER NOT NULL,
      device_id TEXT NOT NULL,
      first_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(license_id, device_id)
    );
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      license_id INTEGER NOT NULL,
      request_id TEXT UNIQUE,
      action TEXT,
      cost INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS topups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      license_id INTEGER NOT NULL,
      provider TEXT NOT NULL,
      provider_ref TEXT,
      amount_cents INTEGER,
      tokens_added INTEGER NOT NULL,
      status TEXT DEFAULT 'succeeded',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `).run();
}

module.exports = { db, initDb };
