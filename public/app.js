/**
 * RHoSAM HCM — Frontend Application
 */
const API = '/api';
let STATE = { token: null, user: null, me: null };
let currentRoute = 'dashboard';

// ===== Input Validation Helpers =====
function stripNonDigits(value) {
  return value.replace(/[^0-9]/g, '');
}

function validatePhoneInput(input) {
  const cleaned = stripNonDigits(input.value);
  input.value = cleaned;
  if (cleaned.length > 0 && cleaned.length < 7) {
    input.setCustomValidity('Phone must be at least 7 digits');
  } else if (cleaned.length > 15) {
    input.setCustomValidity('Phone must not exceed 15 digits');
  } else {
    input.setCustomValidity('');
  }
}

function validateNationalIDInput(input) {
  const cleaned = stripNonDigits(input.value);
  input.value = cleaned;
  if (cleaned.length > 11) {
    input.setCustomValidity('National ID must not exceed 11 digits');
  } else {
    input.setCustomValidity('');
  }
}

// ===== API Helper =====
async function call(fn, ...args) {
  const headers = { 'Content-Type': 'application/json' };
  if (STATE.token) headers['Authorization'] = `Bearer ${STATE.token}`;
  
  const res = await fetch(`${API}/${fn}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ args })
  });
  
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Network error' }));
    throw new Error(err.error || 'Request failed');
  }
  
  return res.json();
}

// ===== Auth =====
document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  
  if (!email || !password) {
    showToast('Please enter email and password', 'error');
    return;
  }
  
  try {
    const data = await call('login', email, password);
    if (!data.ok) throw new Error(data.error || 'Login failed');
    
    STATE.token = data.token;
    STATE.user = { email, role: data.role, employeeId: data.employeeId };
    
    // Get full employee profile
    const profile = await call('getMyProfile', STATE.token);
    if (profile.ok) STATE.me = profile.employee;
    
    localStorage.setItem('token', STATE.token);
    enterApp();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

async function restoreSession() {
  const token = localStorage.getItem('token');
  if (!token) return false;
  
  try {        const data = await call('resumeDashboard', token);
    if (!data.ok || !data.valid) {
      localStorage.removeItem('token');
      return false;
    }
    
    STATE.token = token;
    STATE.user = data.user || { email: data.me?.email, role: data.me?.role, employeeId: data.me?.employeeId };
    STATE.me = data.me;
    return true;
  } catch {
    localStorage.removeItem('token');
    return false;
  }
}

async function enterApp() {
  document.getElementById('loginPage').style.display = 'none';
  document.getElementById('appContainer').style.display = 'flex';
  
  // Update user info
  document.getElementById('userName').textContent = STATE.me ? `${STATE.me.FirstName} ${STATE.me.LastName}` : STATE.user?.email;
  document.getElementById('userRole').textContent = STATE.user?.role || 'Employee';
  
  if (STATE.me?.PhotoUrl) {
    document.getElementById('userAvatar').src = STATE.me.PhotoUrl;
  }
  
  // Ensure we have employee profile data (FirstName, LastName, PhotoUrl)
  if (!STATE.me?.FirstName && STATE.token) {
    try {
      const profile = await call('getMyProfile', STATE.token);
      if (profile.ok) {
        STATE.me = { ...STATE.me, ...profile.employee };
        document.getElementById('userName').textContent = profile.employee ? `${profile.employee.FirstName} ${profile.employee.LastName}` : STATE.user?.email;
        if (profile.employee?.PhotoUrl) document.getElementById('userAvatar').src = profile.employee.PhotoUrl;
      }
    } catch (e) { /* continue with session data */ }
  }
  
  buildSidebar();
  navigateTo('dashboard');
}

function logout() {
  call('logout', STATE.token).catch(() => {});
  STATE = { token: null, user: null, me: null };
  localStorage.removeItem('token');
  document.getElementById('appContainer').style.display = 'none';
  document.getElementById('loginPage').style.display = 'flex';
  document.getElementById('loginForm').reset();
}

// ===== Sidebar Menu =====
const MENU_ITEMS = {
  Admin: [
    { route: 'dashboard', icon: 'fas fa-tachometer-alt', label: 'Dashboard' },
    { route: 'employees', icon: 'fas fa-users', label: 'Employees' },
    { route: 'usermgmt', icon: 'fas fa-user-shield', label: 'User Management' },
    { route: 'chat', icon: 'fas fa-comments', label: 'Chat' },
    { route: 'notifications', icon: 'fas fa-bell', label: 'Notifications' },
    { route: 'leave', icon: 'fas fa-calendar-alt', label: 'Leave Management' },
    { route: 'payroll', icon: 'fas fa-money-check-alt', label: 'Payroll' },
    { route: 'goals', icon: 'fas fa-bullseye', label: 'Goals & Appraisals' },
    { route: 'learning', icon: 'fas fa-graduation-cap', label: 'Learning' },
    { route: 'recruitment', icon: 'fas fa-user-plus', label: 'Recruitment' },
    { route: 'assessments', icon: 'fas fa-clipboard-check', label: 'Assessments' },
    { route: 'orgchart', icon: 'fas fa-sitemap', label: 'Org Chart' },
    { route: 'reports', icon: 'fas fa-chart-bar', label: 'Reports' },
    { route: 'settings', icon: 'fas fa-cog', label: 'Settings' },
  ],
  HRBP: [
    { route: 'dashboard', icon: 'fas fa-tachometer-alt', label: 'Dashboard' },
    { route: 'employees', icon: 'fas fa-users', label: 'Employees' },
    { route: 'chat', icon: 'fas fa-comments', label: 'Chat' },
    { route: 'notifications', icon: 'fas fa-bell', label: 'Notifications' },
    { route: 'leave', icon: 'fas fa-calendar-alt', label: 'Leave Management' },
    { route: 'payroll', icon: 'fas fa-money-check-alt', label: 'Payroll' },
    { route: 'goals', icon: 'fas fa-bullseye', label: 'Goals & Appraisals' },
    { route: 'learning', icon: 'fas fa-graduation-cap', label: 'Learning' },
    { route: 'orgchart', icon: 'fas fa-sitemap', label: 'Org Chart' },
    { route: 'reports', icon: 'fas fa-chart-bar', label: 'Reports' },
  ],
  Manager: [
    { route: 'dashboard', icon: 'fas fa-tachometer-alt', label: 'Dashboard' },
    { route: 'team', icon: 'fas fa-users', label: 'My Team' },
    { route: 'chat', icon: 'fas fa-comments', label: 'Chat' },
    { route: 'notifications', icon: 'fas fa-bell', label: 'Notifications' },
    { route: 'leave', icon: 'fas fa-calendar-alt', label: 'Leave Management' },
    { route: 'goals', icon: 'fas fa-bullseye', label: 'Goals & Appraisals' },
    { route: 'reports', icon: 'fas fa-chart-bar', label: 'Reports' },
  ],
  'Learning Manager': [
    { route: 'dashboard', icon: 'fas fa-tachometer-alt', label: 'Dashboard' },
    { route: 'employees', icon: 'fas fa-users', label: 'Employees' },
    { route: 'learning', icon: 'fas fa-graduation-cap', label: 'Course Library' },
    { route: 'chat', icon: 'fas fa-comments', label: 'Chat' },
    { route: 'notifications', icon: 'fas fa-bell', label: 'Notifications' },
    { route: 'reports', icon: 'fas fa-chart-bar', label: 'Reports' },
  ],
  'Talent Manager': [
    { route: 'dashboard', icon: 'fas fa-tachometer-alt', label: 'Dashboard' },
    { route: 'employees', icon: 'fas fa-users', label: 'Employees' },
    { route: 'learning', icon: 'fas fa-graduation-cap', label: 'Course Library' },
    { route: 'goals', icon: 'fas fa-bullseye', label: 'Goals & Appraisals' },
    { route: 'chat', icon: 'fas fa-comments', label: 'Chat' },
    { route: 'notifications', icon: 'fas fa-bell', label: 'Notifications' },
    { route: 'reports', icon: 'fas fa-chart-bar', label: 'Reports' },
  ],
  'Recruitment Manager': [
    { route: 'dashboard', icon: 'fas fa-tachometer-alt', label: 'Dashboard' },
    { route: 'recruitment', icon: 'fas fa-user-plus', label: 'Recruitment (ATS)' },
    { route: 'assessments', icon: 'fas fa-clipboard-check', label: 'Assessments' },
    { route: 'employees', icon: 'fas fa-users', label: 'Employees' },
    { route: 'chat', icon: 'fas fa-comments', label: 'Chat' },
    { route: 'notifications', icon: 'fas fa-bell', label: 'Notifications' },
    { route: 'reports', icon: 'fas fa-chart-bar', label: 'Reports' },
  ],
  'Performance Manager': [
    { route: 'dashboard', icon: 'fas fa-tachometer-alt', label: 'Dashboard' },
    { route: 'employees', icon: 'fas fa-users', label: 'Employees' },
    { route: 'goals', icon: 'fas fa-bullseye', label: 'Goals & Appraisals' },
    { route: 'chat', icon: 'fas fa-comments', label: 'Chat' },
    { route: 'notifications', icon: 'fas fa-bell', label: 'Notifications' },
    { route: 'reports', icon: 'fas fa-chart-bar', label: 'Reports' },
  ],
  Employee: [
    { route: 'dashboard', icon: 'fas fa-tachometer-alt', label: 'Dashboard' },
    { route: 'profile', icon: 'fas fa-user', label: 'My Profile' },
    { route: 'chat', icon: 'fas fa-comments', label: 'Chat' },
    { route: 'notifications', icon: 'fas fa-bell', label: 'Notifications' },
    { route: 'leave', icon: 'fas fa-calendar-alt', label: 'Leave' },
    { route: 'goals', icon: 'fas fa-bullseye', label: 'My Goals' },
    { route: 'learning', icon: 'fas fa-graduation-cap', label: 'Learning' },
    { route: 'payslips', icon: 'fas fa-file-invoice-dollar', label: 'My Payslips' },
  ],
};

function buildSidebar() {
  const role = STATE.user?.role || 'Employee';
  const menu = MENU_ITEMS[role] || MENU_ITEMS.Employee;
  
  const sidebar = document.getElementById('sidebarMenu');
  sidebar.innerHTML = menu.map(item => `
    <li>
      <a href="#" data-route="${item.route}" onclick="navigateTo('${item.route}'); return false;">
        <i class="${item.icon}"></i>
        <span>${item.label}</span>
      </a>
    </li>
  `).join('');
}

function navigateTo(route) {
  currentRoute = route;
  
  // Update active state
  document.querySelectorAll('.sidebar-menu a').forEach(a => {
    a.classList.toggle('active', a.dataset.route === route);
  });
  
  // Update page title
  const titles = {
    dashboard: 'Dashboard',
    employees: 'Employee Management',
    team: 'My Team',
    profile: 'My Profile',
    chat: 'Chat',
    notifications: 'Notifications',
    leave: 'Leave Management',
    payroll: 'Payroll',
    goals: 'Goals & Appraisals',
    learning: 'Learning & Development',
    recruitment: 'Recruitment',
    orgchart: 'Org Chart',
    reports: 'Reports',
    settings: 'Settings',
    payslips: 'My Payslips',
    assessments: 'Assessments',
    usermgmt: 'User Management',
  };
  document.getElementById('pageTitle').textContent = titles[route] || 'Dashboard';
  
  // Load content
  loadRoute(route);
}

async function loadRoute(route) {
  const content = document.getElementById('contentArea');
  content.innerHTML = '<div class="flex-center" style="min-height:200px"><div class="spinner"></div></div>';
  
  try {
    switch (route) {
      case 'dashboard': await loadDashboard(); break;
      case 'employees': await loadEmployees(); break;
      case 'team': await loadTeam(); break;
      case 'profile': await loadProfile(); break;
      case 'chat': await loadChat(); break;
      case 'notifications': await loadNotifications(); break;
      case 'leave': await loadLeave(); break;
      case 'payroll': await loadPayroll(); break;
      case 'goals': await loadGoals(); break;
      case 'learning': await loadLearning(); break;
      case 'recruitment': await loadRecruitment(); break;
      case 'orgchart': await loadOrgChart(); break;
      case 'reports': await loadReports(); break;
      case 'settings': await loadSettings(); break;
      case 'payslips': await loadPayslips(); break;
      case 'assessments': await loadAssessments(); break;
      case 'usermgmt': await loadUserManagement(); break;
      default: content.innerHTML = '<p>Page not found</p>';
    }
  } catch (err) {
    content.innerHTML = `<div class="card"><div class="card-body"><p>Error loading page: ${err.message}</p></div></div>`;
  }
}

// ===== Dashboard =====
async function loadDashboard() {
  const data = await call('getDashboardData', STATE.token);
  const content = document.getElementById('contentArea');
  
  if (!data.ok) throw new Error(data.error);
  
  const stats = data.stats || {};
  const role = STATE.user?.role;
  
  content.innerHTML = `
    <div class="stats-grid">
      ${role === 'Admin' || role === 'HRBP' ? `
        <div class="stat-card">
          <div class="stat-icon blue"><i class="fas fa-users"></i></div>
          <div class="stat-info"><h4>${stats.totalEmployees || 0}</h4><p>Total Employees</p></div>
        </div>
        <div class="stat-card">
          <div class="stat-icon green"><i class="fas fa-user-check"></i></div>
          <div class="stat-info"><h4>${stats.activeEmployees || 0}</h4><p>Active Employees</p></div>
        </div>
        <div class="stat-card">
          <div class="stat-icon orange"><i class="fas fa-calendar-times"></i></div>
          <div class="stat-info"><h4>${stats.pendingLeave || 0}</h4><p>Pending Leave</p></div>
        </div>
        <div class="stat-card">
          <div class="stat-icon red"><i class="fas fa-user-clock"></i></div>
          <div class="stat-info"><h4>${stats.newHires || 0}</h4><p>New Hires This Month</p></div>
        </div>
      ` : `
        <div class="stat-card">
          <div class="stat-icon blue"><i class="fas fa-calendar-check"></i></div>
          <div class="stat-info"><h4>${stats.leaveBalance || 0}</h4><p>Leave Days Balance</p></div>
        </div>
        <div class="stat-card">
          <div class="stat-icon green"><i class="fas fa-tasks"></i></div>
          <div class="stat-info"><h4>${stats.myGoals || 0}</h4><p>My Goals</p></div>
        </div>
        <div class="stat-card">
          <div class="stat-icon orange"><i class="fas fa-bell"></i></div>
          <div class="stat-info"><h4>${stats.unreadNotifications || 0}</h4><p>Unread Notifications</p></div>
        </div>
      `}
    </div>
    
    <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 24px;">
      <div class="card">
        <div class="card-header"><h3>Recent Activity</h3></div>
        <div class="card-body">
          ${(data.recentActivity || []).map(a => `
            <div style="padding: 12px 0; border-bottom: 1px solid var(--gray-100);">
              <p style="font-size: 14px;">${a.message}</p>
              <small style="color: var(--gray-500);">${a.time || ''}</small>
            </div>
          `).join('') || '<p style="color: var(--gray-500);">No recent activity</p>'}
        </div>
      </div>
      
      <div class="card">
        <div class="card-header"><h3>Quick Actions</h3></div>
        <div class="card-body">
          <button class="btn btn-outline btn-block mb-1" onclick="navigateTo('notifications')">
            <i class="fas fa-bell"></i> View Notifications
          </button>
          <button class="btn btn-outline btn-block mb-1" onclick="navigateTo('leave')">
            <i class="fas fa-calendar-plus"></i> Apply for Leave
          </button>
          <button class="btn btn-outline btn-block mb-1" onclick="navigateTo('chat')">
            <i class="fas fa-comments"></i> Open Chat
          </button>
          ${role === 'Admin' ? `
            <button class="btn btn-primary btn-block" onclick="showCreateEmployee()">
              <i class="fas fa-user-plus"></i> Add Employee
            </button>
          ` : ''}
        </div>
      </div>
    </div>
  `;
}

// ===== Employees =====
async function loadEmployees() {
  const data = await call('listEmployees', STATE.token);
  const content = document.getElementById('contentArea');
  
  if (!data.ok) throw new Error(data.error);
  
  content.innerHTML = `
    <div class="card">
      <div class="card-header">
        <h3>All Employees</h3>
        <div style="display: flex; gap: 8px;">
          <input type="file" id="empBulkImport" accept=".csv" style="display: none;" onchange="handleBulkImport(this)">
          <button class="btn btn-outline btn-sm" onclick="document.getElementById('empBulkImport').click()">
            <i class="fas fa-upload"></i> Bulk Import
          </button>
          <button class="btn btn-primary btn-sm" onclick="showCreateEmployee()">
            <i class="fas fa-plus"></i> Add Employee
          </button>
        </div>
      </div>
      <div class="card-body">
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Department</th>
                <th>Position</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${(data.employees || []).map(emp => `
                <tr>
                  <td>${emp.FirstName} ${emp.LastName}</td>
                  <td>${emp.Email}</td>
                  <td>${emp.Department || '-'}</td>
                  <td>${emp.Position || '-'}</td>
                  <td><span class="pill ${(emp.EmploymentStatus || emp.Status) === 'Active' ? 'pill-success' : 'pill-danger'}">${emp.EmploymentStatus || emp.Status}</span></td>
                  <td class="action-btns">
                    <button class="btn btn-sm btn-outline" onclick="viewEmployee('${emp.EmployeeID}')">
                      <i class="fas fa-eye"></i>
                    </button>
                    <button class="btn btn-sm btn-outline" onclick="editEmployee('${emp.EmployeeID}')">
                      <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn btn-sm btn-danger" onclick="terminateEmployee('${emp.EmployeeID}')">
                      <i class="fas fa-user-slash"></i>
                    </button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

async function showCreateEmployee() {
  const dropdowns = await call('getDropdownConfig', STATE.token);
  
  showModal('Create Employee', `
    <form id="createEmployeeForm" class="employee-form">
      <div class="section-title">Personal Information</div>
      
      <div class="form-group">
        <label>Title</label>
        <select name="Title" required>
          <option value="">Select Title</option>
          <option value="Mr">Mr</option>
          <option value="Mrs">Mrs</option>
          <option value="Miss">Miss</option>
          <option value="Ms">Ms</option>
          <option value="Dr">Dr</option>
          <option value="Prof">Prof</option>
        </select>
      </div>
      
      <div class="form-group">
        <label>First Name</label>
        <input type="text" name="FirstName" required>
      </div>
      
      <div class="form-group">
        <label>Middle Name</label>
        <input type="text" name="MiddleName">
      </div>
      
      <div class="form-group">
        <label>Last Name</label>
        <input type="text" name="LastName" required>
      </div>
      
      <div class="form-group">
        <label>Email</label>
        <input type="email" name="Email" required>
      </div>
      
      <div class="form-group">
        <label>Phone</label>
        <input type="tel" name="Phone" pattern="[0-9]{7,15}" maxlength="15" title="Phone must be 7-15 digits only" oninput="validatePhoneInput(this)">
      </div>
      
      <div class="form-group">
        <label>Date of Birth</label>
        <input type="date" name="DateOfBirth">
      </div>
      
      <div class="form-group">
        <label>Gender</label>
        <select name="Gender">
          <option value="">Select</option>
          <option value="Male">Male</option>
          <option value="Female">Female</option>
        </select>
      </div>
      
      <div class="form-group">
        <label>Marital Status</label>
        <select name="MaritalStatus">
          <option value="">Select</option>
          <option value="Single">Single</option>
          <option value="Married">Married</option>
          <option value="Divorced">Divorced</option>
          <option value="Separated">Separated</option>
          <option value="Widowed">Widowed</option>
        </select>
      </div>
      
      <div class="form-group">
        <label>National ID</label>
        <input type="text" name="NationalID" required pattern="[0-9]{1,11}" maxlength="11" title="National ID must be 1-11 digits only" oninput="validateNationalIDInput(this)">
      </div>
      
      <div class="section-title">Address</div>
      
      <div class="form-group">
        <label>Residential Address</label>
        <input type="text" name="Address">
      </div>
      
      <div class="form-group">
        <label>State of Residence</label>
        <select name="AddressState" id="addressState" onchange="updateLGAs('addressState', 'addressLGA')">
          <option value="">Select State</option>
        </select>
      </div>
      
      <div class="form-group">
        <label>LGA of Residence</label>
        <select name="AddressLGA" id="addressLGA">
          <option value="">Select LGA</option>
        </select>
      </div>
      
      <div class="form-group">
        <label>State of Origin</label>
        <select name="StateOfOrigin" id="stateOfOrigin" onchange="updateLGAs('stateOfOrigin', 'lgaOfOrigin')">
          <option value="">Select State</option>
        </select>
      </div>
      
      <div class="form-group">
        <label>LGA of Origin</label>
        <select name="LGA" id="lgaOfOrigin">
          <option value="">Select LGA</option>
        </select>
      </div>
      
      <div class="section-title">Employment Details</div>
      
      <div class="form-group">
        <label>Position</label>
        <select name="Position" required>
          <option value="">Select Position</option>
          ${(dropdowns.positions || []).map(p => `<option value="${p}">${p}</option>`).join('')}
        </select>
      </div>
      
      <div class="form-group">
        <label>Department</label>
        <select name="Department" required>
          <option value="">Select Department</option>
          ${(dropdowns.departments || []).map(d => `<option value="${d}">${d}</option>`).join('')}
        </select>
      </div>
      
      <div class="form-group">
        <label>Location</label>
        <select name="Location" required>
          <option value="">Select Location</option>
          ${(dropdowns.locations || []).map(l => `<option value="${l}">${l}</option>`).join('')}
        </select>
      </div>
      
      <div class="form-group">
        <label>Job Level</label>
        <select name="JobLevel" required>
          <option value="">Select Level</option>
          ${['1','2','3','4','5','6'].map(l => `<option value="${l}">Level ${l}</option>`).join('')}
        </select>
      </div>
      
      <div class="form-group">
        <label>Grade</label>
        <select name="Grade">
          <option value="">Select Grade</option>
          ${(dropdowns.grades || []).map(g => `<option value="${g}">${g}</option>`).join('')}
        </select>
      </div>
      
      <div class="form-group">
        <label>Manager ID</label>
        <input type="text" name="ManagerID" placeholder="Leave blank if top level">
      </div>
      
      <div class="form-group">
        <label>Job Title</label>
        <input type="text" name="JobTitle" placeholder="e.g. Senior Software Engineer">
      </div>
      
      <div class="form-group">
        <label>Country</label>
        <select name="Country">
          <option value="Nigeria" selected>Nigeria</option>
          <option value="Ghana">Ghana</option>
          <option value="Kenya">Kenya</option>
          <option value="South Africa">South Africa</option>
          <option value="United Kingdom">United Kingdom</option>
          <option value="United States">United States</option>
          <option value="Other">Other</option>
        </select>
      </div>
      
      <div class="form-group">
        <label>Hire Date</label>
        <input type="date" name="HireDate" required>
      </div>
      
      <div class="form-group">
        <label>Employment Status</label>
        <select name="EmploymentStatus">
          <option value="Active" selected>Active</option>
          <option value="Probation">Probation</option>
          <option value="On Leave">On Leave</option>
          <option value="Suspended">Suspended</option>
          <option value="Terminated">Terminated</option>
        </select>
      </div>
      
      <div style="grid-column: 1 / -1; display: flex; gap: 12px; justify-content: flex-end; margin-top: 16px;">
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary"><i class="fas fa-save"></i> Create Employee</button>
      </div>
    </form>
  `);
  
  // Populate states
  populateStates();
  
  // Handle form submission
  document.getElementById('createEmployeeForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const payload = Object.fromEntries(form);
    
    try {
      const data = await call('createEmployee', STATE.token, payload);
      if (!data.ok) throw new Error(data.error);
      
      showToast('Employee created successfully', 'success');
      closeModal();
      loadEmployees();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

async function viewEmployee(id) {
  const data = await call('getEmployeeById', STATE.token, id);
  if (!data.ok) return showToast(data.error, 'error');
  
  const emp = data.employee;
  showModal(`${emp.Title || ''} ${emp.FirstName} ${emp.LastName}`, `
    <div class="profile-card">
      <img src="${emp.PhotoUrl || '/default-avatar.png'}" class="profile-photo" alt="Photo">
      <div class="profile-info">
        <h3>${emp.Title || ''} ${emp.FirstName} ${emp.LastName}</h3>
        <p>${emp.Position || ''} • ${emp.Department || ''}</p>
        <p><span class="pill pill-success">${emp.EmploymentStatus || emp.Status}</span></p>
      </div>
    </div>
    
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; padding: 24px;">
      <div><strong>Email:</strong> ${emp.Email}</div>
      <div><strong>Phone:</strong> ${emp.Phone || '-'}</div>
      <div><strong>Employee ID:</strong> ${emp.EmployeeID}</div>
      <div><strong>National ID:</strong> ${emp.NationalID || '-'}</div>
      <div><strong>Hire Date:</strong> ${emp.HireDate || '-'}</div>
      <div><strong>Job Level:</strong> ${emp.JobLevel || '-'}</div>
      <div><strong>Location:</strong> ${emp.Location || '-'}</div>
      <div><strong>Grade:</strong> ${emp.Grade || '-'}</div>
      <div><strong>Manager:</strong> ${emp.ManagerID || 'None'}</div>
      <div><strong>Address:</strong> ${emp.Address || '-'}</div>
      <div><strong>State of Origin:</strong> ${emp.StateOfOrigin || '-'}</div>
      <div><strong>LGA:</strong> ${emp.LGA || '-'}</div>
    </div>
  `);
}

async function editEmployee(id) {
  const data = await call('getEmployeeById', STATE.token, id);
  if (!data.ok) return showToast(data.error, 'error');
  
  const emp = data.employee;
  const dropdowns = await call('getDropdownConfig', STATE.token);
  
  showModal('Edit Employee', `
    <form id="editEmployeeForm" class="employee-form">
      <div class="form-group">
        <label>First Name</label>
        <input type="text" name="FirstName" value="${emp.FirstName || ''}" required>
      </div>
      <div class="form-group">
        <label>Middle Name</label>
        <input type="text" name="MiddleName" value="${emp.MiddleName || ''}">
      </div>
      <div class="form-group">
        <label>Last Name</label>
        <input type="text" name="LastName" value="${emp.LastName || ''}" required>
      </div>
      <div class="form-group">
        <label>Phone</label>
        <input type="tel" name="Phone" value="${emp.Phone || ''}" pattern="[0-9]{7,15}" maxlength="15" title="Phone must be 7-15 digits only" oninput="validatePhoneInput(this)">
      </div>
      <div class="form-group">
        <label>Marital Status</label>
        <select name="MaritalStatus">
          <option value="">Select</option>
          ${['Single','Married','Divorced','Separated','Widowed'].map(m => `<option value="${m}" ${m === emp.MaritalStatus ? 'selected' : ''}>${m}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>Position</label>
        <select name="Position">
          <option value="">Select Position</option>
          ${(dropdowns.positions || []).map(p => `<option value="${p}" ${p === emp.Position ? 'selected' : ''}>${p}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>Department</label>
        <select name="Department">
          <option value="">Select Department</option>
          ${(dropdowns.departments || []).map(d => `<option value="${d}" ${d === emp.Department ? 'selected' : ''}>${d}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>Location</label>
        <select name="Location">
          <option value="">Select Location</option>
          ${(dropdowns.locations || []).map(l => `<option value="${l}" ${l === emp.Location ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>Job Level</label>
        <select name="JobLevel">
          <option value="">Select Level</option>
          ${['1','2','3','4','5','6'].map(l => `<option value="${l}" ${l == emp.JobLevel ? 'selected' : ''}>Level ${l}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>Grade</label>
        <select name="Grade">
          <option value="">Select Grade</option>
          ${(dropdowns.grades || []).map(g => `<option value="${g}" ${g === emp.Grade ? 'selected' : ''}>${g}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>Manager ID</label>
        <input type="text" name="ManagerID" value="${emp.ManagerID || ''}">
      </div>
      <div class="form-group">
        <label>Job Title</label>
        <input type="text" name="JobTitle" value="${emp.JobTitle || ''}" placeholder="e.g. Senior Software Engineer">
      </div>
      <div class="form-group">
        <label>Country</label>
        <select name="Country">
          ${['Nigeria','Ghana','Kenya','South Africa','United Kingdom','United States','Other'].map(c => `<option value="${c}" ${c === emp.Country ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>Status</label>
        <select name="EmploymentStatus">
          ${['Active','Probation','On Leave','Suspended','Terminated'].map(s => `<option value="${s}" ${(emp.EmploymentStatus || emp.Status) === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
      </div>
      
      <div style="grid-column: 1 / -1; display: flex; gap: 12px; justify-content: flex-end; margin-top: 16px;">
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary"><i class="fas fa-save"></i> Save Changes</button>
      </div>
    </form>
  `);
  
  document.getElementById('editEmployeeForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const payload = Object.fromEntries(form);
    
    try {
      const data = await call('updateEmployee', STATE.token, id, payload);
      if (!data.ok) throw new Error(data.error);
      
      showToast('Employee updated successfully', 'success');
      closeModal();
      loadEmployees();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

async function terminateEmployee(id) {
  if (!confirm('Are you sure you want to terminate this employee?')) return;
  
  try {
    const data = await call('terminateEmployee', STATE.token, id);
    if (!data.ok) throw new Error(data.error);
    
    showToast('Employee terminated', 'success');
    loadEmployees();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ===== Team (Manager) =====
async function loadTeam() {
  const data = await call('listEmployees', STATE.token);
  const content = document.getElementById('contentArea');
  
  if (!data.ok) throw new Error(data.error);
  
  // Filter to direct reports
  const myId = STATE.me?.EmployeeID;
  const team = (data.employees || []).filter(e => e.ManagerID === myId);
  
  content.innerHTML = `
    <div class="card">
      <div class="card-header">
        <h3>My Direct Reports (${team.length})</h3>
      </div>
      <div class="card-body">
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Position</th>
                <th>Department</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${team.map(emp => `
                <tr>
                  <td>${emp.FirstName} ${emp.LastName}</td>
                  <td>${emp.Position || '-'}</td>
                  <td>${emp.Department || '-'}</td>
                  <td><span class="pill ${(emp.EmploymentStatus || emp.Status) === 'Active' ? 'pill-success' : 'pill-danger'}">${emp.EmploymentStatus || emp.Status}</span></td>
                  <td class="action-btns">
                    <button class="btn btn-sm btn-outline" onclick="viewEmployee('${emp.EmployeeID}')">
                      <i class="fas fa-eye"></i> View
                    </button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

// ===== Profile =====
async function loadProfile() {
  const content = document.getElementById('contentArea');
  const emp = STATE.me;
  
  if (!emp) {
    content.innerHTML = '<div class="card"><div class="card-body"><p>Profile not found</p></div></div>';
    return;
  }
  
  content.innerHTML = `
    <div class="card mb-3">
      <div class="profile-card">
        <div style="position: relative;">
          <img src="${emp.PhotoUrl || '/default-avatar.png'}" class="profile-photo" alt="Photo" id="profilePhoto">
          <label for="photoUpload" style="position: absolute; bottom: 0; right: 0; background: var(--primary); color: white; width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer;">
            <i class="fas fa-camera"></i>
          </label>
          <input type="file" id="photoUpload" accept="image/*" style="display: none;" onchange="uploadPhoto(this)">
        </div>
        <div class="profile-info">
          <h3>${emp.Title || ''} ${emp.FirstName} ${emp.LastName}</h3>
          <p>${emp.Position || ''} • ${emp.Department || ''}</p>
          <p><span class="pill pill-success">${emp.EmploymentStatus || emp.Status}</span></p>
        </div>
      </div>
    </div>
    
    <div class="card">
      <div class="card-header">
        <h3>Personal Details</h3>
        <button class="btn btn-outline btn-sm" onclick="editProfile()"><i class="fas fa-edit"></i> Edit</button>
      </div>
      <div class="card-body">
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 16px;">
          <div><strong>Employee ID:</strong> ${emp.EmployeeID}</div>
          <div><strong>Email:</strong> ${emp.Email}</div>
          <div><strong>Phone:</strong> ${emp.Phone || '-'}</div>
          <div><strong>Date of Birth:</strong> ${emp.DateOfBirth || '-'}</div>
          <div><strong>Gender:</strong> ${emp.Gender || '-'}</div>
          <div><strong>National ID:</strong> ${emp.NationalID || '-'}</div>
          <div><strong>Hire Date:</strong> ${emp.HireDate || '-'}</div>
          <div><strong>Job Level:</strong> ${emp.JobLevel || '-'}</div>
          <div><strong>Grade:</strong> ${emp.Grade || '-'}</div>
          <div><strong>Location:</strong> ${emp.Location || '-'}</div>
          <div><strong>Manager:</strong> ${emp.ManagerID || 'None'}</div>
          <div><strong>Residential Address:</strong> ${emp.Address || '-'}</div>
          <div><strong>State of Residence:</strong> ${emp.AddressState || '-'}</div>
          <div><strong>LGA of Residence:</strong> ${emp.AddressLGA || '-'}</div>
          <div><strong>State of Origin:</strong> ${emp.StateOfOrigin || '-'}</div>
          <div><strong>LGA of Origin:</strong> ${emp.LGA || '-'}</div>
        </div>
      </div>
    </div>
  `;
}

async function uploadPhoto(input) {
  const file = input.files[0];
  if (!file) return;
  
  if (file.size > 5 * 1024 * 1024) {
    return showToast('File too large (max 5MB)', 'error');
  }
  
  const formData = new FormData();
  formData.append('profilePic', file);
  
  try {
    const res = await fetch(`${API}/upload/profile`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${STATE.token}` },
      body: formData
    });
    
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    
    STATE.me.PhotoUrl = data.photoUrl;
    document.getElementById('profilePhoto').src = data.photoUrl;
    document.getElementById('userAvatar').src = data.photoUrl;
    showToast('Photo updated successfully', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function editProfile() {
  const emp = STATE.me;
  const dropdowns = await call('getDropdownConfig', STATE.token);
  
  showModal('Edit Profile', `
    <form id="editProfileForm" class="employee-form">
      <div class="form-group">
        <label>Phone</label>
        <input type="tel" name="Phone" value="${emp.Phone || ''}" pattern="[0-9]{7,15}" maxlength="15" title="Phone must be 7-15 digits only" oninput="validatePhoneInput(this)">
      </div>
      <div class="form-group">
        <label>Residential Address</label>
        <input type="text" name="Address" value="${emp.Address || ''}">
      </div>
      <div class="form-group">
        <label>State of Residence</label>
        <select name="AddressState">
          <option value="">Select State</option>
        </select>
      </div>
      <div class="form-group">
        <label>LGA of Residence</label>
        <select name="AddressLGA">
          <option value="">Select LGA</option>
        </select>
      </div>
      
      <div style="grid-column: 1 / -1; display: flex; gap: 12px; justify-content: flex-end; margin-top: 16px;">
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary"><i class="fas fa-save"></i> Save</button>
      </div>
    </form>
  `);
  
  populateStates();
  
  document.getElementById('editProfileForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const payload = Object.fromEntries(form);
    
    try {
      const data = await call('updateMyProfile', STATE.token, payload);
      if (!data.ok) throw new Error(data.error);
      
      STATE.me = { ...STATE.me, ...payload };
      showToast('Profile updated', 'success');
      closeModal();
      loadProfile();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

// ===== Chat =====
let currentChat = null;

async function loadChat() {
  const content = document.getElementById('contentArea');
  
  const [convos, employees] = await Promise.all([
    call('getRecentConversations', STATE.token),
    call('listAllEmployeesForChat', STATE.token)
  ]);
  
  content.innerHTML = `
    <div class="chat-container">
      <div class="chat-sidebar">
        <div style="padding: 16px;">
          <input type="text" placeholder="Search employees..." style="width: 100%; padding: 8px 12px; border: 1px solid var(--gray-300); border-radius: var(--radius);" oninput="filterChatList(this.value)">
        </div>
        <div class="chat-list" id="chatList">
          ${(employees.employees || []).map(e => `
            <div class="chat-item" onclick="openChat('${e.Email}', '${e.FirstName} ${e.LastName}')">
              <img src="${e.Photo || e.PhotoUrl || '/default-avatar.png'}" class="avatar" alt="">
              <div>
                <div style="font-weight: 500;">${e.FirstName} ${e.LastName}</div>
                <div style="font-size: 12px; color: var(--gray-500);">${e.Email}</div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
      <div class="chat-main">
        <div class="chat-messages" id="chatMessages">
          <div class="flex-center" style="height: 100%; color: var(--gray-500);">
            <p>Select a conversation to start chatting</p>
          </div>
        </div>
        <div class="chat-input" id="chatInputArea" style="display: none;">
          <button class="btn btn-icon btn-outline" onclick="attachFile()" title="Attach file">
            <i class="fas fa-paperclip"></i>
          </button>
          <input type="text" id="chatMessageInput" placeholder="Type a message..." onkeypress="if(event.key==='Enter') sendChatMsg()">
          <button class="btn btn-primary" onclick="sendChatMsg()">
            <i class="fas fa-paper-plane"></i>
          </button>
        </div>
      </div>
    </div>
  `;
}

async function openChat(email, name) {
  currentChat = { email, name };
  
  document.getElementById('chatInputArea').style.display = 'flex';
  
  const data = await call('getChatThreadByEmail', STATE.token, email);
  const messages = data.messages || [];
  
  const chatArea = document.getElementById('chatMessages');
  chatArea.innerHTML = messages.map(m => `
    <div class="message ${m.mine || String(m.FromEmployeeID) === String(STATE.user?.employeeId) ? 'sent' : 'received'}">
      <div class="message-bubble">
        <div>${m.Message || ''}</div>
        ${m.FileName ? `<div style="margin-top: 8px;"><a href="#" onclick="return false;" style="color: inherit;"><i class="fas fa-paperclip"></i> ${m.FileName}</a></div>` : ''}
        <div style="font-size: 11px; opacity: 0.7; margin-top: 4px;">${m.CreatedAt || ''}</div>
      </div>
    </div>
  `).join('');
  
  chatArea.scrollTop = chatArea.scrollHeight;
}

async function sendChatMsg() {
  if (!currentChat) return;
  
  const input = document.getElementById('chatMessageInput');
  const message = input.value.trim();
  if (!message) return;
  
  try {
    const data = await call('sendChatMessage', STATE.token, currentChat.email, message);
    if (!data.ok) throw new Error(data.error);
    
    input.value = '';
    openChat(currentChat.email, currentChat.name);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function filterChatList(query) {
  const items = document.querySelectorAll('.chat-item');
  items.forEach(item => {
    const text = item.textContent.toLowerCase();
    item.style.display = text.includes(query.toLowerCase()) ? 'flex' : 'none';
  });
}

// ===== Notifications =====
async function loadNotifications() {
  const data = await call('listNotifications', STATE.token);
  const content = document.getElementById('contentArea');
  
  const notifications = data.notifications || [];
  
  content.innerHTML = `
    <div class="card">
      <div class="card-header">
        <h3>Notifications (${notifications.length})</h3>
        <button class="btn btn-outline btn-sm" onclick="markAllRead()">
          <i class="fas fa-check-double"></i> Mark All Read
        </button>
      </div>
      <div class="card-body">
        ${notifications.length === 0 ? '<p style="color: var(--gray-500);">No notifications</p>' : ''}
        ${notifications.map(n => `
          <div style="padding: 16px; border-bottom: 1px solid var(--gray-100); ${!n.IsRead ? 'background: var(--primary-light);' : ''}">
            <div style="display: flex; justify-content: space-between;">
              <strong>${n.Title}</strong>
              <small style="color: var(--gray-500);">${n.CreatedAt || ''}</small>
            </div>
            <p style="color: var(--gray-600); margin-top: 4px;">${n.Message || ''}</p>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

async function markAllRead() {
  await call('markAllNotificationsRead', STATE.token);
  loadNotifications();
  document.getElementById('notifCount').textContent = '0';
}

// ===== Leave =====
async function loadLeave() {
  const data = await call('getMyLeave', STATE.token);
  const content = document.getElementById('contentArea');
  
  const leaves = data.leaves || [];
  
  content.innerHTML = `
    <div class="card mb-3">
      <div class="card-header">
        <h3>Apply for Leave</h3>
      </div>
      <div class="card-body">
        <form id="leaveForm" class="employee-form">
          <div class="form-group">
            <label>Leave Type</label>
            <select name="leaveType" required>
              <option value="Annual">Annual Leave</option>
              <option value="Sick">Sick Leave</option>
              <option value="Maternity">Maternity Leave</option>
              <option value="Paternity">Paternity Leave</option>
              <option value="Compassionate">Compassionate Leave</option>
            </select>
          </div>
          <div class="form-group">
            <label>Start Date</label>
            <input type="date" name="startDate" required>
          </div>
          <div class="form-group">
            <label>End Date</label>
            <input type="date" name="endDate" required>
          </div>
          <div class="form-group">
            <label>Reason</label>
            <textarea name="reason" rows="3"></textarea>
          </div>
          <div style="grid-column: 1 / -1;">
            <button type="submit" class="btn btn-primary"><i class="fas fa-paper-plane"></i> Submit Application</button>
          </div>
        </form>
      </div>
    </div>
    
    <div class="card">
      <div class="card-header">
        <h3>My Leave Requests</h3>
      </div>
      <div class="card-body">
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>Start</th>
                <th>End</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${leaves.map(l => `
                <tr>
                  <td>${l.LeaveType}</td>
                  <td>${l.StartDate}</td>
                  <td>${l.EndDate}</td>
                  <td><span class="pill ${l.Status === 'Approved' ? 'pill-success' : l.Status === 'Rejected' ? 'pill-danger' : 'pill-warning'}">${l.Status}</span></td>
                  <td>
                    ${l.Status === 'Submitted' && String(l.ManagerID) === String(STATE.me?.EmployeeID) && l.EmployeeID !== STATE.me?.EmployeeID ? `
                      <button class="btn btn-sm btn-primary" onclick="approveLeaveAction('${l.LeaveID}', 'approve')"><i class="fas fa-check"></i> Approve</button>
                      <button class="btn btn-sm btn-danger" onclick="approveLeaveAction('${l.LeaveID}', 'reject')"><i class="fas fa-times"></i> Reject</button>
                    ` : l.Status === 'Submitted' && l.EmployeeID === STATE.me?.EmployeeID ? `
                      <button class="btn btn-sm btn-danger" onclick="cancelLeave('${l.LeaveID}')">Cancel</button>
                    ` : ''}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
  
  document.getElementById('leaveForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const payload = Object.fromEntries(form);
    
    try {
      const data = await call('applyLeave', STATE.token, payload);
      if (!data.ok) throw new Error(data.error);
      
      showToast('Leave application submitted', 'success');
      loadLeave();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

// ===== Payroll =====
async function loadPayroll() {
  const content = document.getElementById('contentArea');
  
  try {
    const [salaryData, payslips] = await Promise.all([
      call('getSalarySheet', STATE.token),
      call('getMyPayslips', STATE.token)
    ]);
    
    content.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-icon blue"><i class="fas fa-money-check-alt"></i></div>
          <div class="stat-info">
            <h4>₦${(salaryData.basicSalary || 0).toLocaleString()}</h4>
            <p>Basic Salary</p>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon green"><i class="fas fa-arrow-up"></i></div>
          <div class="stat-info">
            <h4>₦${(salaryData.totalAllowances || 0).toLocaleString()}</h4>
            <p>Total Allowances</p>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon red"><i class="fas fa-arrow-down"></i></div>
          <div class="stat-info">
            <h4>₦${(salaryData.totalDeductions || 0).toLocaleString()}</h4>
            <p>Total Deductions</p>
          </div>
        </div>
      </div>
      
      <div class="card">
        <div class="card-header"><h3>Payslip History</h3></div>
        <div class="card-body">
          <div class="table-container">
            <table>
              <thead>
                <tr>
                  <th>Period</th>
                  <th>Gross Pay</th>
                  <th>Deductions</th>
                  <th>Net Pay</th>
                </tr>
              </thead>
              <tbody>
                ${(payslips.payslips || []).map(p => `
                  <tr>
                    <td>${p.Period}</td>
                    <td>₦${(p.GrossPay || 0).toLocaleString()}</td>
                    <td>₦${(p.Deductions || 0).toLocaleString()}</td>
                    <td><strong>₦${(p.NetPay || 0).toLocaleString()}</strong></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  } catch (err) {
    content.innerHTML = `<div class="card"><div class="card-body"><p>Error: ${err.message}</p></div></div>`;
  }
}

async function cancelLeave(leaveId) {
  if (!confirm('Are you sure you want to cancel this leave request?')) return;
  try {
    const data = await call('cancelLeave', STATE.token, leaveId);
    if (!data.ok) throw new Error(data.error);
    showToast('Leave cancelled', 'success');
    loadLeave();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function approveLeaveAction(leaveId, decision) {
  const msg = decision === 'approve' ? 'approve' : 'reject';
  if (!confirm(`Are you sure you want to ${msg} this leave request?`)) return;
  try {
    const data = await call('approveLeave', STATE.token, leaveId, decision);
    if (!data.ok) throw new Error(data.error);
    showToast(`Leave ${msg}d`, 'success');
    loadLeave();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ===== Goals =====
async function loadGoals() {
  const data = await call('getGoals', STATE.token);
  const content = document.getElementById('contentArea');
  
  const goals = data.goals || [];
  
  content.innerHTML = `
    <div class="card mb-3">
      <div class="card-header">
        <h3>Add New Goal</h3>
      </div>
      <div class="card-body">
        <form id="goalForm" class="employee-form">
          <div class="form-group">
            <label>Goal Title</label>
            <input type="text" name="title" required>
          </div>
          <div class="form-group">
            <label>Description</label>
            <textarea name="description" rows="3"></textarea>
          </div>
          <div class="form-group">
            <label>Target Date</label>
            <input type="date" name="targetDate">
          </div>
          <div style="grid-column: 1 / -1;">
            <button type="submit" class="btn btn-primary"><i class="fas fa-plus"></i> Add Goal</button>
          </div>
        </form>
      </div>
    </div>
    
    <div class="card">
      <div class="card-header"><h3>My Goals</h3></div>
      <div class="card-body">
        ${goals.length === 0 ? '<p style="color: var(--gray-500);">No goals yet</p>' : ''}
        ${goals.map(g => `
          <div style="padding: 16px; border: 1px solid var(--gray-200); border-radius: var(--radius); margin-bottom: 12px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <h4>${g.Goal || g.Title || ''}</h4>
              <span class="pill ${g.Status === 'Completed' ? 'pill-success' : g.Status === 'In Progress' ? 'pill-info' : 'pill-warning'}">${g.Status || 'Open'}</span>
            </div>
            <div style="margin-top: 8px; color: var(--gray-500); font-size: 13px;">
              Target: ${g.DueDate || g.TargetDate || 'No date'}
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
  
  document.getElementById('goalForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const payload = Object.fromEntries(form);
    
    try {
      const data = await call('saveGoal', STATE.token, payload);
      if (!data.ok) throw new Error(data.error);
      
      showToast('Goal added', 'success');
      loadGoals();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

// ===== Learning =====
async function loadLearning() {
  const content = document.getElementById('contentArea');
  const role = STATE.user?.role;
  const isLearningAdmin = ['Learning Manager', 'Talent Manager', 'Admin', 'HRBP'].includes(role);
  
  try {
    const [myCourses, catalog] = await Promise.all([
      call('getMyCourses', STATE.token).catch(() => []),
      isLearningAdmin ? call('listCourseCatalog', STATE.token).catch(() => []) : Promise.resolve([])
    ]);
    
    const courses = Array.isArray(myCourses) ? myCourses : (myCourses.courses || []);
    const catalogList = Array.isArray(catalog) ? catalog : (catalog.courses || []);
    
    content.innerHTML = `
      ${isLearningAdmin ? `
        <div class="card mb-3">
          <div class="card-header">
            <h3>Course Library</h3>
            <button class="btn btn-primary btn-sm" onclick="showAddCourse()">
              <i class="fas fa-plus"></i> Add Course
            </button>
          </div>
          <div class="card-body">
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px;">
              ${catalogList.map(c => `
                <div class="card">
                  <div class="card-body">
                    <h4>${c.Title || 'Untitled'}</h4>
                    <p style="color: var(--gray-600); font-size: 13px;">${c.Description || ''}</p>
                    <div style="margin-top: 8px; display: flex; gap: 8px;">
                      ${c.Link ? `<a href="${c.Link}" target="_blank" class="btn btn-sm btn-outline"><i class="fas fa-external-link-alt"></i> Open</a>` : ''}
                      <button class="btn btn-sm btn-outline" onclick="showAssignCourse('${c.CourseID}')"><i class="fas fa-paper-plane"></i> Assign</button>
                    </div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      ` : ''}
      
      <div class="card">
        <div class="card-header"><h3>My Assigned Courses</h3></div>
        <div class="card-body">
          ${courses.length === 0 ? '<p style="color: var(--gray-500);">No courses assigned to you.</p>' : ''}
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px;">
            ${courses.map(c => `
              <div class="card">
                <div class="card-body">
                  <h4>${c.course?.Title || c.Title || 'Untitled'}</h4>
                  <p style="color: var(--gray-600);">${c.course?.Description || c.Description || ''}</p>
                  <div style="margin-top: 8px;">
                    ${c.course?.Link ? `<a href="${c.course.Link}" target="_blank" class="btn btn-sm btn-outline"><i class="fas fa-external-link-alt"></i> Open Course</a>` : ''}
                  </div>
                  <div style="margin-top: 12px;">
                    <span class="pill ${c.Status === 'Completed' ? 'pill-success' : c.open ? 'pill-info' : 'pill-warning'}">${c.Status || 'Assigned'}</span>
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  } catch (err) {
    content.innerHTML = `<div class="card"><div class="card-body"><p>Error: ${err.message}</p></div></div>`;
  }
}

async function showAddCourse() {
  showModal('Add Course', `
    <form id="addCourseForm" class="employee-form">
      <div class="form-group" style="grid-column: 1 / -1;">
        <label>Course Title</label>
        <input type="text" name="Title" required>
      </div>
      <div class="form-group" style="grid-column: 1 / -1;">
        <label>Description</label>
        <textarea name="Description" rows="3"></textarea>
      </div>
      <div class="form-group">
        <label>Link (URL)</label>
        <input type="url" name="Link" placeholder="https://...">
      </div>
      <div class="form-group">
        <label>Duration (hours)</label>
        <input type="number" name="DurationHours" min="0">
      </div>
      
      <div style="grid-column: 1 / -1; display: flex; gap: 12px; justify-content: flex-end; margin-top: 16px;">
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary"><i class="fas fa-save"></i> Save Course</button>
      </div>
    </form>
  `);
  
  document.getElementById('addCourseForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const payload = Object.fromEntries(form);
    
    try {
      const data = await call('saveCourse', STATE.token, payload);
      if (!data.ok) throw new Error(data.error);
      showToast('Course added', 'success');
      closeModal();
      loadLearning();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

async function showAssignCourse(courseId) {
  const employees = await call('listEmployees', STATE.token);
  const empList = (employees.employees || []).filter(e => (e.EmploymentStatus || e.Status) === 'Active');
  
  showModal('Assign Course', `
    <form id="assignCourseForm" class="employee-form">
      <div class="form-group">
        <label>Employee</label>
        <select name="EmployeeID" required>
          <option value="">Select Employee</option>
          ${empList.map(e => `<option value="${e.EmployeeID}">${e.FirstName} ${e.LastName}</option>`).join('')}
        </select>
      </div>
      
      <div style="grid-column: 1 / -1; display: flex; gap: 12px; justify-content: flex-end; margin-top: 16px;">
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary"><i class="fas fa-paper-plane"></i> Assign</button>
      </div>
    </form>
  `);
  
  document.getElementById('assignCourseForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const payload = Object.fromEntries(form);
    payload.CourseID = courseId;
    
    try {
      const data = await call('assignCourse', STATE.token, payload);
      if (!data.ok) throw new Error(data.error);
      showToast('Course assigned', 'success');
      closeModal();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

// ===== Recruitment =====
async function loadRecruitment() {
  const data = await call('listRequisitions', STATE.token);
  const content = document.getElementById('contentArea');
  
  const reqs = data.requisitions || [];
  
  content.innerHTML = `
    <div class="card mb-3">
      <div class="card-header">
        <h3>Job Requisitions</h3>
        <button class="btn btn-primary btn-sm" onclick="showCreateRequisition()">
          <i class="fas fa-plus"></i> New Requisition
        </button>
      </div>
      <div class="card-body">
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Department</th>
                <th>Headcount</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${reqs.map(r => `
                <tr>
                  <td>${r.Title}</td>
                  <td>${r.Department || '-'}</td>
                  <td>${r.Openings || r.Headcount || 1}</td>
                  <td><span class="pill ${r.Status === 'Open' ? 'pill-success' : 'pill-warning'}">${r.Status}</span></td>
                  <td>
                    <button class="btn btn-sm btn-outline" onclick="viewCandidates('${r.RequisitionID}')">
                      <i class="fas fa-users"></i> Candidates
                    </button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

// ===== Org Chart =====
async function loadOrgChart() {
  const data = await call('getOrgTree', STATE.token);
  const content = document.getElementById('contentArea');
  
  content.innerHTML = `
    <div class="card">
      <div class="card-header"><h3>Organization Chart</h3></div>
      <div class="card-body org-chart">
        ${renderOrgTree(data.tree || [])}
      </div>
    </div>
  `;
}

function renderOrgTree(nodes, depth) {
  if (!nodes || nodes.length === 0) return '';
  depth = depth || 0;
  
  return `<div class="org-level" style="display: flex; flex-direction: column; align-items: center;">
    <div style="display: flex; gap: 16px; flex-wrap: wrap; justify-content: center;">
      ${nodes.map(n => `
        <div class="org-node" style="min-width: 160px;">
          <img src="${n.photo || '/default-avatar.png'}" style="width: 48px; height: 48px; border-radius: 50%; object-fit: cover; margin-bottom: 8px; border: 2px solid var(--primary-light);" onerror="this.src='/default-avatar.png'">
          <div style="font-size: 14px; font-weight: 600; color: var(--gray-900);">${n.name}</div>
          <div style="font-size: 12px; color: var(--gray-500);">${n.title || ''}</div>
          <div style="font-size: 11px; color: var(--gray-400);">${n.department || ''}</div>
        </div>
      `).join('')}
    </div>
    ${nodes.some(n => n.children && n.children.length > 0) ? `
      <div style="width: 2px; height: 24px; background: var(--gray-300); margin: 0 auto;"></div>
      <div style="display: flex; gap: 24px; flex-wrap: wrap; justify-content: center; position: relative;">
        ${nodes.filter(n => n.children && n.children.length > 0).map(n => `
          <div style="display: flex; flex-direction: column; align-items: center;">
            <div style="width: 2px; height: 16px; background: var(--gray-300);"></div>
            ${renderOrgTree(n.children, depth + 1)}
          </div>
        `).join('')}
      </div>
    ` : ''}
  </div>`;
}

// ===== Reports =====
async function loadReports() {
  const data = await call('getStandardReport', STATE.token);
  const content = document.getElementById('contentArea');
  
  content.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-icon blue"><i class="fas fa-users"></i></div>
        <div class="stat-info"><h4>${data.totalEmployees || 0}</h4><p>Total Employees</p></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon green"><i class="fas fa-user-check"></i></div>
        <div class="stat-info"><h4>${data.activeEmployees || 0}</h4><p>Active</p></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon red"><i class="fas fa-user-times"></i></div>
        <div class="stat-info"><h4>${data.terminatedEmployees || 0}</h4><p>Terminated</p></div>
      </div>
    </div>
    
    <div class="card mb-3">
      <div class="card-header">
        <h3>Employee Distribution</h3>
        <button class="btn btn-sm btn-outline" onclick="downloadReport('employees')">
          <i class="fas fa-download"></i> Export CSV
        </button>
      </div>
      <div class="card-body">
        ${Object.entries(data.byDepartment || {}).map(([dept, count]) => `
          <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--gray-100);">
            <span>${dept}</span>
            <span><strong>${count}</strong></span>
          </div>
        `).join('')}
      </div>
    </div>
    
    <div class="card mb-3">
      <div class="card-header">
        <h3>Available Reports</h3>
      </div>
      <div class="card-body">
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px;">
          <button class="btn btn-outline btn-block" onclick="downloadReport('employees')">
            <i class="fas fa-file-csv"></i> Employees Report
          </button>
          <button class="btn btn-outline btn-block" onclick="downloadReport('payroll')">
            <i class="fas fa-file-csv"></i> Payroll Report
          </button>
          <button class="btn btn-outline btn-block" onclick="downloadReport('leave')">
            <i class="fas fa-file-csv"></i> Leave Report
          </button>
          <button class="btn btn-outline btn-block" onclick="downloadReport('audit')">
            <i class="fas fa-file-csv"></i> Audit Log
          </button>
        </div>
      </div>
    </div>
  `;
}

// ===== Settings =====
async function loadSettings() {
  const content = document.getElementById('contentArea');
  
  content.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card" style="cursor: pointer;" onclick="navigateTo('usermgmt')">
        <div class="stat-icon blue"><i class="fas fa-user-shield"></i></div>
        <div class="stat-info"><h4>Users</h4><p>Manage user accounts</p></div>
      </div>
      <div class="stat-card" style="cursor: pointer;" onclick="navigateTo('employees')">
        <div class="stat-icon green"><i class="fas fa-users"></i></div>
        <div class="stat-info"><h4>Employees</h4><p>Employee directory</p></div>
      </div>
    </div>
    
    <div class="card mb-3">
      <div class="card-header"><h3>System Information</h3></div>
      <div class="card-body">
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 16px;">
          <div><strong>Application:</strong> RHoSAM HCM</div>
          <div><strong>Version:</strong> 2.0.0</div>
          <div><strong>Country Default:</strong> Nigeria</div>
          <div><strong>Timezone:</strong> Africa/Lagos</div>
          <div><strong>Database:</strong> PostgreSQL</div>
        </div>
      </div>
    </div>
    
    <div class="card">
      <div class="card-header"><h3>Bulk Employee Import (CSV)</h3></div>
      <div class="card-body">
        <p style="color: var(--gray-600); margin-bottom: 16px;">Upload a CSV file with employee data. Required columns: <code>FirstName, LastName, Email</code></p>
        <p style="color: var(--gray-500); margin-bottom: 16px; font-size: 13px;">Optional: MiddleName, Phone, NationalID, Gender, DOB, Department, Position, Location, JobLevel, Grade, ManagerID, Title, HireDate, Address, StateOfOrigin, LGA</p>
        <div style="display: flex; gap: 12px; align-items: center;">
          <input type="file" id="bulkImportFile" accept=".csv" style="display: none;" onchange="handleBulkImport(this)">
          <button class="btn btn-primary" onclick="document.getElementById('bulkImportFile').click()">
            <i class="fas fa-upload"></i> Upload CSV
          </button>
          <span id="bulkImportStatus" style="color: var(--gray-500);"></span>
        </div>
      </div>
    </div>
  `;
}

async function handleBulkImport(input) {
  const file = input.files[0];
  if (!file) return;
  
  const status = document.getElementById('bulkImportStatus');
  status.textContent = 'Importing...';
  status.style.color = 'var(--gray-500)';
  
  const formData = new FormData();
  formData.append('csvFile', file);
  
  try {
    const res = await fetch(`${API}/upload/bulk-employees`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${STATE.token}` },
      body: formData
    });
    
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    
    let msg = `Import complete: ${data.success} succeeded, ${data.failed} failed.`;
    if (data.errors && data.errors.length > 0) {
      msg += '\n\nErrors:\n' + data.errors.slice(0, 10).join('\n');
      if (data.errors.length > 10) msg += `\n... and ${data.errors.length - 10} more`;
    }
    
    status.textContent = `\u2705 ${data.success} imported, ${data.failed} failed`;
    status.style.color = data.failed > 0 ? 'var(--warning)' : 'var(--success)';
    
    if (data.errors && data.errors.length > 0) {
      showModal('Import Results', `<pre style="white-space: pre-wrap; font-size: 13px; color: var(--gray-700);">${msg}</pre>`);
    } else {
      showToast(`${data.success} employees imported successfully`, 'success');
    }
  } catch (err) {
    status.textContent = '\u274c Import failed: ' + err.message;
    status.style.color = 'var(--danger)';
  }
  
  input.value = '';
}

// ===== Payslips =====
async function loadPayslips() {
  await loadPayroll(); // Reuse payroll view
}

// ===== Assessments =====
async function loadAssessments() {
  const content = document.getElementById('contentArea');
  
  try {
    const [assignments, reports] = await Promise.all([
      call('getMyAssessments', STATE.token).catch(() => ({ assessments: [] })),
      call('getAssessmentReports', STATE.token).catch(() => ({ reports: [] }))
    ]);
    
    const myAssessments = assignments.assessments || assignments || [];
    const allReports = reports.reports || reports || [];
    const role = STATE.user?.role;
    const isAdminOrRecruiter = ['Admin', 'HRBP', 'Recruitment Manager'].includes(role);
    
    content.innerHTML = `
      ${isAdminOrRecruiter ? `
        <div class="card mb-3">
          <div class="card-header">
            <h3>Manage Assessment Questions</h3>
            <button class="btn btn-primary btn-sm" onclick="showAddQuestion()">
              <i class="fas fa-plus"></i> Add Question
            </button>
          </div>
          <div class="card-body">
            <button class="btn btn-outline btn-sm" onclick="showAssignAssessment()">
              <i class="fas fa-paper-plane"></i> Assign Assessment
            </button>
          </div>
        </div>
      ` : ''}
      
      <div class="card mb-3">
        <div class="card-header"><h3>My Assessments</h3></div>
        <div class="card-body">
          ${myAssessments.length === 0 ? '<p style="color: var(--gray-500);">No assessments assigned to you.</p>' : ''}
          <div class="table-container">
            <table>
              <thead>
                <tr><th>Bank</th><th>Status</th><th>Score</th><th>Assigned</th></tr>
              </thead>
              <tbody>
                ${myAssessments.map(a => `
                  <tr>
                    <td>${a.Bank || 'Default'}</td>
                    <td><span class="pill ${a.Status === 'Completed' ? 'pill-success' : 'pill-warning'}">${a.Status}</span></td>
                    <td>${a.Score !== undefined && a.Score !== '' ? a.Score + '%' : '-'}</td>
                    <td>${a.CreatedAt || ''}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      
      ${isAdminOrRecruiter && allReports.length > 0 ? `
        <div class="card">
          <div class="card-header"><h3>Assessment Reports</h3></div>
          <div class="card-body">
            <div class="table-container">
              <table>
                <thead>
                  <tr><th>Employee</th><th>Bank</th><th>Status</th><th>Score</th></tr>
                </thead>
                <tbody>
                  ${allReports.map(r => `
                    <tr>
                      <td>${r.Name || r.EmployeeID}</td>
                      <td>${r.Bank || 'Default'}</td>
                      <td><span class="pill pill-success">${r.Status}</span></td>
                      <td>${r.Score !== undefined ? r.Score + '%' : '-'}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ` : ''}
    `;
  } catch (err) {
    content.innerHTML = `<div class="card"><div class="card-body"><p>Error: ${err.message}</p></div></div>`;
  }
}

async function showAddQuestion() {
  showModal('Add Assessment Question', `
    <form id="addQuestionForm" class="employee-form">
      <div class="form-group">
        <label>Question Bank</label>
        <input type="text" name="Bank" value="Default">
      </div>
      <div class="form-group" style="grid-column: 1 / -1;">
        <label>Question</label>
        <textarea name="Question" rows="3" required></textarea>
      </div>
      <div class="form-group">
        <label>Option A</label>
        <input type="text" name="OptionA" required>
      </div>
      <div class="form-group">
        <label>Option B</label>
        <input type="text" name="OptionB" required>
      </div>
      <div class="form-group">
        <label>Option C</label>
        <input type="text" name="OptionC" required>
      </div>
      <div class="form-group">
        <label>Option D</label>
        <input type="text" name="OptionD" required>
      </div>
      <div class="form-group">
        <label>Correct Option</label>
        <select name="CorrectOption">
          <option value="A">A</option>
          <option value="B">B</option>
          <option value="C">C</option>
          <option value="D">D</option>
        </select>
      </div>
      
      <div style="grid-column: 1 / -1; display: flex; gap: 12px; justify-content: flex-end; margin-top: 16px;">
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary"><i class="fas fa-save"></i> Save Question</button>
      </div>
    </form>
  `);
  
  document.getElementById('addQuestionForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const payload = Object.fromEntries(form);
    
    try {
      const data = await call('saveAssessmentQuestion', STATE.token, payload);
      if (!data.ok) throw new Error(data.error);
      showToast('Question added', 'success');
      closeModal();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

async function showAssignAssessment() {
  const employees = await call('listEmployees', STATE.token);
  const empList = (employees.employees || []).filter(e => (e.EmploymentStatus || e.Status) === 'Active');
  
  showModal('Assign Assessment', `
    <form id="assignAssessForm" class="employee-form">
      <div class="form-group">
        <label>Employee</label>
        <select name="EmployeeID" required>
          <option value="">Select Employee</option>
          ${empList.map(e => `<option value="${e.EmployeeID}">${e.FirstName} ${e.LastName}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>Question Bank</label>
        <input type="text" name="Bank" value="Default">
      </div>
      
      <div style="grid-column: 1 / -1; display: flex; gap: 12px; justify-content: flex-end; margin-top: 16px;">
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary"><i class="fas fa-paper-plane"></i> Assign</button>
      </div>
    </form>
  `);
  
  document.getElementById('assignAssessForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const payload = Object.fromEntries(form);
    
    try {
      const data = await call('assignAssessment', STATE.token, payload);
      if (!data.ok) throw new Error(data.error);
      showToast('Assessment assigned', 'success');
      closeModal();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

// ===== Password Reset =====
function showForgotPassword() {
  document.getElementById('forgotPasswordModal').style.display = 'flex';
}

function hideForgotPassword() {
  document.getElementById('forgotPasswordModal').style.display = 'none';
}

async function requestOTP() {
  const email = document.getElementById('resetEmail').value.trim();
  if (!email) return showToast('Enter your email', 'error');
  
  try {
    const data = await call('requestPasswordReset', email);
    if (!data.ok) throw new Error(data.error);
    
    showToast('OTP sent to your email', 'success');
    document.getElementById('otpStep1').style.display = 'none';
    document.getElementById('otpStep2').style.display = 'block';
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function resetPassword() {
  const email = document.getElementById('resetEmail').value.trim();
  const otp = document.getElementById('otpCode').value.trim();
  const newPassword = document.getElementById('newPassword').value;
  
  if (!otp || !newPassword) return showToast('Fill all fields', 'error');
  
  try {
    const data = await call('resetPassword', email, otp, newPassword);
    if (!data.ok) throw new Error(data.error);
    
    showToast('Password reset successful', 'success');
    hideForgotPassword();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ===== Nigerian States =====
let NIGERIAN_STATES = null;

async function loadNigerianStates() {
  try {
    const data = await call('getDropdownConfig', STATE.token);
    NIGERIAN_STATES = data.states || {};
  } catch {
    NIGERIAN_STATES = {};
  }
}

function populateStates() {
  const states = Object.keys(NIGERIAN_STATES || {});
  document.querySelectorAll('select[name="AddressState"], select[name="StateOfOrigin"]').forEach(sel => {
    const current = sel.value;
    sel.innerHTML = '<option value="">Select State</option>' + 
      states.map(s => `<option value="${s}" ${s === current ? 'selected' : ''}>${s}</option>`).join('');
  });
}

function updateLGAs(stateSelectId, lgaSelectId) {
  const state = document.getElementById(stateSelectId)?.value;
  const lgaSelect = document.getElementById(lgaSelectId);
  
  lgaSelect.innerHTML = '<option value="">Select LGA</option>';
  
  if (state && NIGERIAN_STATES?.[state]) {
    lgaSelect.innerHTML += NIGERIAN_STATES[state]
      .map(lga => `<option value="${lga}">${lga}</option>`)
      .join('');
  }
}

// ===== Modal =====
function showModal(title, body) {
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalBody').innerHTML = body;
  document.getElementById('modalContainer').style.display = 'flex';
}

function closeModal() {
  document.getElementById('modalContainer').style.display = 'none';
}

// ===== Toast =====
function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<i class="fas ${type === 'success' ? 'fa-check-circle' : type === 'error' ? 'fa-exclamation-circle' : 'fa-exclamation-triangle'}"></i> ${message}`;
  container.appendChild(toast);
  
  setTimeout(() => toast.remove(), 4000);
}

// ===== Toggle Password =====
function togglePassword() {
  const input = document.getElementById('password');
  const icon = document.querySelector('.toggle-password i');
  if (input.type === 'password') {
    input.type = 'text';
    icon.className = 'fas fa-eye-slash';
  } else {
    input.type = 'password';
    icon.className = 'fas fa-eye';
  }
}

// ===== Toggle Sidebar =====
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('active');
}

// ===== Attach File (Chat) =====
function attachFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*,.pdf,.doc,.docx,.txt';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return showToast('File too large (max 5MB)', 'error');
    
    const formData = new FormData();
    formData.append('chatFile', file);
    
    try {
      const res = await fetch(`${API}/upload/chat`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${STATE.token}` },
        body: formData
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      
      if (currentChat) {
        const msg = `[File: ${data.fileName}]`;
        await call('sendChatMessage', STATE.token, currentChat.email, msg);
        openChat(currentChat.email, currentChat.name);
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  };
  input.click();
}

// ===== Recruitment =====
async function showCreateRequisition() {
  const dropdowns = await call('getDropdownConfig', STATE.token);
  
  showModal('New Job Requisition', `
    <form id="reqForm" class="employee-form">
      <div class="form-group">
        <label>Job Title</label>
        <input type="text" name="Title" required>
      </div>
      <div class="form-group">
        <label>Department</label>
        <select name="Department">
          <option value="">Select Department</option>
          ${(dropdowns.departments || []).map(d => `<option value="${d}">${d}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>Location</label>
        <select name="Location">
          <option value="">Select Location</option>
          ${(dropdowns.locations || []).map(l => `<option value="${l}">${l}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>Number of Openings</label>
        <input type="number" name="Openings" value="1" min="1" required>
      </div>
      <div class="form-group">
        <label>Priority</label>
        <select name="Priority">
          <option value="Low">Low</option>
          <option value="Medium" selected>Medium</option>
          <option value="High">High</option>
          <option value="Urgent">Urgent</option>
        </select>
      </div>
      <div class="form-group">
        <label>Job Description</label>
        <textarea name="JobDescription" rows="4"></textarea>
      </div>
      
      <div style="grid-column: 1 / -1; display: flex; gap: 12px; justify-content: flex-end; margin-top: 16px;">
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary"><i class="fas fa-save"></i> Create Requisition</button>
      </div>
    </form>
  `);
  
  document.getElementById('reqForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const payload = Object.fromEntries(form);
    
    try {
      const data = await call('createRequisition', STATE.token, payload);
      if (!data.ok) throw new Error(data.error);
      
      showToast('Requisition created', 'success');
      closeModal();
      loadRecruitment();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

async function viewCandidates(requisitionId) {
  try {
    const allCandidates = await call('listCandidates', STATE.token);
    const reqCandidates = (allCandidates || []).filter(c => String(c.RequisitionID) === String(requisitionId));
    
    showModal('Candidates', `
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Stage</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${reqCandidates.length === 0 ? '<tr><td colspan="4" style="text-align: center; color: var(--gray-500);">No candidates yet</td></tr>' : ''}
            ${reqCandidates.map(c => `
              <tr>
                <td>${c.FirstName} ${c.LastName}</td>
                <td>${c.Email || '-'}</td>
                <td><span class="pill pill-info">${c.Stage || 'Applied'}</span></td>
                <td>
                  <select onchange="moveCandidate('${c.CandidateID}', this.value)" style="padding: 4px 8px; border: 1px solid var(--gray-300); border-radius: var(--radius);">
                    <option value="Applied" ${c.Stage === 'Applied' ? 'selected' : ''}>Applied</option>
                    <option value="Screening" ${c.Stage === 'Screening' ? 'selected' : ''}>Screening</option>
                    <option value="Interview" ${c.Stage === 'Interview' ? 'selected' : ''}>Interview</option>
                    <option value="Shortlisted" ${c.Stage === 'Shortlisted' ? 'selected' : ''}>Shortlisted</option>
                    <option value="Offer" ${c.Stage === 'Offer' ? 'selected' : ''}>Offer</option>
                    <option value="Hired" ${c.Stage === 'Hired' ? 'selected' : ''}>Hired</option>
                    <option value="Rejected" ${c.Stage === 'Rejected' ? 'selected' : ''}>Rejected</option>
                  </select>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      
      <div style="margin-top: 16px;">
        <button class="btn btn-primary btn-sm" onclick="showAddCandidate('${requisitionId}')">
          <i class="fas fa-plus"></i> Add Candidate
        </button>
      </div>
    `);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function moveCandidate(candidateId, stage) {
  try {
    const data = await call('moveCandidateStage', STATE.token, candidateId, stage);
    if (!data.ok) throw new Error(data.error);
    showToast('Stage updated', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function showAddCandidate(requisitionId) {
  showModal('Add Candidate', `
    <form id="addCandidateForm" class="employee-form">
      <div class="form-group">
        <label>First Name</label>
        <input type="text" name="FirstName" required>
      </div>
      <div class="form-group">
        <label>Last Name</label>
        <input type="text" name="LastName" required>
      </div>
      <div class="form-group">
        <label>Email</label>
        <input type="email" name="Email">
      </div>
      <div class="form-group">
        <label>Phone</label>
        <input type="tel" name="Phone" pattern="[0-9]{7,15}" maxlength="15" title="Phone must be 7-15 digits only" oninput="validatePhoneInput(this)">
      </div>
      <div class="form-group">
        <label>Source</label>
        <select name="Source">
          <option value="Direct">Direct</option>
          <option value="Referral">Referral</option>
          <option value="Job Board">Job Board</option>
          <option value="LinkedIn">LinkedIn</option>
          <option value="Agency">Agency</option>
        </select>
      </div>
      
      <div style="grid-column: 1 / -1; display: flex; gap: 12px; justify-content: flex-end; margin-top: 16px;">
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary"><i class="fas fa-save"></i> Add Candidate</button>
      </div>
    </form>
  `);
  
  document.getElementById('addCandidateForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const payload = Object.fromEntries(form);
    payload.RequisitionID = requisitionId;
    
    try {
      const data = await call('createCandidate', STATE.token, payload);
      if (!data.ok) throw new Error(data.error);
      
      showToast('Candidate added', 'success');
      closeModal();
      viewCandidates(requisitionId);
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

function downloadReport(type) {
  const url = `${API}/reports/${type}/download`;
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  // We need to add auth header, so use fetch
  fetch(`${API}/reports/${type}/download`, {
    headers: { 'Authorization': `Bearer ${STATE.token}` }
  }).then(res => {
    if (!res.ok) throw new Error('Download failed');
    return res.blob();
  }).then(blob => {
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `${type}_report.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
    showToast('Report downloaded', 'success');
  }).catch(err => {
    showToast('Download failed: ' + err.message, 'error');
  });
}

// ===== User Management (Admin) =====
async function loadUserManagement() {
  const data = await call('listUsers', STATE.token);
  const content = document.getElementById('contentArea');
  
  const users = data.users || [];
  
  content.innerHTML = `
    <div class="card mb-3">
      <div class="card-header">
        <h3>User Management</h3>
        <button class="btn btn-primary btn-sm" onclick="showAddUser()">
          <i class="fas fa-user-plus"></i> Add User
        </button>
      </div>
      <div class="card-body">
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th>Employee ID</th>
                <th>Role</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${users.map(u => `
                <tr>
                  <td>${u.Email}</td>
                  <td>${u.EmployeeID || '-'}</td>
                  <td><span class="pill pill-info">${u.Role}</span></td>
                  <td><span class="pill ${(u.Status || 'Active') === 'Active' ? 'pill-success' : 'pill-danger'}">${u.Status || 'Active'}</span></td>
                  <td class="action-btns">
                    <button class="btn btn-sm btn-outline" onclick="showResetUserPassword('${u.Email}')">
                      <i class="fas fa-key"></i> Reset Password
                    </button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

async function showAddUser() {
  const employees = await call('listEmployees', STATE.token);
  const empList = (employees.employees || []).filter(e => (e.EmploymentStatus || e.Status) === 'Active');
  
  showModal('Add User Account', `
    <form id="addUserForm" class="employee-form">
      <div class="form-group">
        <label>Employee</label>
        <select name="EmployeeID" id="addUserEmpSelect" required>
          <option value="">Select Employee</option>
          ${empList.map(e => `<option value="${e.EmployeeID}">${e.FirstName} ${e.LastName} (${e.Email})</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>Email</label>
        <input type="email" name="Email" id="addUserEmail" required>
      </div>
      <div class="form-group">
        <label>Role</label>
        <select name="Role" required>
          <option value="Employee">Employee</option>
          <option value="Manager">Manager</option>
          <option value="HRBP">HRBP</option>
          <option value="Admin">Admin</option>
          <option value="Learning Manager">Learning Manager</option>
          <option value="Talent Manager">Talent Manager</option>
          <option value="Recruitment Manager">Recruitment Manager</option>
          <option value="Performance Manager">Performance Manager</option>
        </select>
      </div>
      <div class="form-group">
        <label>Temporary Password</label>
        <input type="text" name="TempPassword" value="Welcome@123">
      </div>
      
      <div style="grid-column: 1 / -1; display: flex; gap: 12px; justify-content: flex-end; margin-top: 16px;">
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary"><i class="fas fa-save"></i> Create User</button>
      </div>
    </form>
  `);
  
  // Auto-fill email from employee selection
  document.getElementById('addUserEmpSelect').addEventListener('change', (e) => {
    const emp = empList.find(x => x.EmployeeID === e.target.value);
    if (emp) document.getElementById('addUserEmail').value = emp.Email;
  });
  
  document.getElementById('addUserForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const payload = Object.fromEntries(form);
    
    try {
      const data = await call('adminCreateUser', STATE.token, payload.Email, payload.EmployeeID, payload.Role, payload.TempPassword);
      if (!data.ok) throw new Error(data.error);
      
      showToast('User created successfully', 'success');
      closeModal();
      loadUserManagement();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

async function showResetUserPassword(email) {
  showModal('Reset Password', `
    <form id="resetUserPwForm" class="employee-form">
      <div class="form-group">
        <label>Email</label>
        <input type="email" value="${email}" readonly style="background: var(--gray-100);">
      </div>
      <div class="form-group">
        <label>New Temporary Password</label>
        <input type="text" name="TempPassword" value="Welcome@123" required>
      </div>
      
      <div style="grid-column: 1 / -1; display: flex; gap: 12px; justify-content: flex-end; margin-top: 16px;">
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary"><i class="fas fa-key"></i> Reset Password</button>
      </div>
    </form>
  `);
  
  document.getElementById('resetUserPwForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const pw = form.get('TempPassword');
    
    try {
      const data = await call('adminResetPassword', STATE.token, email, pw);
      if (!data.ok) throw new Error(data.error);
      
      showToast('Password reset successfully', 'success');
      closeModal();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

// ===== Init =====
(async function boot() {
  const ok = await restoreSession();
  if (ok) {
    await loadNigerianStates();
    enterApp();
  } else {
    document.getElementById('loginPage').style.display = 'flex';
  }
})();

// ===== Close modal on outside click =====
document.getElementById('modalContainer').addEventListener('click', (e) => {
  if (e.target.id === 'modalContainer') closeModal();
});

// ===== Keyboard shortcuts =====
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});
