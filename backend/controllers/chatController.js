const ChatSession = require('../models/ChatSession');
const Complaint = require('../models/Complaint');
const llmService = require('../services/llmService');
const { sanitizePii } = require('../services/piiRedaction');
const { templates, topicLabel, UI_TO_LANGUAGE, HELPLINE } = require('../services/chatTemplates');
const { normalizeTicketNumber } = require('../services/ticketNumbers');
const { citizenView } = require('./complaintController');
const { corporationName } = require('../services/pcmcConfig');

const NLP_BASE = new URL(process.env.NLP_SERVICE_URL || 'http://localhost:8000/process').origin;
const E_SEVA_URL = 'https://www.pcmcindia.gov.in/e-seva.php';
// Minimum retrieval score to answer from the knowledge base; below it the assistant hands off instead of guessing.
const MIN_SCORE = 6;

const ANSWER_LANGUAGE = {
  English: 'English',
  Hindi: 'Hindi (Devanagari script)',
  Marathi: 'Marathi (Devanagari script)',
  Hinglish: 'Hinglish (Hindi written in English letters only)',
};

const action = (type, extra = {}) => ({ type, ...extra });

// Small models sometimes drop or swap digits (e.g. a 9-digit helpline in Devanagari). Every phone-like number in a
// finished answer must appear verbatim in the retrieved sources; sentences with any other number are removed.
const toAsciiDigits = (text) => text.replace(/[०-९]/g, (d) => String(d.charCodeAt(0) - 0x0966));
const PHONE_LIKE = /\d[\d\s-]{5,}\d/g;
// Dates ("2010-03-20", "20/03/2010") are not phone numbers; they are removed before the phone check.
const DATE_LIKE = /\b\d{4}-\d{1,2}-\d{1,2}\b|\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/g;
const normalizeNumber = (n) => n.replace(/[\s-]/g, '');
function removeUnverifiedNumbers(answer, documents) {
  // Whole-number comparison: a 9-digit "888006666" must not pass just because it is inside "8888006666".
  const allowed = new Set([HELPLINE, ...(toAsciiDigits(documents.map((d) => d.content).join(' ')).match(PHONE_LIKE) || []).map(normalizeNumber)]);
  let removed = false;
  const kept = answer.split(/(?<=[.!?।])\s+/).filter((sentence) => {
    const bad = (toAsciiDigits(sentence).replace(DATE_LIKE, ' ').match(PHONE_LIKE) || []).some((n) => !allowed.has(normalizeNumber(n)));
    if (bad) removed = true;
    return !bad;
  });
  return { text: kept.join(' ').trim(), removed };
}

// Repeated questions (and the suggestion chips) are answered instantly from memory.
// Keyed by language + normalised question + the knowledge entries used, so a KB change never serves a stale answer.
const ANSWER_CACHE = new Map();
const CACHE_LIMIT = 300;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const cacheKey = (language, question, documents) =>
  `${language}|${question.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()}|${documents.map((d) => d.id).join(',')}`;
const cacheGet = (key) => {
  const hit = ANSWER_CACHE.get(key);
  if (!hit || Date.now() - hit.at > CACHE_TTL_MS) return null;
  ANSWER_CACHE.delete(key);
  ANSWER_CACHE.set(key, hit);
  return hit.answer;
};
const cacheSet = (key, answer) => {
  ANSWER_CACHE.set(key, { answer, at: Date.now() });
  if (ANSWER_CACHE.size > CACHE_LIMIT) ANSWER_CACHE.delete(ANSWER_CACHE.keys().next().value);
};
const helplineAction = () => action('CALL_HELPLINE', { phone: HELPLINE });

