const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'office-balance.sqlite'));
db.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS offices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    percentage REAL NOT NULL DEFAULT 35 CHECK (percentage >= 0 AND percentage <= 100),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    office_id INTEGER NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
    total_gross REAL NOT NULL CHECK (total_gross >= 0),
    total_win REAL NOT NULL CHECK (total_win >= 0),
    cash_balance REAL,
    percentage REAL NOT NULL CHECK (percentage >= 0 AND percentage <= 100),
    record_date TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
`);
if (!db.prepare("PRAGMA table_info(records)").all().some(column => column.name === 'record_date')) {
  db.exec('ALTER TABLE records ADD COLUMN record_date TEXT');
  db.exec("UPDATE records SET record_date = substr(created_at, 1, 10) WHERE record_date IS NULL");
}

const statements = {
  userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
  userById: db.prepare('SELECT id, name, email FROM users WHERE id = ?'),
  createUser: db.prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)'),
  createOffice: db.prepare('INSERT INTO offices (user_id, name, percentage) VALUES (?, ?, ?)'),
  offices: db.prepare('SELECT id, name, percentage, created_at FROM offices WHERE user_id = ? ORDER BY name'),
  office: db.prepare('SELECT * FROM offices WHERE id = ? AND user_id = ?'),
  updateOffice: db.prepare('UPDATE offices SET name = ?, percentage = ? WHERE id = ? AND user_id = ?'),
  deleteOffice: db.prepare('DELETE FROM offices WHERE id = ? AND user_id = ?'),
  records: db.prepare('SELECT id, total_gross, total_win, cash_balance, percentage, record_date, created_at FROM records WHERE office_id = ? ORDER BY record_date DESC, created_at DESC, id DESC'),
  createRecord: db.prepare('INSERT INTO records (office_id, total_gross, total_win, cash_balance, percentage, record_date) VALUES (?, ?, ?, ?, ?, ?)'),
  updateRecord: db.prepare('UPDATE records SET total_gross = ?, total_win = ?, cash_balance = ?, percentage = ?, record_date = ? WHERE id = ? AND office_id IN (SELECT id FROM offices WHERE user_id = ?)'),
  deleteRecord: db.prepare('DELETE FROM records WHERE id = ? AND office_id IN (SELECT id FROM offices WHERE user_id = ?)'),
  session: db.prepare('SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ?'),
  saveSession: db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)'),
  deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?')
};

function json(res, status, body) {
  const output = JSON.stringify(body);
  const origin = res.req.headers.origin;
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Credentials': 'true'
  });
  res.end(output);
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, (error, derived) => {
    if (error) reject(error);
    else resolve(`${salt}:${derived.toString('hex')}`);
  }));
}

function verifyPassword(password, stored) {
  const [salt, expected] = stored.split(':');
  return new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, (error, derived) => {
    if (error) reject(error);
    else resolve(expected.length === derived.toString('hex').length &&
      crypto.timingSafeEqual(Buffer.from(expected, 'hex'), derived));
  }));
}

function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map(part => {
    const index = part.indexOf('=');
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }));
}

function setSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  statements.saveSession.run(hashToken(token), userId, Date.now() + 7 * 24 * 60 * 60 * 1000);
  res.setHeader('Set-Cookie', `session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800`);
}

function currentUser(req) {
  const token = cookies(req).session;
  if (!token) return null;
  const session = statements.session.get(hashToken(token), Date.now());
  return session ? statements.userById.get(session.user_id) : null;
}

async function body(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  if (raw.length > 1_000_000) throw new Error('Request is too large');
  return raw ? JSON.parse(raw) : {};
}

function number(value, label, optional = false) {
  if (optional && (value === null || value === undefined || value === '')) return null;
  if (value === null || value === undefined || value === '') throw new Error(`${label} is required`);
  const normalized = typeof value === 'string' ? value.replace(/,/g, '').trim() : value;
  const result = Number(normalized);
  if (!Number.isFinite(result) || result < 0) throw new Error(`${label} must be a non-negative number`);
  return result;
}

function recordDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) throw new Error('Record date is required');
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error('Record date is invalid');
  return value;
}

function calculate(gross, win, cash, percentage) {
  const net = gross * (1 - percentage / 100);
  const winNet = win * 240;
  const difference = net - winNet;
  const bto = Math.max(difference, 0);
  const bta = Math.max(-difference, 0);
  const cashDifference = bto > 0 && cash !== null ? cash - bto : null;
  return { gross, win, cash, percentage, net, winNet, bto, bta, cashDifference };
}

async function api(req, res, pathname) {
  const user = currentUser(req);
  if (pathname === '/api/register' && req.method === 'POST') {
    const input = await body(req);
    if (!input.name?.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.email || '') || (input.password || '').length < 8) {
      return json(res, 400, { error: 'Name, a valid email, and a password of at least 8 characters are required.' });
    }
    try {
      const passwordHash = await hashPassword(input.password);
      const result = statements.createUser.run(input.name.trim(), input.email.trim().toLowerCase(), passwordHash);
      statements.createOffice.run(Number(result.lastInsertRowid), 'Main Office', 35);
      setSession(res, Number(result.lastInsertRowid));
      return json(res, 201, { user: statements.userById.get(Number(result.lastInsertRowid)) });
    } catch (error) {
      if (String(error.message).includes('UNIQUE')) return json(res, 409, { error: 'An account with that email already exists.' });
      throw error;
    }
  }
  if (pathname === '/api/login' && req.method === 'POST') {
    const input = await body(req);
    const account = statements.userByEmail.get((input.email || '').trim().toLowerCase());
    if (!account || !(await verifyPassword(input.password || '', account.password_hash))) return json(res, 401, { error: 'Invalid email or password.' });
    setSession(res, account.id);
    return json(res, 200, { user: statements.userById.get(account.id) });
  }
  if (pathname === '/api/logout' && req.method === 'POST') {
    const token = cookies(req).session;
    if (token) statements.deleteSession.run(hashToken(token));
    res.setHeader('Set-Cookie', 'session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    return json(res, 200, { ok: true });
  }
  if (!user) return json(res, 401, { error: 'Please sign in.' });
  if (pathname === '/api/me' && req.method === 'GET') return json(res, 200, { user, offices: statements.offices.all(user.id) });
  if (pathname === '/api/offices' && req.method === 'POST') {
    const input = await body(req);
    const name = (input.name || '').trim();
    const percentage = input.percentage === undefined ? 35 : number(input.percentage, 'Percentage');
    if (!name || percentage > 100) return json(res, 400, { error: 'Office name and a percentage between 0 and 100 are required.' });
    const result = statements.createOffice.run(user.id, name, percentage);
    return json(res, 201, { office: statements.office.get(Number(result.lastInsertRowid), user.id) });
  }
  const officeMatch = pathname.match(/^\/api\/offices\/(\d+)$/);
  const recordsMatch = pathname.match(/^\/api\/offices\/(\d+)\/records$/);
  if (officeMatch) {
    const officeId = Number(officeMatch[1]);
    if (req.method === 'PATCH') {
      const input = await body(req);
      const name = (input.name || '').trim();
      const percentage = number(input.percentage, 'Percentage');
      if (!name || percentage > 100) return json(res, 400, { error: 'Office name and a percentage between 0 and 100 are required.' });
      statements.updateOffice.run(name, percentage, officeId, user.id);
      return json(res, 200, { office: statements.office.get(officeId, user.id) });
    }
    if (req.method === 'DELETE') {
      statements.deleteOffice.run(officeId, user.id);
      return json(res, 200, { ok: true });
    }
  }
  if (recordsMatch) {
    const officeId = Number(recordsMatch[1]);
    const office = statements.office.get(officeId, user.id);
    if (!office) return json(res, 404, { error: 'Office not found.' });
    if (req.method === 'GET') {
      const records = statements.records.all(officeId).map(record => ({
        id: record.id,
        record_date: record.record_date || record.created_at.slice(0, 10),
        created_at: record.created_at,
        total_gross: record.total_gross,
        total_win: record.total_win,
        cash_balance: record.cash_balance,
        percentage: record.percentage,
        ...calculate(record.total_gross, record.total_win, record.cash_balance, record.percentage)
      }));
      return json(res, 200, { records });
    }
    if (req.method === 'POST') {
      const input = await body(req);
      const gross = number(input.totalGross, 'Total gross');
      const win = number(input.totalWin, 'Total win');
      const cash = number(input.cashBalance, 'Cash balance', true);
      const date = recordDate(input.recordDate);
      const percentage = input.percentage === undefined ? office.percentage : number(input.percentage, 'Percentage');
      if (percentage > 100) return json(res, 400, { error: 'Percentage must be between 0 and 100.' });
      const result = calculate(gross, win, cash, percentage);
      if (result.bto > 0 && cash === null) {
        return json(res, 400, { error: 'Cash at hand is required when the result is BTO.' });
      }
      statements.createRecord.run(officeId, gross, win, cash, percentage, date);
      return json(res, 201, { record: result });
    }
  }
  const recordMatch = pathname.match(/^\/api\/records\/(\d+)$/);
  if (recordMatch && req.method === 'DELETE') {
    statements.deleteRecord.run(Number(recordMatch[1]), user.id);
    return json(res, 200, { ok: true });
  }
  if (recordMatch && req.method === 'PATCH') {
    const input = await body(req);
    const gross = number(input.totalGross, 'Total gross');
    const win = number(input.totalWin, 'Total win');
    const cash = number(input.cashBalance, 'Cash balance', true);
    const date = recordDate(input.recordDate);
    const percentage = number(input.percentage, 'Percentage');
    if (percentage > 100) return json(res, 400, { error: 'Percentage must be between 0 and 100.' });
    const result = calculate(gross, win, cash, percentage);
    if (result.bto > 0 && cash === null) return json(res, 400, { error: 'Cash at hand is required when the result is BTO.' });
    const updated = statements.updateRecord.run(gross, win, cash, percentage, date, Number(recordMatch[1]), user.id);
    if (!updated.changes) return json(res, 404, { error: 'Record not found.' });
    return json(res, 200, { record: { id: Number(recordMatch[1]), record_date: date, ...result } });
  }
  return json(res, 404, { error: 'Not found.' });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'OPTIONS') {
      const origin = req.headers.origin;
      res.writeHead(204, {
        'Access-Control-Allow-Origin': origin || '*',
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS'
      });
      return res.end();
    }
    if (url.pathname.startsWith('/api/')) return await api(req, res, url.pathname);
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Method not allowed.' });
    const requested = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const file = path.resolve(ROOT, requested);
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) return json(res, 404, { error: 'Not found.' });
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  } catch (error) {
    console.error(error);
    json(res, 500, { error: 'The server could not complete that request.' });
  }
});
server.listen(PORT, () => console.log(`Office Account Balance running at http://localhost:${PORT}`));
