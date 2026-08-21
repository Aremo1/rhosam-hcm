/**
 * RHoSAM HCM - Configuration
 * All constants, schema, roles, dropdown options
 */
require('dotenv').config();

const { NIGERIAN_STATE_NAMES, NIGERIAN_STATES, getLGAs } = require('./nigerian-states');

const TZ = process.env.TZ || 'Africa/Lagos';

const APP = {
  NAME: 'RHoSAM HCM',
  COMPANY: 'RHoSAM',
  COUNTRY_DEFAULT: 'Nigeria',
  TZ,
  SESSION_HOURS: Number(process.env.SESSION_HOURS || 24),
  OTP_MINUTES: 10,
  PHOTO_FOLDER: 'RHoSAM_HCM_Profile_Photos',
  CHAT_FOLDER: 'RHoSAM_HCM_Chat_Files',
  PAYSLIP_FOLDER: 'RHoSAM_HCM_Payslips',
  DOC_FOLDER: 'RHoSAM_HCM_Documents',
  VERSION: '2026.08.20-web',
  // All roles in the system
  ROLES: [
    'Admin',
    'HRBP',
    'Manager',
    'Learning Manager',
    'Talent Manager',
    'Recruitment Manager',
    'Performance Manager',
    'Employee'
  ],
  ADMIN_ROLES: ['Admin', 'HRBP'],
  MANAGER_ROLES: ['Manager', 'Admin', 'HRBP'],
  LEARNING_ROLES: ['Learning Manager', 'Admin', 'HRBP'],
  TALENT_ROLES: ['Talent Manager', 'Learning Manager', 'Admin', 'HRBP'],
  RECRUITMENT_ROLES: ['Recruitment Manager', 'Admin', 'HRBP'],
  PERFORMANCE_ROLES: ['Performance Manager', 'Manager', 'Admin', 'HRBP'],
  CHAT_ALLOWED_MIME: ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain'],
  CHAT_MAX_BYTES: 5242880,
  // Office locations (editable by admin)
  OFFICE_LOCATIONS: [
    'Lagos Head Office',
    'Abuja Office',
    'Port Harcourt Office',
    'Kano Office',
    'Ibadan Office',
    'Enugu Office'
  ],
  // Job levels (1-6)
  JOB_LEVELS: ['Level 1', 'Level 2', 'Level 3', 'Level 4', 'Level 5', 'Level 6'],
  // Position names (11 generic)
  POSITION_NAMES: [
    'Software Engineer',
    'Accountant',
    'HR Officer',
    'Sales Executive',
    'Operations Manager',
    'Legal Counsel',
    'Marketing Analyst',
    'Payroll Officer',
    'Recruitment Officer',
    'Business Analyst',
    'Project Manager'
  ],
  // Title prefixes
  TITLES: ['Mr', 'Mrs', 'Miss', 'Ms', 'Dr', 'Prof', 'Engr', 'Hon'],
  // Departments
  DEPARTMENTS: [
    'Human Resources',
    'Finance',
    'Information Technology',
    'Sales',
    'Operations',
    'Legal',
    'Marketing',
    'Customer Experience',
    'Administration',
    'Engineering'
  ],
  // Marital statuses
  MARITAL_STATUSES: ['Single', 'Married', 'Divorced', 'Separated', 'Widowed'],
  // Gender options
  GENDERS: ['Male', 'Female', 'Other'],
  // Employment statuses
  EMP_STATUSES: ['Active', 'On Leave', 'Terminated', 'Suspended', 'Probation'],
  // Leave types
  LEAVE_TYPES: ['Annual Leave', 'Sick Leave', 'Maternity Leave', 'Paternity Leave', 'Compassionate Leave', 'Study Leave', 'Unpaid Leave'],
  // Grade levels
  GRADES: ['Grade A', 'Grade B', 'Grade C', 'Grade D', 'Grade E', 'Grade F']
};