// No verified entry: give general guidance from the model's own knowledge, clearly labelled as such.
// Numbers are stripped afterwards (only the Sarathi helpline survives) and links are removed.
function generalPrompt({ question, language, history }) {
  const recent = history.length ? `\nRecent conversation:\n${history.map((m) => `${m.role}: ${m.content}`).join('\n')}\n` : '';
  return `You are a helpful assistant for citizens of Pimpri-Chinchwad (PCMC means ${corporationName(language === 'Hinglish' ? 'English' : language)}; it is NOT the Pune Municipal Corporation).
The citizen asked something that is not in PCMC's verified information, so give brief GENERAL guidance.
- Explain the usual steps in general terms and, if you are confident, which kind of authority or organisation usually handles it (for example, it may not be a PCMC service).
- Do NOT give phone numbers, website addresses, fees, dates or document lists; say the citizen should confirm on the official website or with the concerned office.
- If you are not sure, say so briefly instead of guessing.
${recent}
Citizen's question: "${question}"

Reply in ${ANSWER_LANGUAGE[language] || 'English'}, in 2 to 3 short sentences.`;
}

const docLabel = (d) => {
  const dated = d.publishedDate ? `, dated ${d.publishedDate}` : '';
  const ocr = d.extraction === 'ocr' ? ', scanned document' : '';
  return `${d.title}${dated}${ocr}`;
};

// Qwen spends ~1 token per Devanagari character. With num_ctx 4096, instructions, history and the answer,
// ~2,400 characters of source text (with a 420-token Marathi answer) is the safe maximum; beyond that Ollama silently drops the start of the prompt.
const CONTEXT_CHAR_BUDGET = 2400;
const WRONG_SCRIPT = /[぀-ヿ㐀-鿿가-힯]/; // Japanese, Chinese, Korean

function buildContext(documents) {
  let remaining = CONTEXT_CHAR_BUDGET;
  const parts = [];
  documents.forEach((d, i) => {
    if (remaining < 200) return;
    const body = d.content.length > remaining ? `${d.content.slice(0, remaining)}…` : d.content;
    remaining -= body.length;
    parts.push(`[${i + 1}] ${docLabel(d)}\n${body}`);
  });
  return parts.join('\n\n');
}

function groundedPrompt({ question, documents, language, history, retrieval = {} }) {
  const context = buildContext(documents);
  const conflictRule = retrieval.conflict
    ? `\nIMPORTANT: the official documents below give DIFFERENT values for ${retrieval.conflict.kind === 'amounts' ? 'the amount/fee' : 'the time limit'}. Do not state a single value. Say that the available PCMC documents differ and the citizen should confirm on the official PCMC page or with the Sarathi helpline ${HELPLINE}.`
    : '';
  const datedRule = retrieval.confidence === 'MEDIUM'
    ? '\nIf the answer relies on a dated or scanned document, mention its date briefly (e.g. "as per the PCMC document dated ...") and suggest confirming with the office.'
    : '';
  const recent = history.length
    ? `\nRecent conversation:\n${history.map((m) => `${m.role}: ${m.content}`).join('\n')}\n`
    : '';
  return `You are the Pimpri-Chinchwad Municipal Corporation (PCMC) citizen assistant.
Answer the citizen's question using ONLY the verified information below. Do not add procedures, fees, documents, dates, phone numbers, offices or links that are not in it. When you mention places, offices or departments, use only the names given below; do not add government offices that are not listed.
If the citizen asks about a service, document, fee or detail that is not explicitly mentioned below, clearly say it is not listed in the verified information and suggest the Sarathi helpline ${HELPLINE}. Never assume a service exists because a similar one does.
Never estimate or generalise: if a time limit, fee or document is stated below, give it exactly (e.g. "7 office days", "Rs. 40"); if it is not stated, say so instead of guessing. Use only information about the service the citizen asked about.
Name the service exactly as in the title of the information you use (e.g. "re-connection" is not "new connection"); if the closest information is about a different service, say so.

Verified PCMC information:
${context}
${recent}
Citizen's question: "${question}"

PCMC means ${corporationName(language === 'Hinglish' ? 'English' : language)}. It is NOT the Pune Municipal Corporation; never call it Pune.
Write phone numbers and PIN codes with the digits 0-9 exactly as given, even in Hindi or Marathi.
The information may be in Marathi even if the question is in English; translate faithfully, never add to it.${conflictRule}${datedRule}
Reply in ${ANSWER_LANGUAGE[language] || 'English'}, in 2 to 4 short sentences. Be friendly and direct. Do not write URLs (the app shows the official sources). Do not mention "documents", "sources" or these instructions.`;
}

