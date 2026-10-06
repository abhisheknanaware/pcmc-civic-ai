const Complaint = require('../models/Complaint');
const ChatSession = require('../models/ChatSession');

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const CLOSED_STATUSES = ['RESOLVED', 'CLOSED'];
const STATUS_ORDER = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_FOR_CUSTOMER', 'RESOLVED', 'CLOSED'];
const AGING_BUCKETS = [
  { key: '<1d', max: 1 },
  { key: '1-3d', max: 3 },
  { key: '3-7d', max: 7 },
  { key: '7-14d', max: 14 },
  { key: '>14d', max: Infinity },
];

const TIMEZONE = 'Asia/Kolkata';
const istDate = (date) => date.toLocaleDateString('en-CA', { timeZone: TIMEZONE });

const round = (value, digits = 1) => (value == null ? null : Number(value.toFixed(digits)));
const pct = (part, whole) => (whole ? round((part / whole) * 100) : null);
const groupCount = (field) => [{ $group: { _id: field, count: { $sum: 1 } } }, { $sort: { count: -1 } }];

// Citizen-assistant usage for management. Chat volume is small, so this is computed in JS over the window.
async function chatbotStats(since) {
  const sessions = await ChatSession.find(since ? { createdAt: { $gte: since } } : {})
    .sort({ updatedAt: -1 }).limit(5000).select('messages complaintConverted statusChecks serviceClicks').lean();
  const count = (map, key) => { if (key) map[key] = (map[key] || 0) + 1; };
  const intents = {}, topics = {}, languages = {};
  let questions = 0, answered = 0, responseMs = 0, responses = 0;
  const unansweredQuestions = [];

  for (const session of sessions) {
    session.messages.forEach((m, i) => {
      if (m.role === 'user') {
        questions++;
        count(intents, m.intent);
        count(languages, m.language);
        if (m.intent === 'SERVICE_QUESTION') count(topics, m.topic);
        const reply = session.messages[i + 1];
        const question = m.content.slice(0, 160);
        if (reply?.answered === false && unansweredQuestions.length < 8 && !unansweredQuestions.includes(question)) unansweredQuestions.push(question);
      } else {
        if (m.answered) answered++;
        if (m.ms) { responseMs += m.ms; responses++; }
      }
    });
  }
  const toList = (map) => Object.entries(map).map(([_id, value]) => ({ _id, count: value })).sort((a, b) => b.count - a.count);
  return {
    conversations: sessions.length,
    questions,
    answerRate: questions ? round((answered / questions) * 100) : null,
    unanswered: questions - answered,
    complaintConversions: sessions.filter((x) => x.complaintConverted).length,
    statusChecks: sessions.reduce((sum, x) => sum + (x.statusChecks || 0), 0),
    serviceClicks: sessions.reduce((sum, x) => sum + (x.serviceClicks || 0), 0),
    avgResponseSeconds: responses ? round(responseMs / responses / 1000) : null,
    intents: toList(intents),
    topics: toList(topics),
    languages: toList(languages),
    unansweredQuestions,
  };
}

