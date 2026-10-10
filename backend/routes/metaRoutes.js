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

// Public transparency page: how PCMC is doing, by zone, department and month. Aggregates only — no ticket
// numbers, text, names or locations ever leave this endpoint. Cached for 5 minutes.
const CLOSED = ['RESOLVED', 'CLOSED'];
let transparencyCache = { at: 0, data: null };
router.get('/transparency', async (req, res) => {
  try {
    if (!transparencyCache.data || Date.now() - transparencyCache.at > 5 * 60 * 1000) {
      const now = new Date();
      const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
      const isClosed = { $in: ['$status', CLOSED] };
      const hours = { $cond: [{ $and: [isClosed, { $ne: [{ $ifNull: ['$resolvedAt', null] }, null] }] }, { $divide: [{ $subtract: ['$resolvedAt', '$createdAt'] }, 36e5] }, null] };
      const breached = { $and: [{ $ne: [{ $ifNull: ['$slaDeadline', null] }, null] },
        { $cond: [isClosed, { $gt: [{ $ifNull: ['$resolvedAt', '$updatedAt'] }, '$slaDeadline'] }, { $lt: ['$slaDeadline', now] }] }] };
      const groupBy = (key) => [
        { $group: { _id: key, received: { $sum: 1 }, resolved: { $sum: { $cond: [isClosed, 1, 0] } },
          avgHours: { $avg: hours }, overdueOpen: { $sum: { $cond: [{ $and: [{ $not: [isClosed] }, breached] }, 1, 0] } } } },
        { $sort: { received: -1 } },
      ];
      const [r] = await Complaint.aggregate([
        { $match: { category: { $ne: 'Processing...' } } },
        { $facet: {
          totals: [{ $group: { _id: null, received: { $sum: 1 }, resolved: { $sum: { $cond: [isClosed, 1, 0] } }, avgHours: { $avg: hours },
            withSla: { $sum: { $cond: [{ $ne: [{ $ifNull: ['$slaDeadline', null] }, null] }, 1, 0] } }, breached: { $sum: { $cond: [breached, 1, 0] } },
            feedback: { $sum: { $cond: [{ $ne: [{ $ifNull: ['$feedback.at', null] }, null] }, 1, 0] } },
            fixed: { $sum: { $cond: [{ $eq: ['$feedback.resolved', true] }, 1, 0] } }, avgRating: { $avg: '$feedback.rating' } } }],
          zones: [{ $match: { zone: { $in: Object.keys(pcmc.zones) } } }, ...groupBy('$zone')],
          departments: [...groupBy('$department'), { $limit: 8 }],
          categories: [{ $group: { _id: '$category', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 6 }],
          received: [{ $match: { createdAt: { $gte: sixMonthsAgo } } },
            { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$createdAt', timezone: 'Asia/Kolkata' } }, count: { $sum: 1 } } }],
          resolvedByMonth: [{ $match: { resolvedAt: { $gte: sixMonthsAgo } } },
            { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$resolvedAt', timezone: 'Asia/Kolkata' } }, count: { $sum: 1 } } }],
        } },
      ]);
      const t = r.totals[0] || {};
      const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);
      const round = (n) => (n == null ? null : Math.round(n));
      const rows = (list) => list.map((g) => ({ id: g._id, received: g.received, resolved: g.resolved, resolutionRate: pct(g.resolved, g.received), avgHours: round(g.avgHours), overdueOpen: g.overdueOpen }));
      const byMonth = (list) => Object.fromEntries(list.map((m) => [m._id, m.count]));
      const rec = byMonth(r.received), res2 = byMonth(r.resolvedByMonth);
      const months = Array.from({ length: 6 }, (_, i) => {
        const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        return { month: key, received: rec[key] || 0, resolved: res2[key] || 0 };
      });
      transparencyCache = {
        at: Date.now(),
        data: {
          updatedAt: new Date().toISOString(),
          totals: {
            received: t.received || 0, resolved: t.resolved || 0, open: (t.received || 0) - (t.resolved || 0),
            resolutionRate: pct(t.resolved, t.received), avgHours: round(t.avgHours),
            slaCompliance: pct((t.withSla || 0) - (t.breached || 0), t.withSla), feedback: t.feedback || 0,
            confirmedFixedRate: pct(t.fixed, t.feedback), avgRating: t.avgRating == null ? null : Math.round(t.avgRating * 10) / 10,
          },
          zones: rows(r.zones), departments: rows(r.departments),
          categories: r.categories.map((c) => ({ id: c._id, count: c.count })), months,
        },
      };
    }
    res.json(transparencyCache.data);
  } catch (error) {
    console.error('Transparency stats failed:', error.message);
    res.status(500).json({ message: 'Could not load statistics' });
  }
});

module.exports = router;