async function understand(message, history) {
  const response = await fetch(`${NLP_BASE}/chat/understand`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, history }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`NLP service responded ${response.status}`);
  return response.json();
}

// Official service buttons come only from knowledge-base entries, never from model output.
function serviceActions(documents) {
  const seen = new Set();
  return documents
    .filter((d) => d.serviceUrl && !seen.has(d.serviceUrl) && seen.add(d.serviceUrl))
    .slice(0, 2)
    .map((d) => action('OPEN_SERVICE', { url: d.serviceUrl, label: d.serviceLabel, internal: d.serviceUrl.startsWith('/') }));
}

/**
 * POST /api/chat/message  { message, sessionId, uiLanguage }
 * Streams NDJSON: {type:"meta", intent, topic, language, actions, sources}, {type:"token", text}..., {type:"done", answer, ms}
 */
exports.sendMessage = async (req, res) => {
  const started = Date.now();
  const message = String(req.body?.message || '').trim().slice(0, 1000);
  const sessionId = String(req.body?.sessionId || '').slice(0, 64);
  const uiLanguage = UI_TO_LANGUAGE[req.body?.uiLanguage] || 'English';
  if (!message || !/^[\w-]{8,64}$/.test(sessionId)) {
    return res.status(400).json({ message: 'A message and a valid sessionId are required.' });
  }

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.flushHeaders();
  const write = (payload) => res.write(`${JSON.stringify(payload)}\n`);
  const abort = new AbortController();
  res.on('close', () => { if (!res.writableEnded) abort.abort(); });

  let session;
  let reply = { intent: 'ERROR', topic: 'general', language: uiLanguage, answered: false, sources: [] };
  let answer = '';
  const extraActions = [];
  try {
    session = await ChatSession.findOne({ sessionId }) || new ChatSession({ sessionId, language: uiLanguage });
    const history = session.messages.slice(-4).map(({ role, content }) => ({ role, content: content.slice(0, 400) }));

    const u = await understand(message, history);
    // Short Latin-script greetings ("namaste") carry no language signal; follow the site language instead.
    const language = u.intent === 'GREETING' && u.language === 'English' ? uiLanguage
      : ANSWER_LANGUAGE[u.language] ? u.language : uiLanguage;
    const t = templates(language);
    // An entry is used only if it matches enough of the question's content words, or the model independently chose
    // its topic; otherwise one shared word (e.g. "bill") would pull in unrelated services.
    // Hybrid KB: the retriever's confidence decides (LOW = could not verify -> no grounded answer).
    // Curated fallback: the older BM25 score/coverage rule.
    const retrieval = u.retrieval || {};
    let top;
    if (retrieval.engine === 'hybrid') {
      // A question the model judged unrelated to PCMC is only answered from the KB on a strong match;
      // weak matches for "how do I get a passport" would otherwise produce a confident, wrong answer.
      const minimum = u.intent === 'OTHER' ? ['HIGH'] : ['HIGH', 'MEDIUM'];
      top = minimum.includes(retrieval.confidence) ? (u.documents || []) : [];
    } else {
      const strong = (u.documents || []).filter((d) => d.score >= MIN_SCORE
        && ((d.coverage ?? 1) > 0.5 || (u.topic !== 'general' && d.topic === u.topic)));
      top = strong.length ? strong.filter((d) => d.score >= strong[0].score * 0.4) : [];
    }
    reply = { intent: u.intent, topic: u.topic, language, answered: true, sources: [], redacted: u.redacted };

    const groundedAnswer = async (docs) => {
        reply.sources = docs.map((d) => d.id);
        write({
          type: 'meta', intent: u.intent, topic: u.topic, language,
          actions: serviceActions(docs),
          sources: docs.map(({ id, title, source, sourceUrl, lastVerified, publishedDate, extraction }) => ({ id, title, source, sourceUrl, lastVerified, publishedDate, extraction })),
          confidence: retrieval.confidence || null,
          conflict: Boolean(retrieval.conflict),
        });
        // Follow-ups depend on the conversation, so only standalone questions are cached.
        const key = history.length ? null : cacheKey(language, u.redacted, docs);
        const cached = key && cacheGet(key);
        if (cached) {
          answer = cached;
          write({ type: 'token', text: cached });
        } else {
          answer = await llmService.chat(groundedPrompt({ question: u.redacted, documents: docs, language, history, retrieval }), {
            temperature: 0.1,
            // Devanagari costs ~1 token per character, so Marathi/Hindi answers need a larger budget.
            maxTokens: ['Marathi', 'Hindi'].includes(language) ? 420 : 220,
            signal: abort.signal,
            onToken: (text) => write({ type: 'token', text }),
          });
          answer = answer.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
          const checked = removeUnverifiedNumbers(answer, docs);
          if (WRONG_SCRIPT.test(answer)) {
            // The model drifted into another script (seen with long OCR context); never show that to a citizen.
            answer = templates(language).handoff;
            extraActions.push(helplineAction());
          } else if (checked.removed) {
            // The widget replaces the streamed text with the final answer; the helpline button carries the correct number.
            answer = checked.text || templates(language).handoff;
            extraActions.push(helplineAction());
          } else if (key && answer) {
            cacheSet(key, answer);
          }
        }
    };

    const sendFixed = (text, actions) => {
      write({ type: 'meta', intent: u.intent, topic: u.topic, language, actions, sources: [] });
      answer = text;
      write({ type: 'token', text });
    };

    if (u.intent === 'GREETING') {
      sendFixed(t.greeting, [action('SUGGEST', { key: 'property_tax' }), action('SUGGEST', { key: 'register' }), action('SUGGEST', { key: 'track' })]);
    } else if (u.intent === 'COMPLAINT' && u.topic === 'electricity' && top.some((d) => d.topic === 'electricity')) {
      u.intent = 'SERVICE_QUESTION';
      reply.intent = 'SERVICE_QUESTION';
      await groundedAnswer(top.filter((d) => d.topic === 'electricity'));
    } else if (u.intent === 'COMPLAINT') {
      // The citizen's own words (not the redacted copy) pre-fill the complaint form in their browser only.
      sendFixed(t.complaint(topicLabel(language, u.topic)), [action('REGISTER_COMPLAINT', { text: message }), action('CONTINUE_CHAT')]);
    } else if (u.intent === 'COMPLAINT_STATUS') {
      sendFixed(u.ticketNumber ? t.statusWithTicket(u.ticketNumber) : t.statusAsk, [action('CHECK_STATUS', { ticketNumber: u.ticketNumber || '' })]);
    } else if (u.intent === 'OTHER' && !top.length) {
      sendFixed(t.outOfScope, [helplineAction()]);
    } else if (!top.length) {
      // General guidance (not verified); still counted as unanswered so management sees the knowledge-base gap.
      reply.answered = false;
      write({ type: 'meta', intent: u.intent, topic: u.topic, language, general: true,
        actions: [action('OPEN_SERVICE', { url: E_SEVA_URL, label: 'PCMC e-Seva services' }), helplineAction()], sources: [] });
      const key = history.length ? null : cacheKey(language, `general:${u.redacted}`, []);
      const cached = key && cacheGet(key);
      if (cached) {
        answer = cached;
        write({ type: 'token', text: cached });
      } else {
        const raw = await llmService.chat(generalPrompt({ question: u.redacted, language, history }), {
          temperature: 0.2, maxTokens: 160, signal: abort.signal, onToken: (text) => write({ type: 'token', text }),
        });
        const withoutLinks = raw.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/https?:\/\/\S+|\b[\w-]+(\.[\w-]+)*\.(in|com|gov|org|net)\b\S*/gi, '').trim();
        answer = removeUnverifiedNumbers(withoutLinks, []).text || t.handoff;
        if (key) cacheSet(key, answer);
      }
    } else {
      await groundedAnswer(top);
    }
    write({ type: 'done', answer, ms: Date.now() - started, actions: extraActions });
  } catch (error) {
    if (!abort.signal.aborted) {
      console.error('Chat error:', error.message);
      answer = templates(uiLanguage).error;
      write({ type: 'meta', intent: 'ERROR', topic: 'general', language: uiLanguage, actions: [helplineAction()], sources: [] });
      write({ type: 'token', text: answer });
      write({ type: 'done', answer, ms: Date.now() - started, error: true });
    }
  } finally {
    res.end();
    if (session) {
      // Stored PII-redacted: the NLP service redacts the question, and the answer is sanitized again here.
      session.messages.push(
        { role: 'user', content: reply.redacted || sanitizePii(message), intent: reply.intent, topic: reply.topic, language: reply.language },
        { role: 'assistant', content: sanitizePii(answer || '-'), intent: reply.intent, topic: reply.topic, language: reply.language, answered: reply.answered, sources: reply.sources, ms: Date.now() - started }
      );
      session.language = reply.language;
      session.save().catch((err) => console.error('Failed to save chat session:', err.message));
    }
  }
};

