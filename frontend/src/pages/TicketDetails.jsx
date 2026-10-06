import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Bot, Save, AlertCircle, RefreshCw, Loader, Zap, Clock, ChevronRight, Languages, Square } from 'lucide-react';
import useLabels from '../hooks/useLabels';
import { API_BASE, PRIORITIES, STATUSES } from '../constants';
import api, { authFetch } from '../services/api';
import { useMeta } from '../context/MetaContext';

const shortId = (id) => id.slice(-6);
const GENERATING = 'Generating smart reply...';
const REPLY_LANGUAGES = ['auto', 'English', 'Hindi', 'Marathi', 'Hinglish'];

export default function TicketDetails() {
  const L = useLabels();
  const { t } = L;
  const { departmentIds = [], zones } = useMeta();
  const [zone, setZone] = useState('');
  const { id } = useParams();
  const navigate = useNavigate();
  const [complaint, setComplaint] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editedReply, setEditedReply] = useState('');
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [department, setDepartment] = useState('');

  const [isSaving, setIsSaving] = useState(false);
  const [replyLanguage, setReplyLanguage] = useState('auto');
  const [streaming, setStreaming] = useState(false);
  const [replyMeta, setReplyMeta] = useState(null);
  const [translating, setTranslating] = useState(false);
  const abortRef = useRef(null);
  const streamingRef = useRef(false);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    fetchComplaint();
  }, [id]);

  useEffect(() => {
    let interval;
    if (complaint && (complaint.generatedReply === GENERATING || complaint.category === 'Processing...')) {
      interval = setInterval(() => {
        fetchComplaint(true);
      }, 2500);
    }
    return () => clearInterval(interval);
  }, [complaint, id]);

  const fetchComplaint = async (isPolling = false) => {
    try {
      if (!isPolling) setLoading(true);
      const response = await api.get('/complaints');
      const found = response.data.find(c => c._id === id);
      if (found) {
        setComplaint(found);
        if (!streamingRef.current) setEditedReply(found.finalReply || found.generatedReply || '');
        if (!isPolling) {
          setStatus(found.status || 'OPEN');
          setPriority(found.priority || 'P3');
          setDepartment(found.department || 'Zonal Office');
          setZone(found.zone || '');
        }
      }
    } catch (error) {
      console.error('Failed to fetch complaint:', error);
    } finally {
      if (!isPolling) setLoading(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const { data } = await api.patch(`/complaints/${id}`, {
        finalReply: editedReply === GENERATING ? '' : editedReply,
        status,
        priority,
        department,
        zone: zone || null,
        sendEmail: true
      });
      const replyToSend = editedReply && editedReply !== GENERATING;
      alert(t(data.emailSent ? 'ticket_updated_email' : replyToSend ? 'ticket_email_failed' : 'ticket_updated'));
      fetchComplaint();
    } catch (error) {
      console.error('Error updating ticket:', error);
      alert(t('ticket_update_failed'));
    } finally {
      setIsSaving(false);
    }
  };

  // Streams the reply token by token (NDJSON) so the officer sees text within about a second.
  const handleGenerateReply = async (regenerate = false) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    streamingRef.current = true;
    setStreaming(true);
    setReplyMeta(null);
    setEditedReply('');
    const started = performance.now();
    let text = '';
    let final = null;

    try {
      const response = await authFetch(`/complaints/${id}/generate-reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: replyLanguage, regenerate, stream: true }),
        signal: controller.signal,
      });
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
          if (event.error) throw new Error(event.error);
          if (event.reset) text = '';
          if (event.token) text += event.token;
          if (event.done) final = event;
          setEditedReply(final ? final.generatedReply : text);
        }
      }
      if (!final) throw new Error('Stream ended early');
      setReplyMeta({ language: final.replyLanguage, fallback: final.fallback, seconds: (performance.now() - started) / 1000 });
      setComplaint((c) => ({ ...c, generatedReply: final.generatedReply, replyLanguage: final.replyLanguage }));
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.error('Failed to generate reply:', error);
        alert(t('reply_failed'));
      }
      setEditedReply(text || complaint.finalReply || complaint.generatedReply || '');
    } finally {
      streamingRef.current = false;
      setStreaming(false);
    }
  };

  const handleTranslate = async () => {
    setTranslating(true);
    try {
      const { data } = await api.post(`/complaints/${id}/translate`);
      setComplaint((c) => ({ ...c, translatedText: data.translatedText }));
    } catch (error) {
      console.error('Failed to translate complaint:', error);
      alert(t('translate_failed'));
    } finally {
      setTranslating(false);
    }
  };

  if (loading) return <div className="page-loading"><Loader className="spin" size={28} /> {t('loading_ticket')}</div>;
  if (!complaint) return <div className="page-container"><p className="empty-state">{t('ticket_not_found')}</p></div>;

  const slaMissed = complaint.slaDeadline && new Date(complaint.slaDeadline) < new Date();
  const departmentOptions = departmentIds.includes(department) ? departmentIds : [department, ...departmentIds];
  const citizenLanguage = complaint.language && complaint.language !== 'Processing...' ? complaint.language : 'English';
  const showTranslation = !['English', 'Unknown', 'Processing...'].includes(complaint.language || 'English');
  const backgroundDrafting = editedReply === GENERATING;
  const hasReply = editedReply && !backgroundDrafting;
  const draftLanguage = replyMeta?.language || complaint.replyLanguage;

  return (
    <div className="page-container ticket-detail-page" style={{ maxWidth: '1120px' }}>
      <header className="page-header">
        <div>
          <p className="eyebrow">{t('ticket_eyebrow')}</p>
          <h1 className="page-title">{t('ticket_title', { id: complaint.ticketNumber || shortId(complaint._id) })}</h1>
          <p className="page-subtitle">{t('submitted_by', { name: complaint.userName, email: complaint.userEmail })}</p>
        </div>
        <div className="flex gap-2 header-actions">
          <button className="btn btn-secondary" onClick={() => navigate('/dashboard')}>{t('back_workspace')}</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={isSaving}>
            {isSaving ? <RefreshCw size={16} className="spin" /> : <Save size={16} />}
            {t('save_changes')}
          </button>
        </div>
      </header>

      <div className="split-layout">
        <div className="stack">
          <div className="card">
            <h3 className="card-title">{t('original_request')}</h3>
            <p className="request-copy">{complaint.originalText}</p>

            {showTranslation && (
              <section className="detail-section translation-section">
                <h4 className="detail-label"><Languages size={14} /> {t('translation_title', { lang: L.language(citizenLanguage) })}</h4>
                {complaint.translatedText ? (
                  <p className="translation-copy">{complaint.translatedText}</p>
                ) : backgroundDrafting ? (
                  <p className="form-note"><Loader size={13} className="spin" /> {t('translating')}</p>
                ) : (
                  <button type="button" className="btn btn-secondary small" onClick={handleTranslate} disabled={translating}>
                    {translating ? <Loader size={14} className="spin" /> : <Languages size={14} />} {t(translating ? 'translating' : 'translate_btn')}
                  </button>
                )}
              </section>
            )}

            {complaint.imageUrl && (
              <section className="detail-section">
                <h4 className="detail-label">{t('evidence_photo')}</h4>
                <a href={complaint.imageUrl} target="_blank" rel="noreferrer" className="evidence-photo">
                  <img src={complaint.imageUrl} alt={t('evidence_photo')} />
                </a>
              </section>
            )}

            {complaint.sanitizedText && (
              <section className="detail-section">
                <h4 className="detail-label">{t('sanitized_text')}</h4>
                <p className="sanitized-copy">{complaint.sanitizedText}</p>
              </section>
            )}

            {complaint.audioUrl && (
              <section className="detail-section">
                <h4 className="detail-label">{t('audio_attachment')}</h4>
                <audio controls src={`${API_BASE}${complaint.audioUrl}`} className="detail-audio"></audio>
              </section>
            )}
          </div>

          <div className="card">
            <h3 className="card-title">
              <Bot size={20} color="var(--primary)" /> {t('smart_reply')}
            </h3>
            <div className="reply-toolbar">
              <div className="reply-language">
                <label htmlFor="reply-language">{t('reply_language')}</label>
                <select id="reply-language" value={replyLanguage} onChange={(e) => setReplyLanguage(e.target.value)} disabled={streaming}>
                  {REPLY_LANGUAGES.map((lng) => (
                    <option key={lng} value={lng}>{lng === 'auto' ? t('lang_auto', { lang: L.language(citizenLanguage) }) : L.language(lng)}</option>
                  ))}
                </select>
              </div>
              {streaming ? (
                <button type="button" className="btn btn-secondary" onClick={() => abortRef.current?.abort()}>
                  <Square size={14} /> {t('stop')}
                </button>
              ) : (
                <button type="button" className="btn btn-secondary" onClick={() => handleGenerateReply(Boolean(hasReply))} disabled={backgroundDrafting}>
                  {hasReply ? <RefreshCw size={15} /> : <Zap size={15} />} {t(hasReply ? 'regenerate' : 'generate_reply')}
                </button>
              )}
            </div>

            {backgroundDrafting ? (
              <div className="reply-placeholder reply-generating">
                <Loader size={24} className="spin" color="var(--primary)" />
                <span>{t('generating_reply')}</span>
              </div>
            ) : hasReply || streaming ? (
              <>
                <div className="form-group">
                  <label htmlFor="reply-text" className="reply-label">
                    <span>{t('edit_reply')}</span>
                    {streaming ? (
                      <span className="reply-status live"><Loader size={12} className="spin" /> {t('writing')}</span>
                    ) : draftLanguage && (
                      <span className="reply-status">{L.language(draftLanguage)}{replyMeta ? ` · ${t('generated_in', { s: replyMeta.seconds.toFixed(1) })}` : ''}</span>
                    )}
                  </label>
                  <textarea
                    id="reply-text"
                    rows="7"
                    value={editedReply}
                    readOnly={streaming}
                    className={streaming ? 'is-streaming' : ''}
                    onChange={(e) => setEditedReply(e.target.value)}
                  />
                  {replyMeta?.fallback && <p className="form-note reply-fallback">{t('reply_fallback')}</p>}
                </div>
                <div className="reply-actions">
                   <button className="btn btn-primary" onClick={handleSave} disabled={streaming || isSaving}>{t('approve_send')}</button>
                </div>
              </>
            ) : (
              <div className="reply-placeholder">
                <p>{t('no_reply')}</p>
                <p className="form-note">{t('reply_hint')}</p>
              </div>
            )}
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <h3 className="card-title">{t('ticket_metadata')}</h3>

            {complaint.duplicates && complaint.duplicates.length > 0 && (
              <div className="duplicate-alert">
                <div className="duplicate-alert-head">
                  <AlertCircle size={18} />
                  <div>
                    <strong>{t('duplicates_title')}</strong>
                    <p>{t('duplicates_desc', { count: complaint.duplicates.length })}</p>
                  </div>
                </div>
                <ul className="duplicate-list">
                  {[...complaint.duplicates].sort((a, b) => b.score - a.score).map(d => (
                    <li key={d.complaintId}>
                      <Link to={`/ticket/${d.complaintId}`}>
                        <span className="ticket-id">#{shortId(d.complaintId)}</span>
                        <span className={`match-score ${d.score >= 0.8 ? 'strong' : ''}`}>{t('match', { value: (d.score * 100).toFixed(0) })}</span>
                        <ChevronRight size={15} />
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="form-group">
              <label htmlFor="ticket-status">{t('label_status')}</label>
              <select id="ticket-status" value={status} onChange={(e) => setStatus(e.target.value)}>
                {STATUSES.map(s => <option key={s} value={s}>{L.status(s)}</option>)}
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="ticket-priority">{t('label_priority')}</label>
              <select id="ticket-priority" value={priority} onChange={(e) => setPriority(e.target.value)}>
                {PRIORITIES.map(p => <option key={p} value={p}>{L.priority(p)}</option>)}
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="ticket-department">{t('label_department')}</label>
              <select id="ticket-department" value={department} onChange={(e) => setDepartment(e.target.value)}>
                {departmentOptions.map(d => <option key={d} value={d}>{L.department(d)}</option>)}
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="ticket-zone">{t('label_zone')}</label>
              <select id="ticket-zone" value={zone} onChange={(e) => setZone(e.target.value)}>
                <option value="">{t('zone_unknown')}</option>
                {Object.entries(zones).map(([zid, z]) => <option key={zid} value={zid}>{zid} – {z.name}</option>)}
              </select>
            </div>

            <div className="metadata-list">
              <p><strong>{t('label_category')}</strong>{L.category(complaint.category)}</p>
              <p><strong>{t('label_subcategory')}</strong>{complaint.subcategory || t('na')}</p>
              <p><strong>{t('label_ward')}</strong>{complaint.ward && complaint.ward !== 'Unknown Ward' ? complaint.ward : t('unknown')}</p>
              <p><strong>{t('label_location')}</strong>{complaint.location?.locality || complaint.location?.address || t('not_specified')}</p>
              <p><strong>{t('label_language')}</strong>{L.language(complaint.language || 'English')}</p>
              <p><strong>{t('label_sentiment')}</strong>{L.sentiment(complaint.sentiment || 'Neutral')}</p>
              <p><strong>{t('label_urgency')}</strong>{L.urgency(complaint.urgency)}</p>
            </div>

            {complaint.slaDeadline && (
              <div className={`time-box ${slaMissed ? 'danger' : 'success'}`}>
                 <Clock size={16} />
                 <div>
                   <span className="time-box-label">{t(slaMissed ? 'deadline_missed' : 'on_track_caps')}</span>
                   <span className="time-box-value">{L.timeRemaining(complaint.slaDeadline)}</span>
                 </div>
              </div>
            )}

            {complaint.createdAt && (
              <div className="time-box">
                 <Clock size={16} />
                 <div>
                   <span className="time-box-label">{t('time_since_reported')}</span>
                   <span className="time-box-value">{L.timeSince(complaint.createdAt)}</span>
                 </div>
              </div>
            )}
          </div>

          <div className="card">
            <h3 className="card-title">{t('extracted_entities')}</h3>
            {complaint.entities && Object.keys(complaint.entities).length > 0 ? (
              <ul className="entity-list">
                {Object.entries(complaint.entities).map(([key, value]) => (
                  <li key={key}><strong>{key}:</strong> {JSON.stringify(value)}</li>
                ))}
              </ul>
            ) : (
              <p className="form-note">{t('no_entities')}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
