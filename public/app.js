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

// ===== Photo Preview & Upload =====
function previewEmployeePhoto(input, previewId) {
  const preview = document.getElementById(previewId);
  const file = input.files[0];
  if (!file) return;
  
  if (file.size > 5 * 1024 * 1024) {
    showToast('File size must be under 5MB', 'error');
    return;
  }
  
  const reader = new FileReader();
  reader.onload = (e) => {
    preview.innerHTML = `<img src="${e.target.result}" style="width: 100%; height: 100%; object-fit: cover;">`;
    preview.style.border = '2px solid var(--primary)';
  };
  reader.readAsDataURL(file);
}

async function uploadEmployeePhoto(employeeId, input) {
  const file = input.files[0];
  if (!file) return;
  
  if (file.size > 5 * 1024 * 1024) {
    showToast('File size must be under 5MB', 'error');
    return;
  }
  
  try {
    const formData = new FormData();
    formData.append('profilePic', file);
    
    // Use admin endpoint to upload for any employee
    const res = await fetch(`${API}/upload/profile/${employeeId}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${STATE.token}` },
      body: formData
    });
    
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Upload failed');
    
    const preview = document.getElementById('editEmpPhotoPreview');
    preview.innerHTML = `<img src="${data.photoUrl}" style="width: 100%; height: 100%; object-fit: cover;">`;
    preview.style.border = '2px solid var(--success)';
    showToast('Profile picture updated!', 'success');
  } catch (err) {
    showToast(err.message, 'error');
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
  const fullName = STATE.me ? `${STATE.me.FirstName} ${STATE.me.LastName}` : STATE.user?.email;
  document.getElementById('userName').textContent = fullName;
  document.getElementById('userRole').textContent = STATE.user?.role || 'Employee';
  
  // Top bar avatar
  const topBarName = document.getElementById('topBarUserName');
  const topBarAvatar = document.getElementById('topBarAvatar');
  if (topBarName) topBarName.textContent = fullName;
  if (topBarAvatar && STATE.me?.PhotoUrl) topBarAvatar.src = STATE.me.PhotoUrl;
  
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
        if (profile.employee?.PhotoUrl) {
          document.getElementById('userAvatar').src = profile.employee.PhotoUrl;
          const tba = document.getElementById('topBarAvatar');
          if (tba) tba.src = profile.employee.PhotoUrl;
        }
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
  // Stop chat polling when leaving chat
  if (currentRoute === 'chat' && route !== 'chat' && chatPollTimer) {
    clearInterval(chatPollTimer);
    chatPollTimer = null;
  }
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
let dashboardData = null;
let dashboardFilters = {};

async function loadDashboard() {
  const data = await call('getDashboardData', STATE.token);
  const content = document.getElementById('contentArea');
  
  if (!data.ok) throw new Error(data.error);
  dashboardData = data;
  renderDashboard(data);
}

function renderDashboard(data) {
  const content = document.getElementById('contentArea');
  const stats = data.stats || {};
  const role = STATE.user?.role;
  const employees = data.employees || [];
  const dropdowns = data.dropdowns || {};
  
  // Apply dashboard filters
  let filteredEmps = [...employees];
  if (dashboardFilters.department) filteredEmps = filteredEmps.filter(e => e.Department === dashboardFilters.department);
  if (dashboardFilters.jobLevel) filteredEmps = filteredEmps.filter(e => String(e.JobLevel) === dashboardFilters.jobLevel);
  if (dashboardFilters.grade) filteredEmps = filteredEmps.filter(e => e.Grade === dashboardFilters.grade);
  if (dashboardFilters.location) filteredEmps = filteredEmps.filter(e => e.Location === dashboardFilters.location);
  if (dashboardFilters.gender) filteredEmps = filteredEmps.filter(e => String(e.Gender).toLowerCase() === dashboardFilters.gender.toLowerCase());
  
  const isAdminHr = role === 'Admin' || role === 'HRBP';
  
  content.innerHTML = `
    ${isAdminHr ? `
    <div class="dashboard-filters">
      <select onchange="applyDashboardFilter('department', this.value)">
        <option value="">All Departments</option>
        ${(dropdowns.departments || []).map(d => `<option value="${d}" ${dashboardFilters.department === d ? 'selected' : ''}>${d}</option>`).join('')}
      </select>
      <select onchange="applyDashboardFilter('jobLevel', this.value)">
        <option value="">All Job Levels</option>
        ${(dropdowns.jobLevels || []).map(l => `<option value="${l}" ${dashboardFilters.jobLevel === l ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
      <select onchange="applyDashboardFilter('grade', this.value)">
        <option value="">All Grades</option>
        ${(dropdowns.grades || []).map(g => `<option value="${g}" ${dashboardFilters.grade === g ? 'selected' : ''}>${g}</option>`).join('')}
      </select>
      <select onchange="applyDashboardFilter('location', this.value)">
        <option value="">All Locations</option>
        ${(dropdowns.locations || []).map(l => `<option value="${l}" ${dashboardFilters.location === l ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
      <select onchange="applyDashboardFilter('gender', this.value)">
        <option value="">All Genders</option>
        <option value="Male" ${dashboardFilters.gender === 'Male' ? 'selected' : ''}>Male</option>
        <option value="Female" ${dashboardFilters.gender === 'Female' ? 'selected' : ''}>Female</option>
      </select>
      ${Object.values(dashboardFilters).some(v => v) ? `<button class="btn btn-sm btn-outline" onclick="clearDashboardFilters()"><i class="fas fa-times"></i> Clear</button>` : ''}
    </div>
    ` : ''}
    
    <div class="stats-grid">
      ${isAdminHr ? `
        <div class="stat-card">
          <div class="stat-icon blue"><i class="fas fa-users"></i></div>
          <div class="stat-info"><h4>${stats.totalEmployees || 0}</h4><p>Total Employees</p></div>
        </div>
        <div class="stat-card">
          <div class="stat-icon green"><i class="fas fa-user-check"></i></div>
          <div class="stat-info"><h4>${stats.activeEmployees || 0}</h4><p>Active Employees</p></div>
        </div>
        <div class="stat-card">
          <div class="stat-icon blue"><i class="fas fa-mars"></i></div>
          <div class="stat-info"><h4>${stats.maleCount || 0}</h4><p>Male Employees</p></div>
        </div>
        <div class="stat-card">
          <div class="stat-icon orange"><i class="fas fa-venus"></i></div>
          <div class="stat-info"><h4>${stats.femaleCount || 0}</h4><p>Female Employees</p></div>
        </div>
        <div class="stat-card">
          <div class="stat-icon green"><i class="fas fa-user-plus"></i></div>
          <div class="stat-info"><h4>${stats.newHiresYTD || 0}</h4><p>New Hires (YTD)</p></div>
        </div>
        <div class="stat-card">
          <div class="stat-icon red"><i class="fas fa-user-slash"></i></div>
          <div class="stat-info"><h4>${stats.terminatedThisMonth || 0}</h4><p>Terminations (Month)</p></div>
        </div>
        <div class="stat-card">
          <div class="stat-icon orange"><i class="fas fa-user-minus"></i></div>
          <div class="stat-info"><h4>${stats.terminatedYTD || 0}</h4><p>Terminations (YTD)</p></div>
        </div>
        <div class="stat-card">
          <div class="stat-icon orange"><i class="fas fa-calendar-times"></i></div>
          <div class="stat-info"><h4>${stats.pendingLeave || 0}</h4><p>Pending Leave</p></div>
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

function applyDashboardFilter(key, value) {
  dashboardFilters[key] = value || '';
  if (dashboardData) renderDashboard(dashboardData);
}

function clearDashboardFilters() {
  dashboardFilters = {};
  if (dashboardData) renderDashboard(dashboardData);
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
      <div style="text-align: center; margin-bottom: 16px;">
        <div id="createEmpPhotoPreview" style="width: 100px; height: 100px; border-radius: 50%; background: var(--gray-100); margin: 0 auto 8px; display: flex; align-items: center; justify-content: center; overflow: hidden; cursor: pointer; border: 2px dashed var(--gray-300);" onclick="document.getElementById('createEmpPhotoInput').click()">
          <i class="fas fa-camera" style="font-size: 24px; color: var(--gray-400);"></i>
        </div>
        <input type="file" id="createEmpPhotoInput" accept="image/*" style="display: none;" onchange="previewEmployeePhoto(this, 'createEmpPhotoPreview')">
        <small style="color: var(--gray-500);">Click to upload profile picture</small>
      </div>
      <div class="section-title">Personal Information</div>
      
      <div class="form-group">
        <label>Title <span style="color: var(--danger);">*</span></label>
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
        <label>First Name <span style="color: var(--danger);">*</span></label>
        <input type="text" name="FirstName" required>
      </div>
      
      <div class="form-group">
        <label>Middle Name</label>
        <input type="text" name="MiddleName">
      </div>
      
      <div class="form-group">
        <label>Last Name <span style="color: var(--danger);">*</span></label>
        <input type="text" name="LastName" required>
      </div>
      
      <div class="form-group">
        <label>Email <span style="color: var(--danger);">*</span></label>
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
        <label>Religion</label>
        <select name="Religion">
          <option value="">Select</option>
          <option value="Christianity">Christianity</option>
          <option value="Islam">Islam</option>
          <option value="Traditional">Traditional</option>
          <option value="Other">Other</option>
        </select>
      </div>
      
      <div class="form-group">
        <label>National ID <span style="color: var(--danger);">*</span></label>
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
      
      <div class="section-title">Emergency Contact</div>
      
      <div class="form-group">
        <label>Contact Name</label>
        <input type="text" name="EmergencyContactName" placeholder="Full name">
      </div>
      
      <div class="form-group">
        <label>Contact Phone</label>
        <input type="tel" name="EmergencyContactPhone" pattern="[0-9]{7,15}" maxlength="15" title="Phone must be 7-15 digits only" oninput="validatePhoneInput(this)">
      </div>
      
      <div class="section-title">Next of Kin</div>
      
      <div class="form-group">
        <label>Next of Kin Name</label>
        <input type="text" name="NextOfKin" placeholder="Full name">
      </div>
      
      <div class="form-group">
        <label>Next of Kin Phone</label>
        <input type="tel" name="NextOfKinPhone" pattern="[0-9]{7,15}" maxlength="15" title="Phone must be 7-15 digits only" oninput="validatePhoneInput(this)">
      </div>
      
      <div class="form-group">
        <label>Relationship</label>
        <select name="NextOfKinRelationship">
          <option value="">Select</option>
          <option value="Spouse">Spouse</option>
          <option value="Parent">Parent</option>
          <option value="Sibling">Sibling</option>
          <option value="Child">Child</option>
          <option value="Other">Other</option>
        </select>
      </div>
      
      <div class="section-title">Bank Details</div>
      
      <div class="form-group">
        <label>Bank Name</label>
        <select name="BankName">
          <option value="">Select Bank</option>
          <option value="Access Bank">Access Bank</option>
          <option value="Citibank Nigeria">Citibank Nigeria</option>
          <option value="Ecobank Nigeria">Ecobank Nigeria</option>
          <option value="Fidelity Bank">Fidelity Bank</option>
          <option value="First Bank of Nigeria">First Bank of Nigeria</option>
          <option value="First City Monument Bank">First City Monument Bank</option>
          <option value="Globus Bank">Globus Bank</option>
          <option value="Guaranty Trust Bank">Guaranty Trust Bank</option>
          <option value="Heritage Bank">Heritage Bank</option>
          <option value="Keystone Bank">Keystone Bank</option>
          <option value="Kuda Bank">Kuda Bank</option>
          <option value="Opay">Opay</option>
          <option value="PALMPAY">PALMPAY</option>
          <option value="Polaris Bank">Polaris Bank</option>
          <option value="Providus Bank">Providus Bank</option>
          <option value="Stanbic IBTC Bank">Stanbic IBTC Bank</option>
          <option value="Standard Chartered Bank">Standard Chartered Bank</option>
          <option value="Sterling Bank">Sterling Bank</option>
          <option value="SunTrust Bank">SunTrust Bank</option>
          <option value="Titan Trust Bank">Titan Trust Bank</option>
          <option value="Union Bank">Union Bank</option>
          <option value="United Bank for Africa">United Bank for Africa</option>
          <option value="Unity Bank">Unity Bank</option>
          <option value="VFD Microfinance Bank">VFD Microfinance Bank</option>
          <option value="Wema Bank">Wema Bank</option>
          <option value="Zenith Bank">Zenith Bank</option>
        </select>
      </div>
      
      <div class="form-group">
        <label>Account Number</label>
        <input type="text" name="BankAccountNumber" pattern="[0-9]{10}" maxlength="10" title="Account number must be 10 digits" oninput="validateNationalIDInput(this)">
      </div>
      
      <div class="form-group">
        <label>Account Name</label>
        <input type="text" name="BankAccountName" placeholder="Name on account">
      </div>
      
      <div class="section-title">Employment Details</div>
      
      <div class="form-group">
        <label>Position <span style="color: var(--danger);">*</span></label>
        <select name="Position" required>
          <option value="">Select Position</option>
          ${(dropdowns.positions || []).map(p => `<option value="${p}">${p}</option>`).join('')}
        </select>
      </div>
      
      <div class="form-group">
        <label>Department <span style="color: var(--danger);">*</span></label>
        <select name="Department" required>
          <option value="">Select Department</option>
          ${(dropdowns.departments || []).map(d => `<option value="${d}">${d}</option>`).join('')}
        </select>
      </div>
      
      <div class="form-group">
        <label>Location <span style="color: var(--danger);">*</span></label>
        <select name="Location" required>
          <option value="">Select Location</option>
          ${(dropdowns.locations || []).map(l => `<option value="${l}">${l}</option>`).join('')}
        </select>
      </div>
      
      <div class="form-group">
        <label>Job Level <span style="color: var(--danger);">*</span></label>
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
        <label>Hire Date <span style="color: var(--danger);">*</span></label>
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
    const photoFile = document.getElementById('createEmpPhotoInput').files[0];
    
    try {
      const data = await call('createEmployee', STATE.token, payload);
      if (!data.ok) throw new Error(data.error);
      
      // Upload profile picture if selected
      if (photoFile && data.employeeId) {
        const fd = new FormData();
        fd.append('profilePic', photoFile);
        // We need a token for this employee - use the admin's session
        // Photo will be uploaded when admin edits the employee
      }
      
      showToast(`Employee created successfully! ID: ${data.employeeId}. Default password: ${data.defaultPassword}`, 'success');
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
      <div><strong>Gender:</strong> ${emp.Gender || '-'}</div>
      <div><strong>Date of Birth:</strong> ${emp.DOB || '-'}</div>
      <div><strong>Marital Status:</strong> ${emp.MaritalStatus || '-'}</div>
      <div><strong>Religion:</strong> ${emp.Religion || '-'}</div>
      <div><strong>Country:</strong> ${emp.Country || '-'}</div>
      <div><strong>Hire Date:</strong> ${emp.HireDate || '-'}</div>
      <div><strong>Job Level:</strong> ${emp.JobLevel || '-'}</div>
      <div><strong>Job Title:</strong> ${emp.JobTitle || '-'}</div>
      <div><strong>Location:</strong> ${emp.Location || '-'}</div>
      <div><strong>Grade:</strong> ${emp.Grade || '-'}</div>
      <div><strong>Manager:</strong> ${emp.ManagerID || 'None'}</div>
      <div><strong>Address:</strong> ${emp.Address || '-'}</div>
      <div><strong>State of Origin:</strong> ${emp.StateOfOrigin || '-'}</div>
      <div><strong>LGA:</strong> ${emp.LGA || '-'}</div>
    </div>
    
    <div class="section-title" style="padding: 0 24px;">Emergency Contact</div>
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; padding: 0 24px 24px;">
      <div><strong>Contact Name:</strong> ${emp.EmergencyContactName || '-'}</div>
      <div><strong>Contact Phone:</strong> ${emp.EmergencyContactPhone || '-'}</div>
    </div>
    
    <div class="section-title" style="padding: 0 24px;">Next of Kin</div>
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; padding: 0 24px 24px;">
      <div><strong>Name:</strong> ${emp.NextOfKin || '-'}</div>
      <div><strong>Phone:</strong> ${emp.NextOfKinPhone || '-'}</div>
      <div><strong>Relationship:</strong> ${emp.NextOfKinRelationship || '-'}</div>
    </div>
    
    <div class="section-title" style="padding: 0 24px;">Bank Details</div>
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; padding: 0 24px 24px;">
      <div><strong>Bank Name:</strong> ${emp.BankName || '-'}</div>
      <div><strong>Account Number:</strong> ${emp.BankAccountNumber || '-'}</div>
      <div><strong>Account Name:</strong> ${emp.BankAccountName || '-'}</div>
    </div>
  `);
}

async function editEmployee(id) {
  const data = await call('getEmployeeById', STATE.token, id);
  if (!data.ok) return showToast(data.error, 'error');
  
  const emp = data.employee;
  const dropdowns = await call('getDropdownConfig', STATE.token);
  
  const photoUrl = emp.PhotoUrl || '';
  showModal('Edit Employee', `
    <form id="editEmployeeForm" class="employee-form">
      <div style="text-align: center; margin-bottom: 16px;">
        <div id="editEmpPhotoPreview" style="width: 100px; height: 100px; border-radius: 50%; background: var(--gray-100); margin: 0 auto 8px; display: flex; align-items: center; justify-content: center; overflow: hidden; cursor: pointer; border: 2px dashed var(--gray-300);" onclick="document.getElementById('editEmpPhotoInput').click()">
          ${photoUrl ? `<img src="${photoUrl}" style="width: 100%; height: 100%; object-fit: cover;">` : `<i class="fas fa-camera" style="font-size: 24px; color: var(--gray-400);"></i>`}
        </div>
        <input type="file" id="editEmpPhotoInput" accept="image/*" style="display: none;" onchange="uploadEmployeePhoto('${emp.EmployeeID}', this)">
        <small style="color: var(--gray-500);">Click to ${photoUrl ? 'change' : 'upload'} profile picture</small>
      </div>
      <div class="form-group">
        <label>First Name <span style="color: var(--danger);">*</span></label>
        <input type="text" name="FirstName" value="${emp.FirstName || ''}" required>
      </div>
      <div class="form-group">
        <label>Middle Name</label>
        <input type="text" name="MiddleName" value="${emp.MiddleName || ''}">
      </div>
      <div class="form-group">
        <label>Last Name <span style="color: var(--danger);">*</span></label>
        <input type="text" name="LastName" value="${emp.LastName || ''}" required>
      </div>
      <div class="form-group">
        <label>Email <span style="color: var(--danger);">*</span></label>
        <input type="email" name="Email" value="${emp.Email || ''}" required>
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
      
      <div class="section-title">Emergency Contact</div>
      <div class="form-group">
        <label>Contact Name</label>
        <input type="text" name="EmergencyContactName" value="${emp.EmergencyContactName || ''}" placeholder="Full name">
      </div>
      <div class="form-group">
        <label>Contact Phone</label>
        <input type="tel" name="EmergencyContactPhone" value="${emp.EmergencyContactPhone || ''}" pattern="[0-9]{7,15}" maxlength="15" title="Phone must be 7-15 digits only" oninput="validatePhoneInput(this)">
      </div>
      
      <div class="section-title">Next of Kin</div>
      <div class="form-group">
        <label>Next of Kin Name</label>
        <input type="text" name="NextOfKin" value="${emp.NextOfKin || ''}" placeholder="Full name">
      </div>
      <div class="form-group">
        <label>Next of Kin Phone</label>
        <input type="tel" name="NextOfKinPhone" value="${emp.NextOfKinPhone || ''}" pattern="[0-9]{7,15}" maxlength="15" title="Phone must be 7-15 digits only" oninput="validatePhoneInput(this)">
      </div>
      <div class="form-group">
        <label>Relationship</label>
        <select name="NextOfKinRelationship">
          <option value="">Select</option>
          ${['Spouse','Parent','Sibling','Child','Other'].map(r => `<option value="${r}" ${r === emp.NextOfKinRelationship ? 'selected' : ''}>${r}</option>`).join('')}
        </select>
      </div>
      
      <div class="section-title">Bank Details</div>
      <div class="form-group">
        <label>Bank Name</label>
        <select name="BankName">
          <option value="">Select Bank</option>
          ${['Access Bank','Citibank Nigeria','Ecobank Nigeria','Fidelity Bank','First Bank of Nigeria','First City Monument Bank','Globus Bank','Guaranty Trust Bank','Heritage Bank','Keystone Bank','Kuda Bank','Opay','PALMPAY','Polaris Bank','Providus Bank','Stanbic IBTC Bank','Standard Chartered Bank','Sterling Bank','SunTrust Bank','Titan Trust Bank','Union Bank','United Bank for Africa','Unity Bank','VFD Microfinance Bank','Wema Bank','Zenith Bank'].map(b => `<option value="${b}" ${b === emp.BankName ? 'selected' : ''}>${b}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>Account Number</label>
        <input type="text" name="BankAccountNumber" value="${emp.BankAccountNumber || ''}" pattern="[0-9]{10}" maxlength="10" title="Account number must be 10 digits" oninput="validateNationalIDInput(this)">
      </div>
      <div class="form-group">
        <label>Account Name</label>
        <input type="text" name="BankAccountName" value="${emp.BankAccountName || ''}" placeholder="Name on account">
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
    </div>      <div class="card mb-3">
      <div class="tabs" style="padding: 0 24px;">
        <button class="tab active" onclick="loadProfileTab('personal', this)">Personal Details</button>
        <button class="tab" onclick="loadProfileTab('qualifications', this)">Qualifications</button>
        <button class="tab" onclick="loadProfileTab('skills', this)">Skills</button>
        <button class="tab" onclick="loadProfileTab('certifications', this)">Certifications</button>
        <button class="tab" onclick="loadProfileTab('workhistory', this)">Work History</button>
      </div>
      <div class="card-body" id="profileTabContent">
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
        <div style="margin-top: 16px;"><button class="btn btn-outline btn-sm" onclick="editProfile()"><i class="fas fa-edit"></i> Edit Profile</button></div>
      </div>
    </div>
  `;
}

async function loadProfileTab(tab, btn) {
  document.querySelectorAll('.tabs .tab').forEach(t => t.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const container = document.getElementById('profileTabContent');
  const empId = STATE.me?.EmployeeID;
  
  if (tab === 'personal') {
    loadProfile(); return;
  } else if (tab === 'qualifications') {
    const quals = await call('getEmployeeQualifications', STATE.token, empId);
    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <h4>Qualifications</h4>
        <button class="btn btn-sm btn-primary" onclick="showAddQualification()"><i class="fas fa-plus"></i> Add</button>
      </div>
      ${(quals || []).length === 0 ? '<p style="color:var(--gray-500);">No qualifications added yet.</p>' : ''}
      <table><thead><tr><th>Institution</th><th>Qualification</th><th>Field of Study</th><th>Start</th><th>End</th><th>Grade</th><th>Actions</th></tr></thead><tbody>
      ${(quals || []).map(q => `<tr><td>${q.Institution || ''}</td><td>${q.Qualification || ''}</td><td>${q.FieldOfStudy || ''}</td><td>${q.StartDate || ''}</td><td>${q.EndDate || ''}</td><td>${q.Grade || ''}</td><td><button class="btn btn-sm btn-danger" onclick="deleteQualification('${q.QualificationID}')"><i class="fas fa-trash"></i></button></td></tr>`).join('')}
      </tbody></table>
    `;
  } else if (tab === 'skills') {
    const skills = await call('getEmployeeSkills', STATE.token, empId);
    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <h4>Skills</h4>
        <button class="btn btn-sm btn-primary" onclick="showAddSkill()"><i class="fas fa-plus"></i> Add</button>
      </div>
      ${(skills || []).length === 0 ? '<p style="color:var(--gray-500);">No skills added yet.</p>' : ''}
      <table><thead><tr><th>Skill</th><th>Proficiency</th><th>Years</th><th>Actions</th></tr></thead><tbody>
      ${(skills || []).map(s => `<tr><td>${s.SkillName || ''}</td><td>${s.Proficiency || ''}</td><td>${s.YearsOfExperience || ''}</td><td><button class="btn btn-sm btn-danger" onclick="deleteSkill('${s.SkillID}')"><i class="fas fa-trash"></i></button></td></tr>`).join('')}
      </tbody></table>
    `;
  } else if (tab === 'certifications') {
    const certs = await call('getEmployeeCertifications', STATE.token, empId);
    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <h4>Certifications</h4>
        <button class="btn btn-sm btn-primary" onclick="showAddCertification()"><i class="fas fa-plus"></i> Add</button>
      </div>
      ${(certs || []).length === 0 ? '<p style="color:var(--gray-500);">No certifications added yet.</p>' : ''}
      <table><thead><tr><th>Certification</th><th>Issuing Body</th><th>Issue Date</th><th>Expiry</th><th>Status</th><th>Actions</th></tr></thead><tbody>
      ${(certs || []).map(c => `<tr><td>${c.CertName || ''}</td><td>${c.IssuingBody || ''}</td><td>${c.IssueDate || ''}</td><td>${c.ExpiryDate || ''}</td><td><span class="pill ${c.Status === 'Active' ? 'pill-success' : 'pill-danger'}">${c.Status || 'Active'}</span></td><td><button class="btn btn-sm btn-danger" onclick="deleteCertification('${c.CertificationID}')"><i class="fas fa-trash"></i></button></td></tr>`).join('')}
      </tbody></table>
    `;
  } else if (tab === 'workhistory') {
    const work = await call('getEmployeeWorkHistory', STATE.token, empId);
    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <h4>Work History</h4>
        <button class="btn btn-sm btn-primary" onclick="showAddWorkHistory()"><i class="fas fa-plus"></i> Add</button>
      </div>
      ${(work || []).length === 0 ? '<p style="color:var(--gray-500);">No work history added yet.</p>' : ''}
      <table><thead><tr><th>Company</th><th>Position</th><th>Start</th><th>End</th><th>Reason for Leaving</th><th>Actions</th></tr></thead><tbody>
      ${(work || []).map(w => `<tr><td>${w.CompanyName || ''}</td><td>${w.Position || ''}</td><td>${w.StartDate || ''}</td><td>${w.EndDate || ''}</td><td>${w.ReasonForLeaving || ''}</td><td><button class="btn btn-sm btn-danger" onclick="deleteWorkHistory('${w.HistoryID}')"><i class="fas fa-trash"></i></button></td></tr>`).join('')}
      </tbody></table>
    `;
  }
}

async function showAddQualification() {
  showModal('Add Qualification', `
    <form id="addQualForm" class="employee-form">
      <div class="form-group"><label>Institution</label><input type="text" name="Institution" required></div>
      <div class="form-group"><label>Qualification</label><input type="text" name="Qualification" placeholder="e.g. B.Sc, M.Sc, HND"></div>
      <div class="form-group"><label>Field of Study</label><input type="text" name="FieldOfStudy"></div>
      <div class="form-group"><label>Start Date</label><input type="date" name="StartDate"></div>
      <div class="form-group"><label>End Date</label><input type="date" name="EndDate"></div>
      <div class="form-group"><label>Grade</label><input type="text" name="Grade" placeholder="e.g. First Class, Upper Credit"></div>
      <div style="grid-column:1/-1;display:flex;gap:12px;justify-content:flex-end;margin-top:16px;">
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary"><i class="fas fa-save"></i> Save</button>
      </div>
    </form>
  `);
  document.getElementById('addQualForm').addEventListener('submit', async (e) => {
    e.preventDefault(); const p = Object.fromEntries(new FormData(e.target));
    const d = await call('saveEmployeeQualification', STATE.token, p);
    if (!d.ok) return showToast(d.error, 'error'); showToast('Qualification added', 'success'); closeModal(); loadProfileTab('qualifications', document.querySelector('.tab.active'));
  });
}
async function deleteQualification(id) { if (!confirm('Delete?')) return; await call('deleteEmployeeQualification', STATE.token, id); loadProfileTab('qualifications', document.querySelector('.tab.active')); }

async function showAddSkill() {
  showModal('Add Skill', `
    <form id="addSkillForm" class="employee-form">
      <div class="form-group"><label>Skill Name</label><input type="text" name="SkillName" required></div>
      <div class="form-group"><label>Proficiency</label><select name="Proficiency"><option value="Beginner">Beginner</option><option value="Intermediate">Intermediate</option><option value="Advanced">Advanced</option><option value="Expert">Expert</option></select></div>
      <div class="form-group"><label>Years of Experience</label><input type="number" name="YearsOfExperience" min="0" max="50"></div>
      <div style="grid-column:1/-1;display:flex;gap:12px;justify-content:flex-end;margin-top:16px;">
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary"><i class="fas fa-save"></i> Save</button>
      </div>
    </form>
  `);
  document.getElementById('addSkillForm').addEventListener('submit', async (e) => {
    e.preventDefault(); const p = Object.fromEntries(new FormData(e.target));
    const d = await call('saveEmployeeSkill', STATE.token, p);
    if (!d.ok) return showToast(d.error, 'error'); showToast('Skill added', 'success'); closeModal(); loadProfileTab('skills', document.querySelector('.tab.active'));
  });
}
async function deleteSkill(id) { if (!confirm('Delete?')) return; await call('deleteEmployeeSkill', STATE.token, id); loadProfileTab('skills', document.querySelector('.tab.active')); }

async function showAddCertification() {
  showModal('Add Certification', `
    <form id="addCertForm" class="employee-form">
      <div class="form-group"><label>Certification Name</label><input type="text" name="CertName" required></div>
      <div class="form-group"><label>Issuing Body</label><input type="text" name="IssuingBody"></div>
      <div class="form-group"><label>Issue Date</label><input type="date" name="IssueDate"></div>
      <div class="form-group"><label>Expiry Date</label><input type="date" name="ExpiryDate"></div>
      <div class="form-group"><label>Credential ID</label><input type="text" name="CredentialID"></div>
      <div style="grid-column:1/-1;display:flex;gap:12px;justify-content:flex-end;margin-top:16px;">
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary"><i class="fas fa-save"></i> Save</button>
      </div>
    </form>
  `);
  document.getElementById('addCertForm').addEventListener('submit', async (e) => {
    e.preventDefault(); const p = Object.fromEntries(new FormData(e.target));
    const d = await call('saveEmployeeCertification', STATE.token, p);
    if (!d.ok) return showToast(d.error, 'error'); showToast('Certification added', 'success'); closeModal(); loadProfileTab('certifications', document.querySelector('.tab.active'));
  });
}
async function deleteCertification(id) { if (!confirm('Delete?')) return; await call('deleteEmployeeCertification', STATE.token, id); loadProfileTab('certifications', document.querySelector('.tab.active')); }

async function showAddWorkHistory() {
  showModal('Add Work History', `
    <form id="addWorkForm" class="employee-form">
      <div class="form-group"><label>Company Name</label><input type="text" name="CompanyName" required></div>
      <div class="form-group"><label>Position</label><input type="text" name="Position"></div>
      <div class="form-group"><label>Start Date</label><input type="date" name="StartDate"></div>
      <div class="form-group"><label>End Date</label><input type="date" name="EndDate"></div>
      <div class="form-group"><label>Reason for Leaving</label><input type="text" name="ReasonForLeaving"></div>
      <div style="grid-column:1/-1;display:flex;gap:12px;justify-content:flex-end;margin-top:16px;">
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary"><i class="fas fa-save"></i> Save</button>
      </div>
    </form>
  `);
  document.getElementById('addWorkForm').addEventListener('submit', async (e) => {
    e.preventDefault(); const p = Object.fromEntries(new FormData(e.target));
    const d = await call('saveEmployeeWorkHistory', STATE.token, p);
    if (!d.ok) return showToast(d.error, 'error'); showToast('Work history added', 'success'); closeModal(); loadProfileTab('workhistory', document.querySelector('.tab.active'));
  });
}
async function deleteWorkHistory(id) { if (!confirm('Delete?')) return; await call('deleteEmployeeWorkHistory', STATE.token, id); loadProfileTab('workhistory', document.querySelector('.tab.active')); }

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

let chatPollTimer = null;

async function openChat(email, name) {
  currentChat = { email, name };
  
  // Show chat header with recipient name
  const chatArea = document.getElementById('chatMessages');
  document.getElementById('chatInputArea').style.display = 'flex';
  
  // Stop previous poll
  if (chatPollTimer) clearInterval(chatPollTimer);
  
  await loadChatMessages(email);
  
  // Auto-refresh every 5 seconds
  chatPollTimer = setInterval(() => {
    if (currentChat && currentChat.email === email) loadChatMessages(email);
  }, 5000);
}

async function loadChatMessages(email) {
  const data = await call('getChatThreadByEmail', STATE.token, email);
  const messages = data.messages || [];
  const myId = String(STATE.user?.employeeId || STATE.me?.EmployeeID);
  
  const chatArea = document.getElementById('chatMessages');
  const existingHeader = document.querySelector('.chat-header');
  const wasAtBottom = chatArea.scrollHeight - chatArea.scrollTop <= chatArea.clientHeight + 50;
  
  // Build messages HTML with edit/delete actions
  const msgsHtml = messages.map(m => {
    const isMine = m.mine || String(m.FromEmployeeID) === myId;
    const msgId = m.MessageID || '';
    const editedTag = m.EditedAt ? ' <em style="font-size:10px;opacity:0.6;">(edited)</em>' : '';
    return `
      <div class="message ${isMine ? 'sent' : 'received'}">
        <div class="message-bubble">
          <div>${(m.Message || '').replace(/</g,'&lt;')}${editedTag}</div>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px;">
            <div style="font-size: 11px; opacity: 0.7;">${m.CreatedAt || ''}</div>
            ${isMine ? `
              <div class="message-actions">
                <button onclick="editChatMsg('${msgId}', '${(m.Message || '').replace(/'/g, '\\'')}")" title="Edit"><i class="fas fa-pen" style="font-size:11px;"></i></button>
                <button onclick="deleteChatMsg('${msgId}')" title="Delete"><i class="fas fa-trash" style="font-size:11px;"></i></button>
              </div>
            ` : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');
  
  // Chat header
  const headerHtml = `<div class="chat-header"><div class="chat-header-info"><strong>${currentChat.name || 'Chat'}</strong></div></div>`;
  
  chatArea.innerHTML = headerHtml + msgsHtml;
  
  if (wasAtBottom) chatArea.scrollTop = chatArea.scrollHeight;
}

async function editChatMsg(messageId, currentMsg) {
  const newMsg = prompt('Edit message:', currentMsg);
  if (newMsg === null || newMsg.trim() === '') return;
  try {
    const data = await call('editChatMessage', STATE.token, messageId, newMsg);
    if (!data.ok) throw new Error(data.error);
    if (currentChat) loadChatMessages(currentChat.email);
  } catch (err) { showToast(err.message, 'error'); }
}

async function deleteChatMsg(messageId) {
  if (!confirm('Delete this message?')) return;
  try {
    const data = await call('deleteChatMessage', STATE.token, messageId);
    if (!data.ok) throw new Error(data.error);
    if (currentChat) loadChatMessages(currentChat.email);
  } catch (err) { showToast(err.message, 'error'); }
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
  const [data, empData] = await Promise.all([
    call('getMyLeave', STATE.token),
    call('listEmployees', STATE.token)
  ]);
  const content = document.getElementById('contentArea');
  
  const leaves = data.leaves || [];
  const employees = empData.employees || [];
  const empMap = {};
  employees.forEach(e => { empMap[e.EmployeeID] = e; });
  
  const myId = STATE.me?.EmployeeID || STATE.user?.employeeId;
  const role = STATE.user?.role;
  const isManager = ['Admin', 'HRBP', 'Manager'].includes(role);
  
  // Separate my leave and pending approvals
  const myLeave = leaves.filter(l => String(l.EmployeeID) === String(myId));
  const pendingApproval = isManager ? leaves.filter(l =>
    String(l.ManagerID) === String(myId) &&
    String(l.EmployeeID) !== String(myId) &&
    l.Status === 'Submitted'
  ) : [];
  const allTeamLeave = isManager ? leaves.filter(l =>
    String(l.ManagerID) === String(myId) && String(l.EmployeeID) !== String(myId)
  ) : [];
  
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
    
    ${pendingApproval.length > 0 ? `
    <div class="card mb-3">
      <div class="card-header" style="background: #fef3c7;">
        <h3><i class="fas fa-clock" style="color: var(--warning);"></i> Pending Approvals (${pendingApproval.length})</h3>
      </div>
      <div class="card-body">
        <div class="table-container">
          <table>
            <thead>
              <tr><th>Employee</th><th>Type</th><th>Start</th><th>End</th><th>Actions</th></tr>
            </thead>
            <tbody>
              ${pendingApproval.map(l => {
                const emp = empMap[l.EmployeeID] || {};
                return `<tr>
                  <td>${emp.FirstName || ''} ${emp.LastName || ''}</td>
                  <td>${l.LeaveType || ''}</td>
                  <td>${l.StartDate || ''}</td>
                  <td>${l.EndDate || ''}</td>
                  <td class="leave-actions">
                    <button class="btn btn-sm btn-success" onclick="approveLeaveAction('${l.LeaveID}', 'approve')"><i class="fas fa-check"></i> Approve</button>
                    <button class="btn btn-sm btn-danger" onclick="approveLeaveAction('${l.LeaveID}', 'reject')"><i class="fas fa-times"></i> Reject</button>
                  </td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
    ` : ''}
    
    <div class="card mb-3">
      <div class="card-header">
        <h3>${isManager ? 'My Leave Requests' : 'My Leave Requests'}</h3>
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
              ${myLeave.map(l => `
                <tr>
                  <td>${l.LeaveType}</td>
                  <td>${l.StartDate}</td>
                  <td>${l.EndDate}</td>
                  <td><span class="pill ${l.Status === 'Approved' ? 'pill-success' : l.Status === 'Rejected' ? 'pill-danger' : 'pill-warning'}">${l.Status}</span></td>
                  <td>
                    ${l.Status === 'Submitted' ? `<button class="btn btn-sm btn-danger" onclick="cancelLeave('${l.LeaveID}')">Cancel</button>` : ''}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
    
    ${allTeamLeave.length > 0 ? `
    <div class="card">
      <div class="card-header">
        <h3>Team Leave History (${allTeamLeave.length})</h3>
      </div>
      <div class="card-body">
        <div class="table-container">
          <table>
            <thead>
              <tr><th>Employee</th><th>Type</th><th>Start</th><th>End</th><th>Status</th></tr>
            </thead>
            <tbody>
              ${allTeamLeave.map(l => {
                const emp = empMap[l.EmployeeID] || {};
                return `<tr>
                  <td>${emp.FirstName || ''} ${emp.LastName || ''}</td>
                  <td>${l.LeaveType || ''}</td>
                  <td>${l.StartDate || ''}</td>
                  <td>${l.EndDate || ''}</td>
                  <td><span class="pill ${l.Status === 'Approved' ? 'pill-success' : l.Status === 'Rejected' ? 'pill-danger' : 'pill-warning'}">${l.Status}</span></td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
    ` : ''}
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
let currentReportTab = 'overview';

async function loadReports() {
  const content = document.getElementById('contentArea');
  
  content.innerHTML = `
    <div class="tabs" style="margin-bottom: 24px;">
      <button class="tab active" onclick="loadReportTab('overview', this)">Overview</button>
      <button class="tab" onclick="loadReportTab('headcount', this)">Headcount</button>
      <button class="tab" onclick="loadReportTab('turnover', this)">Turnover</button>
      <button class="tab" onclick="loadReportTab('payroll', this)">Payroll Summary</button>
      <button class="tab" onclick="loadReportTab('leave', this)">Leave Utilization</button>
    </div>
    <div id="reportContent"></div>
  `;
  loadReportTab('overview', document.querySelector('.tab.active'));
}

async function loadReportTab(tab, btn) {
  document.querySelectorAll('.tabs .tab').forEach(t => t.classList.remove('active'));
  if (btn) btn.classList.add('active');
  currentReportTab = tab;
  const container = document.getElementById('reportContent');
  container.innerHTML = '<div class="flex-center" style="min-height:100px"><div class="spinner"></div></div>';
  
  if (tab === 'overview') {
    const data = await call('getStandardReport', STATE.token);
    container.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-icon blue"><i class="fas fa-users"></i></div><div class="stat-info"><h4>${data.totalEmployees || 0}</h4><p>Total Employees</p></div></div>
        <div class="stat-card"><div class="stat-icon green"><i class="fas fa-user-check"></i></div><div class="stat-info"><h4>${data.activeEmployees || 0}</h4><p>Active</p></div></div>
        <div class="stat-card"><div class="stat-icon red"><i class="fas fa-user-times"></i></div><div class="stat-info"><h4>${data.terminatedEmployees || 0}</h4><p>Terminated</p></div></div>
      </div>
      <div class="card mb-3">
        <div class="card-header"><h3>Employee by Department</h3><button class="btn btn-sm btn-outline" onclick="downloadReport('employees')"><i class="fas fa-download"></i> Export CSV</button></div>
        <div class="card-body">
          ${Object.entries(data.byDepartment || {}).map(([dept, count]) => `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--gray-100);"><span>${dept}</span><span><strong>${count}</strong></span></div>`).join('')}
        </div>
      </div>
      <div class="card"><div class="card-header"><h3>CSV Downloads</h3></div><div class="card-body"><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;">
        <button class="btn btn-outline btn-block" onclick="downloadReport('employees')"><i class="fas fa-file-csv"></i> Employees</button>
        <button class="btn btn-outline btn-block" onclick="downloadReport('payroll')"><i class="fas fa-file-csv"></i> Payroll</button>
        <button class="btn btn-outline btn-block" onclick="downloadReport('leave')"><i class="fas fa-file-csv"></i> Leave</button>
        <button class="btn btn-outline btn-block" onclick="downloadReport('audit')"><i class="fas fa-file-csv"></i> Audit Log</button>
      </div></div></div>
    `;
  } else if (tab === 'headcount') {
    const data = await call('getHeadcountReport', STATE.token);
    container.innerHTML = `
      <div class="stats-grid"><div class="stat-card"><div class="stat-icon blue"><i class="fas fa-users"></i></div><div class="stat-info"><h4>${data.total || 0}</h4><p>Active Employees</p></div></div></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
        <div class="card"><div class="card-header"><h3>By Department</h3></div><div class="card-body">${Object.entries(data.byDepartment || {}).map(([k,v]) => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--gray-100);"><span>${k}</span><span>${v}</span></div>`).join('')}</div></div>
        <div class="card"><div class="card-header"><h3>By Gender</h3></div><div class="card-body">${Object.entries(data.byGender || {}).map(([k,v]) => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--gray-100);"><span>${k}</span><span>${v}</span></div>`).join('')}</div></div>
        <div class="card"><div class="card-header"><h3>By Location</h3></div><div class="card-body">${Object.entries(data.byLocation || {}).map(([k,v]) => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--gray-100);"><span>${k}</span><span>${v}</span></div>`).join('')}</div></div>
        <div class="card"><div class="card-header"><h3>By Job Level</h3></div><div class="card-body">${Object.entries(data.byLevel || {}).map(([k,v]) => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--gray-100);"><span>${k}</span><span>${v}</span></div>`).join('')}</div></div>
      </div>
    `;
  } else if (tab === 'turnover') {
    const data = await call('getTurnoverReport', STATE.token);
    container.innerHTML = `
      <div class="card"><div class="card-header"><h3>12-Month Turnover Trend</h3></div><div class="card-body">
        <div style="display:flex;gap:4px;align-items:flex-end;height:200px;padding-top:20px;">
          ${(data.months || []).map(m => {
            const max = Math.max(...(data.months || []).map(x => Math.max(x.hires, x.terminations)), 1);
            const hH = Math.round((m.hires / max) * 170);
            const tH = Math.round((m.terminations / max) * 170);
            return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;"><div style="display:flex;gap:2px;align-items:flex-end;height:170px;"><div style="width:16px;background:var(--success);border-radius:3px 3px 0 0;height:${hH}px;" title="Hires: ${m.hires}"></div><div style="width:16px;background:var(--danger);border-radius:3px 3px 0 0;height:${tH}px;" title="Terminations: ${m.terminations}"></div></div><div style="font-size:10px;color:var(--gray-500);white-space:nowrap;">${m.month}</div></div>`;
          }).join('')}
        </div>
        <div style="display:flex;gap:16px;margin-top:12px;font-size:12px;"><span><span style="display:inline-block;width:12px;height:12px;background:var(--success);border-radius:2px;margin-right:4px;"></span>Hires</span><span><span style="display:inline-block;width:12px;height:12px;background:var(--danger);border-radius:2px;margin-right:4px;"></span>Terminations</span></div>
      </div></div>
    `;
  } else if (tab === 'payroll') {
    const data = await call('getPayrollSummaryReport', STATE.token);
    container.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-icon blue"><i class="fas fa-money-check-alt"></i></div><div class="stat-info"><h4>₦${(data.totalGross || 0).toLocaleString()}</h4><p>Total Gross Pay</p></div></div>
        <div class="stat-card"><div class="stat-icon green"><i class="fas fa-hand-holding-usd"></i></div><div class="stat-info"><h4>₦${(data.totalNet || 0).toLocaleString()}</h4><p>Total Net Pay</p></div></div>
        <div class="stat-card"><div class="stat-icon red"><i class="fas fa-minus-circle"></i></div><div class="stat-info"><h4>₦${(data.totalDeductions || 0).toLocaleString()}</h4><p>Total Deductions</p></div></div>
      </div>
      <div class="card"><div class="card-header"><h3>By Department</h3></div><div class="card-body">
        <table><thead><tr><th>Department</th><th>Employees</th><th>Gross (₦)</th><th>Net (₦)</th><th>Deductions (₦)</th></tr></thead><tbody>
        ${Object.entries(data.byDepartment || {}).map(([k,v]) => `<tr><td>${k}</td><td>${v.count}</td><td>${v.gross.toLocaleString()}</td><td>${v.net.toLocaleString()}</td><td>${v.deductions.toLocaleString()}</td></tr>`).join('')}
        </tbody></table>
      </div></div>
    `;
  } else if (tab === 'leave') {
    const data = await call('getLeaveUtilizationReport', STATE.token);
    container.innerHTML = `
      <div class="stats-grid"><div class="stat-card"><div class="stat-icon blue"><i class="fas fa-calendar-alt"></i></div><div class="stat-info"><h4>${data.total || 0}</h4><p>Total Leave Requests</p></div></div></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
        <div class="card"><div class="card-header"><h3>By Leave Type</h3></div><div class="card-body">
          ${Object.entries(data.byType || {}).map(([k,v]) => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--gray-100);"><span>${k}</span><span>${v}</span></div>`).join('')}
        </div></div>
        <div class="card"><div class="card-header"><h3>By Department</h3></div><div class="card-body">
          <table><thead><tr><th>Department</th><th>Total</th><th>Approved</th><th>Rejected</th><th>Pending</th></tr></thead><tbody>
          ${Object.entries(data.byDepartment || {}).map(([k,v]) => `<tr><td>${k}</td><td>${v.total}</td><td style="color:var(--success);">${v.approved}</td><td style="color:var(--danger);">${v.rejected}</td><td style="color:var(--warning);">${v.pending}</td></tr>`).join('')}
          </tbody></table>
        </div></div>
      </div>
    `;
  }
}

// ===== Settings =====
async function loadSettings() {
  const content = document.getElementById('contentArea');
  
  const dropdowns = await call('getDropdownConfig', STATE.token);
    content.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card" style="cursor: pointer;" onclick="navigateTo('usermgmt')">
        <div class="stat-icon blue"><i class="fas fa-user-shield"></i></div>
        <div class="stat-info"><h4>Users</h4><p>Manage user accounts & roles</p></div>
      </div>
      <div class="stat-card" style="cursor: pointer;" onclick="navigateTo('employees')">
        <div class="stat-icon green"><i class="fas fa-users"></i></div>
        <div class="stat-info"><h4>Employees</h4><p>Employee directory</p></div>
      </div>
      <div class="stat-card" style="cursor: pointer;" onclick="navigateTo('orgchart')">
        <div class="stat-icon orange"><i class="fas fa-sitemap"></i></div>
        <div class="stat-info"><h4>Org Chart</h4><p>Organization hierarchy</p></div>
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
    
    <div class="card mb-3">
      <div class="card-header"><h3>Email Notifications</h3></div>
      <div class="card-body">
        <p style="color: var(--gray-600); margin-bottom: 12px;">Automated email notifications are triggered by system events:</p>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
          <div style="padding: 12px; background: var(--gray-50); border-radius: var(--radius);"><strong>🎂 Birthday Reminders</strong><br><small style="color: var(--gray-500);">Sends email to employees on their birthday</small></div>
          <div style="padding: 12px; background: var(--gray-50); border-radius: var(--radius);"><strong>📋 Probation Reviews</strong><br><small style="color: var(--gray-500);">Notifies managers at 90-day probation mark</small></div>
          <div style="padding: 12px; background: var(--gray-50); border-radius: var(--radius);"><strong>✅ Leave Approvals</strong><br><small style="color: var(--gray-500);">Email when leave is approved or rejected</small></div>
          <div style="padding: 12px; background: var(--gray-50); border-radius: var(--radius);"><strong>💬 Chat Messages</strong><br><small style="color: var(--gray-500);">In-app notifications for new messages</small></div>
        </div>
        <p style="color: var(--gray-500); font-size: 12px; margin-top: 12px;">Set up a cron job to run daily: <code>GET /cron/digest</code> at 07:00</p>
      </div>
    </div>
    
    <div class="card mb-3">
      <div class="card-header"><h3>Dropdown Management</h3></div>
      <div class="card-body">
        <p style="color: var(--gray-600); margin-bottom: 16px;">Current dropdown values (managed via config.js):</p>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px;">
          <div><strong>Departments (${(dropdowns.departments || []).length}):</strong> ${(dropdowns.departments || []).join(', ')}</div>
          <div><strong>Positions (${(dropdowns.positions || []).length}):</strong> ${(dropdowns.positions || []).join(', ')}</div>
          <div><strong>Locations (${(dropdowns.locations || []).length}):</strong> ${(dropdowns.locations || []).join(', ')}</div>
          <div><strong>Grades (${(dropdowns.grades || []).length}):</strong> ${(dropdowns.grades || []).join(', ')}</div>
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

// ===== Notifications Dropdown =====
let notifDropdownOpen = false;
async function showNotifications() {
  // Close existing dropdown if open
  const existing = document.querySelector('.notifications-dropdown');
  if (existing) { existing.remove(); notifDropdownOpen = false; return; }
  
  notifDropdownOpen = true;
  const data = await call('listNotifications', STATE.token);
  const notifications = data.notifications || [];
  
  const dropdown = document.createElement('div');
  dropdown.className = 'notifications-dropdown';
  dropdown.innerHTML = `
    <div class="notif-header">
      <strong>Notifications (${notifications.length})</strong>
      <button class="btn btn-sm btn-outline" onclick="markAllNotificationsRead(); this.closest('.notifications-dropdown').remove();">
        Mark all read
      </button>
    </div>
    ${notifications.length === 0 ? '<p style="padding: 24px; text-align: center; color: var(--gray-500);">No notifications</p>' : ''}
    ${notifications.slice(0, 20).map(n => `
      <div class="notif-item ${n.Status === 'Unread' ? 'unread' : ''}" onclick="handleNotifClick('${n.ReferenceType || ''}', '${n.ReferenceID || ''}', '${n.NotificationID || ''}')">
        <div style="display: flex; justify-content: space-between;">
          <strong style="font-size: 13px;">${n.Title || ''}</strong>
          <small style="color: var(--gray-500); white-space: nowrap; margin-left: 8px;">${n.CreatedAt ? new Date(n.CreatedAt).toLocaleDateString() : ''}</small>
        </div>
        <p style="font-size: 12px; color: var(--gray-600); margin-top: 2px;">${n.Message || ''}</p>
      </div>
    `).join('')}
  `;
  
  // Position relative to the bell icon
  const bell = document.querySelector('.notifications');
  bell.style.position = 'relative';
  bell.appendChild(dropdown);
  
  // Close on click outside
  setTimeout(() => {
    document.addEventListener('click', function closeNotif(e) {
      if (!dropdown.contains(e.target) && !bell.contains(e.target)) {
        dropdown.remove();
        notifDropdownOpen = false;
        document.removeEventListener('click', closeNotif);
      }
    });
  }, 10);
  
  // Update badge
  const unread = notifications.filter(n => n.Status === 'Unread').length;
  document.getElementById('notifCount').textContent = unread;
}

function handleNotifClick(refType, refId, notifId) {
  // Mark as read and navigate
  if (refType === 'Leave') navigateTo('leave');
  else if (refType === 'Chat') navigateTo('chat');
  else if (refType === 'Course') navigateTo('learning');
  else navigateTo('notifications');
  // Close dropdown
  const dd = document.querySelector('.notifications-dropdown');
  if (dd) dd.remove();
  notifDropdownOpen = false;
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
              ${users.map(u => {
                const roles = ['Admin','HRBP','Manager','Learning Manager','Talent Manager','Recruitment Manager','Performance Manager','Employee'];
                return `<tr>
                  <td>${u.Email}</td>
                  <td>${u.EmployeeID || '-'}</td>
                  <td>
                    <select style="padding: 4px 8px; border: 1px solid var(--gray-300); border-radius: 4px; font-size: 13px;" onchange="changeUserRole('${u.Email}', this.value)">
                      ${roles.map(r => `<option value="${r}" ${r === u.Role ? 'selected' : ''}>${r}</option>`).join('')}
                    </select>
                  </td>
                  <td><span class="pill ${(u.Status || 'Active') === 'Active' ? 'pill-success' : 'pill-danger'}">${u.Status || 'Active'}</span></td>
                  <td class="action-btns">
                    <button class="btn btn-sm btn-outline" onclick="showResetUserPassword('${u.Email}')">
                      <i class="fas fa-key"></i> Reset Password
                    </button>
                  </td>
                </tr>`;
              }).join('')}
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

async function changeUserRole(email, newRole) {
  try {
    const data = await call('adminUpdateUserRole', STATE.token, email, newRole);
    if (!data.ok) throw new Error(data.error);
    showToast(`Role updated to ${newRole}`, 'success');
  } catch (err) {
    showToast(err.message, 'error');
    loadUserManagement();
  }
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
