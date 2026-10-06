// Smart replies and translations via the local Ollama server (native /api/chat for streaming + keep_alive).
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
// qwen3.5 writes usable Hindi/Marathi; the 1.5B–2B models produce broken Devanagari text.
const REPLY_MODEL = process.env.REPLY_MODEL || 'qwen3.5:latest';
// Loading the model from disk takes ~30s; keeping it resident makes every reply start in about a second.
const KEEP_ALIVE = process.env.OLLAMA_KEEP_ALIVE || '30m';
// Load options must be identical for every request (replies, chat, warm-up, and the Python NLP service):
// any difference makes Ollama reload the model. GPU layer placement is left to Ollama by default; forcing all
// layers onto an 8 GB laptop GPU was fast at first but became erratic once other apps needed VRAM.
// Set OLLAMA_NUM_GPU (layer count) to override.
const MODEL_OPTIONS = { num_ctx: 4096, ...(process.env.OLLAMA_NUM_GPU ? { num_gpu: Number(process.env.OLLAMA_NUM_GPU) } : {}) };
const { departmentName, corporationName, isExternalDepartment, pcmc } = require('./pcmcConfig');
const DEVANAGARI = /[\u0900-\u097F]/;

const REPLY_LANGUAGES = {
  English: 'English',
  Hindi: 'Hindi, written in Devanagari script',
  Marathi: 'Marathi, written in Devanagari script',
  Hinglish: 'simple Hinglish (Hindi written in English letters)',
};

const SIGNATURE = {
  English: (dept) => `Regards,\n${dept}\n${corporationName('English')}`,
  Hindi: (dept) => `सादर,\n${dept}\n${corporationName('Hindi')}`,
  Marathi: (dept) => `आपला नम्र,\n${dept}\n${corporationName('Marathi')}`,
  Hinglish: (dept) => `Regards,\n${dept}\n${corporationName('English')}`,
};

// Used when Ollama is unavailable, so the officer always gets a correct draft in the citizen's language.
const TEMPLATE = {
  English: ({ category, ward, department, deadline }) => `Thank you for reporting this ${category ? `${category.toLowerCase()} ` : ''}issue${ward ? ` in ${ward}` : ''}. Your complaint has been registered and forwarded to the ${department}. ${deadline ? `We aim to resolve it by ${deadline}.` : 'Our team will act on it as soon as possible.'}`,
  Hindi: ({ ward, department, deadline }) => `${ward ? `${ward} में ` : ''}इस समस्या की जानकारी देने के लिए धन्यवाद। आपकी शिकायत दर्ज कर ली गई है और ${department} को भेज दी गई है। ${deadline ? `हमारा प्रयास है कि इसका समाधान ${deadline} तक हो जाए।` : 'हमारी टीम जल्द से जल्द कार्रवाई करेगी।'}`,
  Marathi: ({ ward, department, deadline }) => `${ward ? `${ward} येथील ` : ''}या समस्येची माहिती दिल्याबद्दल धन्यवाद. आपली तक्रार नोंदवली असून ती ${department} यांच्याकडे पाठवण्यात आली आहे. ${deadline ? `${deadline} पर्यंत ही समस्या सोडवण्याचा आमचा प्रयत्न आहे.` : 'आमची टीम लवकरात लवकर कार्यवाही करेल.'}`,
  Hinglish: ({ ward, department, deadline }) => `${ward ? `${ward} mein ` : ''}is samasya ki jaankari dene ke liye dhanyavaad. Aapki shikayat darj ho gayi hai aur ${department} ko bhej di gayi hai. ${deadline ? `Hum ise ${deadline} tak hal karne ki koshish karenge.` : 'Hamari team jald se jald karyavahi karegi.'}`,
};

// Older tickets stored raw langdetect codes ("Mr", "Hi") before the pipeline normalised them.
const LANGUAGE_CODES = { mr: 'Marathi', hi: 'Hindi', en: 'English' };

