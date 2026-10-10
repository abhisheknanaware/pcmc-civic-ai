import { useEffect, useState } from 'react';
import { KeyRound, ShieldCheck, Loader, CheckCircle2, Circle, History, AlertCircle } from 'lucide-react';
import useLabels from '../hooks/useLabels';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';

const FILTERS = ['', 'auth.', 'complaint.', 'kb.', 'privacy.'];

function PasswordForm() {
  const { t } = useLabels();
  const { officer, passwordChanged } = useAuth();
  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const local = (officer?.email || '').split('@')[0].toLowerCase();
  const rules = [
    { ok: form.next.length >= 10, label: t('pw_rule_length') },
    { ok: /[A-Za-z]/.test(form.next) && /[0-9]/.test(form.next), label: t('pw_rule_mix') },
    { ok: form.next.length > 0 && !(local.length >= 4 && form.next.toLowerCase().includes(local)), label: t('pw_rule_email') },
    { ok: form.next.length > 0 && form.next === form.confirm, label: t('pw_rule_match') },
  ];

  const submit = async (e) => {
    e.preventDefault();
    setMessage(null);
    if (!rules.every((r) => r.ok)) { setMessage({ type: 'warn', text: t('pw_fix_rules') }); return; }
    setSaving(true);
    try {
      const { data } = await api.put('/auth/password', { currentPassword: form.current, newPassword: form.next });
      passwordChanged(data.token);
      setForm({ current: '', next: '', confirm: '' });
      setMessage({ type: 'ok', text: t('pw_changed') });
    } catch (err) {
      setMessage({ type: 'warn', text: err.response?.data?.message || t('pw_failed') });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="card account-card" onSubmit={submit}>
      <h3 className="card-title"><KeyRound size={18} color="var(--primary)" /> {t('pw_title')}</h3>
      {officer?.weakPassword && <p className="account-warn"><AlertCircle size={16} /> {t('pw_weak_warning')}</p>}
      <div className="form-group">
        <label htmlFor="pw-current">{t('pw_current')}</label>
        <input id="pw-current" type="password" autoComplete="current-password" value={form.current} onChange={set('current')} required />
      </div>
      <div className="form-group">
        <label htmlFor="pw-next">{t('pw_new')}</label>
        <input id="pw-next" type="password" autoComplete="new-password" value={form.next} onChange={set('next')} required />
      </div>
      <div className="form-group">
        <label htmlFor="pw-confirm">{t('pw_confirm')}</label>
        <input id="pw-confirm" type="password" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} required />
      </div>
      <ul className="pw-rules">
        {rules.map((r) => <li key={r.label} className={r.ok ? 'ok' : ''}>{r.ok ? <CheckCircle2 size={14} /> : <Circle size={14} />} {r.label}</li>)}
      </ul>
      {message && <p className={`picker-msg ${message.type}`}>{message.text}</p>}
      <button type="submit" className="button" disabled={saving}>{saving ? <Loader size={16} className="spin" /> : <ShieldCheck size={16} />} {t('pw_save')}</button>
      <p className="form-note">{t('pw_note')}</p>
    </form>
  );
}

function ActivityLog() {
  const L = useLabels();
  const { t } = L;
  const [filter, setFilter] = useState('');
  const [entries, setEntries] = useState(null);

  useEffect(() => {
    setEntries(null);
    api.get('/auth/audit', { params: { limit: 150, action: filter || undefined } })
      .then(({ data }) => setEntries(data.entries || []))
      .catch(() => setEntries([]));
  }, [filter]);

  return (
    <div className="card account-card account-log">
      <h3 className="card-title"><History size={18} color="var(--primary)" /> {t('audit_title')}</h3>
      <p className="form-note">{t('audit_intro')}</p>
      <div className="kb-tabs audit-filters">
        {FILTERS.map((f) => (
          <button key={f || 'all'} type="button" className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>{t(`audit_filter_${f.replace('.', '') || 'all'}`)}</button>
        ))}
      </div>
      {entries === null ? <p className="form-note"><Loader size={14} className="spin" /> {t('loading')}</p> : (
        <div className="table-scroll">
          <table className="data-table audit-table">
            <thead><tr><th>{t('audit_when')}</th><th>{t('audit_who')}</th><th>{t('audit_action')}</th><th>{t('audit_target')}</th></tr></thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e._id} className={/failed|locked/.test(e.action) ? 'audit-warn' : ''}>
                  <td>{L.date(e.at, { dateStyle: 'medium', timeStyle: 'short' })}</td>
                  <td>{e.actor}</td>
                  <td><span className="audit-action">{t(`audit_${e.action.replace(/\./g, '_')}`, { defaultValue: e.action })}</span>
                    {e.details?.status && <span className="audit-detail"> → {L.status(e.details.status)}</span>}
                    {e.details?.into && <span className="audit-detail"> → {e.details.into}</span>}</td>
                  <td>{e.target || '—'}</td>
                </tr>
              ))}
              {entries.length === 0 && <tr><td colSpan="4" className="empty-state">{t('audit_empty')}</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function Account() {
  const { t } = useLabels();
  const { officer } = useAuth();
  return (
    <div className="page-container account-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">{t('account_eyebrow')}</p>
          <h1 className="page-title">{t('account_title')}</h1>
          <p className="page-subtitle">{officer?.name} · {officer?.email} · {officer?.role === 'admin' ? t('account_role_admin') : t('account_role_agent')}</p>
        </div>
      </header>
      <div className={`account-grid ${officer?.role === 'admin' ? 'with-log' : ''}`}>
        <PasswordForm />
        {officer?.role === 'admin' && <ActivityLog />}
      </div>
    </div>
  );
}