exports.getAnalytics = async (req, res) => {
  try {
    const now = new Date();
    const days = Number.parseInt(req.query.days, 10);
    const match = {};
    if (days > 0) match.createdAt = { $gte: new Date(now - days * DAY_MS) };
    if (req.query.department && req.query.department !== 'ALL') match.department = req.query.department;

    const trendDays = days > 0 && days <= 90 ? days : 30;
    const trendStart = new Date(`${istDate(new Date(now - (trendDays - 1) * DAY_MS))}T00:00:00+05:30`);

    // Derived per-ticket fields shared by every facet.
    const derive = {
      $addFields: {
        isClosed: { $in: ['$status', CLOSED_STATUSES] },
        closedAt: { $cond: [{ $in: ['$status', CLOSED_STATUSES] }, { $ifNull: ['$resolvedAt', '$updatedAt'] }, null] },
      },
    };
    const withSla = {
      $addFields: {
        resolutionHours: { $cond: ['$isClosed', { $divide: [{ $subtract: ['$closedAt', '$createdAt'] }, HOUR_MS] }, null] },
        hasSla: { $ne: [{ $ifNull: ['$slaDeadline', null] }, null] },
        breached: {
          $and: [
            { $ne: [{ $ifNull: ['$slaDeadline', null] }, null] },
            { $cond: ['$isClosed', { $gt: ['$closedAt', '$slaDeadline'] }, { $lt: ['$slaDeadline', now] }] },
          ],
        },
        isHighPriority: { $in: ['$priority', ['P1', 'P2']] },
        isDuplicate: { $gt: [{ $size: { $ifNull: ['$duplicates', []] } }, 0] },
        isNegative: { $in: [{ $toLower: { $ifNull: ['$sentiment', ''] } }, ['negative', 'frustrated', 'angry']] },
      },
    };

    const chatbotPromise = chatbotStats(days > 0 ? new Date(now - days * DAY_MS) : null);
    const [result] = await Complaint.aggregate([
      { $match: match },
      derive,
      withSla,
      {
        $facet: {
          summary: [{
            $group: {
              _id: null,
              total: { $sum: 1 },
              closed: { $sum: { $cond: ['$isClosed', 1, 0] } },
              withSla: { $sum: { $cond: ['$hasSla', 1, 0] } },
              breached: { $sum: { $cond: ['$breached', 1, 0] } },
              breachedOpen: { $sum: { $cond: [{ $and: ['$breached', { $not: ['$isClosed'] }] }, 1, 0] } },
              highPriorityOpen: { $sum: { $cond: [{ $and: ['$isHighPriority', { $not: ['$isClosed'] }] }, 1, 0] } },
              duplicates: { $sum: { $cond: ['$isDuplicate', 1, 0] } },
              negative: { $sum: { $cond: ['$isNegative', 1, 0] } },
              avgResolutionHours: { $avg: '$resolutionHours' },
              avgConfidence: { $avg: '$categoryConfidence' },
            },
          }],
          received: [
            { $match: { createdAt: { $gte: trendStart } } },
            { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: TIMEZONE } }, count: { $sum: 1 } } },
          ],
          resolved: [
            { $match: { closedAt: { $gte: trendStart } } },
            { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$closedAt', timezone: TIMEZONE } }, count: { $sum: 1 } } },
          ],
          departments: [
            {
              $group: {
                _id: { $ifNull: ['$department', 'Unassigned'] },
                total: { $sum: 1 },
                closed: { $sum: { $cond: ['$isClosed', 1, 0] } },
                withSla: { $sum: { $cond: ['$hasSla', 1, 0] } },
                breached: { $sum: { $cond: ['$breached', 1, 0] } },
                avgResolutionHours: { $avg: '$resolutionHours' },
              },
            },
            { $sort: { total: -1 } },
          ],
          zones: [
            { $match: { isClosed: false } },
            {
              $group: {
                _id: { $ifNull: ['$zone', null] },
                open: { $sum: 1 },
                highPriority: { $sum: { $cond: ['$isHighPriority', 1, 0] } },
                breached: { $sum: { $cond: ['$breached', 1, 0] } },
              },
            },
            { $sort: { open: -1, highPriority: -1 } },
            { $limit: 8 },
          ],
          openAges: [
            { $match: { isClosed: false } },
            { $project: { ageDays: { $divide: [{ $subtract: [now, '$createdAt'] }, DAY_MS] } } },
          ],
          attention: [
            { $match: { isClosed: false } },
            { $sort: { breached: -1, isHighPriority: -1, slaDeadline: 1, createdAt: 1 } },
            { $limit: 6 },
            { $project: { ticketNumber: 1, category: 1, department: 1, ward: 1, zone: 1, priority: 1, status: 1, slaDeadline: 1, createdAt: 1, breached: 1 } },
          ],
          status: groupCount('$status'),
          category: groupCount('$category'),
          priority: groupCount('$priority'),
          sentiment: groupCount('$sentiment'),
          language: groupCount('$language'),
          sla: groupCount({ $cond: [{ $not: ['$hasSla'] }, 'No SLA', { $cond: ['$breached', 'Breached', 'On Track'] }] }),
        },
      },
    ]);

    const s = result.summary[0] || { total: 0, closed: 0, withSla: 0, breached: 0, breachedOpen: 0, highPriorityOpen: 0, duplicates: 0, negative: 0 };
    const receivedByDay = Object.fromEntries(result.received.map((d) => [d._id, d.count]));
    const resolvedByDay = Object.fromEntries(result.resolved.map((d) => [d._id, d.count]));
    const trend = Array.from({ length: trendDays }, (_, i) => {
      const date = istDate(new Date(trendStart.getTime() + i * DAY_MS));
      return { date, received: receivedByDay[date] || 0, resolved: resolvedByDay[date] || 0 };
    });

    const aging = AGING_BUCKETS.map(({ key }) => ({ _id: key, count: 0 }));
    result.openAges.forEach(({ ageDays }) => {
      aging[AGING_BUCKETS.findIndex(({ max }) => ageDays < max)].count++;
    });

    const statusCounts = Object.fromEntries(result.status.map((d) => [d._id, d.count]));

    const chatbot = await chatbotPromise;
    res.json({
      chatbot,
      total: s.total,
      filters: { days: days > 0 ? days : null, department: match.department || 'ALL', trendDays },
      kpis: {
        total: s.total,
        open: s.total - s.closed,
        resolved: s.closed,
        resolutionRate: pct(s.closed, s.total),
        avgResolutionHours: round(s.avgResolutionHours),
        slaCompliance: pct(s.withSla - s.breached, s.withSla),
        breachedOpen: s.breachedOpen,
        highPriorityOpen: s.highPriorityOpen,
        duplicateRate: pct(s.duplicates, s.total),
        negativeShare: pct(s.negative, s.total),
        avgAiConfidence: s.avgConfidence == null ? null : pct(s.avgConfidence, 1),
      },
      trend,
      departmentPerformance: result.departments.map((d) => ({
        department: d._id,
        total: d.total,
        open: d.total - d.closed,
        resolved: d.closed,
        breached: d.breached,
        resolutionRate: pct(d.closed, d.total),
        slaCompliance: pct(d.withSla - d.breached, d.withSla),
        avgResolutionHours: round(d.avgResolutionHours),
      })),
      zoneHotspots: result.zones.map((z) => ({ zone: z._id, open: z.open, highPriority: z.highPriority, breached: z.breached })),
      agingDistribution: aging,
      attentionTickets: result.attention,
      statusDistribution: STATUS_ORDER.map((status) => ({ _id: status, count: statusCounts[status] || 0 })),
      categoryDistribution: result.category,
      priorityDistribution: result.priority,
      sentimentDistribution: result.sentiment,
      languageDistribution: result.language,
      slaDistribution: result.sla,
      // Kept for backwards compatibility with older clients.
      departmentWorkload: result.departments.map((d) => ({ _id: d._id, count: d.total })),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error fetching analytics' });
  }
};
