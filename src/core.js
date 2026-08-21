/**
 * core.js - Complete business logic for RHoSAM HCM (Node.js)
 * All functions are async. No GAS-specific APIs.
 */
const {
  pool, uuid, normalizeEmail, norm, makeHash, formatDate,
  readRowsAsync, findByFieldAsync, findByIdAsync, appendRowAsync, updateByIdAsync,
  readRows, findById, findByField, getHeaders,
  auditAsync, sendEmailAsync, cache, prop,
  getOrCreateFolder, fileUrl, base64Decode, base64Encode, newBlob,
  APP, SHEETS, SCHEMA, clearRequestCache
} = require('./globals');

const { NIGERIAN_STATES } = require('./nigerian-states');

/* ================================================================
   SYSTEM INIT / CONFIG SEEDING
   ================================================================ */
async function initSystem() {
  const tables = Object.keys(SCHEMA);
  for (const t of tables) {
    await ensureTable(t, SCHEMA[t]);
  }
  await seedConfig();
  await auditAsync('SYSTEM_INIT', 'SYSTEM', { version: '2.0' });
  return { ok: true, message: 'RHoSAM HCM initialized', tables: tables.length };
}

async function ensureTable(table, headers) {
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
}

async function seedConfig() {
  const insertIfEmpty = async (table, data) => {
    const rows = await readRowsAsync(table);
    if (rows.length === 0) {
      for (const row of data) await appendRowAsync(table, row);
    }
  };

  await insertIfEmpty(SHEETS.CONFIG, [
    ['CompanyName', 'RHoSAM', 'Brand', 'TRUE'],
    ['CountryDefault', 'Nigeria', 'HR', 'TRUE']
  ]);

  await insertIfEmpty(SHEETS.DEPT, APP.DEPARTMENTS.map(d => [d, 'TRUE']));
  await insertIfEmpty(SHEETS.POSITIONS, APP.POSITION_NAMES.map(p => [p, 'TRUE']));
  await insertIfEmpty(SHEETS.LOCATIONS, APP.OFFICE_LOCATIONS.map(l => [l, 'TRUE']));
  await insertIfEmpty(SHEETS.JOBLEVELS, APP.JOB_LEVELS.map(l => [l, 'TRUE']));
  await insertIfEmpty(SHEETS.GRADES, APP.GRADES.map(g => [g, 'TRUE']));
  await insertIfEmpty(SHEETS.TITLES, APP.TITLES.map(t => [t, 'TRUE']));

  // Seed states + LGAs
  const stateRows = await readRowsAsync(SHEETS.STATES);
  if (stateRows.length === 0) {
    for (const [state, lgas] of Object.entries(NIGERIAN_STATES)) {
      for (const lga of lgas) {
        await appendRowAsync(SHEETS.STATES, [state, lga, 'TRUE']);
      }
    }
  }

  await seedStatutoryDefaults();
}

async function seedStatutoryDefaults() {
  const rows = await readRowsAsync(SHEETS.STAT_CONFIG);
  if (rows.length > 0) return;

  const defaults = [
    ['TAX_FREE_ALLOWANCE', '300000', 'Annual tax-free personal relief (NGN)', 'TRUE'],
    ['PAYE_BAND_1_LIMIT', '300000', 'First PAYE band ceiling (NGN)', 'TRUE'],
    ['PAYE_BAND_1_RATE', '0.07', 'Rate for first band', 'TRUE'],
    ['PAYE_BAND_2_LIMIT', '500000', 'Second PAYE band ceiling (NGN)', 'TRUE'],
    ['PAYE_BAND_2_RATE', '0.11', 'Rate for second band', 'TRUE'],
    ['PAYE_BAND_3_LIMIT', '800000', 'Third PAYE band ceiling (NGN)', 'TRUE'],
    ['PAYE_BAND_3_RATE', '0.15', 'Rate for third band', 'TRUE'],
    ['PAYE_BAND_4_RATE', '0.18', 'Rate above third band', 'TRUE'],
    ['PENSION_RATE', '0.08', 'Employee pension contribution rate', 'TRUE'],
    ['NHF_RATE', '0.025', 'National Housing Fund rate', 'TRUE']
  ];
  for (const r of defaults) await appendRowAsync(SHEETS.STAT_CONFIG, r);
}

async function saveStatutoryConfig(token, key, value) {
  await requireRole(token, ['Admin']);
  const rows = await readRowsAsync(SHEETS.STAT_CONFIG);
  const existing = rows.find(r => r.Key === key);
  if (existing) {
    await updateByIdAsync(SHEETS.STAT_CONFIG, 'Key', key, { Value: String(value), UpdatedAt: new Date().toISOString() });
  } else {
    await appendRowAsync(SHEETS.STAT_CONFIG, [key, String(value), '', 'TRUE']);
  }
  return { ok: true };
}

let _dropdownCache = null;
async function getDropdownConfig() {
  if (_dropdownCache) return _dropdownCache;
  const [states, depts, positions, locations, levels, grades] = await Promise.all([
    readRowsAsync(SHEETS.STATES),
    readRowsAsync(SHEETS.DEPT),
    readRowsAsync(SHEETS.POSITIONS),
    readRowsAsync(SHEETS.LOCATIONS),
    readRowsAsync(SHEETS.JOBLEVELS),
    readRowsAsync(SHEETS.GRADES)
  ]);

  _dropdownCache = {
    states: Object.fromEntries(
      [...new Set(states.map(s => s.State || s.state || ''))].filter(Boolean).map(st => [
        st,
        states.filter(s => (s.State || s.state) === st).map(s => s.LGA || s.lga || '').filter(Boolean)
      ])
    ),
    departments: depts.filter(x => String(x.Active).toUpperCase() === 'TRUE').map(x => x.Department || x.Name || ''),
    positions: positions.filter(x => String(x.Active).toUpperCase() === 'TRUE').map(x => x.Position || x.Name || ''),
    locations: locations.filter(x => String(x.Active).toUpperCase() === 'TRUE').map(x => x.Location || x.Name || ''),
    jobLevels: levels.filter(x => String(x.Active).toUpperCase() === 'TRUE').map(x => x.JobLevel || x.Level || ''),
    grades: grades.filter(x => String(x.Active).toUpperCase() === 'TRUE').map(x => x.Grade || x.Name || ''),
    roles: APP.ROLES,
    titles: APP.TITLES,
    marital: APP.MARITAL_STATUSES,
    genders: APP.GENDERS,
    leaveTypes: APP.LEAVE_TYPES,
    empStatuses: APP.EMP_STATUSES,
    country: APP.COUNTRY_DEFAULT
  };
  return _dropdownCache;
}

/* ================================================================
   VALIDATION
   ================================================================ */
function validateNationalID(nid) {
  if (nid === undefined || nid === null || nid === '') throw new Error('National ID is required');
  const s = String(nid).trim();
  if (!/^[0-9]{1,11}$/.test(s)) throw new Error('National ID must be numeric and not more than 11 digits');
  return s;
}

function validatePhone(phone) {
  if (!phone) return '';
  const s = String(phone).trim().replace(/[^0-9]/g, '');
  if (s.length > 15) throw new Error('Phone number must not exceed 15 digits (international standard)');
  if (s.length > 0 && s.length < 7) throw new Error('Phone number must be at least 7 digits');
  return s;
}

async function validateEmployeePayload(p, existingId) {
  const email = normalizeEmail(p.Email);
  const nid = validateNationalID(p.NationalID);
  const phone = validatePhone(p.Phone);
  const first = norm(p.FirstName);
  const last = norm(p.LastName);
  const dob = norm(p.DOB || p.DateOfBirth);
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) throw new Error('Valid email is required');
  if (!first || !last) throw new Error('First name and last name are required');

  const rows = await readRowsAsync(SHEETS.EMP);
  const others = rows.filter(e => String(e.EmployeeID) !== String(existingId || ''));

  if (others.some(e => normalizeEmail(e.Email) === email)) throw new Error('Duplicate email detected');
  if (others.some(e => String(e.NationalID) === String(nid))) throw new Error('Duplicate National ID detected');
  if (dob && others.some(e =>
    norm(e.FirstName).toLowerCase() === first.toLowerCase() &&
    norm(e.LastName).toLowerCase() === last.toLowerCase() &&
    String(e.DOB || e.DateOfBirth) === String(dob)
  )) {
    throw new Error('Duplicate First Name + Last Name + DOB detected');
  }
}

function nextEmployeeId(rows) {
  let max = 100000;
  rows.forEach(r => {
    const n = Number(r.EmployeeID);
    if (!isNaN(n) && n > max) max = n;
  });
  return String(max + 1);
}

/* ================================================================
   EMPLOYEE CRUD
   ================================================================ */
async function createEmployee(token, p) {
  const me = await requireRole(token, APP.ADMIN_ROLES);
  return lockRun(async () => {
    await validateEmployeePayload(p);
    const empRows = await readRowsAsync(SHEETS.EMP);
    const id = nextEmployeeId(empRows);
    const hireDate = p.HireDate || formatDate(new Date(), APP.TZ, 'yyyy-MM-dd');
    const headers = getHeaders(SHEETS.EMP);
    const e = {
      EmployeeID: id, Title: p.Title || '', FirstName: p.FirstName, MiddleName: p.MiddleName || '',
      LastName: p.LastName, DOB: p.DOB || p.DateOfBirth || '', Gender: p.Gender || '', MaritalStatus: p.MaritalStatus || '',
      Email: normalizeEmail(p.Email), Phone: validatePhone(p.Phone), NationalID: validateNationalID(p.NationalID),
      Country: p.Country || APP.COUNTRY_DEFAULT, StateOfOrigin: p.StateOfOrigin || '', LGA: p.LGA || '',
      Address: p.Address || '', AddressState: p.AddressState || '', AddressLGA: p.AddressLGA || '',
      Department: p.Department || '', Position: p.Position || '', Location: p.Location || '',
      JobLevel: p.JobLevel || '', Grade: p.Grade || '', JobTitle: p.JobTitle || p.Position || '',
      ManagerID: p.ManagerID || '', Role: p.Role || 'Employee',
      EmploymentStatus: p.EmploymentStatus || 'Active', HireDate: hireDate, TerminationDate: '',
      PhotoFileId: '', PhotoUrl: '', CreatedAt: new Date().toISOString(), UpdatedAt: new Date().toISOString()
    };
    await appendRowAsync(SHEETS.EMP, headers.map(h => e[h] !== undefined ? e[h] : ''));
    await createUserInternal(e.Email, id, e.Role, 'Welcome@123', me.email, true);
    await appendRowAsync(SHEETS.ORG, [id, e.ManagerID, e.JobTitle, e.Department, 'TRUE']);
    await notify(id, me.employeeId, 'Onboarding', 'Welcome to RHoSAM',
      'Your profile has been created. Please upload your profile picture and change your password.');
    await auditAsync('EMPLOYEE_CREATED', me.email, { id });
    return { ok: true, employeeId: id, defaultPassword: 'Welcome@123' };
  });
}

async function updateEmployee(token, id, patch) {
  const me = await requireRole(token, APP.ADMIN_ROLES);
  return lockRun(async () => {
    const ex = await findByIdAsync(SHEETS.EMP, 'EmployeeID', id);
    if (!ex) throw new Error('Employee not found');
    if (patch.NationalID) patch.NationalID = validateNationalID(patch.NationalID);
    if (patch.Phone) patch.Phone = validatePhone(patch.Phone);
    if (patch.Email) patch.Email = normalizeEmail(patch.Email);
    patch.UpdatedAt = new Date().toISOString();
    await updateByIdAsync(SHEETS.EMP, 'EmployeeID', id, patch);
    await auditAsync('EMPLOYEE_UPDATED', me.email, { id, fields: Object.keys(patch) });
    return { ok: true };
  });
}

async function terminateEmployee(token, id, reason) {
  const me = await requireRole(token, ['Admin', 'HRBP']);
  return updateEmployee(token, id, {
    EmploymentStatus: 'Terminated',
    TerminationDate: formatDate(new Date(), APP.TZ, 'yyyy-MM-dd'),
    Status: 'Terminated'
  });
}

async function createEmployeeRecord(token, p) { return createEmployee(token, p); }
async function modifyEmployee(token, id, patch) { return updateEmployee(token, id, patch); }
async function terminateEmployeeRecord(token, id, reason) { return terminateEmployee(token, id, reason); }

async function getEmployeeById(token, id) {
  const me = await requireLogin(token);
  const emp = await findByIdAsync(SHEETS.EMP, 'EmployeeID', id);
  if (!emp) throw new Error('Employee not found');
  if (APP.ADMIN_ROLES.includes(me.role)) return { ok: true, employee: emp };
  if (String(me.employeeId) === String(id)) return { ok: true, employee: emp };
  if (APP.MANAGER_ROLES.includes(me.role)) {
    if (String(emp.ManagerID) === String(me.employeeId)) return { ok: true, employee: emp };
  }
  throw new Error('Access denied: you cannot view this employee record');
}

async function listEmployees(token) {
  const me = await requireLogin(token);
  const rows = await readRowsAsync(SHEETS.EMP);
  if (APP.ADMIN_ROLES.includes(me.role)) return { ok: true, employees: rows };
  if (me.role === 'Employee') return { ok: true, employees: rows.filter(r => String(r.EmployeeID) === String(me.employeeId)) };
  if (APP.MANAGER_ROLES.includes(me.role) || APP.PERFORMANCE_ROLES.includes(me.role)) {
    return { ok: true, employees: rows.filter(r => String(r.ManagerID) === String(me.employeeId) || String(r.EmployeeID) === String(me.employeeId)) };
  }
  return { ok: true, employees: rows.filter(r => String(r.EmployeeID) === String(me.employeeId)) };
}

