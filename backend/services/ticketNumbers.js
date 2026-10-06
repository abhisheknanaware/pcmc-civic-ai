const Counter = require('../models/Counter');
const Complaint = require('../models/Complaint');

const PREFIX = 'PCMC-';
const START = 100000;

const format = (seq) => `${PREFIX}${seq}`;

async function nextTicketNumber() {
  await Counter.updateOne({ _id: 'complaint' }, { $setOnInsert: { seq: START } }, { upsert: true });
  const counter = await Counter.findOneAndUpdate({ _id: 'complaint' }, { $inc: { seq: 1 } }, { new: true });
  return format(counter.seq);
}

// Gives complaints created before ticket numbers existed a number, oldest first.
async function backfillTicketNumbers() {
  const missing = await Complaint.find({ ticketNumber: { $exists: false } }).sort({ createdAt: 1 }).select('_id');
  for (const { _id } of missing) {
    await Complaint.updateOne({ _id, ticketNumber: { $exists: false } }, { ticketNumber: await nextTicketNumber() });
  }
  if (missing.length) console.log(`Assigned ticket numbers to ${missing.length} existing complaints`);
}

const normalizeTicketNumber = (value) => {
  const digits = String(value || '').toUpperCase().replace(/\s+/g, '').replace(/^PCMC-?/, '');
  return /^\d{6,}$/.test(digits) ? format(digits) : null;
};

module.exports = { nextTicketNumber, backfillTicketNumbers, normalizeTicketNumber };
