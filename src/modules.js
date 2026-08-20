/**
 * modules.js - Payroll, Statutory, ATS, Assessments (Node.js)
 * All functions are async.
 */
const {
  pool, uuid, normalizeEmail,
  readRowsAsync, findByIdAsync, appendRowAsync, updateByIdAsync,
  APP, SHEETS, SCHEMA, cache, auditAsync
} = require('./globals');

const core = require('./core');

/* ================================================================
   PAYROLL / SALARY
   ================================================================ */
async function saveSalarySetup(token, p) {
  await core.requireRole(token, APP.ADMIN_ROLES.concat(['HRBP']));
  const id = uuid();
  await appendRowAsync(SHEETS.SALARY, [
    id, p.EmployeeID, p.Period || '', Number(p.Basic || 0), Number(p.Housing || 0),
    Number(p.Transport || 0), Number(p.OtherAllowances || 0), p.Currency || 'NGN',
    p.EffectiveFrom || '', p.EffectiveTo || '', p.Status || 'Active',
    new Date().toISOString(), new Date().toISOString()
  ]);
  await auditAsync('SALARY_SETUP', core._normalizeEmail ? '' : '', { employeeId: p.EmployeeID, period: p.Period });
  return { ok: true, salaryId: id };
}

async function getSalarySheet(token, period) {
  await core.requireRole(token, APP.ADMIN_ROLES.concat(['HRBP']));
  const rows = await readRowsAsync(SHEETS.SALARY);
  const filtered = rows.filter(s => !period || s.Period === period);
  // Compute totals for current user's salary
  if (filtered.length === 1) {
    const s = filtered[0];
    return {
      ok: true,
      basicSalary: Number(s.Basic || 0),
      totalAllowances: Number(s.Housing || 0) + Number(s.Transport || 0) + Number(s.OtherAllowances || 0),
      totalDeductions: 0,
      allowances: { Housing: Number(s.Housing || 0), Transport: Number(s.Transport || 0), Other: Number(s.OtherAllowances || 0) }
    };
  }
  return { ok: true, salaries: filtered, basicSalary: 0, totalAllowances: 0, totalDeductions: 0 };
}

async function processPayroll(token, period) {
  const me = await core.requireRole(token, APP.ADMIN_ROLES.concat(['HRBP']));
  if (!period) throw new Error('Period is required (YYYY-MM)');
  const salaries = (await readRowsAsync(SHEETS.SALARY)).filter(s => s.Period === period && s.Status === 'Active');
  const emp = await readRowsAsync(SHEETS.EMP);
  let processed = 0;
  for (const s of salaries) {
    const employee = emp.find(e => String(e.EmployeeID) === String(s.EmployeeID));
    if (!employee || String(employee.EmploymentStatus) !== 'Active') continue;
    const gross = Number(s.Basic || 0) + Number(s.Housing || 0) + Number(s.Transport || 0) + Number(s.OtherAllowances || 0);
    const statutory = computeStatutoryInternal(s.EmployeeID, period, gross);
    const net = gross - statutory.totalStatutory;
    await appendRowAsync(SHEETS.PAYRUN, [uuid(), period, s.EmployeeID, gross, gross - Number(s.Basic || 0), statutory.totalStatutory, net, 'Processed', me.email, new Date().toISOString()]);
    await appendRowAsync(SHEETS.PAYSLIPS, [uuid(), s.EmployeeID, period, gross, statutory.totalStatutory, net, new Date().toISOString()]);
    processed++;
  }
  await auditAsync('PAYROLL_RUN', me.email, { period, processed });
  return { ok: true, period, processed };
}

async function getPayrollDashboard(token) {
  await core.requireRole(token, APP.ADMIN_ROLES.concat(['HRBP']));
  const runs = await readRowsAsync(SHEETS.PAYRUN);
  return {
    ok: true,
    count: runs.length,
    gross: runs.reduce((s, r) => s + Number(r.GrossPay || 0), 0),
    deductions: runs.reduce((s, r) => s + Number(r.TotalDeduction || 0), 0),
    net: runs.reduce((s, r) => s + Number(r.NetPay || 0), 0)
  };
}

async function getMyPayslips(token) {
  const me = await core.requireLogin(token);
  const rows = await readRowsAsync(SHEETS.PAYSLIPS);
  return { ok: true, payslips: rows.filter(p => String(p.EmployeeID) === String(me.employeeId)) };
}

async function generateMyPayslip(token, period) {
  await core.requireLogin(token);
  return { ok: true, url: '#', period };
}