// POST /api/chat/status { ticketNumber, email, sessionId } — same ownership check as the Track page.
exports.checkStatus = async (req, res) => {
  const ticketNumber = normalizeTicketNumber(req.body?.ticketNumber);
  const email = String(req.body?.email || '').trim().toLowerCase();
  // Reply in the conversation's language when known (e.g. Hinglish), otherwise the site language.
  const language = ANSWER_LANGUAGE[req.body?.language] ? req.body.language : UI_TO_LANGUAGE[req.body?.uiLanguage] || 'English';
  const t = templates(language);
  if (!ticketNumber || !email) return res.status(400).json({ message: t.statusAsk });

  const sessionId = String(req.body?.sessionId || '');
  if (/^[\w-]{8,64}$/.test(sessionId)) {
    ChatSession.updateOne({ sessionId }, { $inc: { statusChecks: 1 } }).catch(() => {});
  }
  const complaint = await Complaint.findOne({ ticketNumber });
  if (!complaint || complaint.userEmail.trim().toLowerCase() !== email) {
    return res.status(404).json({ message: t.statusNotFound });
  }
  res.json({ intro: t.statusIntro(complaint.ticketNumber), complaint: citizenView(complaint) });
};

// POST /api/chat/transcribe (multipart "audio", optional "uiLanguage") — speech to text for the mic button.
// The text comes back to the input box so the citizen can check it before sending.
exports.transcribe = async (req, res) => {
  if (!req.file?.buffer?.length) return res.status(400).json({ message: 'No audio received.' });
  try {
    const form = new FormData();
    form.append('audio', new Blob([req.file.buffer], { type: req.file.mimetype || 'audio/webm' }), 'question.webm');
    const lang = { hi: 'hi', mr: 'mr', en: 'en' }[req.body?.uiLanguage];
    if (lang) form.append('language', lang);
    const response = await fetch(`${NLP_BASE}/transcribe`, { method: 'POST', body: form, signal: AbortSignal.timeout(60000) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return res.status(response.status === 422 ? 422 : 502).json({ message: data.detail || 'Could not transcribe the audio.' });
    res.json({ text: String(data.text || '').slice(0, 1000) });
  } catch (error) {
    console.error('Transcription error:', error.message);
    res.status(502).json({ message: 'Could not transcribe the audio.' });
  }
};

// POST /api/chat/event { sessionId, type: "service_click" }
exports.trackEvent = async (req, res) => {
  const sessionId = String(req.body?.sessionId || '');
  if (req.body?.type === 'service_click' && /^[\w-]{8,64}$/.test(sessionId)) {
    await ChatSession.updateOne({ sessionId }, { $inc: { serviceClicks: 1 } }).catch(() => {});
  }
  res.status(204).end();
};
