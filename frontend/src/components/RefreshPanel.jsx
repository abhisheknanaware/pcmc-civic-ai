import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Loader, CheckCheck, AlertCircle, CalendarClock, ChevronDown, ChevronUp, Search } from 'lucide-react';
import useLabels from '../hooks/useLabels';
import api from '../services/api';

const KINDS = [['changed', 'tone-amber'], ['added', 'tone-green'], ['removed', 'tone-rose']];

// Weekly re-crawl status: when PCMC's site was last read, what changed, and a review checkbox for officers.
export default function RefreshPanel({ isAdmin, onFind }) {
  const L = useLabels();
  const { t } = L;
  const [info, setInfo] = useState(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api.get('/kb/refresh').then(({ data }) => setInfo(data)).catch(() => setInfo({ unavailable: true })), []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!info?.running) return undefined;
    const timer = setInterval(load, 10000);
    return () => clearInterval(timer);
  }, [info?.running, load]);

  if (!info || info.unavailable) return null;

  const start = async () => {
    if (!window.confirm(t('kb_refresh_confirm'))) return;
    setBusy(true);
    try {
      await api.post('/kb/refresh');
      await load();
    } catch (err) {
      alert(err.response?.data?.message || t('kb_update_failed'));
    } finally {
      setBusy(false);
    }
  };

  const markReviewed = async () => {
    setBusy(true);
    try {
      await api.post('/kb/refresh/reviewed');
      await load();
    } catch (err) {
      alert(err.response?.data?.message || t('kb_update_failed'));
    } finally {
      setBusy(false);
    }
  };

  const counts = info.counts || {};
  const changes = (counts.added || 0) + (counts.changed || 0) + (counts.removed || 0);
  const failed = info.finishedAt && !info.ok;
  const when = (iso) => L.date(iso, { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <section className={`card refresh-panel ${changes && !info.reviewed ? 'needs-review' : ''}`}>
      <div className="refresh-head">
        <span className="refresh-icon">{info.running ? <Loader size={18} className="spin" /> : <RefreshCw size={18} />}</span>
        <div className="refresh-main">
          <strong>{t('kb_refresh_title')}</strong>
          <span className="kb-meta">
            {info.running
              ? <span>{t('kb_refresh_running', { step: t(`kb_refresh_step_${info.step}`, { defaultValue: info.step }) })}</span>
              : <span>{info.finishedAt ? t('kb_refresh_last', { when: when(info.finishedAt) }) : t('kb_refresh_never')}</span>}
            {info.nextRun && !info.running && <span><CalendarClock size={11} /> {t('kb_refresh_next', { when: when(info.nextRun) })}</span>}
            {!info.everyDays && <span>{t('kb_refresh_off')}</span>}
          </span>
        </div>
        {info.finishedAt && !info.running && (
          <div className="refresh-counts">
            {KINDS.map(([k, tone]) => <span key={k} className={`refresh-count ${tone}`}>{L.number(counts[k] || 0)} {t(`kb_refresh_${k}`)}</span>)}
          </div>
        )}
        {isAdmin && (
          <button type="button" className="button small secondary" onClick={start} disabled={busy || info.running}>
            <RefreshCw size={14} /> {t('kb_refresh_now')}
          </button>
        )}
      </div>

      {failed && (
        <div className="alert refresh-alert">
          <AlertCircle size={16} /> {t('kb_refresh_failed', { step: info.steps?.find((s) => !s.ok)?.name || '?' })}
        </div>
      )}

      {changes > 0 && !info.running && (
        <>
          <div className="refresh-review">
            <button type="button" className="refresh-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
              {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />} {t('kb_refresh_show', { count: changes })}
            </button>
            {info.reviewed
              ? <span className="refresh-reviewed"><CheckCheck size={14} /> {t('kb_refresh_reviewed', { who: info.reviewedBy || '' })}</span>
              : isAdmin && <button type="button" className="kb-act good" onClick={markReviewed} disabled={busy}><CheckCheck size={14} /> {t('kb_refresh_mark')}</button>}
          </div>
          {open && (
            <ul className="refresh-list">
              {KINDS.flatMap(([k, tone]) => (info[k] || []).map((d) => (
                <li key={`${k}-${d.doc_id}`}>
                  <span className={`refresh-count ${tone}`}>{t(`kb_refresh_${k}_one`)}</span>
                  <span className="refresh-doc">{d.title || d.url}</span>
                  {k !== 'removed' && <button type="button" className="kb-act" onClick={() => onFind(d.title || d.url)}><Search size={13} /> {t('kb_refresh_find')}</button>}
                </li>
              )))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
