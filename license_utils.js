const crypto = require('crypto');

function normalizeKey(key) {
  return String(key || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9-]/g, '');
}

function fingerprintKey(normalizedKey) {
  return crypto.createHash('sha256').update(normalizedKey).digest('hex');
}

function randomKey(prefix = 'BDRIS') {
  const chunk = () => crypto.randomBytes(2).toString('hex').toUpperCase();
  return `${prefix}-${chunk()}${chunk()}-${chunk()}${chunk()}-${chunk()}${chunk()}`;
}

module.exports = { normalizeKey, fingerprintKey, randomKey };
