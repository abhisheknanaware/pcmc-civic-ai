const Complaint = require('../models/Complaint');
const User = require('../models/User');
const emailService = require('./emailService');
const { emailConfigured } = require('./notifications');

// Every 30 minutes: complaints that have just passed their SLA deadline are flagged (slaBreached) and
// the responsible department's officers plus admins get one escalation email per department.
// Each complaint is escalated once; a citizen reopening it resets the flag with a new deadline.
const INTERVAL_MS = 30 * 60 * 1000;
const DASHBOARD_URL = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/dashboard`;

async function recipientsFor(department, cache) {
  if (!cache.has(department)) {
    const users = await User.find({ $or: [{ role: 'admin' }, { department }] }).select('email');
    cache.set(department, [...new Set(users.map((u) => u.email).filter(Boolean))]);
  }
  return cache.get(department);
}

async function checkBreaches() {
  const overdue = await Complaint.find({
    status: { $nin: ['RESOLVED', 'CLOSED'] },
    slaDeadline: { $lt: new Date() },
    slaBreached: { $ne: true },
  }).select('ticketNumber category department zone priority slaDeadline');
  if (!overdue.length) return { escalated: 0 };

  const byDepartment = new Map();
  overdue.forEach((c) => {
    const key = c.department || 'Unassigned';
    byDepartment.set(key, [...(byDepartment.get(key) || []), c]);
  });

  // Flag first, so officers see it on the dashboard right away and nobody gets repeat emails.
  await Complaint.updateMany({ _id: { $in: overdue.map((c) => c._id) } }, { $set: { slaBreached: true } });

  const cache = new Map();
  let emailed = 0;
  if (emailConfigured()) {
    for (const [department, complaints] of byDepartment) {
      const to = await recipientsFor(department, cache);
      if (!to.length) continue;
      const lines = complaints.map((c) => `- ${c.ticketNumber} · ${c.category} · ${c.priority}${c.zone ? ` · Zone ${c.zone}` : ''} · due ${c.slaDeadline.toISOString().slice(0, 16).replace('T', ' ')} UTC`);
      try {
        await emailService.sendEmail(to.join(','), `SLA breached: ${complaints.length} complaint(s) in ${department}`,
          `These complaints have passed their SLA deadline and need attention:\n\n${lines.join('\n')}\n\nOpen the officer dashboard: ${DASHBOARD_URL}\n\n- PCMC Civic`);
        emailed += complaints.length;
      } catch (error) {
        console.error(`SLA escalation email for ${department} failed:`, error.message);
      }
    }
  }

  console.log(`SLA monitor: ${overdue.length} complaint(s) newly overdue, ${emailed} included in escalation emails`);
  return { escalated: overdue.length, emailed };
}

exports.checkBreaches = checkBreaches;
exports.startSlaMonitor = () => {
  const run = () => checkBreaches().catch((error) => console.error('SLA monitor failed:', error.message));
  setTimeout(run, 15 * 1000); // shortly after start-up, then every 30 minutes
  setInterval(run, INTERVAL_MS).unref();
};
