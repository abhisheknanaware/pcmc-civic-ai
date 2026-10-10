const AuditLog = require('../models/AuditLog');

// Record an action. Never throws (logging must not break the request) and never stores secrets.
function logAudit(req, action, target, details) {
  const actor = req?.user?.email || details?.actor || 'citizen';
  const label = target && typeof target === 'object' ? (target.ticketNumber || target.email || String(target._id || '')) : target;
  AuditLog.create({
    actor,
    role: req?.user?.role || (actor === 'system' ? 'system' : undefined),
    action,
    target: label ? String(label).slice(0, 200) : undefined,
    details,
    ip: req?.ip,
  }).catch((error) => console.error('Audit log failed:', error.message));
}

module.exports = { logAudit };