const SHEETS = {
  USERS: 'Users',
  EMP: 'Employees',
  CONFIG: 'Config',
  STATES: 'State_LGA_Config',
  DEPT: 'Departments',
  POSITIONS: 'Positions',
  LOCATIONS: 'Locations',
  JOBLEVELS: 'Job_Levels',
  GRADES: 'Grades',
  TITLES: 'Titles',
  NOTIF: 'Notifications',
  LEAVE: 'Leave_Tracker',
  ONBOARD: 'Onboarding_Workflow',
  OFFBOARD: 'Offboarding_Workflow',
  SESSIONS: 'Sessions',
  AUDIT: 'Audit_Log',
  CHAT: 'Chat_Messages',
  CHAT_FILES: 'Chat_Files',
  ASSESS_Q: 'Assessment_Questions',
  ASSESS_ASSIGN: 'Assessment_Assignments',
  ASSESS_RESP: 'Assessment_Responses',
  COURSES: 'Courses',
  COURSE_ASSIGN: 'Course_Assignments',
  COURSE_PROGRESS: 'Course_Progress',
  SALARY: 'Salary_Master',
  PAYRUN: 'Payroll_Run',
  DED: 'Deductions',
  STAT_CONFIG: 'Statutory_Config',
  STAT_PAY: 'Payroll_Statutory',
  ALLOW: 'Allowances',
  PAYSLIPS: 'Payslips',
  BANK: 'Bank_Details',
  BANK_BATCH: 'Bank_Transfer_Batches',
  REQ: 'Recruitment_Requisitions',
  CAND: 'Recruitment_Candidates',
  CAND_STAGE: 'Candidate_Stages',
  GOALS: 'Goals',
  CHECKINS: 'CheckIns',
  DOCS: 'Documents',
  ORG: 'Org_Chart',
  APPRAISAL_CYCLES: 'Appraisal_Cycles',
  APPRAISAL_FEEDBACK: 'Appraisal_Feedback'
};

