const ChatSession = require('../models/ChatSession');

const NLP_BASE = new URL(process.env.NLP_SERVICE_URL || 'http://localhost:8000/process').origin;

async function nlp(path, options = {}) {
  const response = await fetch(`${NLP_BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.detail || `NLP service responded ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

// GET /api/kb/documents - every document the chatbot answers from, with its review state.
exports.listDocuments = async (req, res) => {
  try {
    res.json(await nlp('/kb/documents'));
  } catch (error) {
    res.status(error.status === 503 ? 503 : 502).json({ message: error.status === 503 ? 'The knowledge base is still loading. Try again in a minute.' : 'Could not reach the chatbot service.' });
  }
};

// PATCH /api/kb/documents/:id { status?: active|disabled|superseded, verified?: boolean } - admins only.
exports.reviewDocument = async (req, res) => {
  const { status, verified } = req.body || {};
  if (status === undefined && verified === undefined) return res.status(400).json({ message: 'Nothing to change.' });
  try {
    const doc = await nlp(`/kb/documents/${encodeURIComponent(req.params.id)}`, {
      method: 'POST',
      body: JSON.stringify({ status, verified, reviewer: req.user.email }),
    });
    res.json(doc);
  } catch (error) {
    res.status(error.status === 404 || error.status === 400 ? error.status : 502).json({ message: error.message });
  }
};

// GET /api/kb/unanswered - questions the assistant could not answer from verified sources, most frequent first.
exports.unansweredQuestions = async (req, res) => {
  try {
    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const sessions = await ChatSession.find({ updatedAt: { $gte: since } }).select('messages').lean();
    const groups = new Map();
    for (const session of sessions) {
      session.messages.forEach((m, i) => {
        const reply = session.messages[i + 1];
        if (m.role !== 'user' || reply?.role !== 'assistant' || reply.answered !== false) return;
        const key = m.content.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
        if (!key) return;
        const group = groups.get(key) || { question: m.content.slice(0, 200), count: 0, topic: m.topic, language: m.language, lastAsked: null };
        group.count += 1;
        const at = reply.createdAt || session.updatedAt;
        if (at && (!group.lastAsked || at > group.lastAsked)) group.lastAsked = at;
        groups.set(key, group);
      });
    }
    const questions = [...groups.values()].sort((a, b) => b.count - a.count || new Date(b.lastAsked) - new Date(a.lastAsked)).slice(0, 50);
    res.json({ questions });
  } catch (error) {
    res.status(500).json({ message: 'Could not load unanswered questions.' });
  }
};
