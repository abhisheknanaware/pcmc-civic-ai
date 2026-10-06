const express = require('express');
const Complaint = require('../models/Complaint');
const { pcmc } = require('../services/pcmcConfig');

const router = express.Router();

// Public reference data for the frontend: zones, departments, categories, official links.
router.get('/', (req, res) => {
  res.json({
    corporation: pcmc.corporation,
    zones: pcmc.zones,
    departments: pcmc.departments.map(({ id, external }) => ({ id, external: Boolean(external) })),
    categories: Object.keys(pcmc.categoryRouting),
    routing: Object.fromEntries(Object.entries(pcmc.categoryRouting).map(([category, r]) => [category, r.department])),
    slaHours: pcmc.slaHours,
  });
});

// Public homepage figures: aggregate counts only, never individual complaints. Cached briefly.
let statsCache = { at: 0, data: null };
router.get('/stats', async (req, res) => {
  try {
    if (!statsCache.data || Date.now() - statsCache.at > 60 * 1000) {
      const [s] = await Complaint.aggregate([
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            resolved: { $sum: { $cond: [{ $in: ['$status', ['RESOLVED', 'CLOSED']] }, 1, 0] } },
            avgResolutionMs: {
              $avg: { $cond: [{ $and: [{ $in: ['$status', ['RESOLVED', 'CLOSED']] }, { $ne: [{ $ifNull: ['$resolvedAt', null] }, null] }] }, { $subtract: ['$resolvedAt', '$createdAt'] }, null] },
            },
          },
        },
      ]);
      const total = s?.total || 0;
      statsCache = {
        at: Date.now(),
        data: {
          total,
          resolved: s?.resolved || 0,
          resolutionRate: total ? Math.round(((s.resolved || 0) / total) * 100) : 0,
          avgResolutionHours: s?.avgResolutionMs ? Math.round(s.avgResolutionMs / 36e5) : null,
          departments: pcmc.departments.filter((d) => !d.external).length,
          zones: Object.keys(pcmc.zones).length,
          languages: 4,
        },
      };
    }
    res.json(statsCache.data);
  } catch (error) {
    res.status(500).json({ message: 'Could not load statistics' });
  }
});

module.exports = router;