async function listAllEmployeesForChat(token) {
  await requireLogin(token);
  const rows = await readRowsAsync(SHEETS.EMP);
  const active = rows.filter(e => String(e.EmploymentStatus) === 'Active');
  return { ok: true, employees: active.map(e => ({
    EmployeeID: e.EmployeeID, FirstName: e.FirstName, LastName: e.LastName,
    Email: e.Email, Department: e.Department, Photo: e.PhotoUrl || ''
  }))};
}

async function getEmployeeDirectory(token) { return listEmployees(token); }

/* ================================================================
   USER MANAGEMENT
   ================================================================ */
async function createUserInternal(email, eid, role, pass, actor, mustChange) {
  const salt = uuid();
  const hash = makeHash(pass, salt);
  await appendRowAsync(SHEETS.USERS, [
    uuid(), eid, normalizeEmail(email), hash, salt, role, 'Active',
    mustChange ? 'TRUE' : 'FALSE', '', new Date().toISOString(), new Date().toISOString()
  ]);
  await auditAsync('USER_CREATED', actor || 'SYSTEM', { email, eid, role });
}

async function adminCreateUser(token, email, eid, role, temp) {
  const me = await requireRole(token, ['Admin']);
  if (!APP.ROLES.includes(role)) throw new Error('Invalid role');
  const users = await readRowsAsync(SHEETS.USERS);
  if (users.some(u => normalizeEmail(u.Email) === normalizeEmail(email))) throw new Error('User already exists');
  await createUserInternal(email, eid, role, temp || 'Welcome@123', me.email, true);
  return { ok: true };
}

async function adminResetPassword(token, email, temp) {
  const me = await requireRole(token, ['Admin']);
  const users = await readRowsAsync(SHEETS.USERS);
  const u = users.find(x => normalizeEmail(x.Email) === normalizeEmail(email));
  if (!u) throw new Error('User not found');
  const salt = uuid();
  await updateByIdAsync(SHEETS.USERS, 'UserID', u.UserID, {
    PasswordHash: makeHash(temp || 'Welcome@123', salt), Salt: salt,
    MustChangePassword: 'TRUE', UpdatedAt: new Date().toISOString()
  });
  await auditAsync('ADMIN_PASSWORD_RESET', me.email, { email });
  return { ok: true };
}

async function addUserByAdmin(token, email, employeeId, role, tempPassword) { return adminCreateUser(token, email, employeeId, role, tempPassword); }
async function resetUserPasswordByAdmin(token, email, tempPassword) { return adminResetPassword(token, email, tempPassword); }
async function listUsers(token) {
  await requireRole(token, ['Admin']);
  const users = await readRowsAsync(SHEETS.USERS);
  return { ok: true, users: users.map(u => ({ UserID: u.UserID, EmployeeID: u.EmployeeID, Email: u.Email, Role: u.Role, Status: u.Status })) };
}

async function adminUpdateUserRole(token, email, newRole) {
  const me = await requireRole(token, ['Admin']);
  if (!APP.ROLES.includes(newRole)) throw new Error('Invalid role');
  const users = await readRowsAsync(SHEETS.USERS);
  const u = users.find(x => normalizeEmail(x.Email) === normalizeEmail(email));
  if (!u) throw new Error('User not found');
  if (normalizeEmail(u.Email) === normalizeEmail(me.email)) throw new Error('Cannot change your own role');
  await updateByIdAsync(SHEETS.USERS, 'UserID', u.UserID, {
    Role: newRole, UpdatedAt: new Date().toISOString()
  });
  // Also update the employee's Role field
  if (u.EmployeeID) {
    try {
      await updateByIdAsync(SHEETS.EMP, 'EmployeeID', u.EmployeeID, { Role: newRole, UpdatedAt: new Date().toISOString() });
    } catch (e) { /* employee may not exist */ }
  }
  await auditAsync('ROLE_UPDATED', me.email, { email, oldRole: u.Role, newRole });
  return { ok: true };
}

/* ================================================================
   AUTH / SESSIONS / PASSWORD RESET
   ================================================================ */
async function login(email, password) {
  const normEmail = normalizeEmail(email);
  const users = await pool.query('SELECT * FROM "Users" WHERE lower("Email") = $1 AND "Status" = $2 LIMIT 1', [normEmail, 'Active']);
  if (!users.rows.length) throw new Error('Invalid login');

  const u = users.rows[0];
  const hash = makeHash(password, String(u.Salt));
  if (String(u.PasswordHash) !== hash) throw new Error('Invalid login');

  const token = uuid();
  const exp = new Date(Date.now() + APP.SESSION_HOURS * 3600000).toISOString();
  await appendRowAsync(SHEETS.SESSIONS, [token, u.EmployeeID, u.Email, u.Role, exp, uuid(), new Date().toISOString(), new Date().toISOString()]);
  cache().put('session:' + token, JSON.stringify({ token, employeeId: u.EmployeeID, email: u.Email, role: u.Role, expiresAt: exp }), 21600);
  await updateByIdAsync(SHEETS.USERS, 'UserID', u.UserID, { LastLogin: new Date().toISOString(), UpdatedAt: new Date().toISOString() });

  return { ok: true, token, role: u.Role, employeeId: u.EmployeeID, mustChange: String(u.MustChangePassword).toUpperCase() === 'TRUE' };
}

async function getSession(token) {
  if (!token) return null;
  const c = cache().get('session:' + token);
  if (c) {
    try {
      const x = JSON.parse(c);
      if (new Date(x.expiresAt) > new Date()) return x;
    } catch (e) { /* invalid cache */ }
  }
  const rows = await pool.query('SELECT * FROM "Sessions" WHERE "Token" = $1 LIMIT 1', [String(token)]);
  if (!rows.rows.length) return null;
  const s = rows.rows[0];
  if (new Date(s.ExpiresAt) < new Date()) return null;
  const x = { token, employeeId: s.EmployeeID, email: s.Email, role: s.Role, expiresAt: s.ExpiresAt };
  cache().put('session:' + token, JSON.stringify(x), 21600);
  return x;
}

function touchSession() { return; }

async function requireLogin(token) {
  const s = await getSession(token);
  if (!s) throw new Error('Session expired. Please sign in again.');
  return s;
}

async function requireRole(token, roles) {
  const s = await requireLogin(token);
  if (s.role === 'Admin') return s;
  const allowed = Array.isArray(roles) ? roles : [roles];
  if (!allowed.includes(s.role)) throw new Error('Access denied for ' + s.role);
  return s;
}

async function requireEmployeeAccess(token, employeeId, opts) {
  const me = await requireLogin(token);
  const o = opts || {};
  if (o.allowAdmin !== false && APP.ADMIN_ROLES.includes(me.role)) return me;
  if (o.allowSelf !== false && String(me.employeeId) === String(employeeId)) return me;
  if (o.allowManager && APP.MANAGER_ROLES.includes(me.role)) {
    const target = await findByIdAsync(SHEETS.EMP, 'EmployeeID', employeeId);
    if (target && String(target.ManagerID) === String(me.employeeId)) return me;
  }
  throw new Error('Access denied for employee ' + employeeId);
}

async function logout(token) {
  cache().remove('session:' + token);
  try { await updateByIdAsync(SHEETS.SESSIONS, 'Token', token, { ExpiresAt: new Date().toISOString() }); } catch (e) {}
  return { ok: true };
}

async function restoreSession(token) {
  try {
    const s = await getSession(token);
    if (!s) return { ok: true, valid: false };
    return { ok: true, valid: true, token, role: s.role, employeeId: s.employeeId, email: s.email };
  } catch (e) { return { ok: false, valid: null, error: String(e.message || e) }; }
}

async function requestPasswordReset(email) {
  email = normalizeEmail(email);
  const users = await readRowsAsync(SHEETS.USERS);
  const u = users.find(x => normalizeEmail(x.Email) === email && String(x.Status) === 'Active');
  if (!u) return { ok: true, message: 'If the email exists, an OTP has been sent.' };

  const otp = String(Math.floor(100000 + Math.random() * 900000));
  prop().setProperty('otp:' + email, JSON.stringify({ otp, expires: Date.now() + APP.OTP_MINUTES * 60000 }));

  await sendEmailAsync(email, 'RHoSAM HCM - Password Reset OTP',
    `Your 6-digit OTP is ${otp}. It expires in ${APP.OTP_MINUTES} minutes.\n\nIf you did not request this, ignore this email.`);
  await auditAsync('OTP_SENT', 'SYSTEM', { email });
  return { ok: true, message: 'A 6-digit OTP has been sent to your email.' };
}

async function completePasswordReset(email, otp, newPassword) {
  email = normalizeEmail(email);
  const raw = prop().getProperty('otp:' + email);
  if (!raw) throw new Error('OTP expired or invalid');
  const o = JSON.parse(raw);
  if (Date.now() > o.expires || String(o.otp) !== String(otp)) throw new Error('OTP expired or invalid');

  const users = await readRowsAsync(SHEETS.USERS);
  const u = users.find(x => normalizeEmail(x.Email) === email);
  if (!u) throw new Error('User not found');

  const salt = uuid();
  await updateByIdAsync(SHEETS.USERS, 'UserID', u.UserID, {
    PasswordHash: makeHash(newPassword, salt), Salt: salt,
    MustChangePassword: 'FALSE', UpdatedAt: new Date().toISOString()
  });
  prop().deleteProperty('otp:' + email);
  await auditAsync('PASSWORD_RESET', 'SYSTEM', { email });
  return { ok: true };
}

async function resetPassword(email, otp, newPassword) { return completePasswordReset(email, otp, newPassword); }

/* ================================================================
   PERMISSIONS / PROFILE / DASHBOARD
   ================================================================ */
function getPermissions(role) {
  const isAdmin = role === 'Admin';
  const perms = {
    canCreateEmployee: APP.ADMIN_ROLES.includes(role),
    canModifyEmployee: APP.ADMIN_ROLES.includes(role),
    canTerminateEmployee: APP.ADMIN_ROLES.includes(role),
    canPayroll: ['Admin', 'HRBP'].includes(role),
    canRecruit: APP.RECRUITMENT_ROLES.includes(role),
    canLearn: APP.LEARNING_ROLES.includes(role),
    canPerformance: APP.PERFORMANCE_ROLES.includes(role),
    canManageUsers: isAdmin,
    canReports: role !== 'Employee',
    canAdminPanel: isAdmin,
    canResetPassword: isAdmin,
    isSuperAdmin: isAdmin,
    isEmployee: role === 'Employee',
    canViewDirectReports: APP.MANAGER_ROLES.includes(role)
  };
  if (isAdmin) Object.keys(perms).forEach(k => { if (k !== 'isEmployee') perms[k] = true; });
  return perms;
}

async function getMyProfile(token) {
  const me = await requireLogin(token);
  const emp = await findByIdAsync(SHEETS.EMP, 'EmployeeID', me.employeeId);
  return { ok: true, session: me, employee: emp, permissions: getPermissions(me.role), dropdowns: await getDropdownConfig() };
}

async function getMyPhotoUrl(token) {
  const me = await requireLogin(token);
  const e = await findByIdAsync(SHEETS.EMP, 'EmployeeID', me.employeeId) || {};
  return { ok: true, photoUrl: e.PhotoUrl || '' };
}

async function updateMyProfile(token, patch) {
  const me = await requireLogin(token);
  const allow = ['Title', 'MiddleName', 'MaritalStatus', 'Phone', 'StateOfOrigin', 'LGA', 'Address', 'AddressState', 'AddressLGA'];
  const safe = {};
  allow.forEach(k => { if (patch[k] !== undefined) safe[k] = patch[k]; });
  safe.UpdatedAt = new Date().toISOString();
  await updateByIdAsync(SHEETS.EMP, 'EmployeeID', me.employeeId, safe);
  await auditAsync('SELF_PROFILE_UPDATE', me.email, safe);
  return { ok: true };
}

