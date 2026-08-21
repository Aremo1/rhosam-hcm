/**
 * RHoSAM HCM — Express Server (Node.js)
 * Async dispatch, file uploads, proper error handling.
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../public')));

// Serve uploaded files
const DATA_DIR = path.join(__dirname, '..', 'data', 'uploads');
app.use('/files', express.static(DATA_DIR));

// Default avatar
app.get('/default-avatar.png', (req, res) => {
  const { DEFAULT_AVATAR_SVG } = require('./avatar');
  res.setHeader('Content-Type', 'image/svg+xml');
  res.send(DEFAULT_AVATAR_SVG);
});

// File upload
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('application/pdf')) {
      cb(null, true);
    } else {
      cb(new Error('Only images and PDFs are allowed'), false);
    }
  }
});

// API routes
const core = require('./core');
const modules = require('./modules');

// Build function registry
const allFunctions = { ...core, ...modules };
const API_ALLOWED = new Set(Object.keys(allFunctions));
const NO_TOKEN = new Set([
  'login', 'requestPasswordReset', 'completePasswordReset', 'resetPassword',
  'getNotificationCategories', 'dashboardForRole', 'getPermissions'
]);

// API dispatch — async
app.post('/api/:fn', async (req, res) => {
  const fn = req.params.fn;
  const start = Date.now();

  if (!API_ALLOWED.has(fn)) {
    return res.status(404).json({ error: `Unknown function: ${fn}` });
  }

  const args = req.body.args || [];

  // Token injection
  if (!NO_TOKEN.has(fn)) {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    // Inject token as first arg if not present
    if (args.length === 0 || args[0] !== token) {
      args.unshift(token);
    }
  }

  try {
    const result = await allFunctions[fn](...args);
    const ms = Date.now() - start;
    console.log(`[api] ${fn} -> ${ms}ms`);
    res.json(result);
  } catch (err) {
    const ms = Date.now() - start;
    console.error(`[api] ${fn} ERROR (${ms}ms):`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Profile picture upload (self)
app.post('/api/upload/profile', upload.single('profilePic'), async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    const session = await core.getSession(token);
    if (!session) return res.status(401).json({ error: 'Invalid session' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const base64 = req.file.buffer.toString('base64');
    const dataUrl = `data:${req.file.mimetype};base64,${base64}`;

    const { updateByIdAsync, SHEETS } = require('./globals');
    await updateByIdAsync(SHEETS.EMP, 'EmployeeID', session.employeeId, { PhotoUrl: dataUrl, UpdatedAt: new Date().toISOString() });

    res.json({ ok: true, photoUrl: dataUrl });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Admin: Upload profile picture for any employee
app.post('/api/upload/profile/:employeeId', upload.single('profilePic'), async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    const session = await core.getSession(token);
    if (!session) return res.status(401).json({ error: 'Invalid session' });
    if (!['Admin', 'HRBP'].includes(session.role)) return res.status(403).json({ error: 'Admin or HRBP role required' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const employeeId = req.params.employeeId;
    const base64 = req.file.buffer.toString('base64');
    const dataUrl = `data:${req.file.mimetype};base64,${base64}`;

    const { updateByIdAsync, SHEETS } = require('./globals');
    await updateByIdAsync(SHEETS.EMP, 'EmployeeID', employeeId, { PhotoUrl: dataUrl, UpdatedAt: new Date().toISOString() });

    res.json({ ok: true, photoUrl: dataUrl });
  } catch (err) {
    console.error('Admin upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Chat file upload
app.post('/api/upload/chat', upload.single('chatFile'), async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    const session = await core.getSession(token);
    if (!session) return res.status(401).json({ error: 'Invalid session' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const base64 = req.file.buffer.toString('base64');
    res.json({
      ok: true,
      fileData: base64,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      mimeType: req.file.mimetype
    });
  } catch (err) {
    console.error('Chat upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Bulk CSV employee import (Admin)
app.post('/api/upload/bulk-employees', upload.single('csvFile'), async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    const session = await core.getSession(token);
    if (!session) return res.status(401).json({ error: 'Invalid session' });
    if (!['Admin', 'HRBP'].includes(session.role)) return res.status(403).json({ error: 'Admin or HRBP role required' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const csv = req.file.buffer.toString('utf8');
    const lines = csv.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) return res.status(400).json({ error: 'CSV must have a header row and at least one data row' });

    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    const results = { success: 0, failed: 0, errors: [] };

    for (let i = 1; i < lines.length; i++) {
      try {
        const values = lines[i].split(',').map(v => v.trim().replace(/"/g, ''));
        const row = {};
        headers.forEach((h, idx) => { row[h] = values[idx] || ''; });

        // Map CSV columns to employee fields
        const payload = {
          FirstName: row.FirstName || row['First Name'] || '',
          LastName: row.LastName || row['Last Name'] || '',
          MiddleName: row.MiddleName || row['Middle Name'] || '',
          Email: row.Email || '',
          Phone: row.Phone || '',
          NationalID: row.NationalID || row['National ID'] || row['BVN'] || '',
          Gender: row.Gender || '',
          DOB: row.DOB || row.DateOfBirth || row['Date of Birth'] || '',
          Department: row.Department || '',
          Position: row.Position || '',
          Location: row.Location || '',
          JobLevel: row.JobLevel || row['Job Level'] || '',
          Grade: row.Grade || '',
          ManagerID: row.ManagerID || row['Manager ID'] || '',
          Title: row.Title || '',
          HireDate: row.HireDate || row['Hire Date'] || '',
          Address: row.Address || '',
          StateOfOrigin: row.StateOfOrigin || row['State of Origin'] || '',
          LGA: row.LGA || '',
          Country: row.Country || 'Nigeria'
        };

        if (!payload.FirstName || !payload.LastName || !payload.Email) {
          results.failed++;
          results.errors.push(`Row ${i + 1}: Missing required fields (FirstName, LastName, Email)`);
          continue;
        }

        await core.createEmployee(token, payload);
        results.success++;
      } catch (err) {
        results.failed++;
        results.errors.push(`Row ${i + 1}: ${err.message}`);
      }
    }

    res.json({ ok: true, ...results });
  } catch (err) {
    console.error('Bulk import error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Report CSV download
app.get('/api/reports/:type/download', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    const session = await core.getSession(token);
    if (!session) return res.status(401).json({ error: 'Invalid session' });

    const type = req.params.type;
    let csvData = '';
    let filename = '';

    if (type === 'employees') {
      if (!['Admin', 'HRBP'].includes(session.role)) return res.status(403).json({ error: 'Access denied' });
      const rows = await core._readRowsAsync(require('./config').SHEETS.EMP);
      const headers = ['EmployeeID', 'Title', 'FirstName', 'MiddleName', 'LastName', 'Email', 'Phone', 'Department', 'Position', 'Location', 'JobLevel', 'EmploymentStatus', 'HireDate'];
      csvData = headers.join(',') + '\n';
      rows.forEach(r => {
        csvData += headers.map(h => `"${String(r[h] || '').replace(/"/g, '""')}"`).join(',') + '\n';
      });
      filename = 'employees_report.csv';
    } else if (type === 'payroll') {
      if (!['Admin', 'HRBP'].includes(session.role)) return res.status(403).json({ error: 'Access denied' });
      const rows = await core._readRowsAsync(require('./config').SHEETS.PAYRUN);
      const headers = ['PayrollRunID', 'Period', 'EmployeeID', 'GrossPay', 'TotalAllowance', 'TotalDeduction', 'NetPay', 'Status'];
      csvData = headers.join(',') + '\n';
      rows.forEach(r => {
        csvData += headers.map(h => `"${String(r[h] || '').replace(/"/g, '""')}"`).join(',') + '\n';
      });
      filename = 'payroll_report.csv';
    } else if (type === 'leave') {
      const rows = await core._readRowsAsync(require('./config').SHEETS.LEAVE);
      const filtered = ['Admin', 'HRBP'].includes(session.role) ? rows : rows.filter(r => String(r.EmployeeID) === String(session.employeeId));
      const headers = ['LeaveID', 'EmployeeID', 'LeaveType', 'StartDate', 'EndDate', 'Days', 'Status'];
      csvData = headers.join(',') + '\n';
      filtered.forEach(r => {
        csvData += headers.map(h => `"${String(r[h] || '').replace(/"/g, '""')}"`).join(',') + '\n';
      });
      filename = 'leave_report.csv';
    } else if (type === 'audit') {
      if (!['Admin', 'HRBP'].includes(session.role)) return res.status(403).json({ error: 'Access denied' });
      const rows = await core._readRowsAsync(require('./config').SHEETS.AUDIT);
      const headers = ['CreatedAt', 'Action', 'Actor', 'Details'];
      csvData = headers.join(',') + '\n';
      rows.slice(0, 500).forEach(r => {
        csvData += headers.map(h => `"${String(r[h] || '').replace(/"/g, '""')}"`).join(',') + '\n';
      });
      filename = 'audit_log.csv';
    } else {
      return res.status(400).json({ error: 'Unknown report type' });
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csvData);
  } catch (err) {
    console.error('Report download error:', err);
    res.status(500).json({ error: err.message });
  }
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Initialize and start
async function start() {
  try {
    console.log('Initializing RHoSAM HCM...');
    await core.initSystem();
    await core.seedStatutoryDefaults();
    console.log('System initialized successfully');

    app.listen(PORT, () => {
      console.log(`RHoSAM HCM running at http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('Failed to initialize:', err);
    process.exit(1);
  }
}

start();
