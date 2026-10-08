import { useEffect, useMemo, useState } from 'react';
import {
  BookOpen, ShieldCheck, Ban, ScanText, MessageCircleQuestion, Search, Loader, ExternalLink, CheckCircle2, RotateCcw,
  Archive, AlertCircle, FileText,
} from 'lucide-react';
import useLabels from '../hooks/useLabels';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';

const CATEGORIES = ['curated', 'citizen_charter', 'info_page', 'department_info', 'policy', 'circular', 'rti_department', 'home'];
const PAGE = 40;

export default function KnowledgeBase() {
  const L = useLabels();
  const { t } = L;
  const { officer } = useAuth();
  const isAdmin = officer?.role === 'admin';
  const [tab, setTab] = useState('documents');
  const [documents, setDocuments] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('ALL');
  const [status, setStatus] = useState('ALL');
  const [limit, setLimit] = useState(PAGE);
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    Promise.allSettled([api.get('/kb/documents'), api.get('/kb/unanswered')]).then(([docs, unanswered]) => {
      if (docs.status === 'fulfilled') setDocuments(docs.value.data.documents || []);
      else setError(docs.reason?.response?.data?.message || t('kb_load_failed'));
      if (unanswered.status === 'fulfilled') setQuestions(unanswered.value.data.questions || []);
      setLoading(false);
    });
  }, [t]);

  const stats = useMemo(() => ({
    total: documents.length,
    verified: documents.filter((d) => d.verified).length,
    hidden: documents.filter((d) => d.status !== 'active').length,
    ocr: documents.filter((d) => d.extraction === 'ocr').length,
  }), [documents]);

  const needle = query.trim().toLowerCase();
  const filtered = documents.filter((d) =>
    (category === 'ALL' || d.category === category) &&
    (status === 'ALL' || (status === 'verified' ? d.verified : status === 'unverified' ? !d.verified : d.status === status)) &&
    (!needle || [d.title, d.titleEn, d.department, d.url, d.preview].some((v) => v && v.toLowerCase().includes(needle))));

  const review = async (doc, change) => {
    setBusy(doc.id);
    try {
      const { data } = await api.patch(`/kb/documents/${doc.id}`, change);
      setDocuments((list) => list.map((d) => (d.id === doc.id ? data : d)));
    } catch (err) {
      alert(err.response?.data?.message || t('kb_update_failed'));
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <div className="page-loading"><Loader className="spin" size={28} /> {t('kb_loading')}</div>;

  return (
    <div className="page-container kb-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">{t('kb_eyebrow')}</p>
          <h1 className="page-title">{t('kb_title')}</h1>
          <p className="page-subtitle">{t('kb_subtitle')}</p>
        </div>
      </header>

      {error && <div className="alert"><AlertCircle size={18} /> {error}</div>}

      <div className="kb-stats">
        {[
          { icon: BookOpen, label: t('kb_stat_documents'), value: stats.total, tone: 'teal' },
          { icon: ShieldCheck, label: t('kb_stat_verified'), value: stats.verified, tone: 'green' },
          { icon: Ban, label: t('kb_stat_hidden'), value: stats.hidden, tone: 'rose' },
          { icon: ScanText, label: t('kb_stat_ocr'), value: stats.ocr, tone: 'amber' },
          { icon: MessageCircleQuestion, label: t('kb_stat_unanswered'), value: questions.length, tone: 'sky' },
        ].map(({ icon: Icon, label, value, tone }) => (
          <div key={label} className={`kb-stat tone-${tone}`}>
            <span className="kb-stat-icon"><Icon size={18} /></span>
            <strong>{L.number(value)}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>

      <div className="kb-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'documents'} className={tab === 'documents' ? 'active' : ''} onClick={() => setTab('documents')}>
          <FileText size={16} /> {t('kb_tab_documents')}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'questions'} className={tab === 'questions' ? 'active' : ''} onClick={() => setTab('questions')}>
          <MessageCircleQuestion size={16} /> {t('kb_tab_questions')} <span className="kb-tab-count">{questions.length}</span>
        </button>
      </div>

      {tab === 'documents' ? (
        <div className="card kb-card">
          <div className="kb-toolbar">
            <div className="dash-search">
              <Search size={17} />
              <input type="search" value={query} onChange={(e) => { setQuery(e.target.value); setLimit(PAGE); }} placeholder={t('kb_search')} aria-label={t('kb_search')} />
            </div>
            <select value={category} onChange={(e) => { setCategory(e.target.value); setLimit(PAGE); }} aria-label={t('kb_filter_category')}>
              <option value="ALL">{t('kb_all_categories')}</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{t(`kb_cat_${c}`)}</option>)}
            </select>
            <select value={status} onChange={(e) => { setStatus(e.target.value); setLimit(PAGE); }} aria-label={t('kb_filter_status')}>
              <option value="ALL">{t('kb_all_statuses')}</option>
              <option value="verified">{t('kb_verified')}</option>
              <option value="unverified">{t('kb_unverified')}</option>
              <option value="active">{t('kb_status_active')}</option>
              <option value="disabled">{t('kb_status_disabled')}</option>
              <option value="superseded">{t('kb_status_superseded')}</option>
            </select>
            <span className="dash-count">{t('dash_showing', { shown: Math.min(limit, filtered.length), total: filtered.length })}</span>
          </div>
          {!isAdmin && <p className="form-note kb-readonly">{t('kb_admin_only')}</p>}

          <ul className="kb-list">
            {filtered.slice(0, limit).map((d) => (
              <li key={d.id} className={`kb-doc status-${d.status} ${d.verified ? 'is-verified' : ''}`}>
                <div className="kb-doc-main">
                  <div className="kb-doc-head">
                    <strong>{d.title}</strong>
                    {d.verified && <span className="kb-badge verified"><ShieldCheck size={12} /> {t('kb_verified')}</span>}
                    {d.status !== 'active' && <span className={`kb-badge ${d.status}`}>{t(`kb_status_${d.status}`)}</span>}
                  </div>
                  {d.titleEn && d.titleEn !== d.title && <span className="kb-doc-en">{d.titleEn}</span>}
                  <div className="kb-meta">
                    <span>{t(`kb_cat_${d.category}`, { defaultValue: d.category })}</span>
                    {d.department && <span>{L.department(d.department)}</span>}
                    {d.language && <span>{d.language.toUpperCase()}</span>}
                    {d.extraction === 'ocr' && <span className="ocr">{t('kb_ocr', { pct: Math.round((d.ocrConfidence || 0) * 100) })}</span>}
                    {d.publishedDate && <span>{t('chat_dated', { date: d.publishedDate })}</span>}
                    <span>{t('kb_chunks', { count: d.chunks })}</span>
                    {d.reviewedBy && <span>{t('kb_reviewed', { who: d.reviewedBy, date: (d.reviewedAt || '').slice(0, 10) })}</span>}
                  </div>
                  <p className="kb-preview">{d.preview}</p>
                </div>
                <div className="kb-actions">
                  {d.url?.startsWith('http') && <a href={d.url} target="_blank" rel="noreferrer" className="dash-view"><ExternalLink size={14} /> {t('kb_source')}</a>}
                  {isAdmin && (
                    <>
                      <button type="button" className={`kb-act ${d.verified ? '' : 'good'}`} disabled={busy === d.id} onClick={() => review(d, { verified: !d.verified })}>
                        {busy === d.id ? <Loader size={14} className="spin" /> : <CheckCircle2 size={14} />} {t(d.verified ? 'kb_unverify' : 'kb_verify')}
                      </button>
                      {d.status === 'active' ? (
                        <>
                          <button type="button" className="kb-act warn" disabled={busy === d.id} onClick={() => review(d, { status: 'superseded' })}><Archive size={14} /> {t('kb_supersede')}</button>
                          <button type="button" className="kb-act bad" disabled={busy === d.id} onClick={() => review(d, { status: 'disabled' })}><Ban size={14} /> {t('kb_disable')}</button>
                        </>
                      ) : (
                        <button type="button" className="kb-act" disabled={busy === d.id} onClick={() => review(d, { status: 'active' })}><RotateCcw size={14} /> {t('kb_restore')}</button>
                      )}
                    </>
                  )}
                </div>
              </li>
            ))}
            {filtered.length === 0 && <li className="empty-state">{t('kb_no_documents')}</li>}
          </ul>
          {filtered.length > limit && (
            <button type="button" className="button secondary kb-more" onClick={() => setLimit((n) => n + PAGE)}>{t('kb_show_more')}</button>
          )}
        </div>
      ) : (
        <div className="card kb-card">
          <p className="form-note kb-q-intro">{t('kb_questions_intro')}</p>
          <ul className="kb-questions">
            {questions.map((q) => (
              <li key={q.question}>
                <span className="kb-q-count" title={t('kb_times_asked')}>{q.count}×</span>
                <div>
                  <strong>{q.question}</strong>
                  <span className="kb-meta">
                    {q.topic && <span>{q.topic.replace(/_/g, ' ')}</span>}
                    {q.language && <span>{q.language}</span>}
                    {q.lastAsked && <span>{t('kb_last_asked', { date: L.date(q.lastAsked, { dateStyle: 'medium' }) })}</span>}
                  </span>
                </div>
              </li>
            ))}
            {questions.length === 0 && <li className="empty-state">{t('kb_no_questions')}</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
