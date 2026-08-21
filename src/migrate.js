/**
 * RHoSAM HCM — Database Migration
 * Creates tables + seeds admin user (using same hash as core.js)
 * Supports --from-sheets <spreadsheetId> to import existing Google Sheets data
 * Supports --bootstrap-admin to create the initial admin user
 */
require('dotenv').config();
const crypto = require('crypto');
const https = require('https');
const { Pool } = require('pg');
const { SCHEMA } = require('./config');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false }
});

function uuid() { return crypto.randomUUID(); }
function makeHash(password, salt) {
  return crypto.createHash('sha256').update(String(salt) + '::' + String(password)).digest('base64');
}

/* ---- Google Sheets API helpers ---- */
async function getGoogleAuthToken() {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!keyJson) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON env var is required for --from-sheets');

  let credentials;
  try {
    credentials = JSON.parse(keyJson);
  } catch {
    // If it's a file path, try reading it
    const fs = require('fs');
    credentials = JSON.parse(fs.readFileSync(keyJson, 'utf8'));
  }

  const { GoogleAuth } = require('google-auth-library');
  const auth = new GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  return token.token;
}

function httpsGet(url, token) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { Authorization: `Bearer ${token}` }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`Google API error ${res.statusCode}: ${data}`));
        } else {
          resolve(JSON.parse(data));
        }
      });
    });
    req.on('error', reject);
  });
}

async function readSheetData(spreadsheetId, sheetName, token) {
  const range = `${sheetName}!A1:Z1000`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?majorDimension=ROWS`;
  const result = await httpsGet(url, token);
  const rows = result.values || [];
  if (rows.length < 2) return [];
  const headers = rows[0];
  return rows.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i] || ''; });
    return obj;
  });
}

async function getSheetNames(spreadsheetId, token) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties.title`;
  const result = await httpsGet(url, token);
  return result.sheets.map(s => s.properties.title);
}

/* ---- Import from Google Sheets ---- */
async function importFromSheets(spreadsheetId) {
  console.log(`\nImporting data from Google Sheets: ${spreadsheetId}`);

  const token = await getGoogleAuthToken();
  const sheetNames = await getSheetNames(spreadsheetId, token);
  console.log(`  Found ${sheetNames.length} sheets: ${sheetNames.join(', ')}`);

  // Map sheet names to table names (exact match)
  let imported = 0;
  let skipped = 0;
  let failed = 0;

  for (const sheetName of sheetNames) {
    // Check if this sheet maps to a known table
    const tableName = Object.values(require('./config').SHEETS).find(t => t === sheetName);
    if (!tableName) {
      console.log(`  Skipping "${sheetName}" — no matching table`);
      skipped++;
      continue;
    }

    const schema = SCHEMA[tableName];
    if (!schema) {
      console.log(`  Skipping "${sheetName}" — no schema defined`);
      skipped++;
      continue;
    }

    try {
      const rows = await readSheetData(spreadsheetId, sheetName, token);
      if (rows.length === 0) {
        console.log(`  ${sheetName}: 0 rows (empty)`);
        skipped++;
        continue;
      }

      // Ensure table exists
      await pool.query(`CREATE TABLE IF NOT EXISTS "${tableName}" (id BIGSERIAL PRIMARY KEY)`);
      const colRes = await pool.query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND lower(table_name) = $1",
        [tableName.toLowerCase()]
      );
      const have = new Set(colRes.rows.map(r => r.column_name.toLowerCase()));

      // Add missing columns
      for (const col of schema) {
        if (!have.has(col.toLowerCase())) {
          await pool.query(`ALTER TABLE "${tableName}" ADD COLUMN "${col}" TEXT`);
        }
      }

      // Check if table already has data
      const countRes = await pool.query(`SELECT COUNT(*)::int AS cnt FROM "${tableName}"`);
      if (countRes.rows[0].cnt > 0) {
        console.log(`  ${sheetName}: ${countRes.rows[0].cnt} rows already exist — skipping import`);
        skipped++;
        continue;
      }

      // Insert rows
      let inserted = 0;
      for (const row of rows) {
        const params = schema.map(col => {
          const val = row[col] !== undefined ? row[col] : '';
          return String(val);
        });

        // Skip rows where all values are empty
        if (params.every(p => p === '')) continue;

        try {
          const sql = `INSERT INTO "${tableName}" (${schema.map(c => `"${c}"`).join(',')}) VALUES (${schema.map((_, i) => '$' + (i + 1)).join(',')})`;
          await pool.query(sql, params);
          inserted++;
        } catch (err) {
          console.error(`    Row insert failed: ${err.message}`);
        }
      }

      console.log(`  ${sheetName}: imported ${inserted} rows`);
      imported++;
    } catch (err) {
      console.error(`  ${sheetName}: FAILED — ${err.message}`);
      failed++;
    }
  }

  console.log(`\nImport complete: ${imported} imported, ${skipped} skipped, ${failed} failed`);
}

