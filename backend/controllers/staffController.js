const FieldWorker = require('../models/FieldWorker');
const Complaint = require('../models/Complaint');
const { pcmc, ZONE_IDS } = require('../services/pcmcConfig');
const { logAudit } = require('../services/audit');

const OPEN_STATUSES = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_FOR_CUSTOMER'];

function validate(body) {
  const name = String(body.name || '').trim();
  const phone = String(body.phone || '').trim();
  if (name.length < 2) return 'Please enter the worker\'s name.';
  if (phone && !/^[0-9+\-\s]{6,20}$/.test(phone)) return 'Please enter a valid phone number.';
  if (!pcmc.departments.some((d) => d.id === body.department)) return 'Please choose a department.';
  if (body.zone && !ZONE_IDS.includes(body.zone)) return 'Unknown zone.';
  return null;
}

// GET /api/staff — department officers see their department's staff; admins see everyone. Includes open workload.
exports.listStaff = async (req, res) => {
  const scope = req.user.role !== 'admin' && req.user.department ? { department: req.user.department } : {};
  const [workers, load] = await Promise.all([
    FieldWorker.find(scope).sort({ active: -1, department: 1, name: 1 }).lean(),
    Complaint.aggregate([
      { $match: { assignedWorker: { $ne: null }, status: { $in: OPEN_STATUSES } } },
      { $group: { _id: '$assignedWorker', open: { $sum: 1 } } },
    ]),
  ]);
  const openBy = Object.fromEntries(load.map((l) => [String(l._id), l.open]));
  res.json({ workers: workers.map((w) => ({ ...w, openTickets: openBy[String(w._id)] || 0 })) });
};

// POST /api/staff (admins)
exports.createStaff = async (req, res) => {
  const problem = validate(req.body || {});
  if (problem) return res.status(400).json({ message: problem });
  const { name, phone, department, zone } = req.body;
  const worker = await FieldWorker.create({ name: name.trim(), phone: phone?.trim(), department, zone: zone || undefined });
  logAudit(req, 'staff.create', worker.name, { department });
  res.status(201).json(worker);
};

// PATCH /api/staff/:id (admins) — edit, or deactivate with { active: false }.
exports.updateStaff = async (req, res) => {
  const worker = await FieldWorker.findById(req.params.id);
  if (!worker) return res.status(404).json({ message: 'Field worker not found.' });
  const next = { name: worker.name, phone: worker.phone, department: worker.department, zone: worker.zone, ...req.body };
  const problem = validate(next);
  if (problem) return res.status(400).json({ message: problem });
  Object.assign(worker, {
    name: String(next.name).trim(), phone: next.phone ? String(next.phone).trim() : undefined,
    department: next.department, zone: next.zone || undefined,
    active: req.body.active === undefined ? worker.active : Boolean(req.body.active),
  });
  await worker.save();
  logAudit(req, 'staff.update', worker.name, { active: worker.active });
  res.json(worker);
};
