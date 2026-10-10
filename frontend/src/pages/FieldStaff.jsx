import { useEffect, useState } from 'react';
import { HardHat, Plus, Phone, Loader, UserX, UserCheck, AlertCircle } from 'lucide-react';
import useLabels from '../hooks/useLabels';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useMeta } from '../context/MetaContext';

export default function FieldStaff() {
  const L = useLabels();
  const { t } = L;
  const { officer } = useAuth();
  const { departments = [], zones } = useMeta();
  const isAdmin = officer?.role === 'admin';
  const [workers, setWorkers] = useState(null);
  const [form, setForm] = useState({ name: '', phone: '', department: officer?.department || '', zone: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = () => api.get('/staff').then(({ data }) => setWorkers(data.workers || [])).catch(() => setWorkers([]));
  useEffect(() => { load(); }, []);

  const add = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.post('/staff', { ...form, zone: form.zone || undefined });
      setForm((f) => ({ ...f, name: '', phone: '' }));
      load();
    } catch (err) {
      setError(err.response?.data?.message || t('staff_failed'));
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (w) => {
    try {
      await api.patch(`/staff/${w._id}`, { active: !w.active });
      load();
    } catch (err) {
      alert(err.response?.data?.message || t('staff_failed'));
    }
  };

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="page-container staff-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">{t('staff_eyebrow')}</p>
          <h1 className="page-title">{t('staff_title')}</h1>
          <p className="page-subtitle">{t('staff_subtitle')}</p>
        </div>
      </header>

      {isAdmin && (
        <form className="card staff-form" onSubmit={add}>
          <h3 className="card-title"><Plus size={18} color="var(--primary)" /> {t('staff_add')}</h3>
          {error && <div className="alert"><AlertCircle size={16} /> {error}</div>}
          <div className="staff-form-grid">
            <div className="form-group"><label htmlFor="sw-name">{t('staff_name')}</label><input id="sw-name" value={form.name} onChange={set('name')} required maxLength={80} /></div>
            <div className="form-group"><label htmlFor="sw-phone">{t('staff_phone')}</label><input id="sw-phone" value={form.phone} onChange={set('phone')} maxLength={20} inputMode="tel" /></div>
            <div className="form-group">
              <label htmlFor="sw-dept">{t('label_department')}</label>
              <select id="sw-dept" value={form.department} onChange={set('department')} required>
                <option value="">{t('staff_choose_dept')}</option>
                {departments.filter((d) => !d.external).map((d) => <option key={d.id} value={d.id}>{L.department(d.id)}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="sw-zone">{t('label_zone')}</label>
              <select id="sw-zone" value={form.zone} onChange={set('zone')}>
                <option value="">{t('staff_any_zone')}</option>
                {Object.entries(zones).map(([id, z]) => <option key={id} value={id}>{id} – {z.name}</option>)}
              </select>
            </div>
          </div>
          <button type="submit" className="button" disabled={saving}>{saving ? <Loader size={16} className="spin" /> : <Plus size={16} />} {t('staff_add_btn')}</button>
        </form>
      )}

      <div className="card kb-card">
        {workers === null ? <p className="form-note staff-pad"><Loader size={14} className="spin" /> {t('loading')}</p> : (
          <ul className="staff-list">
            {workers.map((w) => (
              <li key={w._id} className={w.active ? '' : 'inactive'}>
                <span className="staff-avatar"><HardHat size={18} /></span>
                <div className="staff-main">
                  <strong>{w.name}{!w.active && <span className="kb-badge disabled">{t('staff_inactive')}</span>}</strong>
                  <span className="kb-meta">
                    <span>{L.department(w.department)}</span>
                    {w.zone && <span>{t('label_zone')} {w.zone}</span>}
                    {w.phone && <span><Phone size={11} /> {w.phone}</span>}
                  </span>
                </div>
                <span className={`staff-load ${w.openTickets >= 8 ? 'high' : ''}`}>{t('staff_open_tickets', { count: w.openTickets })}</span>
                {isAdmin && (
                  <button type="button" className={`kb-act ${w.active ? 'bad' : 'good'}`} onClick={() => toggle(w)}>
                    {w.active ? <UserX size={14} /> : <UserCheck size={14} />} {t(w.active ? 'staff_deactivate' : 'staff_activate')}
                  </button>
                )}
              </li>
            ))}
            {workers.length === 0 && <li className="empty-state">{t(isAdmin ? 'staff_empty_admin' : 'staff_empty')}</li>}
          </ul>
        )}
      </div>
    </div>
  );
}