async function getBankTransferSchedule(token, period) {
  await core.requireRole(token, APP.ADMIN_ROLES.concat(['HRBP']));
  const runs = (await readRowsAsync(SHEETS.PAYRUN)).filter(r => r.Period === period);
  const emp = await readRowsAsync(SHEETS.EMP);
  const bank = await readRowsAsync(SHEETS.BANK);
  return runs.map(r => {
    const e = emp.find(x => String(x.EmployeeID) === String(r.EmployeeID)) || {};
    const b = bank.find(x => String(x.EmployeeID) === String(r.EmployeeID)) || {};
    return { EmployeeID: r.EmployeeID, Name: [e.FirstName, e.LastName].join(' '), NetPay: r.NetPay, BankName: b.BankName || '', AccountNumber: b.AccountNumber || '', AccountName: b.AccountName || '' };
  }).filter(r => r.BankName);
}

async function getBankTransferHistory(token) {
  await core.requireRole(token, APP.ADMIN_ROLES.concat(['HRBP']));
  return (await readRowsAsync(SHEETS.BANK_BATCH));
}

async function saveBankDetails(token, p) {
  const me = await core.requireLogin(token);
  const employeeId = p.EmployeeID || me.employeeId;
  const rows = await readRowsAsync(SHEETS.BANK);
  const existing = rows.find(b => String(b.EmployeeID) === String(employeeId));
  if (existing) {
    await updateByIdAsync(SHEETS.BANK, 'BankID', existing.BankID, { BankName: p.BankName, AccountNumber: p.AccountNumber, AccountName: p.AccountName, SortCode: p.SortCode || '', Status: 'Active', UpdatedAt: new Date().toISOString() });
  } else {
    await appendRowAsync(SHEETS.BANK, [uuid(), employeeId, p.BankName || '', p.AccountNumber || '', p.AccountName || '', p.SortCode || '', 'Active', new Date().toISOString()]);
  }
  return { ok: true };
}

/* ================================================================
   STATUTORY
   ================================================================ */
async function getStatutoryConfig() {
  const rows = await readRowsAsync(SHEETS.STAT_CONFIG);
  const result = {};
  rows.forEach(r => { result[r.Key] = r.Value; });
  return result;
}

function computeStatutoryInternal(employeeId, period, grossPay) {
  const cfg = cache().get('statutory_config') ? JSON.parse(cache().get('statutory_config')) : null;
  // Use defaults if not cached
  const taxFree = 300000;
  const annualGross = grossPay * 12;
  const taxable = Math.max(0, annualGross - taxFree);
  let paye = 0;
  const bands = [
    { limit: 300000, rate: 0.07 },
    { limit: 500000, rate: 0.11 },
    { limit: 800000, rate: 0.15 }
  ];
  let remaining = taxable;
  for (const b of bands) {
    if (remaining <= 0) break;
    const amt = Math.min(remaining, b.limit);
    paye += amt * b.rate;
    remaining -= amt;
  }
  if (remaining > 0) paye += remaining * 0.18;
  const monthlyPaye = Math.round(paye / 12);
  const pension = Math.round(grossPay * 0.08);
  const nhf = Math.round(grossPay * 0.025);
  return { gross: grossPay, paye: monthlyPaye, pension, nhf, totalStatutory: monthlyPaye + pension + nhf };
}

async function computeEmployeeStatutory(token, employeeId, period, opts) {
  if (token) await core.requireLogin(token);
  const salaries = (await readRowsAsync(SHEETS.SALARY)).filter(s => String(s.EmployeeID) === String(employeeId));
  if (!salaries.length) throw new Error('No salary found for this employee');
  const s = salaries[0];
  const gross = Number(s.Basic || 0) + Number(s.Housing || 0) + Number(s.Transport || 0) + Number(s.OtherAllowances || 0);
  const result = computeStatutoryInternal(employeeId, period, gross);
  result.employeeId = employeeId;
  result.period = period;
  if (opts && opts.postToDeductions) {
    await appendRowAsync(SHEETS.STAT_PAY, [uuid(), employeeId, period, s.Basic || 0, gross, result.paye, result.pension, result.nhf, result.totalStatutory, 'Computed', new Date().toISOString(), new Date().toISOString()]);
  }
  return result;
}

async function computeEmployeeStatutoryBreakdownInternal(employeeId, period, opts) {
  return computeEmployeeStatutory(null, employeeId, period, opts);
}