/* ---- Main migration ---- */
async function migrate() {
  const args = process.argv.slice(2);
  const bootstrapAdmin = args.includes('--bootstrap-admin');
  const sheetsIdx = args.indexOf('--from-sheets');
  const spreadsheetId = sheetsIdx !== -1 ? args[sheetsIdx + 1] : null;

  console.log('RHoSAM HCM - database migration');
  console.log('Creating tables...');

  const tables = Object.keys(SCHEMA);
  let created = 0;

  for (const table of tables) {
    const cols = SCHEMA[table];
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS "${table}" (id BIGSERIAL PRIMARY KEY)`);

      const res = await pool.query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND lower(table_name) = $1",
        [table.toLowerCase()]
      );
      const have = new Set(res.rows.map(r => r.column_name.toLowerCase()));

      for (const col of cols) {
        if (!have.has(col.toLowerCase())) {
          await pool.query(`ALTER TABLE "${table}" ADD COLUMN "${col}" TEXT`);
        }
      }
      created++;
    } catch (err) {
      console.error(`  Warning: ${table} - ${err.message}`);
    }
  }

  console.log(`  RHoSAM HCM initialized (${created} tables)`);

  // Seed admin user
  const adminEmail = process.env.SETUP_EMAIL || process.env.ADMIN_EMAIL || 'admin@rhosam.com';
  const adminPassword = process.env.SETUP_PASSWORD || process.env.ADMIN_PASSWORD || 'Welcome@123';

  const salt = uuid();
  const passwordHash = makeHash(adminPassword, salt);

  const existing = await pool.query('SELECT id FROM "Users" WHERE lower("Email") = $1 LIMIT 1', [adminEmail.toLowerCase()]);

  if (existing.rows.length === 0) {
    const schema = SCHEMA.Users;
    const params = schema.map(col => {
      if (col === 'UserID') return uuid();
      if (col === 'EmployeeID') return '100001';
      if (col === 'Email') return adminEmail.toLowerCase();
      if (col === 'PasswordHash') return passwordHash;
      if (col === 'Salt') return salt;
      if (col === 'Role') return 'Admin';
      if (col === 'Status') return 'Active';
      if (col === 'MustChangePassword') return 'TRUE';
      if (col === 'CreatedAt' || col === 'UpdatedAt' || col === 'LastLogin') return new Date().toISOString();
      return '';
    });

    const sql = `INSERT INTO "Users" (${schema.map(c => `"${c}"`).join(',')}) VALUES (${schema.map((_, i) => '$' + (i + 1)).join(',')})`;
    await pool.query(sql, params);
    console.log(`  Admin created: ${adminEmail} / ${adminPassword} (change on first login)`);
  } else {
    console.log(`  Admin already exists: ${adminEmail}`);
  }

  // Import from Google Sheets if requested
  if (spreadsheetId) {
    await importFromSheets(spreadsheetId);
  }

  console.log('Done. Start the app with: npm start');
}

if (require.main === module) {
  migrate()
    .then(() => { process.exit(0); })
    .catch(err => { console.error('Migration failed:', err.message); process.exit(1); })
    .finally(() => { pool.end(); });
}

module.exports = { migrate };
