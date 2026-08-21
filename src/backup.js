/**
 * RHoSAM HCM — Database Backup Service
 * Automated backups, export to CSV, restore capabilities
 */
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

/* ---- Postgres pool ---- */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
  max: 5,
  connectionTimeoutMillis: 10000
});

/* ---- Backup directory ---- */
const BACKUP_DIR = path.join(__dirname, '..', 'data', 'backups');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

/* ---- All tables to backup ---- */
const TABLES = [
  'Users', 'Employees', 'Config', 'State_LGA_Config', 'Departments',
  'Positions', 'Locations', 'Job_Levels', 'Grades', 'Titles',
  'Notifications', 'Leave_Tracker', 'Onboarding_Workflow', 'Offboarding_Workflow',
  'Sessions', 'Audit_Log', 'Chat_Messages', 'Chat_Files',
  'Assessment_Questions', 'Assessment_Assignments', 'Assessment_Responses',
  'Courses', 'Course_Assignments', 'Course_Progress',
  'Salary_Master', 'Payroll_Run', 'Deductions', 'Statutory_Config',
  'Payroll_Statutory', 'Allowances', 'Payslips', 'Bank_Details',
  'Bank_Transfer_Batches', 'Recruitment_Requisitions', 'Recruitment_Candidates',
  'Candidate_Stages', 'Goals', 'CheckIns', 'Appraisal_Cycles', 'Appraisal_Feedback',
  'Documents', 'Employee_Qualifications', 'Employee_Skills', 'Employee_Certifications',
  'Employee_WorkHistory', 'Employee_Dependents', 'Company_Assets', 'Asset_Assignments',
  'Expense_Claims', 'Expense_Items', 'Travel_Requests', 'Training_Sessions',
  'Training_Attendance', 'Engagement_Surveys', 'Engagement_Responses',
  'Exit_Interviews', 'Exit_Clearance', 'Workflow_Templates', 'Workflow_Instances',
  'Workflow_Steps', 'Companies', 'Branches', 'Company_Policies', 'Policy_Acknowledgements',
  'OKRs', 'Peer_Reviews', 'Analytics_Cache', 'Announcements', 'Announcement_Reads',
  'Employee_Contracts', 'Grievances', 'Grievance_Comments', 'Employee_Recognitions',
  'Recognition_Nominees', 'Work_Shifts', 'Shift_Assignments', 'Attendance_Log',
  'Org_Chart'
];

/* ---- Export table to CSV ---- */
async function exportTableToCSV(tableName) {
  try {
    const result = await pool.query(`SELECT * FROM "${tableName}" ORDER BY id`);
    if (result.rows.length === 0) return null;

    const headers = Object.keys(result.rows[0]).filter(h => h !== 'id');
    const csvHeader = headers.join(',');
    const csvRows = result.rows.map(row =>
      headers.map(h => {
        const val = row[h] === null || row[h] === undefined ? '' : String(row[h]);
        return `"${val.replace(/"/g, '""')}"`;
      }).join(',')
    );

    return csvHeader + '\n' + csvRows.join('\n');
  } catch (err) {
    console.error(`[BACKUP] Error exporting ${tableName}:`, err.message);
    return null;
  }
}