async function getDashboardData(token) {
  const me = await requireLogin(token);
  const isAdmin = APP.ADMIN_ROLES.includes(me.role);
  const empRows = await readRowsAsync(SHEETS.EMP);
  const allNotif = await readRowsAsync(SHEETS.NOTIF);
  const allLeave = await readRowsAsync(SHEETS.LEAVE);
  const allChat = await readRowsAsync(SHEETS.CHAT);

  const emp = isAdmin ? empRows : empRows.filter(r =>
    String(r.ManagerID) === String(me.employeeId) || String(r.EmployeeID) === String(me.employeeId));
  const myNotif = allNotif.filter(n => String(n.ToEmployeeID) === String(me.employeeId));
  const unread = myNotif.filter(n => String(n.Status) === 'Unread').length;
  const leaveCount = allLeave.filter(x => String(x.EmployeeID) === String(me.employeeId) || isAdmin).length;
  const chatCount = allChat.filter(m => String(m.ToEmployeeID) === String(me.employeeId) && m.Status !== 'Deleted' && !m.ReadAt).length;
  const meEmp = empRows.find(e => String(e.EmployeeID) === String(me.employeeId)) || {};

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  const yearStart = new Date(currentYear, 0, 1);
  const monthStart = new Date(currentYear, currentMonth, 1);

  // Terminations
  const terminated = empRows.filter(e => e.TerminationDate || String(e.EmploymentStatus) === 'Terminated');
  const terminatedThisMonth = terminated.filter(e => {
    const d = new Date(e.TerminationDate || e.UpdatedAt || '');
    return d >= monthStart && d <= now;
  }).length;
  const terminatedYTD = terminated.filter(e => {
    const d = new Date(e.TerminationDate || e.UpdatedAt || '');
    return d >= yearStart && d <= now;
  }).length;

  // New hires YTD
  const newHiresYTD = empRows.filter(e => {
    if (!e.HireDate) return false;
    const d = new Date(e.HireDate);
    return d >= yearStart && d <= now;
  }).length;

  // Gender breakdown
  const maleCount = empRows.filter(e => String(e.Gender).toLowerCase() === 'male').length;
  const femaleCount = empRows.filter(e => String(e.Gender).toLowerCase() === 'female').length;

  return {
    ok: true,
    me, myPhoto: meEmp.PhotoUrl || '', permissions: getPermissions(me.role),
    employees: emp.slice(0, 300),
    counts: { employees: emp.length, notifications: unread, leave: leaveCount, chat: chatCount },
    dropdowns: await getDropdownConfig(),
    roleDashboard: dashboardForRole(me.role),
    recentActivity: myNotif.slice(0, 5).map(n => ({ message: n.Title + ': ' + (n.Message || ''), time: n.CreatedAt || '' })),
    stats: {
      totalEmployees: empRows.length,
      activeEmployees: empRows.filter(e => String(e.EmploymentStatus) === 'Active').length,
      pendingLeave: allLeave.filter(x => String(x.Status) === 'Submitted').length,
      newHires: newHiresYTD,
      newHiresYTD,
      terminatedThisMonth,
      terminatedYTD,
      maleCount,
      femaleCount,
      leaveBalance: 20,
      myGoals: 0,
      unreadNotifications: unread
    }
  };
}

async function resumeDashboard(token) {
  const s = await getSession(token);
  if (!s) return { ok: true, valid: false };

  const isAdmin = APP.ADMIN_ROLES.includes(s.role);
  const empRows = await readRowsAsync(SHEETS.EMP);
  const allNotif = await readRowsAsync(SHEETS.NOTIF);
  const allLeave = await readRowsAsync(SHEETS.LEAVE);
  const allChat = await readRowsAsync(SHEETS.CHAT);

  const emp = isAdmin ? empRows : empRows.filter(r =>
    String(r.ManagerID) === String(s.employeeId) || String(r.EmployeeID) === String(s.employeeId));
  const myNotif = allNotif.filter(n => String(n.ToEmployeeID) === String(s.employeeId));
  const unread = myNotif.filter(n => String(n.Status) === 'Unread').length;
  const leaveCount = allLeave.filter(x => String(x.EmployeeID) === String(s.employeeId) || isAdmin).length;
  const chatCount = allChat.filter(m => String(m.ToEmployeeID) === String(s.employeeId) && m.Status !== 'Deleted' && !m.ReadAt).length;
  const meEmp = empRows.find(e => String(e.EmployeeID) === String(s.employeeId)) || {};

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  const yearStart = new Date(currentYear, 0, 1);
  const monthStart = new Date(currentYear, currentMonth, 1);

  const terminated = empRows.filter(e => e.TerminationDate || String(e.EmploymentStatus) === 'Terminated');
  const terminatedThisMonth = terminated.filter(e => {
    const d = new Date(e.TerminationDate || e.UpdatedAt || '');
    return d >= monthStart && d <= now;
  }).length;
  const terminatedYTD = terminated.filter(e => {
    const d = new Date(e.TerminationDate || e.UpdatedAt || '');
    return d >= yearStart && d <= now;
  }).length;
  const newHiresYTD = empRows.filter(e => {
    if (!e.HireDate) return false;
    return new Date(e.HireDate) >= yearStart;
  }).length;
  const maleCount = empRows.filter(e => String(e.Gender).toLowerCase() === 'male').length;
  const femaleCount = empRows.filter(e => String(e.Gender).toLowerCase() === 'female').length;

  return {
    ok: true, valid: true, me: s, user: { email: s.email, role: s.role },
    myPhoto: meEmp.PhotoUrl || '', permissions: getPermissions(s.role),
    employees: emp.slice(0, 300),
    counts: { employees: emp.length, notifications: unread, leave: leaveCount, chat: chatCount },
    dropdowns: await getDropdownConfig(),
    roleDashboard: dashboardForRole(s.role),
    stats: {
      totalEmployees: empRows.length,
      activeEmployees: empRows.filter(e => String(e.EmploymentStatus) === 'Active').length,
      pendingLeave: allLeave.filter(x => String(x.Status) === 'Submitted').length,
      newHires: newHiresYTD,
      newHiresYTD,
      terminatedThisMonth,
      terminatedYTD,
      maleCount,
      femaleCount,
      leaveBalance: 20,
      myGoals: 0,
      unreadNotifications: unread
    }
  };
}

function dashboardForRole(role) {
  const m = {
    Admin: ['Create Employee', 'Modify Employee', 'Terminate Employee', 'User Management', 'Notifications', 'Org Chart', 'Reports', 'Payroll', 'Recruitment'],
    HRBP: ['Create Employee', 'Modify Employee', 'Terminate Employee', 'Onboarding', 'Offboarding', 'Reports', 'Org Chart', 'Notifications'],
    Employee: ['My Profile', 'My Payslips', 'Leave', 'Courses', 'Assessments', 'Chat', 'Notifications'],
    Manager: ['Team Profile', 'Approve Leave', 'Team Goals', 'Chat', 'Notifications', 'Reports'],
    'Learning Manager': ['Course Library', 'Assign Courses', 'Course Progress', 'Notifications'],
    'Talent Manager': ['Course Library', 'Assign Courses', 'Course Progress', 'Notifications'],
    'Recruitment Manager': ['Assessment Questions', 'Assign Assessment', 'Assessment Reports', 'ATS', 'Notifications'],
    'Performance Manager': ['Goals', 'Check Ins', 'Appraisals', 'Performance Dashboard', 'Notifications']
  };
  return m[role] || m.Employee;
}

async function renderDashboard(token) { return getDashboardData(token); }

/* ================================================================
   NOTIFICATIONS
   ================================================================ */
async function notify(to, from, type, title, msg, opts) {
  opts = opts || {};
  const id = uuid();
  await appendRowAsync(SHEETS.NOTIF, [
    id, to, from, type || 'General', opts.category || 'General', opts.priority || 'Normal',
    title, msg, 'Unread', opts.canApprove ? 'TRUE' : 'FALSE', opts.refType || '', opts.refId || '',
    opts.comment || '', opts.expiresAt || '', new Date().toISOString(), ''
  ]);
  return id;
}

async function listNotifications(token) {
  const me = await requireLogin(token);
  const now = new Date();
  const items = (await readRowsAsync(SHEETS.NOTIF))
    .filter(n => (String(n.ToEmployeeID) === String(me.employeeId) || APP.ADMIN_ROLES.includes(me.role))
      && (!n.ExpiresAt || new Date(n.ExpiresAt) >= now))
    .sort((a, b) => new Date(b.CreatedAt) - new Date(a.CreatedAt));
  return { ok: true, notifications: items, items };
}

async function getNotificationsFiltered(token, filter) {
  const me = await requireLogin(token);
  filter = filter || {};
  const now = new Date();
  let items = (await readRowsAsync(SHEETS.NOTIF)).filter(n =>
    String(n.ToEmployeeID) === String(me.employeeId) || APP.ADMIN_ROLES.includes(me.role));
  if (filter.status) items = items.filter(n => n.Status === filter.status);
  if (filter.category) items = items.filter(n => n.Category === filter.category);
  items = items.filter(n => !n.ExpiresAt || new Date(n.ExpiresAt) >= now);
  return { ok: true, items: items.sort((a, b) => new Date(b.CreatedAt) - new Date(a.CreatedAt)) };
}

async function getMyNotifications(token) { return listNotifications(token); }
function getNotificationCategories() { return ['General', 'Onboarding', 'Leave', 'Assessment', 'Learning', 'Payroll', 'Chat', 'Broadcast']; }

async function markAllNotificationsRead(token) {
  const me = await requireLogin(token);
  const rows = (await readRowsAsync(SHEETS.NOTIF)).filter(n =>
    String(n.ToEmployeeID) === String(me.employeeId) && n.Status === 'Unread');
  for (const n of rows) {
    await updateByIdAsync(SHEETS.NOTIF, 'NotificationID', n.NotificationID, { Status: 'Read', ActionedAt: new Date().toISOString() });
  }
  return { ok: true, updated: rows.length };
}

/* ================================================================
   LEAVE
   ================================================================ */
async function applyLeave(token, p) {
  const me = await requireLogin(token);
  const emp = await findByIdAsync(SHEETS.EMP, 'EmployeeID', me.employeeId) || {};
  
  // Check for leave conflicts (overlapping dates)
  const startDate = p.StartDate || p.startDate;
  const endDate = p.EndDate || p.endDate;
  if (startDate && endDate) {
    const allLeaves = await readRowsAsync(SHEETS.LEAVE);
    const myActiveLeaves = allLeaves.filter(l =>
      String(l.EmployeeID) === String(me.employeeId) &&
      l.Status !== 'Rejected' && l.Status !== 'Cancelled' &&
      l.StartDate && l.EndDate
    );
    for (const l of myActiveLeaves) {
      const existingStart = new Date(l.StartDate);
      const existingEnd = new Date(l.EndDate);
      const newStart = new Date(startDate);
      const newEnd = new Date(endDate);
      if (newStart <= existingEnd && newEnd >= existingStart) {
        throw new Error(`Leave overlaps with existing ${l.LeaveType || 'leave'} (${l.StartDate} to ${l.EndDate}, status: ${l.Status})`);
      }
    }
  }
  
  const id = uuid();
  await appendRowAsync(SHEETS.LEAVE, [
    id, me.employeeId, p.LeaveType || p.leaveType, p.StartDate || p.startDate, p.EndDate || p.endDate,
    p.Days || '', 'Submitted', p.ManagerID || emp.ManagerID || '', '', new Date().toISOString(), new Date().toISOString()
  ]);
  await notify(p.ManagerID || emp.ManagerID || '', me.employeeId, 'Leave Approval', 'Leave request submitted',
    me.email + ' submitted a ' + (p.LeaveType || p.leaveType || '') + ' request.',
    { category: 'Leave', priority: 'High', canApprove: true, refType: 'Leave', refId: id });
  return { ok: true, leaveId: id };
}

async function getMyLeave(token) {
  const me = await requireLogin(token);
  const rows = await readRowsAsync(SHEETS.LEAVE);
  if (APP.ADMIN_ROLES.includes(me.role)) return { ok: true, leaves: rows };
  if (me.role === 'Employee') return { ok: true, leaves: rows.filter(l => String(l.EmployeeID) === String(me.employeeId)) };
  return { ok: true, leaves: rows.filter(l => String(l.ManagerID) === String(me.employeeId) || String(l.EmployeeID) === String(me.employeeId)) };
}

async function approveLeave(token, id, decision, comment) {
  const me = await requireLogin(token);
  if (!APP.ADMIN_ROLES.includes(me.role) && !APP.MANAGER_ROLES.includes(me.role)) throw new Error('Access denied');
  const l = await findByIdAsync(SHEETS.LEAVE, 'LeaveID', id);
  if (!l) throw new Error('Leave record not found');
  if (!APP.ADMIN_ROLES.includes(me.role) && String(l.ManagerID) !== String(me.employeeId)) throw new Error('Access denied');
  await updateByIdAsync(SHEETS.LEAVE, 'LeaveID', id, {
    Status: decision === 'approve' ? 'Approved' : 'Rejected',
    Comment: comment || '', UpdatedAt: new Date().toISOString()
  });
  await notify(l.EmployeeID, me.employeeId, 'Leave ' + decision, 'Leave request ' + decision, comment || '', { category: 'Leave' });
  // Send email notification
  const emp = await findByIdAsync(SHEETS.EMP, 'EmployeeID', l.EmployeeID);
  if (emp && emp.Email) {
    const subject = `RHoSAM HCM - Leave Request ${decision === 'approve' ? 'Approved' : 'Rejected'}`;
    const body = `Dear ${emp.FirstName || 'Employee'},\n\nYour ${l.LeaveType || ''} leave request (${l.StartDate || ''} to ${l.EndDate || ''}) has been ${decision === 'approve' ? 'approved' : 'rejected'}.\n${comment ? 'Comment: ' + comment : ''}\n\nBest regards,\nRHoSAM HCM`;
    await sendEmailAsync(emp.Email, subject, body);
  }
  return { ok: true };
}

async function cancelLeave(token, leaveId) {
  const me = await requireLogin(token);
  await updateByIdAsync(SHEETS.LEAVE, 'LeaveID', leaveId, { Status: 'Cancelled', UpdatedAt: new Date().toISOString() });
  return { ok: true };
}

/* ================================================================
   EMPLOYEE SUB-RECORDS: Qualifications, Skills, Certifications, Work History
   ================================================================ */
