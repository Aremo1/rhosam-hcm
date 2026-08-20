/**
 * RHoSAM HCM — Database Migration
 * Creates tables + seeds admin user (using same hash as core.js)
 */
require('dotenv').config();
const crypto = require('crypto');
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

async function migrate() {
  console.log('RHoSAM HCM - database migration');
  console.log('Creating tables...');

  const tables = Object.keys(SCHEMA);
  let created = 0;

  for (const table of tables) {
    const cols = SCHEMA[table];
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS "${table}" (id BIGSERIAL PRIMARY KEY)`);

      // Check existing columns
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
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@rhosam.com';
  const adminPassword = process.env.ADMIN_PASSWORD || 'Welcome@123';

  const salt = uuid();
  const passwordHash = makeHash(adminPassword, salt);

  // Check if admin already exists
  const existing = await pool.query('SELECT id FROM "Users" WHERE lower("Email") = $1 LIMIT 1', [adminEmail.toLowerCase()]);

  if (existing.rows.length === 0) {
    const schema = SCHEMA.Users;
    const params = schema.map(col => {
      if (col === 'UserID') return uuid();
      if (col === 'EmployeeID') return 'RHS-ADMIN-00001';
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

  console.log('Done. Start the app with: npm start');
}

if (require.main === module) {
  migrate()
    .then(() => { process.exit(0); })
    .catch(err => { console.error('Migration failed:', err.message); process.exit(1); })
    .finally(() => { pool.end(); });
}

module.exports = { migrate };
