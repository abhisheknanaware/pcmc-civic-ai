import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LogoMark } from './Logo';
import { MessageCircle, X, Send, Loader, ExternalLink, Phone, FilePlus, Search, ShieldCheck, Info } from 'lucide-react';
import useLabels from '../hooks/useLabels';
import { API_BASE } from '../constants';

const SESSION_KEY = 'pcmc_chat_session';

const getSessionId = () => {
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
};

const postJson = (path, body) => fetch(`${API_BASE}/api/chat${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

function StatusForm({ initialTicket, onResult, language, sessionId, uiLanguage }) {
  const { t } = useLabels();
  const [ticketNumber, setTicketNumber] = useState(initialTicket || '');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const response = await postJson('/status', { ticketNumber, email, sessionId, language, uiLanguage });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || t('track_failed'));
      onResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className="chat-status-form" onSubmit={submit}>
      <input aria-label={t('ticket_number_label')} placeholder="PCMC-100001" value={ticketNumber} onChange={(e) => setTicketNumber(e.target.value)} required />
      <input aria-label={t('email_label')} type="email" placeholder={t('email_label')} value={email} onChange={(e) => setEmail(e.target.value)} required />
      <button type="submit" className="btn small" disabled={loading}>{loading ? <Loader size={14} className="spin" /> : <Search size={14} />} {t('track_btn')}</button>
      {error && <p className="chat-error">{error}</p>}
    </form>
  );
}

function StatusCard({ complaint }) {
  const L = useLabels();
  const { t } = L;
  return (
    <div className="chat-status-card">
      <div className="chat-status-head"><span className="ticket-id">{complaint.ticketNumber}</span><span className="badge neutral">{L.status(complaint.status)}</span></div>
      <p><strong>{t('label_category')}:</strong> {L.category(complaint.category)}</p>
      <p><strong>{t('label_department')}:</strong> {L.department(complaint.department)}</p>
      <p><strong>{t('label_priority')}:</strong> {L.priority(complaint.priority)}</p>
      <p><strong>{t('last_updated')}:</strong> {L.date(complaint.updatedAt, { dateStyle: 'medium', timeStyle: 'short' })}</p>
    </div>
  );
}

export default function ChatWidget() {
  const L = useLabels();
  const { t } = L;
  const { i18n } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const sessionId = useRef(getSessionId()).current;
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const abortRef = useRef(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);
  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);
  useEffect(() => () => abortRef.current?.abort(), []);
  // Other parts of the page (e.g. the homepage buttons) can open the assistant.
  useEffect(() => {
    const openChat = () => setOpen(true);
    window.addEventListener('pcmc:open-chat', openChat);
    return () => window.removeEventListener('pcmc:open-chat', openChat);
  }, []);

  const update = (id, patch) => setMessages((list) => list.map((m) => (m.id === id ? { ...m, ...(typeof patch === 'function' ? patch(m) : patch) } : m)));

  const send = async (text) => {
    const message = text.trim();
    if (!message || busy) return;
    setInput('');
    setBusy(true);
    const botId = crypto.randomUUID();
    setMessages((list) => [...list, { id: crypto.randomUUID(), role: 'user', text: message }, { id: botId, role: 'assistant', text: '', pending: true, actions: [], sources: [] }]);

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await fetch(`${API_BASE}/api/chat/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, sessionId, uiLanguage: i18n.language }),
        signal: controller.signal,
      });
      if (response.status === 429) {
        update(botId, { text: t('too_many_requests'), pending: false });
        return;
      }
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newline;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line) continue;
          const event = JSON.parse(line);
          if (event.type === 'meta') update(botId, { intent: event.intent, language: event.language, actions: event.actions, sources: event.sources, general: event.general, confidence: event.confidence, conflict: event.conflict });
          if (event.type === 'token') update(botId, (m) => ({ text: m.text + event.text }));
          if (event.type === 'done') update(botId, (m) => ({ pending: false, text: event.answer, actions: [...(m.actions || []), ...(event.actions || [])] }));
        }
      }
    } catch (error) {
      if (error.name !== 'AbortError') update(botId, { text: t('chat_error'), pending: false, actions: [{ type: 'CALL_HELPLINE', phone: '8888006666' }] });
    } finally {
      update(botId, { pending: false });
      setBusy(false);
    }
  };

  const registerComplaint = (text) => {
    navigate('/report', { state: { complaint: text, chatSessionId: sessionId, fromChat: Date.now() } });
    setOpen(false);
  };

  const openService = (actionItem) => {
    postJson('/event', { sessionId, type: 'service_click' }).catch(() => {});
    if (actionItem.internal) {
      navigate(actionItem.url);
      setOpen(false);
    } else {
      window.open(actionItem.url, '_blank', 'noopener,noreferrer');
    }
  };

  const addStatusForm = (ticketNumber = '') => {
    setMessages((list) => [...list, { id: crypto.randomUUID(), role: 'assistant', text: t('chat_status_prompt'), statusForm: { ticketNumber } }]);
  };

  const suggestion = (key) => {
    if (key === 'register') return registerComplaint('');
    if (key === 'track') return addStatusForm();
    return send(t(`chat_suggest_${key}`));
  };

  const renderAction = (a, m, i) => {
    switch (a.type) {
      case 'OPEN_SERVICE':
        return <button key={i} type="button" className="chat-action" onClick={() => openService(a)}><ExternalLink size={13} /> {a.label || t('chat_open_service')}</button>;
      case 'REGISTER_COMPLAINT':
        return <button key={i} type="button" className="chat-action primary" onClick={() => registerComplaint(a.text)}><FilePlus size={13} /> {t('chat_register')}</button>;
      case 'CONTINUE_CHAT':
        return <button key={i} type="button" className="chat-action" onClick={() => inputRef.current?.focus()}>{t('chat_continue')}</button>;
      case 'CALL_HELPLINE':
        return <a key={i} className="chat-action" href={`tel:${a.phone}`}><Phone size={13} /> {t('chat_call', { phone: a.phone })}</a>;
      case 'SUGGEST':
        return <button key={i} type="button" className="chat-action" onClick={() => suggestion(a.key)}>{t(`chat_chip_${a.key}`)}</button>;
      case 'CHECK_STATUS':
        return m.statusShown ? null : (
          <StatusForm key={i} initialTicket={a.ticketNumber} language={m.language} sessionId={sessionId} uiLanguage={i18n.language}
            onResult={(data) => update(m.id, { statusShown: true, status: data })} />
        );
      default:
        return null;
    }
  };

  const chips = ['property_tax', 'water', 'register', 'track'];

  return (
    <>
      {!open && (
        <button type="button" className="chat-launcher" onClick={() => setOpen(true)} aria-label={t('chat_open')}>
          <MessageCircle size={22} /> <span>{t('chat_open')}</span>
        </button>
      )}
      {open && (
        <section className="chat-panel" role="dialog" aria-label={t('chat_title')}>
          <header className="chat-header">
            <span className="chat-avatar"><LogoMark size={30} /></span>
            <div><strong>{t('chat_title')}</strong><span>{t('chat_subtitle')}</span></div>
            <button type="button" className="chat-close" onClick={() => setOpen(false)} aria-label={t('close')}><X size={18} /></button>
          </header>

          <div className="chat-messages" ref={listRef} aria-live="polite">
            <div className="chat-bubble assistant">
              <p>{t('chat_welcome')}</p>
              <div className="chat-actions">
                {chips.map((key) => <button key={key} type="button" className="chat-action" onClick={() => suggestion(key)}>{t(`chat_chip_${key}`)}</button>)}
              </div>
            </div>

            {messages.map((m) => (
              <div key={m.id} className={`chat-bubble ${m.role}`}>
                {m.pending && !m.text ? <p className="chat-typing"><Loader size={14} className="spin" /> {t('chat_thinking')}</p> : <p>{m.text}</p>}
                {m.status && (<><p className="chat-status-intro">{m.status.intro}</p><StatusCard complaint={m.status.complaint} /></>)}
                {m.statusForm && !m.status && (
                  <StatusForm initialTicket={m.statusForm.ticketNumber} sessionId={sessionId} uiLanguage={i18n.language}
                    onResult={(data) => update(m.id, { status: data })} />
                )}
                {!m.pending && m.actions?.length > 0 && (
                  <div className="chat-actions">{m.actions.map((a, i) => renderAction(a, m, i))}</div>
                )}
                {!m.pending && m.general && <p className="chat-sources chat-general"><Info size={12} /> {t('chat_general_label')}</p>}
                {!m.pending && m.sources?.length > 0 && (
                  <div className="chat-sources chat-citations">
                    <span className="chat-source-head"><ShieldCheck size={12} /> {t('chat_source')}</span>
                    <ol>
                      {m.sources.map((s) => (
                        <li key={s.id}>
                          {s.sourceUrl?.startsWith('http') ? <a href={s.sourceUrl} target="_blank" rel="noreferrer">{s.title || s.source}</a> : (s.title || s.source)}
                          <span className="chat-source-meta">
                            {s.publishedDate && <> · {t('chat_dated', { date: s.publishedDate })}</>}
                            {s.extraction === 'ocr' && <> · {t('chat_scanned')}</>}
                            {s.lastVerified && <> · {t('chat_verified', { date: s.lastVerified })}</>}
                          </span>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
                {!m.pending && m.conflict && <p className="chat-sources chat-general"><Info size={12} /> {t('chat_conflict_note')}</p>}
                {!m.pending && !m.conflict && m.confidence === 'MEDIUM' && <p className="chat-sources chat-general"><Info size={12} /> {t('chat_medium_note')}</p>}
              </div>
            ))}
          </div>

          <form className="chat-input" onSubmit={(e) => { e.preventDefault(); send(input); }}>
            <input ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} placeholder={t('chat_placeholder')} maxLength={1000} disabled={busy} aria-label={t('chat_placeholder')} />
            <button type="submit" disabled={busy || !input.trim()} aria-label={t('chat_send')}>{busy ? <Loader size={16} className="spin" /> : <Send size={16} />}</button>
          </form>
          <p className="chat-disclaimer">{t('chat_disclaimer')}</p>
        </section>
      )}
    </>
  );
}
