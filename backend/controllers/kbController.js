const ChatSession = require('../models/ChatSession');
const { logAudit } = require('../services/audit');

const NLP_BASE = new URL(process.env.NLP_SERVICE_URL || 'http://localhost:8000/process').origin;

async function nlp(path, options = {}) {
  const response = await fetch(`${NLP_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.INTERNAL_API_TOKEN ? { 'X-Internal-Token': process.env.INTERNAL_API_TOKEN } : {}),
      ...(options.headers || {}),
    },
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
    logAudit(req, 'kb.document_review', doc.title || req.params.id, { status, verified });
    res.json(doc);
  } catch (error) {
    res.status(error.status === 404 || error.status === 400 ? error.status : 502).json({ message: error.message });
  }
};

const questionKey = (text) => String(text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// GET /api/kb/answers - answers written by officers (used by the chatbot as verified information).
exports.listAnswers = async (req, res) => {
  try {
    res.json(await nlp('/kb/answers'));
  } catch (error) {
    res.status(502).json({ message: 'Could not reach the chatbot service.' });
  }
};

// POST /api/kb/answers - create or update an officer answer (admins only).
exports.saveAnswer = async (req, res) => {
  const { id, title, answer, questions, department, topic, sourceUrl, serviceUrl, serviceLabel } = req.body || {};
  try {
    const saved = await nlp('/kb/answers', {
      method: 'POST',
      body: JSON.stringify({ id, title, answer, questions: Array.isArray(questions) ? questions : [], department, topic, sourceUrl, serviceUrl, serviceLabel, author: req.user.email }),
    });
    logAudit(req, id ? 'kb.answer_update' : 'kb.answer_create', saved.title);
    res.json(saved);
  } catch (error) {
    res.status(error.status === 400 || error.status === 422 ? 400 : 502).json({ message: error.status === 422 ? 'Please fill in the title and answer.' : error.message });
  }
};

// DELETE /api/kb/answers/:id (admins only).
exports.deleteAnswer = async (req, res) => {
  try {
    const result = await nlp(`/kb/answers/${encodeURIComponent(req.params.id)}`, { method: 'DELETE' });
    logAudit(req, 'kb.answer_delete', req.params.id);
    res.json(result);
  } catch (error) {
    res.status(error.status === 404 ? 404 : 502).json({ message: error.message });
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
        const key = questionKey(m.content);
        if (!key) return;
        const group = groups.get(key) || { question: m.content.slice(0, 200), count: 0, topic: m.topic, language: m.language, lastAsked: null };
        group.count += 1;
        const at = reply.createdAt || session.updatedAt;
        if (at && (!group.lastAsked || at > group.lastAsked)) group.lastAsked = at;
        groups.set(key, group);
      });
    }
    // Questions an officer has since answered are marked, so the list shows what is still open.
    const answered = new Set();
    try {
      (await nlp('/kb/answers')).answers.forEach((a) => (a.questions || []).forEach((q) => answered.add(questionKey(q))));
    } catch { /* chatbot service down: show the list without the marks */ }
    groups.forEach((group, key) => { group.handled = answered.has(key); });
    const questions = [...groups.values()].sort((a, b) => Number(a.handled) - Number(b.handled) || b.count - a.count || new Date(b.lastAsked) - new Date(a.lastAsked)).slice(0, 50);
    res.json({ questions });
  } catch (error) {
    res.status(500).json({ message: 'Could not load unanswered questions.' });
  }
};

// GET /api/kb/refresh - last weekly refresh: when it ran, what changed, when the next one is due.
exports.refreshStatus = async (req, res) => {
  try {
    res.json(await nlp('/kb/refresh'));
  } catch (error) {
    res.status(502).json({ message: 'Could not reach the chatbot service.' });
  }
};

// POST /api/kb/refresh - admins start a re-crawl now (runs in the background on the NLP service).
exports.startRefresh = async (req, res) => {
  try {
    await nlp('/kb/refresh', { method: 'POST' });
    logAudit(req, 'kb.refresh', 'knowledge base', { trigger: 'manual' });
    res.status(202).json({ started: true });
  } catch (error) {
    res.status(error.status === 409 ? 409 : 502).json({ message: error.status === 409 ? 'A refresh is already running.' : 'Could not reach the chatbot service.' });
  }
};

// POST /api/kb/refresh/reviewed - admin confirms the changed pages have been checked.
exports.markRefreshReviewed = async (req, res) => {
  try {
    await nlp('/kb/refresh/reviewed', { method: 'POST', body: JSON.stringify({ reviewer: req.user.email }) });
    logAudit(req, 'kb.refresh_reviewed', 'knowledge base');
    res.json({ reviewed: true });
  } catch (error) {
    res.status(error.status === 404 ? 404 : 502).json({ message: error.message });
  }
};