async function saveEmployeeQualification(token, p) {
  const me = await requireLogin(token);
  const id = p.QualificationID || uuid();
  const empId = p.EmployeeID || me.employeeId;
  if (me.role === 'Employee' && empId !== me.employeeId) throw new Error('Access denied');
  if (p.QualificationID) {
    await updateByIdAsync(SHEETS.EMP_QUAL, 'QualificationID', id, { Institution: p.Institution || '', Qualification: p.Qualification || '', FieldOfStudy: p.FieldOfStudy || '', StartDate: p.StartDate || '', EndDate: p.EndDate || '', Grade: p.Grade || '', UpdatedAt: new Date().toISOString() });
  } else {
    await appendRowAsync(SHEETS.EMP_QUAL, [id, empId, p.Institution || '', p.Qualification || '', p.FieldOfStudy || '', p.StartDate || '', p.EndDate || '', p.Grade || '', new Date().toISOString(), new Date().toISOString()]);
  }
  return { ok: true, id };
}
async function getEmployeeQualifications(token, employeeId) {
  const me = await requireLogin(token);
  const eid = employeeId || me.employeeId;
  const rows = await readRowsAsync(SHEETS.EMP_QUAL);
  return rows.filter(r => String(r.EmployeeID) === String(eid));
}
async function deleteEmployeeQualification(token, qualId) {
  await requireLogin(token);
  await updateByIdAsync(SHEETS.EMP_QUAL, 'QualificationID', qualId, { DeletedAt: new Date().toISOString() });
  return { ok: true };
}

async function saveEmployeeSkill(token, p) {
  const me = await requireLogin(token);
  const id = p.SkillID || uuid();
  const empId = p.EmployeeID || me.employeeId;
  if (me.role === 'Employee' && empId !== me.employeeId) throw new Error('Access denied');
  if (p.SkillID) {
    await updateByIdAsync(SHEETS.EMP_SKILLS, 'SkillID', id, { SkillName: p.SkillName || '', Proficiency: p.Proficiency || '', YearsOfExperience: p.YearsOfExperience || '', UpdatedAt: new Date().toISOString() });
  } else {
    await appendRowAsync(SHEETS.EMP_SKILLS, [id, empId, p.SkillName || '', p.Proficiency || '', p.YearsOfExperience || '', new Date().toISOString(), new Date().toISOString()]);
  }
  return { ok: true, id };
}
async function getEmployeeSkills(token, employeeId) {
  const me = await requireLogin(token);
  const eid = employeeId || me.employeeId;
  const rows = await readRowsAsync(SHEETS.EMP_SKILLS);
  return rows.filter(r => String(r.EmployeeID) === String(eid));
}
async function deleteEmployeeSkill(token, skillId) {
  await requireLogin(token);
  await updateByIdAsync(SHEETS.EMP_SKILLS, 'SkillID', skillId, { DeletedAt: new Date().toISOString() });
  return { ok: true };
}

async function saveEmployeeCertification(token, p) {
  const me = await requireLogin(token);
  const id = p.CertificationID || uuid();
  const empId = p.EmployeeID || me.employeeId;
  if (me.role === 'Employee' && empId !== me.employeeId) throw new Error('Access denied');
  if (p.CertificationID) {
    await updateByIdAsync(SHEETS.EMP_CERTS, 'CertificationID', id, { CertName: p.CertName || '', IssuingBody: p.IssuingBody || '', IssueDate: p.IssueDate || '', ExpiryDate: p.ExpiryDate || '', CredentialID: p.CredentialID || '', Status: p.Status || 'Active', UpdatedAt: new Date().toISOString() });
  } else {
    await appendRowAsync(SHEETS.EMP_CERTS, [id, empId, p.CertName || '', p.IssuingBody || '', p.IssueDate || '', p.ExpiryDate || '', p.CredentialID || '', p.Status || 'Active', new Date().toISOString(), new Date().toISOString()]);
  }
  return { ok: true, id };
}
async function getEmployeeCertifications(token, employeeId) {
  const me = await requireLogin(token);
  const eid = employeeId || me.employeeId;
  const rows = await readRowsAsync(SHEETS.EMP_CERTS);
  return rows.filter(r => String(r.EmployeeID) === String(eid));
}
async function deleteEmployeeCertification(token, certId) {
  await requireLogin(token);
  await updateByIdAsync(SHEETS.EMP_CERTS, 'CertificationID', certId, { DeletedAt: new Date().toISOString() });
  return { ok: true };
}

async function saveEmployeeWorkHistory(token, p) {
  const me = await requireLogin(token);
  const id = p.HistoryID || uuid();
  const empId = p.EmployeeID || me.employeeId;
  if (me.role === 'Employee' && empId !== me.employeeId) throw new Error('Access denied');
  if (p.HistoryID) {
    await updateByIdAsync(SHEETS.EMP_WORK, 'HistoryID', id, { CompanyName: p.CompanyName || '', Position: p.Position || '', StartDate: p.StartDate || '', EndDate: p.EndDate || '', ReasonForLeaving: p.ReasonForLeaving || '', UpdatedAt: new Date().toISOString() });
  } else {
    await appendRowAsync(SHEETS.EMP_WORK, [id, empId, p.CompanyName || '', p.Position || '', p.StartDate || '', p.EndDate || '', p.ReasonForLeaving || '', new Date().toISOString(), new Date().toISOString()]);
  }
  return { ok: true, id };
}
async function getEmployeeWorkHistory(token, employeeId) {
  const me = await requireLogin(token);
  const eid = employeeId || me.employeeId;
  const rows = await readRowsAsync(SHEETS.EMP_WORK);
  return rows.filter(r => String(r.EmployeeID) === String(eid));
}
async function deleteEmployeeWorkHistory(token, histId) {
  await requireLogin(token);
  await updateByIdAsync(SHEETS.EMP_WORK, 'HistoryID', histId, { DeletedAt: new Date().toISOString() });
  return { ok: true };
}

/* ================================================================
   GOALS / PERFORMANCE / APPRAISALS
   ================================================================ */
async function saveGoalRecord(token, g) {
  const me = await requireLogin(token);
  const employeeId = g.EmployeeID || me.employeeId;
  if (me.role === 'Employee' && employeeId !== me.employeeId) throw new Error('Access denied');
  const id = g.GoalID || uuid();
  const headers = getHeaders(SHEETS.GOALS);
  if (g.GoalID) {
    await updateByIdAsync(SHEETS.GOALS, 'GoalID', id, { Goal: g.Goal || g.title, Status: g.Status || 'Open', DueDate: g.DueDate || g.targetDate || '', ManagerComment: g.ManagerComment || '', UpdatedAt: new Date().toISOString() });
  } else {
    await appendRowAsync(SHEETS.GOALS, headers.map(h => {
      if (h === 'GoalID') return id;
      if (h === 'EmployeeID') return employeeId;
      if (h === 'Goal') return g.Goal || g.title || '';
      if (h === 'Status') return g.Status || 'Open';
      if (h === 'DueDate') return g.DueDate || g.targetDate || '';
      if (h === 'ManagerComment') return g.ManagerComment || '';
      if (h === 'CreatedAt' || h === 'UpdatedAt') return new Date().toISOString();
      return '';
    }));
  }
  return { ok: true, goalId: id };
}

async function listGoalRecords(token, employeeId) {
  const me = await requireLogin(token);
  const rows = await readRowsAsync(SHEETS.GOALS);
  return { ok: true, goals: rows.filter(g => !employeeId || String(g.EmployeeID) === String(employeeId)) };
}

async function getGoals(token) {
  const me = await requireLogin(token);
  const rows = await readRowsAsync(SHEETS.GOALS);
  return { ok: true, goals: rows.filter(g => String(g.EmployeeID) === String(me.employeeId)) };
}

async function saveGoal(token, g) { return saveGoalRecord(token, g); }

async function createAppraisalCycle(token, p) {
  const me = await requireRole(token, APP.MANAGER_ROLES.concat(APP.PERFORMANCE_ROLES));
  if (!p.EmployeeID) throw new Error('Employee ID is required');
  const id = uuid();
  await appendRowAsync(SHEETS.APPRAISAL_CYCLES, [id, p.Title || 'Annual Appraisal', String(p.EmployeeID), String(p.ManagerID || me.employeeId), p.ReviewPeriod || '', p.Status || 'Open', p.StartDate || '', p.EndDate || '', new Date().toISOString(), new Date().toISOString()]);
  await auditAsync('APPRAISAL_CYCLE_CREATED', me.email, { id, employeeId: p.EmployeeID });
  return { ok: true, cycleId: id };
}

async function listAppraisalCycles(token, employeeId) {
  const me = await requireLogin(token);
  const rows = await readRowsAsync(SHEETS.APPRAISAL_CYCLES);
  return rows.filter(r => !employeeId || String(r.EmployeeID) === String(employeeId) || String(r.ManagerID) === String(me.employeeId));
}

async function save360Feedback(token, p) {
  const me = await requireLogin(token);
  if (!p.AppraisalCycleID) throw new Error('Appraisal cycle is required');
  if (!p.Rating) throw new Error('Rating is required');
  const id = uuid();
  await appendRowAsync(SHEETS.APPRAISAL_FEEDBACK, [id, p.AppraisalCycleID, String(p.EmployeeID || me.employeeId), String(p.ReviewerID || me.employeeId), me.role, Number(p.Rating), p.Comments || '', p.Strengths || '', p.DevelopmentAreas || '', new Date().toISOString()]);
  return { ok: true, feedbackId: id };
}

async function get360Feedback(token, employeeId, cycleId) {
  await requireLogin(token);
  const rows = await readRowsAsync(SHEETS.APPRAISAL_FEEDBACK);
  return rows.filter(r => (!employeeId || String(r.EmployeeID) === String(employeeId)) && (!cycleId || String(r.AppraisalCycleID) === String(cycleId)));
}

async function createCheckInRecord(token, p) {
  const me = await requireRole(token, APP.MANAGER_ROLES.concat(APP.PERFORMANCE_ROLES));
  await appendRowAsync(SHEETS.CHECKINS, [uuid(), p.EmployeeID, me.employeeId, p.Topic, p.Comment, p.Decision || '', new Date().toISOString()]);
  return { ok: true };
}

async function createCheckIn(token, p) { return createCheckInRecord(token, p); }

async function getPerformanceSummary(token) {
  await requireRole(token, APP.PERFORMANCE_ROLES);
  const g = await readRowsAsync(SHEETS.GOALS);
  return { open: g.filter(x => x.Status === 'Open').length, completed: g.filter(x => x.Status === 'Completed').length, goals: g };
}

/* ================================================================
   LEARNING / COURSES
   ================================================================ */
async function saveCourseRecord(token, c) {
  await requireRole(token, APP.LEARNING_ROLES.concat(APP.TALENT_ROLES));
  const id = c.CourseID || uuid();
  if (c.CourseID) {
    await updateByIdAsync(SHEETS.COURSES, 'CourseID', c.CourseID, { Title: c.Title, Description: c.Description || '', Link: c.Link || '', DurationHours: c.DurationHours || '', Active: String(c.Active || 'TRUE').toUpperCase(), UpdatedAt: new Date().toISOString() });
  } else {
    await appendRowAsync(SHEETS.COURSES, [id, c.Title || '', c.Description || '', c.Link || '', c.DurationHours || '', String(c.Active || 'TRUE').toUpperCase(), new Date().toISOString(), new Date().toISOString()]);
  }
  return { ok: true, courseId: id };
}

async function listCourseCatalog(token) {
  await requireLogin(token);
  const rows = await readRowsAsync(SHEETS.COURSES);
  return rows.filter(c => String(c.Active).toUpperCase() === 'TRUE');
}

async function saveCourse(token, c) { return saveCourseRecord(token, c); }
async function listCourses(token) { return listCourseCatalog(token); }

async function assignCourseRecord(token, p) {
  const me = await requireRole(token, APP.LEARNING_ROLES.concat(APP.TALENT_ROLES));
  const id = uuid();
  await appendRowAsync(SHEETS.COURSE_ASSIGN, [id, p.EmployeeID, p.CourseID, p.StartAt || '', p.EndAt || '', 'Assigned', me.email, new Date().toISOString(), new Date().toISOString()]);
  await notify(p.EmployeeID, me.employeeId, 'Learning', 'Course assigned', 'A course has been assigned.', { category: 'Learning', refType: 'Course', refId: id });
  return { ok: true, courseAssignId: id };
}

async function assignCourse(token, p) { return assignCourseRecord(token, p); }

async function getMyCourseAssignments(token) {
  const me = await requireLogin(token);
  const courses = await readRowsAsync(SHEETS.COURSES);
  const assigns = (await readRowsAsync(SHEETS.COURSE_ASSIGN)).filter(a => String(a.EmployeeID) === String(me.employeeId));
  const now = new Date();
  return assigns.map(a => {
    const open = (!a.StartAt || new Date(a.StartAt) <= now) && (!a.EndAt || new Date(a.EndAt) >= now);
    return { ...a, course: courses.find(x => x.CourseID === a.CourseID), open };
  });
}

async function getMyCourses(token) { return getMyCourseAssignments(token); }

/* ================================================================
   CHAT
   ================================================================ */
function threadId(a, b) { return [a, b].sort().join('__'); }

async function resolveEmployeeByEmail(token, email) {
  await requireLogin(token);
  const rows = await readRowsAsync(SHEETS.EMP);
  const e = rows.find(x => normalizeEmail(x.Email) === normalizeEmail(email) && String(x.EmploymentStatus) === 'Active');
  if (!e) throw new Error('No active employee found for that email');
  return { EmployeeID: e.EmployeeID, Name: [e.FirstName, e.LastName].join(' '), Email: e.Email };
}

