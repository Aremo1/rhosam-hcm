/**
 * RHoSAM HCM — Email Service (Resend)
 * Professional HTML email templates for all notifications
 */
require('dotenv').config();
const { Pool } = require('pg');

/* ---- Resend client ---- */
let resendClient = null;
function getResend() {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  if (!resendClient) {
    const { Resend } = require('resend');
    resendClient = new Resend(key);
  }
  return resendClient;
}

const FROM_EMAIL = process.env.EMAIL_FROM || 'RHoSAM HCM <noreply@rhosamhr.com>';
const APP_URL = process.env.PUBLIC_BASE_URL || 'https://rhosam.onrender.com';

/* ---- Base HTML template ---- */
function baseTemplate(title, content) {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;background:#f4f6f9;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:40px 20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
  <!-- Header -->
  <tr><td style="background:linear-gradient(135deg,#1a365d 0%,#2563eb 100%);padding:30px 40px;text-align:center;">
    <h1 style="color:#ffffff;margin:0;font-size:24px;font-weight:600;">RHoSAM HCM</h1>
    <p style="color:#93c5fd;margin:8px 0 0;font-size:13px;">People • Technology • Growth</p>
  </td></tr>
  <!-- Body -->
  <tr><td style="padding:40px;">
    <h2 style="color:#1a365d;margin:0 0 20px;font-size:20px;">${title}</h2>
    ${content}
  </td></tr>
  <!-- Footer -->
  <tr><td style="background:#f8fafc;padding:20px 40px;border-top:1px solid #e2e8f0;text-align:center;">
    <p style="color:#94a3b8;font-size:12px;margin:0;">© ${new Date().getFullYear()} RHoSAM. All rights reserved.</p>
    <p style="color:#94a3b8;font-size:11px;margin:8px 0 0;">
      <a href="${APP_URL}" style="color:#2563eb;text-decoration:none;">Open App</a> • 
      <a href="${APP_URL}/#/settings" style="color:#2563eb;text-decoration:none;">Settings</a>
    </p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

/* ---- Email Templates ---- */
const templates = {
  welcome: (data) => baseTemplate('Welcome to RHoSAM HCM', `
    <p style="color:#475569;line-height:1.7;">Hi <strong>${data.name}</strong>,</p>
    <p style="color:#475569;line-height:1.7;">Your account has been created successfully. Here are your login details:</p>
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin:20px 0;">
      <p style="margin:4px 0;color:#475569;"><strong>Email:</strong> ${data.email}</p>
      <p style="margin:4px 0;color:#475569;"><strong>Role:</strong> ${data.role}</p>
      <p style="margin:4px 0;color:#475569;"><strong>Employee ID:</strong> ${data.employeeId}</p>
      ${data.tempPassword ? `<p style="margin:4px 0;color:#475569;"><strong>Temporary Password:</strong> <code style="background:#fee2e2;padding:2px 6px;border-radius:4px;color:#dc2626;">${data.tempPassword}</code></p>` : ''}
    </div>
    <p style="color:#475569;line-height:1.7;">Please log in and change your password immediately.</p>
    <div style="text-align:center;margin:30px 0;">
      <a href="${APP_URL}" style="background:#2563eb;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;">Login Now</a>
    </div>
    <p style="color:#94a3b8;font-size:12px;">If you didn't request this account, please contact your HR administrator.</p>
  `),

  leaveApproved: (data) => baseTemplate('Leave Request Approved ✅', `
    <p style="color:#475569;line-height:1.7;">Hi <strong>${data.name}</strong>,</p>
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin:20px 0;">
      <p style="color:#166534;margin:0;font-weight:600;">Your leave request has been approved!</p>
    </div>
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin:20px 0;">
      <p style="margin:4px 0;color:#475569;"><strong>Leave Type:</strong> ${data.leaveType}</p>
      <p style="margin:4px 0;color:#475569;"><strong>Start Date:</strong> ${data.startDate}</p>
      <p style="margin:4px 0;color:#475569;"><strong>End Date:</strong> ${data.endDate}</p>
      <p style="margin:4px 0;color:#475569;"><strong>Days:</strong> ${data.days}</p>
      ${data.comment ? `<p style="margin:4px 0;color:#475569;"><strong>Comment:</strong> ${data.comment}</p>` : ''}
    </div>
    <p style="color:#475569;line-height:1.7;">Enjoy your time off!</p>
  `),

  leaveRejected: (data) => baseTemplate('Leave Request Declined ❌', `
    <p style="color:#475569;line-height:1.7;">Hi <strong>${data.name}</strong>,</p>
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;margin:20px 0;">
      <p style="color:#991b1b;margin:0;font-weight:600;">Your leave request has been declined.</p>
    </div>
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin:20px 0;">
      <p style="margin:4px 0;color:#475569;"><strong>Leave Type:</strong> ${data.leaveType}</p>
      <p style="margin:4px 0;color:#475569;"><strong>Start Date:</strong> ${data.startDate}</p>
      <p style="margin:4px 0;color:#475569;"><strong>End Date:</strong> ${data.endDate}</p>
      ${data.comment ? `<p style="margin:4px 0;color:#475569;"><strong>Reason:</strong> ${data.comment}</p>` : ''}
    </div>
    <p style="color:#475569;line-height:1.7;">Please contact your manager if you have questions.</p>
  `),

  birthday: (data) => baseTemplate('🎂 Happy Birthday!', `
    <p style="color:#475569;line-height:1.7;">Hi <strong>${data.name}</strong>,</p>
    <div style="background:#fefce8;border:1px solid #fde68a;border-radius:8px;padding:20px;margin:20px 0;text-align:center;">
      <p style="font-size:40px;margin:0;">🎉🎂🎁</p>
      <p style="color:#92400e;font-size:18px;font-weight:600;margin:12px 0 0;">Happy Birthday!</p>
    </div>
    <p style="color:#475569;line-height:1.7;">The entire RHoSAM team wishes you a wonderful birthday and a fantastic year ahead!</p>
    <p style="color:#475569;line-height:1.7;">As a reminder, you have <strong>1 day of birthday leave</strong> available if you'd like to take it.</p>
  `),

  payslip: (data) => baseTemplate('Payslip Generated 💰', `
    <p style="color:#475569;line-height:1.7;">Hi <strong>${data.name}</strong>,</p>
    <p style="color:#475569;line-height:1.7;">Your payslip for <strong>${data.period}</strong> has been generated.</p>
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin:20px 0;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr><td style="padding:8px 0;color:#475569;"><strong>Gross Pay:</strong></td><td style="padding:8px 0;text-align:right;color:#166534;">₦${Number(data.grossPay).toLocaleString()}</td></tr>
        <tr><td style="padding:8px 0;color:#475569;border-top:1px solid #e2e8f0;"><strong>Total Deductions:</strong></td><td style="padding:8px 0;text-align:right;color:#991b1b;border-top:1px solid #e2e8f0;">-₦${Number(data.deductions).toLocaleString()}</td></tr>
        <tr><td style="padding:12px 0 8px;color:#1a365d;border-top:2px solid #1a365d;"><strong style="font-size:16px;">Net Pay:</strong></td><td style="padding:12px 0 8px;text-align:right;color:#166534;border-top:2px solid #1a365d;"><strong style="font-size:16px;">₦${Number(data.netPay).toLocaleString()}</strong></td></tr>
      </table>
    </div>
    <div style="text-align:center;margin:30px 0;">
      <a href="${APP_URL}" style="background:#2563eb;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;">View Full Payslip</a>
    </div>
  `),

  probationReview: (data) => baseTemplate('Probation Review Reminder ⏰', `
    <p style="color:#475569;line-height:1.7;">Hi <strong>${data.managerName}</strong>,</p>
    <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:16px;margin:20px 0;">
      <p style="color:#1e40af;margin:0;font-weight:600;">Probation period ending soon</p>
    </div>
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin:20px 0;">
      <p style="margin:4px 0;color:#475569;"><strong>Employee:</strong> ${data.employeeName}</p>
      <p style="margin:4px 0;color:#475569;"><strong>Hire Date:</strong> ${data.hireDate}</p>
      <p style="margin:4px 0;color:#475569;"><strong>Probation End:</strong> ${data.probationEnd}</p>
    </div>
    <p style="color:#475569;line-height:1.7;">Please complete the probation review for this employee.</p>
    <div style="text-align:center;margin:30px 0;">
      <a href="${APP_URL}" style="background:#2563eb;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;">Review Employee</a>
    </div>
  `),

  policyReminder: (data) => baseTemplate('New Policy Published 📋', `
    <p style="color:#475569;line-height:1.7;">Hi <strong>${data.name}</strong>,</p>
    <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:16px;margin:20px 0;">
      <p style="color:#1e40af;margin:0;font-weight:600;">A new company policy has been published</p>
    </div>
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin:20px 0;">
      <p style="margin:4px 0;color:#475569;"><strong>Policy:</strong> ${data.policyTitle}</p>
      <p style="margin:4px 0;color:#475569;"><strong>Category:</strong> ${data.category}</p>
      <p style="margin:4px 0;color:#475569;"><strong>Effective Date:</strong> ${data.effectiveDate}</p>
    </div>
    <p style="color:#475569;line-height:1.7;">Please review and acknowledge this policy in the app.</p>
    <div style="text-align:center;margin:30px 0;">
      <a href="${APP_URL}" style="background:#2563eb;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;">View Policy</a>
    </div>
  `),

  expenseApproved: (data) => baseTemplate('Expense Claim Approved ✅', `
    <p style="color:#475569;line-height:1.7;">Hi <strong>${data.name}</strong>,</p>
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin:20px 0;">
      <p style="color:#166534;margin:0;font-weight:600;">Your expense claim has been approved!</p>
    </div>
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin:20px 0;">
      <p style="margin:4px 0;color:#475569;"><strong>Amount:</strong> ₦${Number(data.amount).toLocaleString()}</p>
      <p style="margin:4px 0;color:#475569;"><strong>Period:</strong> ${data.period}</p>
    </div>
    <p style="color:#475569;line-height:1.7;">Payment will be processed in the next payroll cycle.</p>
  `),

  travelApproved: (data) => baseTemplate('Travel Request Approved ✅', `
    <p style="color:#475569;line-height:1.7;">Hi <strong>${data.name}</strong>,</p>
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin:20px 0;">
      <p style="color:#166534;margin:0;font-weight:600;">Your travel request has been approved!</p>
    </div>
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin:20px 0;">
      <p style="margin:4px 0;color:#475569;"><strong>Destination:</strong> ${data.destination}</p>
      <p style="margin:4px 0;color:#475569;"><strong>Dates:</strong> ${data.departDate} to ${data.returnDate}</p>
      <p style="margin:4px 0;color:#475569;"><strong>Estimated Cost:</strong> ₦${Number(data.cost).toLocaleString()}</p>
    </div>
  `),

  passwordReset: (data) => baseTemplate('Password Reset Request 🔐', `
    <p style="color:#475569;line-height:1.7;">Hi <strong>${data.name}</strong>,</p>
    <p style="color:#475569;line-height:1.7;">We received a request to reset your password.</p>
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;margin:20px 0;">
      <p style="color:#991b1b;margin:0;"><strong>Your temporary password:</strong></p>
      <p style="color:#dc2626;font-size:20px;font-family:monospace;margin:8px 0 0;background:#fff;padding:10px;border-radius:4px;text-align:center;">${data.tempPassword}</p>
    </div>
    <p style="color:#475569;line-height:1.7;">Please log in and change your password immediately. This link expires in 24 hours.</p>
    <div style="text-align:center;margin:30px 0;">
      <a href="${APP_URL}" style="background:#dc2626;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;">Reset Password</a>
    </div>
  `),

  recognition: (data) => baseTemplate('Employee Recognition Award 🏆', `
    <p style="color:#475569;line-height:1.7;">Hi <strong>${data.nomineeName}</strong>,</p>
    <div style="background:#fefce8;border:1px solid #fde68a;border-radius:8px;padding:20px;margin:20px 0;text-align:center;">
      <p style="font-size:40px;margin:0;">🏆⭐🎉</p>
      <p style="color:#92400e;font-size:18px;font-weight:600;margin:12px 0 0;">You've been recognized!</p>
    </div>
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin:20px 0;">
      <p style="margin:4px 0;color:#475569;"><strong>Award:</strong> ${data.title}</p>
      <p style="margin:4px 0;color:#475569;"><strong>Category:</strong> ${data.category}</p>
      <p style="margin:4px 0;color:#475569;"><strong>Nominated by:</strong> ${data.nominatorName}</p>
      <p style="margin:4px 0;color:#475569;"><strong>Points:</strong> ${data.points}</p>
      ${data.description ? `<p style="margin:8px 0 0;color:#475569;"><strong>Description:</strong> ${data.description}</p>` : ''}
    </div>
    <p style="color:#475569;line-height:1.7;">Congratulations on your outstanding contribution!</p>
  `),

  exitInterview: (data) => baseTemplate('Exit Interview Scheduled 📋', `
    <p style="color:#475569;line-height:1.7;">Hi <strong>${data.name}</strong>,</p>
    <p style="color:#475569;line-height:1.7;">An exit interview has been scheduled for your departure.</p>
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin:20px 0;">
      <p style="margin:4px 0;color:#475569;"><strong>Last Working Day:</strong> ${data.lastDay}</p>
      <p style="margin:4px 0;color:#475569;"><strong>Status:</strong> ${data.status}</p>
    </div>
    <p style="color:#475569;line-height:1.7;">Please complete the exit interview in the app before your last day.</p>
    <div style="text-align:center;margin:30px 0;">
      <a href="${APP_URL}" style="background:#2563eb;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;">Complete Interview</a>
    </div>
  `)
};

/* ---- Send email function ---- */
async function sendEmail(to, templateName, data = {}) {
  const template = templates[templateName];
  if (!template) throw new Error(`Unknown email template: ${templateName}`);

  const subject = getSubject(templateName, data);
  const html = template(data);

  const resend = getResend();
  if (!resend) {
    console.log(`[EMAIL-DRY] to=${to} template=${templateName} subject=${subject}`);
    return { ok: true, dryRun: true };
  }

  try {
    const result = await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject,
      html
    });
    console.log(`[EMAIL] sent to=${to} template=${templateName} id=${result.data?.id}`);
    return { ok: true, id: result.data?.id };
  } catch (err) {
    console.error(`[EMAIL-ERROR] to=${to} template=${templateName}:`, err.message);
    return { ok: false, error: err.message };
  }
}