const resolveLanguage = (requested, complaintLanguage) => {
  if (requested && requested !== 'auto' && REPLY_LANGUAGES[requested]) return requested;
  const normalized = LANGUAGE_CODES[String(complaintLanguage || '').toLowerCase()] || complaintLanguage;
  return REPLY_LANGUAGES[normalized] ? normalized : 'English';
};

const DATE_LOCALE = { Hindi: 'hi-IN', Marathi: 'mr-IN' };
const formatDeadline = (deadline, language = 'English') => (deadline
  ? new Date(deadline).toLocaleString(DATE_LOCALE[language] || 'en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'long' })
  : null);

// Official Hindi/Marathi department names, so the model doesn't invent its own translation.
const localizedDepartment = (department, language) => departmentName(department, language === 'Hinglish' ? 'English' : language);

// Small local models still echo redaction tokens and template placeholders; strip them before an officer sees the draft.
function cleanReply(text) {
  return text
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/^\s*(subject|विषय)\s*:.*$/gim, '')
    // The model's own sign-off is replaced by the department signature.
    .replace(/^\s*(best regards|regards|sincerely|thanks and regards|warm regards|yours sincerely|सादर|आपला नम्र|धन्यवादसह)\b[\s\S]*$/im, '')
    .replace(/\[[^\]\n]{1,40}\]/g, '')
    .replace(/,?\s*\b(?:Mr|Mrs|Ms)\.?(?:\/(?:Mr|Mrs|Ms)\.?)?\s*(?=[.,!?])/g, '')
    .split(/(?<=[.!?।])\s+/)
    .filter((sentence) => !/<[A-Z_]+>/.test(sentence) && !/\b(urgency|priority)\b[^.!?।]*\b(low|medium|high|critical|P[1-4])\b/i.test(sentence))
    .join(' ')
    .trim();
}

function buildReplyPrompt(data, language) {
  const department = localizedDepartment(data.department, language);
  const deadline = formatDeadline(data.slaDeadline, language);
  const example = TEMPLATE[language]({ category: data.category, ward: data.ward, department, deadline });
  const script = language === 'Hinglish'
    ? '\n- Use ONLY English (Latin) letters, like "Aapki shikayat darj ho gayi hai". Do NOT use Devanagari script.'
    : language === 'Hindi' || language === 'Marathi' ? `\n- Write natural, grammatical ${language} as a PCMC officer would. Refer to the department exactly as "${department}".` : '';

  return `You are a courteous officer of the Pimpri-Chinchwad Municipal Corporation (PCMC) replying to a citizen who reported a civic issue.

Complaint details:
- Category: ${data.category}
- Department handling it: ${department}
- Ward: ${data.ward || 'not identified'}
- Urgency: ${data.urgency}
- Expected resolution by: ${deadline || 'not set'}
- Complaint text (personal details removed): "${data.sanitizedText}"

Write ONLY the reply body, 3 to 4 short sentences, entirely in ${REPLY_LANGUAGES[language]}.
- Thank the citizen, restate the specific issue and its location in your own words, and say it has been forwarded to the ${department}.
- ${deadline ? `Say the team aims to resolve it by ${deadline}.` : 'Say the team will act on it as soon as possible.'}
- If urgency is High or Critical, or the issue is a safety risk, acknowledge the urgency.${script}

Match the tone and language of this example, but write your own reply that mentions the specific problem:
"${example}"

Strict rules: never write anything in angle brackets (like <PHONE_NUMBER>), never invent complaint numbers, phone numbers or names, never ask the citizen to call, no subject line, no greeting with a name, no sign-off, no placeholders like [Your Name], no promises of compensation, and never mention AI, categories, urgency levels or priorities.`;
}