async function sendChatMessage(token, toEmail, message, files) {
  const me = await requireLogin(token);
  if (!toEmail) throw new Error('Select an employee to chat with');
  if (!String(message || '').trim() && !(files && files.length)) throw new Error('Message cannot be empty');
  const target = await resolveEmployeeByEmail(token, toEmail);
  const id = uuid();
  const tid = threadId(me.employeeId, target.EmployeeID);

  // Handle file uploads
  const fileIds = [];
  for (const f of (files || [])) {
    const fid = uuid();
    // Store file info in chat
    fileIds.push(fid);
  }

  await appendRowAsync(SHEETS.CHAT, [id, tid, me.employeeId, target.EmployeeID, message || '', fileIds.join(','), '{}', 'Active', '', '', '', new Date().toISOString()]);
  await notify(target.EmployeeID, me.employeeId, 'Chat', 'New message', String(message || '[file]').slice(0, 120), { category: 'Chat', refType: 'Chat', refId: id });
  return { ok: true, messageId: id };
}

async function getChatThreadByEmail(token, otherEmail) {
  const me = await requireLogin(token);
  const target = await resolveEmployeeByEmail(token, otherEmail);
  const tid = threadId(me.employeeId, target.EmployeeID);
  const rows = (await readRowsAsync(SHEETS.CHAT)).filter(m => m.ThreadID === tid && m.Status !== 'Deleted');
  return { ok: true, messages: rows.map(m => {
    let reactions = {};
    try { reactions = JSON.parse(m.Reactions || '{}'); } catch (e) {}
    return { ...m, mine: String(m.FromEmployeeID) === String(me.employeeId), reactionMap: reactions };
  })};
}

async function editChatMessage(token, messageId, newMessage) {
  const me = await requireLogin(token);
  const m = await findByIdAsync(SHEETS.CHAT, 'MessageID', messageId);
  if (!m) throw new Error('Message not found');
  if (String(m.FromEmployeeID) !== String(me.employeeId)) throw new Error('You can only edit your own messages');
  await updateByIdAsync(SHEETS.CHAT, 'MessageID', messageId, { Message: newMessage, EditedAt: new Date().toISOString() });
  return { ok: true };
}

async function reactToMessage(token, messageId, emoji) {
  const me = await requireLogin(token);
  const m = await findByIdAsync(SHEETS.CHAT, 'MessageID', messageId);
  if (!m) throw new Error('Message not found');
  let reactions = {};
  try { reactions = JSON.parse(m.Reactions || '{}'); } catch (e) {}
  reactions[me.employeeId] = emoji;
  await updateByIdAsync(SHEETS.CHAT, 'MessageID', messageId, { Reactions: JSON.stringify(reactions) });
  return { ok: true };
}

async function deleteChatMessage(token, messageId) {
  const me = await requireLogin(token);
  const m = await findByIdAsync(SHEETS.CHAT, 'MessageID', messageId);
  if (!m) throw new Error('Message not found');
  if (String(m.FromEmployeeID) !== String(me.employeeId) && !APP.ADMIN_ROLES.includes(me.role)) throw new Error('Access denied');
  await updateByIdAsync(SHEETS.CHAT, 'MessageID', messageId, { Status: 'Deleted', DeletedAt: new Date().toISOString() });
  return { ok: true };
}

async function searchChat(token, query) {
  const me = await requireLogin(token);
  const rows = await readRowsAsync(SHEETS.CHAT);
  return rows.filter(m =>
    (String(m.FromEmployeeID) === String(me.employeeId) || String(m.ToEmployeeID) === String(me.employeeId))
    && m.Status !== 'Deleted' && String(m.Message || '').toLowerCase().includes(String(query || '').toLowerCase()));
}

async function markThreadRead(token, otherEmail) {
  const me = await requireLogin(token);
  const target = await resolveEmployeeByEmail(token, otherEmail);
  const tid = threadId(me.employeeId, target.EmployeeID);
  const rows = (await readRowsAsync(SHEETS.CHAT)).filter(m =>
    m.ThreadID === tid && String(m.ToEmployeeID) === String(me.employeeId) && !m.ReadAt && m.Status !== 'Deleted');
  for (const m of rows) {
    await updateByIdAsync(SHEETS.CHAT, 'MessageID', m.MessageID, { ReadAt: new Date().toISOString() });
  }
  return { ok: true, read: rows.length };
}

async function getRecentConversations(token) {
  const me = await requireLogin(token);
  const emp = await readRowsAsync(SHEETS.EMP);
  const rows = (await readRowsAsync(SHEETS.CHAT)).filter(m =>
    (String(m.FromEmployeeID) === String(me.employeeId) || String(m.ToEmployeeID) === String(me.employeeId)) && m.Status !== 'Deleted');
  const threads = {};
  rows.forEach(m => {
    const other = String(m.FromEmployeeID) === String(me.employeeId) ? m.ToEmployeeID : m.FromEmployeeID;
    if (!threads[other] || new Date(m.CreatedAt) > new Date(threads[other].CreatedAt)) threads[other] = m;
  });
  return { ok: true, conversations: Object.keys(threads).map(id => {
    const e = emp.find(x => String(x.EmployeeID) === String(id)) || {};
    const unread = rows.filter(m => String(m.FromEmployeeID) === String(id) && String(m.ToEmployeeID) === String(me.employeeId) && !m.ReadAt).length;
    return { employeeId: id, name: [e.FirstName, e.LastName].join(' '), email: e.Email, lastMessage: threads[id].Message || '', createdAt: threads[id].CreatedAt, unread };
  }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))};
}

async function getUnreadChatCount(token) {
  const me = await requireLogin(token);
  const rows = await readRowsAsync(SHEETS.CHAT);
  return rows.filter(m => String(m.ToEmployeeID) === String(me.employeeId) && m.Status !== 'Deleted' && !m.ReadAt).length;
}

/* ================================================================
   ORG CHART
   ================================================================ */
async function getOrgTree(token) {
  await requireLogin(token);
  const emp = (await readRowsAsync(SHEETS.EMP)).filter(e => String(e.EmploymentStatus) === 'Active');
  const byMgr = {};
  emp.forEach(e => { const m = e.ManagerID || 'ROOT'; (byMgr[m] = byMgr[m] || []).push(e); });
  function node(e) { return { id: e.EmployeeID, name: [e.FirstName, e.LastName].join(' '), title: e.JobTitle, department: e.Department, photo: e.PhotoUrl, children: (byMgr[e.EmployeeID] || []).map(node) }; }
  return { ok: true, tree: (byMgr.ROOT || emp.filter(e => !e.ManagerID)).map(node) };
}

async function getVisualOrgTree(token) { return getOrgTree(token); }

/* ================================================================
   REPORTS
   ================================================================ */
async function getStandardReport(token) {
  await requireLogin(token);
  const emp = await readRowsAsync(SHEETS.EMP);
  const active = emp.filter(e => String(e.EmploymentStatus) === 'Active');
  const terminated = emp.filter(e => String(e.EmploymentStatus) === 'Terminated');
  const departments = {};
  active.forEach(e => { const d = e.Department || 'Unassigned'; departments[d] = (departments[d] || 0) + 1; });
  return { ok: true, totalEmployees: emp.length, activeEmployees: active.length, terminatedEmployees: terminated.length, departments, byDepartment: departments, total: emp.length, active: active.length, terminated: terminated.length };
}

async function getAuditLog(token, filter) {
  await requireRole(token, ['Admin', 'HRBP']);
  const rows = await readRowsAsync(SHEETS.AUDIT);
  let filtered = rows;
  if (filter?.action) filtered = filtered.filter(r => String(r.Action || '').includes(filter.action));
  if (filter?.actor) filtered = filtered.filter(r => String(r.Actor || '').includes(filter.actor));
  return { items: filtered.slice(0, filter?.limit || 200).reverse() };
}

async function listActiveSessions(token) {
  await requireRole(token, ['Admin', 'HRBP']);
  const sessions = (await readRowsAsync(SHEETS.SESSIONS)).filter(s => new Date(s.ExpiresAt) > new Date());
  const emp = await readRowsAsync(SHEETS.EMP);
  return sessions.map(s => {
    const e = emp.find(x => String(x.EmployeeID) === String(s.EmployeeID)) || {};
    return { ...s, name: [e.FirstName, e.LastName].join(' ') || s.Email };
  });
}

async function getTurnoverReport(token) {
  await requireRole(token, APP.ADMIN_ROLES);
  const emp = await readRowsAsync(SHEETS.EMP);
  const now = new Date();
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    const label = d.toLocaleString('default', { month: 'short', year: 'numeric' });
    const hires = emp.filter(e => {
      if (!e.HireDate) return false;
      const hd = new Date(e.HireDate);
      return hd >= d && hd <= monthEnd;
    }).length;
    const terms = emp.filter(e => {
      if (!e.TerminationDate) return false;
      const td = new Date(e.TerminationDate);
      return td >= d && td <= monthEnd;
    }).length;
    months.push({ month: label, hires, terminations: terms });
  }
  return { ok: true, months };
}

async function getPayrollSummaryReport(token, period) {
  await requireRole(token, APP.ADMIN_ROLES.concat(['HRBP']));
  const runs = period ? (await readRowsAsync(SHEETS.PAYRUN)).filter(r => r.Period === period) : await readRowsAsync(SHEETS.PAYRUN);
  const emp = await readRowsAsync(SHEETS.EMP);
  const byDept = {};
  let totalGross = 0, totalNet = 0, totalDeductions = 0;
  for (const r of runs) {
    const e = emp.find(x => String(x.EmployeeID) === String(r.EmployeeID)) || {};
    const dept = e.Department || 'Unassigned';
    if (!byDept[dept]) byDept[dept] = { count: 0, gross: 0, net: 0, deductions: 0 };
    byDept[dept].count++;
    byDept[dept].gross += Number(r.GrossPay || 0);
    byDept[dept].net += Number(r.NetPay || 0);
    byDept[dept].deductions += Number(r.TotalDeduction || 0);
    totalGross += Number(r.GrossPay || 0);
    totalNet += Number(r.NetPay || 0);
    totalDeductions += Number(r.TotalDeduction || 0);
  }
  return { ok: true, totalEmployees: runs.length, totalGross, totalNet, totalDeductions, byDepartment: byDept };
}

async function getLeaveUtilizationReport(token) {
  await requireRole(token, APP.ADMIN_ROLES.concat(['HRBP', 'Manager']));
  const leaves = await readRowsAsync(SHEETS.LEAVE);
  const emp = await readRowsAsync(SHEETS.EMP);
  const byType = {}, byDept = {};
  for (const l of leaves) {
    const type = l.LeaveType || 'Unknown';
    byType[type] = (byType[type] || 0) + 1;
    const e = emp.find(x => String(x.EmployeeID) === String(l.EmployeeID)) || {};
    const dept = e.Department || 'Unassigned';
    if (!byDept[dept]) byDept[dept] = { total: 0, approved: 0, rejected: 0, pending: 0 };
    byDept[dept].total++;
    if (l.Status === 'Approved') byDept[dept].approved++;
    else if (l.Status === 'Rejected') byDept[dept].rejected++;
    else byDept[dept].pending++;
  }
  return { ok: true, total: leaves.length, byType, byDepartment: byDept };
}

async function getHeadcountReport(token) {
  await requireRole(token, APP.ADMIN_ROLES);
  const emp = await readRowsAsync(SHEETS.EMP);
  const active = emp.filter(e => String(e.EmploymentStatus) === 'Active');
  const byDept = {}, byGender = {}, byLocation = {}, byLevel = {}, byGrade = {};
  active.forEach(e => {
    const d = e.Department || 'Unassigned'; byDept[d] = (byDept[d] || 0) + 1;
    const g = (e.Gender || 'Unknown').toLowerCase(); byGender[g] = (byGender[g] || 0) + 1;
    const l = e.Location || 'Unassigned'; byLocation[l] = (byLocation[l] || 0) + 1;
    const lv = e.JobLevel || 'Unassigned'; byLevel[lv] = (byLevel[lv] || 0) + 1;
    const gr = e.Grade || 'Unassigned'; byGrade[gr] = (byGrade[gr] || 0) + 1;
  });
  return { ok: true, total: active.length, byDepartment: byDept, byGender, byLocation, byLevel, byGrade };
}

/* ================================================================
   DOCUMENTS / WORKFLOW
   ================================================================ */
async function getEmployeeDocuments(token, employeeId) {
  const me = await requireLogin(token);
  const target = employeeId || me.employeeId;
  const rows = await readRowsAsync(SHEETS.DOCS);
  return rows.filter(d => String(d.EmployeeID) === String(target));
}

async function uploadEmployeeDocument(token, employeeId, docType, fileName, fileData) {
  const me = await requireLogin(token);
  const target = employeeId || me.employeeId;
  if (me.role === 'Employee' && target !== me.employeeId) throw new Error('Access denied');
  const id = uuid();
  await appendRowAsync(SHEETS.DOCS, [
    id, target, docType || 'Other', fileName || '', '',
    fileData ? '/files/' + id : '', new Date().toISOString()
  ]);
  return { ok: true, documentId: id };
}

async function deleteEmployeeDocument(token, docId) {
  const me = await requireLogin(token);
  if (!APP.ADMIN_ROLES.includes(me.role)) throw new Error('Admin access required');
  await updateByIdAsync(SHEETS.DOCS, 'DocumentID', docId, { Url: '', FileName: '[deleted]' });
  return { ok: true };
}