/** Canonical column order per table */
const SCHEMA = {
  Users: ['UserID', 'EmployeeID', 'Email', 'PasswordHash', 'Salt', 'Role', 'Status', 'MustChangePassword', 'LastLogin', 'CreatedAt', 'UpdatedAt'],
  Employees: ['EmployeeID', 'Title', 'FirstName', 'MiddleName', 'LastName', 'DOB', 'Gender', 'MaritalStatus', 'Religion', 'Email', 'Phone', 'NationalID', 'Country', 'StateOfOrigin', 'LGA', 'Address', 'AddressState', 'AddressLGA', 'EmergencyContactName', 'EmergencyContactPhone', 'NextOfKin', 'NextOfKinPhone', 'NextOfKinRelationship', 'BankName', 'BankAccountNumber', 'BankAccountName', 'Department', 'Position', 'Location', 'JobLevel', 'Grade', 'JobTitle', 'ManagerID', 'Role', 'EmploymentStatus', 'HireDate', 'TerminationDate', 'PhotoFileId', 'PhotoUrl', 'CreatedAt', 'UpdatedAt'],
  Config: ['Key', 'Value', 'Category', 'Active'],
  State_LGA_Config: ['State', 'LGA', 'Active'],
  Departments: ['Department', 'Active'],
  Positions: ['Position', 'Active'],
  Locations: ['Location', 'Active'],
  Job_Levels: ['JobLevel', 'Active'],
  Grades: ['Grade', 'Active'],
  Titles: ['Title', 'Active'],
  Notifications: ['NotificationID', 'ToEmployeeID', 'FromEmployeeID', 'Type', 'Category', 'Priority', 'Title', 'Message', 'Status', 'CanApprove', 'ReferenceType', 'ReferenceID', 'Comment', 'ExpiresAt', 'CreatedAt', 'ActionedAt'],
  Leave_Tracker: ['LeaveID', 'EmployeeID', 'LeaveType', 'StartDate', 'EndDate', 'Days', 'Status', 'ManagerID', 'Comment', 'CreatedAt', 'UpdatedAt'],
  Onboarding_Workflow: ['WorkflowID', 'EmployeeID', 'Task', 'OwnerRole', 'Status', 'DueDate', 'Comment', 'CreatedAt', 'UpdatedAt'],
  Offboarding_Workflow: ['WorkflowID', 'EmployeeID', 'Task', 'OwnerRole', 'Status', 'DueDate', 'Comment', 'CreatedAt', 'UpdatedAt'],
  Sessions: ['Token', 'EmployeeID', 'Email', 'Role', 'ExpiresAt', 'RefreshKey', 'CreatedAt', 'LastSeen'],
  Audit_Log: ['CreatedAt', 'Action', 'Actor', 'Details'],
  Chat_Messages: ['MessageID', 'ThreadID', 'FromEmployeeID', 'ToEmployeeID', 'Message', 'FileIds', 'Reactions', 'Status', 'ReadAt', 'EditedAt', 'DeletedAt', 'CreatedAt'],
  Chat_Files: ['FileID', 'MessageID', 'OwnerEmployeeID', 'FileName', 'DriveFileId', 'Url', 'CreatedAt'],
  Assessment_Questions: ['QuestionID', 'Bank', 'Question', 'OptionA', 'OptionB', 'OptionC', 'OptionD', 'CorrectOption', 'Active', 'CreatedAt', 'UpdatedAt'],
  Assessment_Assignments: ['AssignmentID', 'EmployeeID', 'Bank', 'StartAt', 'EndAt', 'Status', 'Score', 'AssignedBy', 'CreatedAt', 'UpdatedAt'],
  Assessment_Responses: ['ResponseID', 'AssignmentID', 'EmployeeID', 'QuestionID', 'Answer', 'IsCorrect', 'CreatedAt'],
  Courses: ['CourseID', 'Title', 'Description', 'Link', 'DurationHours', 'Active', 'CreatedAt', 'UpdatedAt'],
  Course_Assignments: ['CourseAssignID', 'EmployeeID', 'CourseID', 'StartAt', 'EndAt', 'Status', 'AssignedBy', 'CreatedAt', 'UpdatedAt'],
  Course_Progress: ['ProgressID', 'CourseAssignID', 'EmployeeID', 'CourseID', 'ProgressPercent', 'CompletedAt', 'Comment', 'UpdatedAt'],
  Salary_Master: ['SalaryID', 'EmployeeID', 'Period', 'Basic', 'Housing', 'Transport', 'OtherAllowances', 'Currency', 'EffectiveFrom', 'EffectiveTo', 'Status', 'CreatedAt', 'UpdatedAt'],
  Payroll_Run: ['PayrollRunID', 'Period', 'EmployeeID', 'GrossPay', 'TotalAllowance', 'TotalDeduction', 'NetPay', 'Status', 'ProcessedBy', 'ProcessedAt'],
  Deductions: ['DeductionID', 'EmployeeID', 'Period', 'Type', 'Amount', 'Recurring', 'CreatedAt'],
  Statutory_Config: ['Key', 'Value', 'Description', 'UpdatedAt'],
  Payroll_Statutory: ['StatutoryID', 'EmployeeID', 'Period', 'Basic', 'Gross', 'PAYE', 'Pension', 'NHF', 'TotalStatutory', 'Status', 'CreatedAt', 'UpdatedAt'],
  Allowances: ['AllowanceID', 'EmployeeID', 'Period', 'Type', 'Amount', 'Recurring', 'CreatedAt'],
  Payslips: ['PayslipID', 'EmployeeID', 'Period', 'GrossPay', 'Deductions', 'NetPay', 'GeneratedAt'],
  Bank_Details: ['BankID', 'EmployeeID', 'BankName', 'AccountNumber', 'AccountName', 'SortCode', 'Status', 'UpdatedAt'],
  Bank_Transfer_Batches: ['BatchID', 'Period', 'FileId', 'FileUrl', 'GeneratedBy', 'Count', 'Total', 'MissingBank', 'CreatedAt'],
  Recruitment_Requisitions: ['RequisitionID', 'Title', 'Department', 'Location', 'Openings', 'Priority', 'Status', 'RequestedBy', 'JobDescription', 'CreatedAt', 'UpdatedAt'],
  Recruitment_Candidates: ['CandidateID', 'RequisitionID', 'FirstName', 'LastName', 'Email', 'Phone', 'ResumeUrl', 'Source', 'Stage', 'Status', 'Notes', 'CreatedAt', 'UpdatedAt'],
  Candidate_Stages: ['StageID', 'CandidateID', 'Stage', 'Comment', 'CreatedAt'],
  Goals: ['GoalID', 'EmployeeID', 'Goal', 'Status', 'DueDate', 'ManagerComment', 'CreatedAt', 'UpdatedAt'],
  CheckIns: ['CheckInID', 'EmployeeID', 'ManagerID', 'Topic', 'Comment', 'Decision', 'CreatedAt'],
  Appraisal_Cycles: ['AppraisalCycleID', 'Title', 'EmployeeID', 'ManagerID', 'ReviewPeriod', 'Status', 'StartDate', 'EndDate', 'CreatedAt', 'UpdatedAt'],
  Appraisal_Feedback: ['FeedbackID', 'AppraisalCycleID', 'EmployeeID', 'ReviewerID', 'ReviewerRole', 'Rating', 'Comments', 'Strengths', 'DevelopmentAreas', 'CreatedAt'],
  Documents: ['DocumentID', 'EmployeeID', 'Type', 'FileName', 'DriveFileId', 'Url', 'CreatedAt'],
  Org_Chart: ['EmployeeID', 'ManagerID', 'PositionTitle', 'Department', 'Active']
};

const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');

module.exports = { APP, SHEETS, SCHEMA, TZ, PUBLIC_BASE_URL, NIGERIAN_STATES, NIGERIAN_STATE_NAMES, getLGAs };