// signal lets callers stop generation early, e.g. when a citizen closes the chat mid-answer.
async function chat(prompt, { temperature = 0.4, maxTokens = 260, onToken, signal } = {}) {
  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: REPLY_MODEL,
      stream: true,
      think: false, // qwen3.x "thinking" adds many seconds of hidden tokens
      keep_alive: KEEP_ALIVE,
      options: { ...MODEL_OPTIONS, temperature, num_predict: maxTokens },
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!response.ok) throw new Error(`Ollama responded ${response.status}: ${await response.text()}`);

  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const event = JSON.parse(line);
      if (event.error) throw new Error(event.error);
      const token = event.message?.content;
      if (token) {
        text += token;
        onToken?.(token);
      }
    }
  }
  return text;
}

// Loads the model into GPU memory at startup so the first officer request doesn't wait ~30s.
exports.warmUp = async () => {
  try {
    const started = Date.now();
    await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: REPLY_MODEL, keep_alive: KEEP_ALIVE, options: MODEL_OPTIONS }),
    });
    console.log(`Reply model ${REPLY_MODEL} loaded in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  } catch (error) {
    console.warn(`Could not preload ${REPLY_MODEL} (is Ollama running?):`, error.message);
  }
};

exports.resolveLanguage = resolveLanguage;
// Shared streaming call so the citizen chatbot uses exactly the same model and settings.
exports.chat = chat;
exports.REPLY_LANGUAGES = Object.keys(REPLY_LANGUAGES);

/**
 * Generates a reply in the requested language ("auto" = the citizen's language).
 * onToken receives raw tokens for streaming; the returned reply is cleaned and signed.
 */
exports.generateSmartReply = async (data, { language = 'auto', regenerate = false, onToken, onReset } = {}) => {
  const replyLanguage = resolveLanguage(language, data.language);
  const department = data.department && data.department !== 'Processing...' ? data.department : pcmc.defaultDepartment;
  const localDept = localizedDepartment(department, replyLanguage);
  // External bodies (e.g. traffic police) are mentioned in the reply, but PCMC signs it.
  const signature = SIGNATURE[replyLanguage](localizedDepartment(isExternalDepartment(department) ? pcmc.defaultDepartment : department, replyLanguage));
  const context = { ...data, department };
  // A higher temperature on regenerate gives the officer a genuinely different draft.
  const temperature = regenerate ? 0.7 : 0.3;

  try {
    let raw = await chat(buildReplyPrompt(context, replyLanguage), { temperature, onToken });
    // Models often slip into Devanagari when asked for Hinglish; retry once more strictly.
    if (replyLanguage === 'Hinglish' && DEVANAGARI.test(raw)) {
      onReset?.();
      raw = await chat(`${buildReplyPrompt(context, replyLanguage)}\n\nIMPORTANT: your previous answer used Devanagari. Rewrite it using only English letters.`, { temperature: 0.2, onToken });
    }
    const body = cleanReply(raw);
    if (!body || (replyLanguage === 'Hinglish' && DEVANAGARI.test(body))) throw new Error('Model did not return a usable reply');
    return { reply: `${body}\n\n${signature}`, language: replyLanguage, fallback: false };
  } catch (error) {
    console.error('Error generating reply with Ollama:', error.message);
    const body = TEMPLATE[replyLanguage]({ category: data.category, ward: data.ward, department: localDept, deadline: formatDeadline(data.slaDeadline, replyLanguage) });
    return { reply: `${body}\n\n${signature}`, language: replyLanguage, fallback: true };
  }
};

// English translation of a Hindi/Marathi/Hinglish complaint for officers.
exports.translateToEnglish = async (text) => {
  // A loose "natural English" prompt let the model drop or change facts; ask for a faithful sentence-by-sentence translation.
  const raw = await chat(
    `You are a professional Marathi/Hindi to English translator for the Pimpri-Chinchwad Municipal Corporation.
Translate the complaint below into English faithfully, sentence by sentence. Do not summarise, add or change any facts. Keep every detail (who, what, where, how long). Keep place names and placeholders like <PHONE_NUMBER> unchanged.
Output only the English translation.

Complaint:
${text}`,
    { temperature: 0, maxTokens: 400 }
  );
  return raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
};