async function runStatutoryForAll(token, period) {
  await core.requireRole(token, APP.ADMIN_ROLES.concat(['HRBP']));
  const salaries = (await readRowsAsync(SHEETS.SALARY)).filter(s => s.Period === period && s.Status === 'Active');
  const results = [];
  for (const s of salaries) {
    try {
      const gross = Number(s.Basic || 0) + Number(s.Housing || 0) + Number(s.Transport || 0) + Number(s.OtherAllowances || 0);
      const stat = computeStatutoryInternal(s.EmployeeID, period, gross);
      await appendRowAsync(SHEETS.STAT_PAY, [uuid(), s.EmployeeID, period, s.Basic || 0, gross, stat.paye, stat.pension, stat.nhf, stat.totalStatutory, 'Computed', new Date().toISOString(), new Date().toISOString()]);
      results.push({ employeeId: s.EmployeeID, gross, paye: stat.paye, pension: stat.pension, nhf: stat.nhf });
    } catch (e) {}
  }
  return { ok: true, processed: results.length, summary: { totalPAYE: results.reduce((s, r) => s + r.paye, 0), totalPension: results.reduce((s, r) => s + r.pension, 0), totalNHF: results.reduce((s, r) => s + r.nhf, 0) } };
}

async function getStatutorySummaryForPeriod(token, period) {
  const rows = (await readRowsAsync(SHEETS.STAT_PAY)).filter(r => !period || r.Period === period);
  if (!rows.length) return { period, totalPAYE: 0, totalPension: 0, totalNHF: 0, count: 0 };
  return {
    ok: true, period, count: rows.length,
    totalPAYE: rows.reduce((s, r) => s + Number(r.PAYE || 0), 0),
    totalPension: rows.reduce((s, r) => s + Number(r.Pension || 0), 0),
    totalNHF: rows.reduce((s, r) => s + Number(r.NHF || 0), 0),
    totalStatutory: rows.reduce((s, r) => s + Number(r.TotalStatutory || 0), 0)
  };
}

async function getMyStatutoryBreakdown(token, period) {
  const me = await core.requireLogin(token);
  const rows = (await readRowsAsync(SHEETS.STAT_PAY)).filter(r => String(r.EmployeeID) === String(me.employeeId) && (!period || r.Period === period));
  return rows;
}

async function getPayeAndPensionReport(token, period) {
  const summary = await getStatutorySummaryForPeriod(token, period);
  return { paye: summary.totalPAYE, pension: summary.totalPension, nhf: summary.totalNHF };
}

/* ================================================================
   ASSESSMENTS
   ================================================================ */
async function saveAssessmentQuestion(token, q) {
  await core.requireRole(token, APP.RECRUITMENT_ROLES);
  const id = uuid();
  await appendRowAsync(SHEETS.ASSESS_Q, [id, q.Bank || 'Default', q.Question, q.OptionA || '', q.OptionB || '', q.OptionC || '', q.OptionD || '', q.CorrectOption || 'A', 'TRUE', new Date().toISOString(), new Date().toISOString()]);
  return { ok: true, questionId: id };
}

async function listAssessmentQuestions(token, bank) {
  await core.requireRole(token, APP.RECRUITMENT_ROLES.concat(APP.ADMIN_ROLES));
  const rows = await readRowsAsync(SHEETS.ASSESS_Q);
  return rows.filter(q => String(q.Active) === 'TRUE' && (!bank || q.Bank === bank));
}

async function assignAssessment(token, p) {
  const me = await core.requireRole(token, APP.RECRUITMENT_ROLES);
  const id = uuid();
  await appendRowAsync(SHEETS.ASSESS_ASSIGN, [id, p.EmployeeID, p.Bank || 'Default', p.StartAt || new Date().toISOString(), p.EndAt || '', 'Assigned', '', me.email, new Date().toISOString(), new Date().toISOString()]);
  return { ok: true, assignmentId: id };
}

async function getMyAssessments(token) {
  const me = await core.requireLogin(token);
  const rows = await readRowsAsync(SHEETS.ASSESS_ASSIGN);
  return rows.filter(a => String(a.EmployeeID) === String(me.employeeId));
}

async function getAssessmentQuestionsForEmployee(token) {
  const me = await core.requireLogin(token);
  const assigns = (await readRowsAsync(SHEETS.ASSESS_ASSIGN)).filter(a => String(a.EmployeeID) === String(me.employeeId) && a.Status === 'Assigned');
  const questions = (await readRowsAsync(SHEETS.ASSESS_Q)).filter(q => String(q.Active) === 'TRUE');
  return assigns.map(a => ({ assignment: a, questions: questions.filter(q => q.Bank === a.Bank) }));
}