/* ---- Full backup (all tables) ---- */
async function createFullBackup() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(BACKUP_DIR, `backup-${timestamp}`);
  fs.mkdirSync(backupDir, { recursive: true });

  const results = { success: 0, failed: 0, empty: 0, tables: [] };

  for (const table of TABLES) {
    try {
      const csv = await exportTableToCSV(table);
      if (csv === null) {
        results.empty++;
        results.tables.push({ name: table, status: 'empty', rows: 0 });
        continue;
      }

      const filePath = path.join(backupDir, `${table}.csv`);
      fs.writeFileSync(filePath, csv, 'utf8');
      const rowCount = csv.split('\n').length - 1;
      results.success++;
      results.tables.push({ name: table, status: 'ok', rows: rowCount, file: `${table}.csv` });
    } catch (err) {
      results.failed++;
      results.tables.push({ name: table, status: 'error', error: err.message });
    }
  }

  // Create manifest
  const manifest = {
    timestamp: new Date().toISOString(),
    version: '1.0',
    tables: results.tables,
    summary: {
      total: TABLES.length,
      success: results.success,
      failed: results.failed,
      empty: results.empty
    }
  };
  fs.writeFileSync(path.join(backupDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  // Create ZIP-like summary
  const summaryPath = path.join(backupDir, 'README.md');
  const readme = `# RHoSAM HCM Backup\n\n` +
    `**Date:** ${new Date().toISOString()}\n\n` +
    `## Summary\n` +
    `- Total tables: ${TABLES.length}\n` +
    `- Exported: ${results.success}\n` +
    `- Empty: ${results.empty}\n` +
    `- Failed: ${results.failed}\n\n` +
    `## Tables\n` +
    results.tables.map(t => `- ${t.name}: ${t.rows || 0} rows`).join('\n');
  fs.writeFileSync(summaryPath, readme);

  console.log(`[BACKUP] Full backup completed: ${backupDir}`);
  console.log(`[BACKUP] ${results.success} tables exported, ${results.empty} empty, ${results.failed} failed`);

  return {
    ok: true,
    directory: backupDir,
    timestamp: new Date().toISOString(),
    summary: manifest.summary,
    tables: results.tables
  };
}

/* ---- Quick backup (key tables only) ---- */
async function createQuickBackup() {
  const keyTables = [
    'Users', 'Employees', 'Salary_Master', 'Payroll_Run', 'Leave_Tracker',
    'Departments', 'Positions', 'Locations', 'Job_Levels', 'Grades'
  ];

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(BACKUP_DIR, `quick-${timestamp}`);
  fs.mkdirSync(backupDir, { recursive: true });

  const results = [];

  for (const table of keyTables) {
    try {
      const csv = await exportTableToCSV(table);
      if (csv) {
        fs.writeFileSync(path.join(backupDir, `${table}.csv`), csv, 'utf8');
        results.push({ name: table, rows: csv.split('\n').length - 1 });
      }
    } catch (err) {
      results.push({ name: table, error: err.message });
    }
  }

  return { ok: true, directory: backupDir, tables: results };
}

/* ---- List backups ---- */
function listBackups() {
  try {
    const dirs = fs.readdirSync(BACKUP_DIR)
      .filter(d => d.startsWith('backup-') || d.startsWith('quick-'))
      .sort()
      .reverse();
    
    return dirs.map(d => {
      const manifestPath = path.join(BACKUP_DIR, d, 'manifest.json');
      let manifest = null;
      try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch (e) {}
      
      const files = fs.readdirSync(path.join(BACKUP_DIR, d));
      const totalSize = files.reduce((sum, f) => {
        try { return sum + fs.statSync(path.join(BACKUP_DIR, d, f)).size; } catch (e) { return sum; }
      }, 0);

      return {
        name: d,
        timestamp: manifest?.timestamp || d,
        type: d.startsWith('quick-') ? 'quick' : 'full',
        tables: manifest?.summary?.success || files.length - 1,
        size: `${Math.round(totalSize / 1024)}KB`
      };
    });
  } catch (err) {
    return [];
  }
}

/* ---- Get backup stats ---- */
async function getBackupStats() {
  const backups = listBackups();
  
  // Get table row counts
  const tableCounts = {};
  for (const table of TABLES.slice(0, 20)) { // Check first 20 tables
    try {
      const result = await pool.query(`SELECT COUNT(*)::int AS cnt FROM "${table}"`);
      tableCounts[table] = result.rows[0].cnt;
    } catch (err) {
      tableCounts[table] = 0;
    }
  }

  return {
    totalBackups: backups.length,
    lastBackup: backups[0] || null,
    backups: backups.slice(0, 10),
    tableCounts,
    backupDir: BACKUP_DIR
  };
}

/* ---- Cleanup old backups (keep last 7) ---- */
function cleanupOldBackups(keepCount = 7) {
  const backups = listBackups();
  if (backups.length <= keepCount) return { removed: 0 };

  const toRemove = backups.slice(keepCount);
  let removed = 0;

  for (const backup of toRemove) {
    try {
      const dirPath = path.join(BACKUP_DIR, backup.name);
      const files = fs.readdirSync(dirPath);
      for (const f of files) {
        fs.unlinkSync(path.join(dirPath, f));
      }
      fs.rmdirSync(dirPath);
      removed++;
    } catch (err) {
      console.error(`[BACKUP] Error removing ${backup.name}:`, err.message);
    }
  }

  return { removed, kept: keepCount };
}

module.exports = {
  createFullBackup,
  createQuickBackup,
  listBackups,
  getBackupStats,
  cleanupOldBackups,
  exportTableToCSV
};
