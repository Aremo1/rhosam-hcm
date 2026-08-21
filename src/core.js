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
  const y = formatDate(new Date(), APP.TZ, 'yyyy');
  let max = 0;
  rows.forEach(r => {
    const m = String(r.EmployeeID || '').match(/RHS-(\d{4})-(\d+)/);
    if (m && m[1] === y) max = Math.max(max, Number(m[2]));
  });
  return 'RHS-' + y + '-' + String(max + 1).padStart(5, '0');
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
      EmploymentStatus: 'Active', HireDate: hireDate, TerminationDate: '',
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
  return { ok: true, users: users.map(u => ({ EmployeeID: u.EmployeeID, Email: u.Email, Role: u.Role, Status: u.Status })) };
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
      newHires: 0,
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
  return { ok: true };
}

async function cancelLeave(token, leaveId) {
  const me = await requireLogin(token);
  await updateByIdAsync(SHEETS.LEAVE, 'LeaveID', leaveId, { Status: 'Cancelled', UpdatedAt: new Date().toISOString() });
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

/* ================================================================
   DOCUMENTS / WORKFLOW
   ================================================================ */
async function getEmployeeDocuments(token, employeeId) {
  const me = await requireLogin(token);
  const target = employeeId || me.employeeId;
  const rows = await readRowsAsync(SHEETS.DOCS);
  return rows.filter(d => String(d.EmployeeID) === String(target));
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

async function getWorkflow(token, type) {
  const me = await requireLogin(token);
  const table = type === 'onboarding' ? SHEETS.ONBOARD : SHEETS.OFFBOARD;
  const rows = await readRowsAsync(table);
  if (APP.ADMIN_ROLES.includes(me.role)) return rows;
  return rows.filter(r => String(r.EmployeeID) === String(me.employeeId));
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
  initSystem, getDropdownConfig, seedStatutoryDefaults,
  // Auth
  login, getSession, logout, restoreSession, requireLogin, requireRole,
  requestPasswordReset, completePasswordReset, resetPassword,
  // Employee
  createEmployee, createEmployeeRecord, updateEmployee, modifyEmployee, terminateEmployee, terminateEmployeeRecord,
  getEmployeeById, getEmployeeDirectory, listEmployees, listAllEmployeesForChat,
  // User admin
  adminCreateUser, adminResetPassword, addUserByAdmin, resetUserPasswordByAdmin, listUsers,
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
  getStandardReport, getAuditLog, listActiveSessions,
  // Documents / Workflow
  getEmployeeDocuments, getWorkflow,
  // Permissions
  getPermissions, dashboardForRole,
  // Bulk
  bulkImportMCQFromSheet,
  // Internal (used by modules)
  _readRowsAsync: readRowsAsync, _findByIdAsync: findByIdAsync, _appendRowAsync: appendRowAsync, _updateByIdAsync: updateByIdAsync,
  _normalizeEmail: normalizeEmail, _getHeaders: getHeaders
};