async function createOnboarding(eid) {
  const tasks = ['Validate employee data', 'Issue access credentials', 'Assign manager', 'Upload documents', 'Welcome orientation'];
  for (const t of tasks) {
    await appendRowAsync(SHEETS.ONBOARD, [uuid(), eid, t, 'HRBP', 'Open', '', '', new Date().toISOString(), new Date().toISOString()]);
  }
}

async function createOffboarding(eid, reason) {
  const tasks = ['Disable system access', 'Recover company assets', 'Finalize payroll exit', 'Archive employee file', 'Exit clearance'];
  for (const t of tasks) {
    await appendRowAsync(SHEETS.OFFBOARD, [uuid(), eid, t, 'HRBP', 'Open', '', reason || '', new Date().toISOString(), new Date().toISOString()]);
  }
}

async function updateWorkflowTask(token, type, taskId, status, comment) {
  const me = await requireLogin(token);
  if (!APP.ADMIN_ROLES.includes(me.role) && !APP.MANAGER_ROLES.includes(me.role)) throw new Error('Access denied');
  const table = type === 'onboarding' ? SHEETS.ONBOARD : SHEETS.OFFBOARD;
  const idField = type === 'onboarding' ? 'WorkflowID' : 'WorkflowID';
  await updateByIdAsync(table, idField, taskId, {
    Status: status || 'Complete', Comment: comment || '', UpdatedAt: new Date().toISOString()
  });
  return { ok: true };
}

async function getWorkflow(token, type) {
  const me = await requireLogin(token);
  const table = type === 'onboarding' ? SHEETS.ONBOARD : SHEETS.OFFBOARD;
  const rows = await readRowsAsync(table);
  if (APP.ADMIN_ROLES.includes(me.role)) return rows;
  return rows.filter(r => String(r.EmployeeID) === String(me.employeeId));
}

/* ================================================================
   EMPLOYEE DEPENDENTS
   ================================================================ */
async function saveEmployeeDependent(token, p) {
  const me = await requireLogin(token);
  const id = p.DependentID || uuid();
  const empId = p.EmployeeID || me.employeeId;
  if (me.role === 'Employee' && empId !== me.employeeId) throw new Error('Access denied');
  if (p.DependentID) {
    await updateByIdAsync(SHEETS.EMP_DEPENDENTS, 'DependentID', id, {
      FullName: p.FullName || '', Relationship: p.Relationship || '', DateOfBirth: p.DateOfBirth || '',
      Gender: p.Gender || '', Phone: p.Phone || '', IsEmergencyContact: p.IsEmergencyContact || 'FALSE',
      UpdatedAt: new Date().toISOString()
    });
  } else {
    await appendRowAsync(SHEETS.EMP_DEPENDENTS, [
      id, empId, p.FullName || '', p.Relationship || '', p.DateOfBirth || '',
      p.Gender || '', p.Phone || '', p.IsEmergencyContact || 'FALSE',
      new Date().toISOString(), new Date().toISOString()
    ]);
  }
  return { ok: true, dependentId: id };
}

async function getEmployeeDependents(token, employeeId) {
  const me = await requireLogin(token);
  const eid = employeeId || me.employeeId;
  const rows = await readRowsAsync(SHEETS.EMP_DEPENDENTS);
  return rows.filter(r => String(r.EmployeeID) === String(eid));
}

async function deleteEmployeeDependent(token, dependentId) {
  await requireLogin(token);
  await updateByIdAsync(SHEETS.EMP_DEPENDENTS, 'DependentID', dependentId, { DeletedAt: new Date().toISOString() });
  return { ok: true };
}

/* ================================================================
   EMAIL NOTIFICATIONS
   ================================================================ */
async function sendBirthdayReminders() {
  const emp = (await readRowsAsync(SHEETS.EMP)).filter(e => String(e.EmploymentStatus) === 'Active');
  const today = new Date();
  const todayStr = `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  for (const e of emp) {
    if (!e.DOB) continue;
    const dob = new Date(e.DOB);
    const dobStr = `${String(dob.getMonth() + 1).padStart(2, '0')}-${String(dob.getDate()).padStart(2, '0')}`;
    if (dobStr === todayStr) {
      const admins = (await readRowsAsync(SHEETS.USERS)).filter(u => APP.ADMIN_ROLES.includes(u.Role));
      for (const a of admins) {
        await notify(a.EmployeeID, 'SYSTEM', 'Broadcast', `Happy Birthday ${e.FirstName}!`,
          `${e.FirstName} ${e.LastName} from ${e.Department || 'Unknown'} has a birthday today.`, { category: 'General' });
      }
      await sendEmailAsync(e.Email, 'Happy Birthday from RHoSAM HCM!',
        `Dear ${e.FirstName},\n\nWishing you a wonderful birthday! 🎂\n\nBest regards,\nRHoSAM HCM Team`);
    }
  }
  return { ok: true };
}

async function checkProbationReviews() {
  const emp = (await readRowsAsync(SHEETS.EMP)).filter(e => String(e.EmploymentStatus) === 'Probation' && e.HireDate);
  const now = new Date();
  for (const e of emp) {
    const hireDate = new Date(e.HireDate);
    const daysSinceHire = Math.floor((now - hireDate) / (1000 * 60 * 60 * 24));
    if (daysSinceHire >= 90 && daysSinceHire <= 92) {
      const managerEmp = emp.find(m => String(m.EmployeeID) === String(e.ManagerID));
      if (managerEmp) {
        const user = (await readRowsAsync(SHEETS.USERS)).find(u => normalizeEmail(u.Email) === normalizeEmail(managerEmp.Email));
        if (user) {
          await notify(user.EmployeeID, 'SYSTEM', 'Onboarding', 'Probation Review Due',
            `${e.FirstName} ${e.LastName}'s 3-month probation review is due.`, { category: 'General' });
        }
      }
      const admins = (await readRowsAsync(SHEETS.USERS)).filter(u => APP.ADMIN_ROLES.includes(u.Role));
      for (const a of admins) {
        await notify(a.EmployeeID, 'SYSTEM', 'Onboarding', 'Probation Review Due',
          `${e.FirstName} ${e.LastName}'s 3-month probation review is due (hired ${e.HireDate}).`, { category: 'General' });
      }
    }
  }
  return { ok: true };
}

/* ================================================================
   ASSET MANAGEMENT
   ================================================================ */
async function createAsset(token, p) {
  await requireRole(token, APP.ADMIN_ROLES.concat(['HRBP']));
  const id = uuid();
  await appendRowAsync(SHEETS.ASSETS, [
    id, p.AssetName || '', p.AssetTag || '', p.Category || '', p.SerialNumber || '',
    p.PurchaseDate || '', p.PurchaseCost || '0', p.CurrentValue || '0', 'Available',
    p.Condition || 'Good', p.Location || '', '', p.Notes || '',
    new Date().toISOString(), new Date().toISOString()
  ]);
  return { ok: true, assetId: id };
}

async function listAssets(token) {
  await requireRole(token, APP.ADMIN_ROLES.concat(['HRBP']));
  return { ok: true, assets: await readRowsAsync(SHEETS.ASSETS) };
}

async function assignAsset(token, assetId, employeeId, notes) {
  await requireRole(token, APP.ADMIN_ROLES.concat(['HRBP']));
  const id = uuid();
  await updateByIdAsync(SHEETS.ASSETS, 'AssetID', assetId, { Status: 'Assigned', AssignedTo: employeeId, UpdatedAt: new Date().toISOString() });
  await appendRowAsync(SHEETS.ASSET_ASSIGNMENTS, [
    id, assetId, employeeId, new Date().toISOString(), '', 'Good', 'Active', notes || '', new Date().toISOString()
  ]);
  return { ok: true, assignmentId: id };
}

async function returnAsset(token, assetId, condition, notes) {
  await requireRole(token, APP.ADMIN_ROLES.concat(['HRBP']));
  await updateByIdAsync(SHEETS.ASSETS, 'AssetID', assetId, { Status: 'Available', AssignedTo: '', Condition: condition || 'Good', UpdatedAt: new Date().toISOString() });
  const assigns = (await readRowsAsync(SHEETS.ASSET_ASSIGNMENTS)).filter(a => String(a.AssetID) === String(assetId) && a.Status === 'Active');
  for (const a of assigns) {
    await updateByIdAsync(SHEETS.ASSET_ASSIGNMENTS, 'AssignmentID', a.AssignmentID, { Status: 'Returned', ReturnedDate: new Date().toISOString(), Condition: condition || 'Good', Notes: notes || '' });
  }
  return { ok: true };
}

async function deleteAsset(token, assetId) {
  await requireRole(token, APP.ADMIN_ROLES);
  await updateByIdAsync(SHEETS.ASSETS, 'AssetID', assetId, { Status: 'Disposed', UpdatedAt: new Date().toISOString() });
  return { ok: true };
}

async function getMyAssets(token) {
  const me = await requireLogin(token);
  const assets = await readRowsAsync(SHEETS.ASSETS);
  return assets.filter(a => String(a.AssignedTo) === String(me.employeeId));
}

/* ================================================================
   TRAVEL & EXPENSE
   ================================================================ */
async function createExpenseClaim(token, p) {
  const me = await requireLogin(token);
  const id = uuid();
  await appendRowAsync(SHEETS.EXPENSE_CLAIMS, [
    id, me.employeeId, p.Period || '', Number(p.TotalAmount || 0), p.Currency || 'NGN',
    'Submitted', '', '', '', p.Notes || '', new Date().toISOString(), new Date().toISOString()
  ]);
  // Add expense items
  for (const item of (p.Items || [])) {
    await appendRowAsync(SHEETS.EXPENSE_ITEMS, [
      uuid(), id, item.Category || '', item.Description || '', Number(item.Amount || 0),
      item.ReceiptUrl || '', item.Date || '', new Date().toISOString()
    ]);
  }
  // Notify manager
  const emp = await findByIdAsync(SHEETS.EMP, 'EmployeeID', me.employeeId);
  if (emp && emp.ManagerID) {
    await notify(emp.ManagerID, me.employeeId, 'Expense Approval', 'Expense claim submitted',
      `${me.email} submitted an expense claim of ₦${Number(p.TotalAmount || 0).toLocaleString()}`,
      { category: 'General', canApprove: true, refType: 'Expense', refId: id });
  }
  return { ok: true, claimId: id };
}

async function getMyExpenseClaims(token) {
  const me = await requireLogin(token);
  const claims = await readRowsAsync(SHEETS.EXPENSE_CLAIMS);
  if (APP.ADMIN_ROLES.includes(me.role)) return claims;
  if (APP.MANAGER_ROLES.includes(me.role)) {
    const teamIds = (await readRowsAsync(SHEETS.EMP)).filter(e => String(e.ManagerID) === String(me.employeeId)).map(e => e.EmployeeID);
    return claims.filter(c => String(c.EmployeeID) === String(me.employeeId) || teamIds.includes(c.EmployeeID));
  }
  return claims.filter(c => String(c.EmployeeID) === String(me.employeeId));
}

async function approveExpenseClaim(token, claimId, decision, comment) {
  const me = await requireLogin(token);
  if (!APP.ADMIN_ROLES.includes(me.role) && !APP.MANAGER_ROLES.includes(me.role)) throw new Error('Access denied');
  const status = decision === 'approve' ? 'Approved' : 'Rejected';
  await updateByIdAsync(SHEETS.EXPENSE_CLAIMS, 'ClaimID', claimId, {
    Status: status, ApprovedBy: me.employeeId, ApprovedAt: new Date().toISOString(),
    Notes: comment || '', UpdatedAt: new Date().toISOString()
  });
  const claim = await findByIdAsync(SHEETS.EXPENSE_CLAIMS, 'ClaimID', claimId);
  if (claim) await notify(claim.EmployeeID, me.employeeId, 'Expense ' + decision, 'Expense claim ' + decision, comment || '', { category: 'General' });
  return { ok: true };
}

async function createTravelRequest(token, p) {
  const me = await requireLogin(token);
  const id = uuid();
  await appendRowAsync(SHEETS.TRAVEL_REQUESTS, [
    id, me.employeeId, p.Destination || '', p.Purpose || '',
    p.DepartDate || '', p.ReturnDate || '', p.EstimatedCost || '0',
    'Submitted', '', '', p.Notes || '', new Date().toISOString(), new Date().toISOString()
  ]);
  const emp = await findByIdAsync(SHEETS.EMP, 'EmployeeID', me.employeeId);
  if (emp && emp.ManagerID) {
    await notify(emp.ManagerID, me.employeeId, 'Travel Approval', 'Travel request submitted',
      `${me.email} requested travel to ${p.Destination || 'Unknown'}`,
      { category: 'General', canApprove: true, refType: 'Travel', refId: id });
  }
  return { ok: true, requestId: id };
}

async function getMyTravelRequests(token) {
  const me = await requireLogin(token);
  const requests = await readRowsAsync(SHEETS.TRAVEL_REQUESTS);
  if (APP.ADMIN_ROLES.includes(me.role)) return requests;
  return requests.filter(r => String(r.EmployeeID) === String(me.employeeId));
}

