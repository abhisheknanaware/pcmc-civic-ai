// Personal-data controls: complaints closed more than RETENTION_DAYS ago are anonymised automatically,
// and a citizen can ask for their data to be removed at any time. The civic record stays (category, zone,
// dates, the PII-redacted text) so analytics and transparency figures still add up.
const cloudinary = require('cloudinary').v2;
const Complaint = require('../models/Complaint');
const AuditLog = require('../models/AuditLog');

const RETENTION_DAYS = Number(process.env.RETENTION_DAYS || 365);
const DAY_MS = 24 * 60 * 60 * 1000;

// Cloudinary public id from a delivery URL: .../upload/v123/pmc_complaints/abc.jpg -> pmc_complaints/abc
const publicId = (url) => url?.match(/\/upload\/(?:v\d+\/)?(.+?)\.[a-z0-9]+$/i)?.[1];

async function deleteMedia(url) {
  const id = publicId(url);
  if (!id || !process.env.CLOUDINARY_API_KEY) return;
  try {
    await cloudinary.uploader.destroy(id);
  } catch (error) {
    console.error('Could not delete photo from Cloudinary:', error.message);
  }
}

// Removes everything that identifies the citizen. The officer's "after" photo is kept (it shows the fix, not the person).
async function anonymise(complaint, reason) {
  await deleteMedia(complaint.imageUrl);
  const round = (n) => (typeof n === 'number' ? Math.round(n * 1000) / 1000 : n); // about 100 m
  await Complaint.updateOne({ _id: complaint._id }, {
    $set: {
      userName: 'Removed',
      userEmail: `removed-${complaint._id}@anonymised.invalid`,
      originalText: complaint.sanitizedText || '[removed]',
      'location.latitude': round(complaint.location?.latitude),
      'location.longitude': round(complaint.location?.longitude),
      anonymizedAt: new Date(),
      anonymizedReason: reason,
    },
    $unset: {
      orderId: 1, audioUrl: 1, imageUrl: 1, entities: 1, generatedReply: 1, finalReply: 1,
      'location.address': 1, 'location.landmark': 1, 'location.road': 1, 'feedback.comment': 1,
    },
  });
}

async function runRetention(now = new Date()) {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * DAY_MS);
  const due = await Complaint.find({
    status: { $in: ['RESOLVED', 'CLOSED'] },
    anonymizedAt: { $exists: false },
    $or: [{ resolvedAt: { $lt: cutoff } }, { resolvedAt: { $exists: false }, updatedAt: { $lt: cutoff } }],
  }).select('imageUrl sanitizedText location').limit(500);
  for (const c of due) await anonymise(c, 'retention');
  if (due.length) {
    await AuditLog.create({ actor: 'system', role: 'system', action: 'privacy.retention', target: `${due.length} complaints`, details: { olderThanDays: RETENTION_DAYS } });
    console.log(`Privacy: anonymised ${due.length} complaints closed more than ${RETENTION_DAYS} days ago`);
  }
  return due.length;
}

exports.anonymise = anonymise;
exports.runRetention = runRetention;
exports.RETENTION_DAYS = RETENTION_DAYS;
exports.startRetentionJob = () => {
  if (RETENTION_DAYS <= 0) return;
  const run = () => runRetention().catch((error) => console.error('Retention job failed:', error.message));
  setTimeout(run, 60 * 1000).unref();
  setInterval(run, DAY_MS).unref();
};