/* ---- Subject lines ---- */
function getSubject(templateName, data) {
  const subjects = {
    welcome: `Welcome to RHoSAM HCM — Your Account is Ready`,
    leaveApproved: `Leave Approved — ${data.leaveType || ''}`,
    leaveRejected: `Leave Request Declined — ${data.leaveType || ''}`,
    birthday: `🎂 Happy Birthday, ${data.name || ''}!`,
    payslip: `Your Payslip for ${data.period || ''} is Ready`,
    probationReview: `Probation Review Due — ${data.employeeName || ''}`,
    policyReminder: `New Policy: ${data.policyTitle || ''}`,
    expenseApproved: `Expense Claim Approved — ₦${Number(data.amount || 0).toLocaleString()}`,
    travelApproved: `Travel Request Approved — ${data.destination || ''}`,
    passwordReset: `Password Reset Request`,
    recognition: `🏆 You've Been Recognized!`,
    exitInterview: `Exit Interview Scheduled`
  };
  return subjects[templateName] || 'RHoSAM HCM Notification';
}

/* ---- Bulk send ---- */
async function sendBulkEmails(recipients, templateName, data = {}) {
  const results = [];
  for (const r of recipients) {
    const result = await sendEmail(r.email, templateName, { ...data, name: r.name });
    results.push({ email: r.email, ...result });
  }
  return results;
}

module.exports = { sendEmail, sendBulkEmails, templates, getSubject };