async function approveTravelRequest(token, requestId, decision, comment) {
  const me = await requireLogin(token);
  if (!APP.ADMIN_ROLES.includes(me.role) && !APP.MANAGER_ROLES.includes(me.role)) throw new Error('Access denied');
  const status = decision === 'approve' ? 'Approved' : 'Rejected';
  await updateByIdAsync(SHEETS.TRAVEL_REQUESTS, 'RequestID', requestId, {
    Status: status, ApprovedBy: me.employeeId, ApprovedAt: new Date().toISOString(),
    Notes: comment || '', UpdatedAt: new Date().toISOString()
  });
  const req = await findByIdAsync(SHEETS.TRAVEL_REQUESTS, 'RequestID', requestId);
  if (req) await notify(req.EmployeeID, me.employeeId, 'Travel ' + decision, 'Travel request ' + decision, comment || '', { category: 'General' });
  return { ok: true };
}

/* ================================================================
   TRAINING CALENDAR
   ================================================================ */
async function createTrainingSession(token, p) {
  await requireRole(token, APP.LEARNING_ROLES.concat(APP.ADMIN_ROLES));
  const id = uuid();
  await appendRowAsync(SHEETS.TRAINING_SESSIONS, [
    id, p.Title || '', p.Description || '', p.Trainer || '', p.Location || '',
    p.StartDate || '', p.EndDate || '', p.StartTime || '', p.EndTime || '',
    p.MaxParticipants || '0', 'Scheduled', p.CourseID || '',
    new Date().toISOString(), new Date().toISOString()
  ]);
  return { ok: true, sessionId: id };
}

async function listTrainingSessions(token) {
  await requireLogin(token);
  return { ok: true, sessions: await readRowsAsync(SHEETS.TRAINING_SESSIONS) };
}

async function registerForTraining(token, sessionId) {
  const me = await requireLogin(token);
  const id = uuid();
  await appendRowAsync(SHEETS.TRAINING_ATTENDANCE, [
    id, sessionId, me.employeeId, 'Registered', '', '', new Date().toISOString()
  ]);
  return { ok: true, attendanceId: id };
}

async function markTrainingAttendance(token, sessionId, employeeId, status, score) {
  await requireRole(token, APP.LEARNING_ROLES.concat(APP.ADMIN_ROLES));
  const rows = (await readRowsAsync(SHEETS.TRAINING_ATTENDANCE)).filter(a => String(a.SessionID) === String(sessionId) && String(a.EmployeeID) === String(employeeId));
  if (rows.length > 0) {
    await updateByIdAsync(SHEETS.TRAINING_ATTENDANCE, 'AttendanceID', rows[0].AttendanceID, { Status: status || 'Attended', Score: score || '' });
  }
  return { ok: true };
}

async function getTrainingAttendance(token, sessionId) {
  await requireLogin(token);
  const rows = (await readRowsAsync(SHEETS.TRAINING_ATTENDANCE)).filter(a => String(a.SessionID) === String(sessionId));
  const emp = await readRowsAsync(SHEETS.EMP);
  return rows.map(r => {
    const e = emp.find(x => String(x.EmployeeID) === String(r.EmployeeID)) || {};
    return { ...r, Name: [e.FirstName, e.LastName].join(' ') };
  });
}

async function getMyTrainingRegistrations(token) {
  const me = await requireLogin(token);
  const rows = await readRowsAsync(SHEETS.TRAINING_ATTENDANCE);
  return rows.filter(r => String(r.EmployeeID) === String(me.employeeId));
}

/* ================================================================
   EMPLOYEE ENGAGEMENT
   ================================================================ */
async function createEngagementSurvey(token, p) {
  await requireRole(token, APP.ADMIN_ROLES.concat(['HRBP', 'Performance Manager']));
  const id = uuid();
  await appendRowAsync(SHEETS.ENGAGEMENT_SURVEYS, [
    id, p.Title || '', p.Description || '', JSON.stringify(p.Questions || []),
    p.StartDate || '', p.EndDate || '', 'Active', me?.employeeId || '',
    new Date().toISOString(), new Date().toISOString()
  ]);
  return { ok: true, surveyId: id };
}

async function listEngagementSurveys(token) {
  await requireLogin(token);
  return { ok: true, surveys: await readRowsAsync(SHEETS.ENGAGEMENT_SURVEYS) };
}

async function submitEngagementResponse(token, surveyId, answers) {
  const me = await requireLogin(token);
  const id = uuid();
  await appendRowAsync(SHEETS.ENGAGEMENT_RESPONSES, [
    id, surveyId, me.employeeId, JSON.stringify(answers || {}), new Date().toISOString()
  ]);
  return { ok: true, responseId: id };
}

async function getEngagementResults(token, surveyId) {
  await requireRole(token, APP.ADMIN_ROLES.concat(['HRBP', 'Performance Manager']));
  const responses = (await readRowsAsync(SHEETS.ENGAGEMENT_RESPONSES)).filter(r => String(r.SurveyID) === String(surveyId));
  return { ok: true, totalResponses: responses.length, responses };
}

/* ================================================================
   SEPARATION / EXIT MANAGEMENT
   ================================================================ */
async function createExitInterview(token, p) {
  await requireRole(token, APP.ADMIN_ROLES.concat(['HRBP']));
  const id = uuid();
  await appendRowAsync(SHEETS.EXIT_INTERVIEWS, [
    id, p.EmployeeID || '', p.InterviewerID || '',
    JSON.stringify(p.Questions || []), JSON.stringify(p.Answers || {}),
    p.OverallRating || '', p.Recommendations || '', 'Open', '',
    new Date().toISOString()
  ]);
  return { ok: true, interviewId: id };
}

async function completeExitInterview(token, interviewId, answers, rating, recommendations) {
  const me = await requireLogin(token);
  await updateByIdAsync(SHEETS.EXIT_INTERVIEWS, 'InterviewID', interviewId, {
    Answers: JSON.stringify(answers || {}), OverallRating: rating || '',
    Recommendations: recommendations || '', Status: 'Completed',
    CompletedAt: new Date().toISOString()
  });
  return { ok: true };
}

async function getExitInterviews(token) {
  await requireRole(token, APP.ADMIN_ROLES.concat(['HRBP']));
  const rows = await readRowsAsync(SHEETS.EXIT_INTERVIEWS);
  const emp = await readRowsAsync(SHEETS.EMP);
  return rows.map(r => {
    const e = emp.find(x => String(x.EmployeeID) === String(r.EmployeeID)) || {};
    return { ...r, EmployeeName: [e.FirstName, e.LastName].join(' ') };
  });
}

async function createExitClearance(token, employeeId) {
  await requireRole(token, APP.ADMIN_ROLES.concat(['HRBP']));
  const tasks = ['Return IT Equipment', 'Return Access Cards', 'Clear Outstanding Loans', 'Handover Projects', 'Exit Interview Completed', 'Final Pay Processing', 'Update Employee Status'];
  const departments = ['IT', 'HR', 'Finance', 'Operations', 'Admin', 'HR', 'Payroll'];
  for (let i = 0; i < tasks.length; i++) {
    await appendRowAsync(SHEETS.EXIT_CLEARANCE, [
      uuid(), employeeId, departments[i] || '', tasks[i], 'Pending', '', '', '',
      new Date().toISOString(), new Date().toISOString()
    ]);
  }
  return { ok: true };
}

async function getExitClearance(token, employeeId) {
  await requireLogin(token);
  const rows = (await readRowsAsync(SHEETS.EXIT_CLEARANCE)).filter(r => String(r.EmployeeID) === String(employeeId));
  return rows;
}

async function updateExitClearance(token, clearanceId, status, clearedBy, notes) {
  await requireRole(token, APP.ADMIN_ROLES.concat(['HRBP']));
  await updateByIdAsync(SHEETS.EXIT_CLEARANCE, 'ClearanceID', clearanceId, {
    Status: status || 'Cleared', ClearedBy: clearedBy || '',
    ClearedAt: new Date().toISOString(), Notes: notes || '',
    UpdatedAt: new Date().toISOString()
  });
  return { ok: true };
}

/* ================================================================
   WORKFLOW AUTOMATION
   ================================================================ */
async function createWorkflowTemplate(token, p) {
  await requireRole(token, APP.ADMIN_ROLES);
  const id = uuid();
  await appendRowAsync(SHEETS.WORKFLOW_TEMPLATES, [
    id, p.Name || '', p.Type || 'General', JSON.stringify(p.Steps || []),
    'TRUE', me?.employeeId || '', new Date().toISOString(), new Date().toISOString()
  ]);
  return { ok: true, templateId: id };
}

async function listWorkflowTemplates(token) {
  await requireRole(token, APP.ADMIN_ROLES);
  return { ok: true, templates: await readRowsAsync(SHEETS.WORKFLOW_TEMPLATES) };
}

async function startWorkflow(token, templateId, targetEmployeeId) {
  const me = await requireLogin(token);
  const template = await findByIdAsync(SHEETS.WORKFLOW_TEMPLATES, 'TemplateID', templateId);
  if (!template) throw new Error('Template not found');
  const steps = JSON.parse(template.Steps || '[]');
  const instanceId = uuid();
  await appendRowAsync(SHEETS.WORKFLOW_INSTANCES, [
    instanceId, templateId, me.employeeId, targetEmployeeId || '', 'In Progress', '0',
    new Date().toISOString(), '', new Date().toISOString()
  ]);
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    await appendRowAsync(SHEETS.WORKFLOW_STEPS, [
      uuid(), instanceId, step.name || step, step.assignTo || '', i === 0 ? 'Pending' : 'Waiting', '', '', new Date().toISOString()
    ]);
    // Notify assignee
    if (step.assignTo) {
      await notify(step.assignTo, me.employeeId, 'Workflow', 'New task assigned',
        `You have a new task: ${step.name || step}`, { category: 'General', refType: 'Workflow', refId: instanceId });
    }
  }
  return { ok: true, instanceId };
}

async function getMyWorkflows(token) {
  const me = await requireLogin(token);
  const instances = await readRowsAsync(SHEETS.WORKFLOW_INSTANCES);
  const steps = await readRowsAsync(SHEETS.WORKFLOW_STEPS);
  const myInstances = instances.filter(i => String(i.InitiatorID) === String(me.employeeId));
  const mySteps = steps.filter(s => String(s.AssignedTo) === String(me.employeeId));
  return { ok: true, initiated: myInstances, assigned: mySteps };
}

async function completeWorkflowStep(token, stepId, status, comment) {
  const me = await requireLogin(token);
  await updateByIdAsync(SHEETS.WORKFLOW_STEPS, 'StepID', stepId, {
    Status: status || 'Completed', Comment: comment || '', CompletedAt: new Date().toISOString()
  });
  // Check if instance is complete
  const step = await findByIdAsync(SHEETS.WORKFLOW_STEPS, 'StepID', stepId);
  if (step) {
    const allSteps = (await readRowsAsync(SHEETS.WORKFLOW_STEPS)).filter(s => String(s.InstanceID) === String(step.InstanceID));
    const allDone = allSteps.every(s => s.Status === 'Completed');
    if (allDone) {
      await updateByIdAsync(SHEETS.WORKFLOW_INSTANCES, 'InstanceID', step.InstanceID, {
        Status: 'Completed', CompletedAt: new Date().toISOString()
      });
    }
  }
  return { ok: true };
}

/* ================================================================
   MULTI-COMPANY / BRANCHES
   ================================================================ */
async function createCompany(token, p) {
  await requireRole(token, ['Admin']);
  const id = uuid();
  await appendRowAsync(SHEETS.COMPANIES, [
    id, p.Name || '', p.RegistrationNumber || '', p.Address || '',
    p.Phone || '', p.Email || '', p.Logo || '', p.DefaultCurrency || 'NGN',
    'Active', new Date().toISOString(), new Date().toISOString()
  ]);
  return { ok: true, companyId: id };
}

async function listCompanies(token) {
  await requireLogin(token);
  return { ok: true, companies: await readRowsAsync(SHEETS.COMPANIES) };
}

async function createBranch(token, p) {
  await requireRole(token, ['Admin']);
  const id = uuid();
  await appendRowAsync(SHEETS.BRANCHES, [
    id, p.CompanyID || '', p.Name || '', p.Address || '', p.State || '',
    p.Phone || '', p.ManagerID || '', 'Active', new Date().toISOString(), new Date().toISOString()
  ]);
  return { ok: true, branchId: id };
}

async function listBranches(token, companyId) {
  await requireLogin(token);
  const branches = await readRowsAsync(SHEETS.BRANCHES);
  if (companyId) return branches.filter(b => String(b.CompanyID) === String(companyId));
  return branches;
}

/* ================================================================
   COMPLIANCE & POLICY
   ================================================================ */
async function createPolicy(token, p) {
  await requireRole(token, APP.ADMIN_ROLES);
  const id = uuid();
  await appendRowAsync(SHEETS.POLICIES, [
    id, p.Title || '', p.Category || 'General', p.Content || '',
    p.Version || '1.0', p.EffectiveDate || '', p.ReviewDate || '',
    'Active', me?.employeeId || '', new Date().toISOString(), new Date().toISOString()
  ]);
  // Notify all employees
  const employees = (await readRowsAsync(SHEETS.EMP)).filter(e => String(e.EmploymentStatus) === 'Active');
  for (const e of employees.slice(0, 50)) {
    await notify(e.EmployeeID, 'SYSTEM', 'Policy', 'New policy published',
      `New policy: ${p.Title || ''}`, { category: 'General', refType: 'Policy', refId: id });
  }
  return { ok: true, policyId: id };
}

