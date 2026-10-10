const mongoose = require('mongoose');

// Who did what, when: officer logins, ticket changes, merges, knowledge-base edits, data deletions.
// Kept for one year (TTL index), never contains passwords or complaint text.
const auditLogSchema = new mongoose.Schema({
  actor: { type: String },          // officer email, or "citizen" / "system"
  role: { type: String },
  action: { type: String, required: true },  // e.g. complaint.update, auth.login_failed, kb.answer_save
  target: { type: String },         // ticket number, document id, user email...
  details: { type: mongoose.Schema.Types.Mixed },
  ip: { type: String },
  at: { type: Date, default: Date.now },
});
auditLogSchema.index({ at: -1 });
auditLogSchema.index({ at: 1 }, { expireAfterSeconds: 365 * 24 * 60 * 60 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