async function submitAssessment(token, assignmentId, answers) {
  const me = await core.requireLogin(token);
  const a = await findByIdAsync(SHEETS.ASSESS_ASSIGN, 'AssignmentID', assignmentId);
  if (!a || String(a.EmployeeID) !== String(me.employeeId)) throw new Error('Assignment not found');
  const questions = (await readRowsAsync(SHEETS.ASSESS_Q)).filter(q => q.Bank === a.Bank);
  let correct = 0;
  for (const ans of (answers || [])) {
    const q = questions.find(x => String(x.QuestionID) === String(ans.questionId));
    if (q) {
      const isCorrect = q.CorrectOption === ans.answer;
      if (isCorrect) correct++;
      await appendRowAsync(SHEETS.ASSESS_RESP, [uuid(), assignmentId, me.employeeId, ans.questionId, ans.answer, isCorrect ? 'TRUE' : 'FALSE', new Date().toISOString()]);
    }
  }
  const score = questions.length ? Math.round((correct / questions.length) * 100) : 0;
  await updateByIdAsync(SHEETS.ASSESS_ASSIGN, 'AssignmentID', assignmentId, { Status: 'Completed', Score: score, UpdatedAt: new Date().toISOString() });
  return { ok: true, score, total: questions.length, correct };
}

async function getAssessmentReports(token) {
  await core.requireRole(token, APP.RECRUITMENT_ROLES.concat(APP.ADMIN_ROLES));
  const assigns = (await readRowsAsync(SHEETS.ASSESS_ASSIGN)).filter(a => a.Status === 'Completed');
  const emp = await readRowsAsync(SHEETS.EMP);
  return assigns.map(a => {
    const e = emp.find(x => String(x.EmployeeID) === String(a.EmployeeID)) || {};
    return { ...a, Name: [e.FirstName, e.LastName].join(' ') };
  });
}

/* ================================================================
   ATS (Applicant Tracking)
   ================================================================ */
async function createRequisition(token, p) {
  await core.requireRole(token, APP.RECRUITMENT_ROLES);
  const id = uuid();
  await appendRowAsync(SHEETS.REQ, [id, p.Title, p.Department || '', p.Location || '', p.Openings || '1', p.Priority || 'Medium', p.Status || 'Open', p.RequestedBy || '', p.JobDescription || '', new Date().toISOString(), new Date().toISOString()]);
  return { ok: true, requisitionId: id };
}

async function listRequisitions(token) {
  await core.requireLogin(token);
  return { ok: true, requisitions: await readRowsAsync(SHEETS.REQ) };
}

async function getATSDashboard(token) {
  await core.requireRole(token, APP.RECRUITMENT_ROLES);
  const reqs = await readRowsAsync(SHEETS.REQ);
  const cands = await readRowsAsync(SHEETS.CAND);
  return {
    requisitions: reqs.length, candidates: cands.length,
    openJobs: reqs.filter(r => r.Status === 'Open').length,
    shortlisted: cands.filter(c => c.Stage === 'Shortlisted').length
  };
}

async function createCandidate(token, p) {
  await core.requireRole(token, APP.RECRUITMENT_ROLES);
  const id = uuid();
  await appendRowAsync(SHEETS.CAND, [id, p.RequisitionID || '', p.FirstName, p.LastName, p.Email || '', p.Phone || '', p.ResumeUrl || '', p.Source || '', p.Stage || 'Applied', p.Status || 'New', p.Notes || '', new Date().toISOString(), new Date().toISOString()]);
  await appendRowAsync(SHEETS.CAND_STAGE, [uuid(), id, p.Stage || 'Applied', '', new Date().toISOString()]);
  return { ok: true, candidateId: id };
}

async function listCandidates(token) {
  await core.requireLogin(token);
  return (await readRowsAsync(SHEETS.CAND));
}

async function moveCandidateStage(token, candidateId, stage, comment) {
  await core.requireRole(token, APP.RECRUITMENT_ROLES);
  await updateByIdAsync(SHEETS.CAND, 'CandidateID', candidateId, { Stage: stage, UpdatedAt: new Date().toISOString() });
  await appendRowAsync(SHEETS.CAND_STAGE, [uuid(), candidateId, stage, comment || '', new Date().toISOString()]);
  return { ok: true };
}

async function getCandidateHistory(token, candidateId) {
  await core.requireLogin(token);
  return (await readRowsAsync(SHEETS.CAND_STAGE)).filter(s => String(s.CandidateID) === String(candidateId));
}

module.exports = {
  saveSalarySetup, getSalarySheet, processPayroll, getPayrollDashboard,
  getMyPayslips, generateMyPayslip, getBankTransferSchedule, getBankTransferHistory, saveBankDetails,
  getStatutoryConfig, computeEmployeeStatutory, computeEmployeeStatutoryBreakdownInternal,
  runStatutoryForAll, getStatutorySummaryForPeriod, getMyStatutoryBreakdown, getPayeAndPensionReport,
  saveAssessmentQuestion, listAssessmentQuestions, assignAssessment, getMyAssessments,
  getAssessmentQuestionsForEmployee, submitAssessment, getAssessmentReports,
  createRequisition, listRequisitions, getATSDashboard, createCandidate, listCandidates,
  moveCandidateStage, getCandidateHistory
};
