/**
 * globals.js - Data layer for RHoSAM HCM web app (Node.js + Postgres)
 * No deasync. All DB functions are async. Server dispatch handles async.
 */
const crypto = require('crypto');
const { Pool } = require('pg');
const { APP, SHEETS, SCHEMA } = require('./config');

/* ---- Postgres pool ---- */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
  max: 10,
  connectionTimeoutMillis: 10000,
  query_timeout: 20000,
  statement_timeout: 20000,
  idleTimeoutMillis: 30000
});

function serialize(v) {
  if (v instanceof Date) return v.toISOString();
  if (v === undefined || v === null) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/* ---- Cache ---- */
let _reqCache = new Map();
let _stableCache = new Map();
const STABLE_TABLES = new Set([
  SHEETS.DEPT, SHEETS.POSITIONS, SHEETS.LOCATIONS, SHEETS.JOBLEVELS,
  SHEETS.GRADES, SHEETS.STATES, SHEETS.CONFIG, SHEETS.STAT_CONFIG
]);

function clearRequestCache() { _reqCache.clear(); }
function clearAllCache() { _reqCache.clear(); _stableCache.clear(); }

/* ---- Table setup ---- */
const ensuredTables = new Set();

async function ensureHeadersAsync(table, headers) {
  if (ensuredTables.has(table)) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS "${table}" (id BIGSERIAL PRIMARY KEY)`);
  const res = await pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND lower(table_name) = $1",
    [table.toLowerCase()]
  );
  const have = new Set(res.rows.map(r => r.column_name.toLowerCase()));
  for (const h of headers) {
    if (!have.has(h.toLowerCase())) {
      await pool.query(`ALTER TABLE "${table}" ADD COLUMN "${h}" TEXT`);
    }
  }
  ensuredTables.add(table);
}

function ensureHeaders(table, headers) {
  // Sync wrapper using spawn
  const { execSync } = require('child_process');
  // Actually, let's just mark as ensured and let the async path handle it
  if (ensuredTables.has(table)) return;
  // We'll ensure on first async call
}

function rowToObj(table, r) {
  const o = { _row: r.id };
  const cols = SCHEMA[table] || [];
  for (const c of cols) o[c] = r[c] === null || r[c] === undefined ? '' : r[c];
  return o;
}

/* ---- Async DB operations ---- */
async function readRowsAsync(table) {
  if (!SCHEMA[table]) throw new Error('Unknown table: ' + table);
  await ensureHeadersAsync(table, SCHEMA[table]);
  if (_reqCache.has(table)) return _reqCache.get(table);
  if (STABLE_TABLES.has(table) && _stableCache.has(table)) {
    const cached = _stableCache.get(table);
    _reqCache.set(table, cached);
    return cached;
  }
  const r = await pool.query(`SELECT * FROM "${table}" ORDER BY id`);
  const rows = r.rows.map(row => rowToObj(table, row));
  _reqCache.set(table, rows);
  if (STABLE_TABLES.has(table)) _stableCache.set(table, rows);
  return rows;
}

async function findByFieldAsync(table, fieldName, value) {
  if (!SCHEMA[table]) throw new Error('Unknown table: ' + table);
  await ensureHeadersAsync(table, SCHEMA[table]);
  const r = await pool.query(`SELECT * FROM "${table}" WHERE "${fieldName}" = $1 LIMIT 1`, [String(value)]);
  if (!r.rows.length) return undefined;
  return rowToObj(table, r.rows[0]);
}

async function findByIdAsync(table, idField, id) {
  return findByFieldAsync(table, idField, id);
}

async function appendRowAsync(table, values) {
  if (!SCHEMA[table]) throw new Error('Unknown table: ' + table);
  await ensureHeadersAsync(table, SCHEMA[table]);
  const cols = SCHEMA[table];
  const sql = `INSERT INTO "${table}" (${cols.map(c => `"${c}"`).join(',')}) VALUES (${cols.map((_, i) => '$' + (i + 1)).join(',')})`;
  const params = cols.map((c, i) => serialize(values[i]));
  await pool.query(sql, params);
  _reqCache.delete(table);
  if (STABLE_TABLES.has(table)) _stableCache.delete(table);
}

async function updateByIdAsync(table, idField, id, patch) {
  if (!SCHEMA[table]) throw new Error('Unknown table: ' + table);
  await ensureHeadersAsync(table, SCHEMA[table]);
  const keys = Object.keys(patch || {}).filter(k => SCHEMA[table].includes(k));
  if (!keys.length) return true;
  const params = keys.map(k => serialize(patch[k]));
  params.push(String(id));
  const r = await pool.query(`UPDATE "${table}" SET ${keys.map((k, i) => `"${k}"=$${i + 1}`).join(',')} WHERE "${idField}"=$${params.length}`, params);
  if (r.rowCount === 0) throw new Error(`${table} record not found: ${id}`);
  _reqCache.delete(table);
  if (STABLE_TABLES.has(table)) _stableCache.delete(table);
  return true;
}

async function countRowsAsync(table, whereClause, params) {
  if (!SCHEMA[table]) throw new Error('Unknown table: ' + table);
  await ensureHeadersAsync(table, SCHEMA[table]);
  const sql = whereClause
    ? `SELECT COUNT(*)::int AS cnt FROM "${table}" WHERE ${whereClause}`
    : `SELECT COUNT(*)::int AS cnt FROM "${table}"`;
  const r = await pool.query(sql, params || []);
  return r.rows[0].cnt;
}

/* ---- Sync wrappers (call from async context) ---- */
// These read from cache only - no DB call
function readRows(table) {
  if (_reqCache.has(table)) return _reqCache.get(table);
  if (STABLE_TABLES.has(table) && _stableCache.has(table)) {
    const cached = _stableCache.get(table);
    _reqCache.set(table, cached);
    return cached;
  }
  throw new Error(`Table "${table}" not cached. Must call readRowsAsync first.`);
}

function findById(table, idField, id) {
  const rows = readRows(table);
  return rows.find(r => String(r[idField]) === String(id));
}

function findByField(table, fieldName, value) {
  const rows = readRows(table);
  return rows.find(r => String(r[fieldName]) === String(value));
}

function getHeaders(table) { return SCHEMA[table] || []; }

/* ---- Helpers ---- */
function uuid() { return crypto.randomUUID(); }
function normalizeEmail(v) { return String(v || '').trim().toLowerCase(); }
function norm(v) { return String(v || '').trim(); }
function makeHash(password, salt) {
  return crypto.createHash('sha256').update(String(salt) + '::' + String(password)).digest('base64');
}
function formatDate(date, tz, fmt) {
  const d = date instanceof Date ? date : new Date(date);
  const p = n => String(n).padStart(2, '0');
  return fmt.replace('yyyy', d.getFullYear()).replace('MM', p(d.getMonth() + 1)).replace('dd', p(d.getDate()));
}

/* ---- Audit (async) ---- */
async function auditAsync(action, actor, details) {
  await appendRowAsync(SHEETS.AUDIT, [new Date(), action, actor || '', JSON.stringify(details || {})]);
}

/* ---- Cache / Properties (in-memory) ---- */
const _cache = new Map();
function cache() {
  return {
    get: k => _cache.has(k) ? _cache.get(k) : null,
    put: (k, v, ttlSeconds) => {
      _cache.set(k, String(v));
      if (ttlSeconds) setTimeout(() => _cache.delete(k), ttlSeconds * 1000);
    },
    remove: k => _cache.delete(k)
  };
}

const _props = new Map();
function prop() {
  return {
    getProperty: k => _props.has(k) ? _props.get(k) : null,
    setProperty: (k, v) => { _props.set(k, String(v)); },
    deleteProperty: k => _props.delete(k)
  };
}

/* ---- Email (async) ---- */
async function sendEmailAsync(to, subject, body) {
  const key = process.env.RESEND_API_KEY;
  if (key) {
    try {
      const { Resend } = require('resend');
      const resend = new Resend(key);
      await resend.emails.send({
        from: process.env.EMAIL_FROM || 'RHoSAM HCM <onboarding@resend.dev>',
        to, subject, text: body
      });
      return;
    } catch (e) { console.error('Email send failed:', e.message); }
  }
  console.log(`[EMAIL] to=${to} subject=${subject}\n${body}`);
}

/* ---- File storage (local disk) ---- */
const path = require('path');
const fs = require('fs');
const UPLOAD_DIR = path.join(__dirname, '..', 'data', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function getOrCreateFolder(name) {
  const folderDir = path.join(UPLOAD_DIR, name.replace(/[^A-Za-z0-9_-]/g, '_'));
  fs.mkdirSync(folderDir, { recursive: true });
  return {
    createFile(blob) {
      const b = blob && blob.bytes !== undefined ? blob : { bytes: Buffer.from(String(blob || '')), mime: 'text/plain', name: 'file' };
      const id = uuid();
      fs.writeFileSync(path.join(folderDir, id), b.bytes);
      const metaPath = path.join(UPLOAD_DIR, 'meta.json');
      let meta = {};
      try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch (e) {}
      meta[id] = { folder: name, name: b.name || '', mime: b.mime || 'application/octet-stream', createdAt: new Date().toISOString() };
      fs.writeFileSync(metaPath, JSON.stringify(meta));
      return {
        getId: () => id,
        getUrl: () => '/files/' + id,
        getName: () => b.name || ''
      };
    }
  };
}

function fileUrl(id) { return '/files/' + id; }

/* ---- Utilities (shim for GAS compatibility) ---- */
function base64Decode(b64) { return Buffer.from(String(b64), 'base64'); }
function base64Encode(buf) { return Buffer.from(buf).toString('base64'); }
function newBlob(bytes, mime, name) {
  return { bytes: Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes)), mime: mime || 'text/plain', name: name || '' };
}

/* ---- Module exports ---- */
module.exports = {
  pool,
  // Async DB ops
  readRowsAsync, findByFieldAsync, findByIdAsync, appendRowAsync, updateByIdAsync, countRowsAsync, ensureHeadersAsync,
  // Sync cache reads
  readRows, findById, findByField, getHeaders, clearRequestCache, clearAllCache,
  // Helpers
  uuid, normalizeEmail, norm, makeHash, formatDate,
  base64Encode, base64Decode, newBlob,
  // Services
  auditAsync, sendEmailAsync, cache, prop,
  // File storage
  getOrCreateFolder, fileUrl,
  // Schema refs
  APP, SHEETS, SCHEMA
};