async function listPolicies(token) {
  await requireLogin(token);
  return { ok: true, policies: await readRowsAsync(SHEETS.POLICIES) };
}

async function acknowledgePolicy(token, policyId) {
  const me = await requireLogin(token);
  const existing = (await readRowsAsync(SHEETS.POLICY_ACK)).find(a => String(a.PolicyID) === String(policyId) && String(a.EmployeeID) === String(me.employeeId));
  if (!existing) {
    await appendRowAsync(SHEETS.POLICY_ACK, [
      uuid(), policyId, me.employeeId, new Date().toISOString(), ''
    ]);
  }
  return { ok: true };
}

async function getPolicyAcknowledgements(token, policyId) {
  await requireRole(token, APP.ADMIN_ROLES);
  const acks = (await readRowsAsync(SHEETS.POLICY_ACK)).filter(a => String(a.PolicyID) === String(policyId));
  const emp = await readRowsAsync(SHEETS.EMP);
  return acks.map(a => {
    const e = emp.find(x => String(x.EmployeeID) === String(a.EmployeeID)) || {};
    return { ...a, Name: [e.FirstName, e.LastName].join(' ') };
  });
}

/* ================================================================
   PERFORMANCE REVIEWS (OKRs + Peer Reviews)
   ================================================================ */
async function saveOKR(token, p) {
  const me = await requireLogin(token);
  const empId = p.EmployeeID || me.employeeId;
  const id = p.OKRID || uuid();
  if (p.OKRID) {
    await updateByIdAsync(SHEETS.OKRs, 'OKRID', id, {
      Objective: p.Objective || '', KeyResults: JSON.stringify(p.KeyResults || []),
      Progress: p.Progress || '0', Status: p.Status || 'In Progress',
      ManagerComment: p.ManagerComment || '', UpdatedAt: new Date().toISOString()
    });
  } else {
    await appendRowAsync(SHEETS.OKRs, [
      id, empId, p.Objective || '', JSON.stringify(p.KeyResults || []),
      p.Quarter || '', p.Year || new Date().getFullYear().toString(),
      p.Progress || '0', p.Status || 'In Progress', p.ManagerComment || '',
      new Date().toISOString(), new Date().toISOString()
    ]);
  }
  return { ok: true, okrId: id };
}

async function getMyOKRs(token) {
  const me = await requireLogin(token);
  const rows = await readRowsAsync(SHEETS.OKRs);
  if (APP.ADMIN_ROLES.includes(me.role) || APP.MANAGER_ROLES.includes(me.role)) return rows;
  return rows.filter(r => String(r.EmployeeID) === String(me.employeeId));
}

async function submitPeerReview(token, p) {
  const me = await requireLogin(token);
  const id = uuid();
  await appendRowAsync(SHEETS.PEER_REVIEWS, [
    id, me.employeeId, p.RevieweeID || '', p.ReviewPeriod || '',
    JSON.stringify(p.Questions || []), JSON.stringify(p.Answers || {}),
    p.OverallRating || '', p.Strengths || '', p.Improvements || '',
    'Submitted', new Date().toISOString()
  ]);
  return { ok: true, reviewId: id };
}

async function getMyPeerReviews(token) {
  const me = await requireLogin(token);
  const rows = await readRowsAsync(SHEETS.PEER_REVIEWS);
  return rows.filter(r => String(r.RevieweeID) === String(me.employeeId) || String(r.ReviewerID) === String(me.employeeId));
}

/* ================================================================
   ADVANCED ANALYTICS
   ================================================================ */
async function getAdvancedAnalytics(token) {
  await requireRole(token, APP.ADMIN_ROLES);
  const emp = await readRowsAsync(SHEETS.EMP);
  const leaves = await readRowsAsync(SHEETS.LEAVE);
  const salaries = await readRowsAsync(SHEETS.SALARY);
  const payruns = await readRowsAsync(SHEETS.PAYRUN);
  
  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1);
  
  // Headcount trends (monthly hires for current year)
  const monthlyHires = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), i, 1);
    const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    const hires = emp.filter(e => { if (!e.HireDate) return false; const hd = new Date(e.HireDate); return hd >= d && hd <= monthEnd; }).length;
    const terms = emp.filter(e => { if (!e.TerminationDate) return false; const td = new Date(e.TerminationDate); return td >= d && td <= monthEnd; }).length;
    monthlyHires.push({ month: d.toLocaleString('default', { month: 'short' }), hires, terminations: terms });
  }
  
  // Department distribution
  const byDept = {};
  emp.filter(e => String(e.EmploymentStatus) === 'Active').forEach(e => {
    const d = e.Department || 'Unassigned'; byDept[d] = (byDept[d] || 0) + 1;
  });
  
  // Gender breakdown
  const gender = { male: emp.filter(e => String(e.Gender).toLowerCase() === 'male').length, female: emp.filter(e => String(e.Gender).toLowerCase() === 'female').length };
  
  // Leave utilization
  const leaveByType = {};
  leaves.forEach(l => { leaveByType[l.LeaveType || 'Unknown'] = (leaveByType[l.LeaveType || 'Unknown'] || 0) + 1; });
  
  // Payroll summary
  const totalGross = payruns.reduce((s, r) => s + Number(r.GrossPay || 0), 0);
  const totalNet = payruns.reduce((s, r) => s + Number(r.NetPay || 0), 0);
  const totalDeductions = payruns.reduce((s, r) => s + Number(r.TotalDeduction || 0), 0);
  
  return {
    ok: true,
    headcount: { total: emp.length, active: emp.filter(e => String(e.EmploymentStatus) === 'Active').length, terminated: emp.filter(e => String(e.EmploymentStatus) === 'Terminated').length },
    monthlyTrend: monthlyHires,
    byDepartment: byDept,
    gender,
    leaveByType,
    payroll: { totalGross, totalNet, totalDeductions, runs: payruns.length },
    salaryAvg: salaries.length ? Math.round(salaries.reduce((s, r) => s + Number(r.Basic || 0), 0) / salaries.length) : 0
  };
}

/* ================================================================
   EMPLOYEE SELF-SERVICE
   ================================================================ */
async function selfServiceUpdateProfile(token, patch) {
  const me = await requireLogin(token);
  const allowed = ['Phone', 'Address', 'AddressState', 'AddressLGA', 'LinkedInUrl', 'TwitterUrl', 'PortfolioUrl', 'PersonalStatement', 'Allergies'];
  const safe = {};
  allowed.forEach(k => { if (patch[k] !== undefined) safe[k] = patch[k]; });
  if (Object.keys(safe).length === 0) throw new Error('No valid fields to update');
  safe.UpdatedAt = new Date().toISOString();
  await updateByIdAsync(SHEETS.EMP, 'EmployeeID', me.employeeId, safe);
  await auditAsync('SELF_SERVICE_UPDATE', me.email, { fields: Object.keys(safe) });
  return { ok: true };
}

async function submitChangeRequest(token, p) {
  const me = await requireLogin(token);
  await notify(p.ManagerID || '', me.employeeId, 'Change Request', 'Profile change request',
    `${me.email} requests: ${p.field || ''} changed from "${p.oldValue || ''}" to "${p.newValue || ''}"`,
    { category: 'General', canApprove: true, refType: 'ChangeRequest' });
  return { ok: true };
}

/* ================================================================
   CUSTOM REPORTS
   ================================================================ */
async function generateCustomReport(token, p) {
  await requireRole(token, APP.ADMIN_ROLES.concat(['HRBP']));
  const emp = await readRowsAsync(SHEETS.EMP);
  let filtered = emp;
  
  // Apply filters
  if (p.department) filtered = filtered.filter(e => e.Department === p.department);
  if (p.location) filtered = filtered.filter(e => e.Location === p.location);
  if (p.jobLevel) filtered = filtered.filter(e => String(e.JobLevel) === String(p.jobLevel));
  if (p.grade) filtered = filtered.filter(e => e.Grade === p.grade);
  if (p.gender) filtered = filtered.filter(e => String(e.Gender).toLowerCase() === p.gender.toLowerCase());
  if (p.status) filtered = filtered.filter(e => String(e.EmploymentStatus) === p.status);
  
  // Select columns
  const columns = p.columns || ['EmployeeID', 'FirstName', 'LastName', 'Email', 'Department', 'Position', 'Location', 'EmploymentStatus'];
  const rows = filtered.map(e => {
    const row = {};
    columns.forEach(c => { row[c] = e[c] || ''; });
    return row;
  });
  
  return { ok: true, totalRows: rows.length, columns, rows };
}

/* ================================================================
   BULK IMPORT
   ================================================================ */
async function bulkImportMCQFromSheet(token) { return { ok: true, imported: 0 }; }

/* ================================================================
   LOCK RUN (async mutex)
   ================================================================ */
let _lockTail = Promise.resolve();
function lockRun(fn) {
  const prev = _lockTail;
  let release;
  _lockTail = new Promise(r => { release = r; });
  return prev.then(() => {
    try { return fn(); } finally { release(); }
  });
}

/* ================================================================
   EXPORTS
   ================================================================ */
module.exports = {
  // System
  initSystem, getDropdownConfig, seedStatutoryDefaults, saveStatutoryConfig,
  // Auth
  login, getSession, logout, restoreSession, requireLogin, requireRole,
  requestPasswordReset, completePasswordReset, resetPassword,
  // Employee
  createEmployee, createEmployeeRecord, updateEmployee, modifyEmployee, terminateEmployee, terminateEmployeeRecord,
  getEmployeeById, getEmployeeDirectory, listEmployees, listAllEmployeesForChat,
  // User admin
  adminCreateUser, adminResetPassword, adminUpdateUserRole, addUserByAdmin, resetUserPasswordByAdmin, listUsers,
  // Profile
  getMyProfile, getMyPhotoUrl, updateMyProfile,
  // Dashboard
  getDashboardData, resumeDashboard, renderDashboard,
  // Notifications
  notify, listNotifications, getNotificationsFiltered, getMyNotifications, getNotificationCategories,
  markAllNotificationsRead,
  // Leave
  applyLeave, getMyLeave, approveLeave, cancelLeave,
  // Goals / Performance
  saveGoalRecord, listGoalRecords, getGoals, saveGoal,
  createAppraisalCycle, listAppraisalCycles, save360Feedback, get360Feedback,
  createCheckInRecord, createCheckIn, getPerformanceSummary,
  // Learning
  saveCourseRecord, listCourseCatalog, saveCourse, listCourses,
  assignCourseRecord, assignCourse, getMyCourseAssignments, getMyCourses,
  // Chat
  sendChatMessage, getChatThreadByEmail, editChatMessage, reactToMessage, deleteChatMessage,
  searchChat, markThreadRead, getRecentConversations, getUnreadChatCount, resolveEmployeeByEmail,
  // Org
  getOrgTree, getVisualOrgTree,
  // Reports
  getStandardReport, getAuditLog, listActiveSessions, getTurnoverReport, getPayrollSummaryReport, getLeaveUtilizationReport, getHeadcountReport,
  // Documents / Workflow
  getEmployeeDocuments, uploadEmployeeDocument, deleteEmployeeDocument, getWorkflow, updateWorkflowTask,
  // Employee sub-records
  saveEmployeeQualification, getEmployeeQualifications, deleteEmployeeQualification,
  saveEmployeeSkill, getEmployeeSkills, deleteEmployeeSkill,
  saveEmployeeCertification, getEmployeeCertifications, deleteEmployeeCertification,
  saveEmployeeWorkHistory, getEmployeeWorkHistory, deleteEmployeeWorkHistory,
  saveEmployeeDependent, getEmployeeDependents, deleteEmployeeDependent,
  // Asset Management
  createAsset, listAssets, assignAsset, returnAsset, deleteAsset, getMyAssets,
  // Travel & Expense
  createExpenseClaim, getMyExpenseClaims, approveExpenseClaim, createTravelRequest, getMyTravelRequests, approveTravelRequest,
  // Training Calendar
  createTrainingSession, listTrainingSessions, registerForTraining, markTrainingAttendance, getTrainingAttendance, getMyTrainingRegistrations,
  // Employee Engagement
  createEngagementSurvey, listEngagementSurveys, submitEngagementResponse, getEngagementResults,
  // Separation / Exit
  createExitInterview, completeExitInterview, getExitInterviews, createExitClearance, getExitClearance, updateExitClearance,
  // Workflow Automation
  createWorkflowTemplate, listWorkflowTemplates, startWorkflow, getMyWorkflows, completeWorkflowStep,
  // Multi-company
  createCompany, listCompanies, createBranch, listBranches,
  // Compliance & Policy
  createPolicy, listPolicies, acknowledgePolicy, getPolicyAcknowledgements,
  // Performance Reviews
  saveOKR, getMyOKRs, submitPeerReview, getMyPeerReviews,
  // Advanced Analytics
  getAdvancedAnalytics,
  // Employee Self-Service
  selfServiceUpdateProfile, submitChangeRequest,
  // Custom Reports
  generateCustomReport,
  // Email notifications
  sendBirthdayReminders, checkProbationReviews,
  // Permissions
  getPermissions, dashboardForRole,
  // Bulk
  bulkImportMCQFromSheet,
  // Internal (used by modules)
  _readRowsAsync: readRowsAsync, _findByIdAsync: findByIdAsync, _appendRowAsync: appendRowAsync, _updateByIdAsync: updateByIdAsync,
  _normalizeEmail: normalizeEmail, _getHeaders: getHeaders
};
