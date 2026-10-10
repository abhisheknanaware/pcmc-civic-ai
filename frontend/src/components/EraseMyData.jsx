import { useState } from 'react';
import { ShieldOff, Loader, CheckCircle, AlertCircle } from 'lucide-react';
import useLabels from '../hooks/useLabels';
import api from '../services/api';

// Citizen's right to have their personal data removed. Uses the same ticket + email proof as tracking.
export default function EraseMyData({ ticketNumber, email }) {
  const { t } = useLabels();
  const [open, setOpen] = useState(false);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [error, setError] = useState('');

  const erase = async () => {
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post('/complaints/erase', { ticketNumber, email, confirm: true });
      setDone(data.erased);
    } catch (err) {
      setError(err.response?.data?.message || t('erase_failed'));
    } finally {
      setBusy(false);
    }
  };

  if (done !== null) {
    return <div className="card erase-card done"><CheckCircle size={18} /> {t('erase_done', { count: done })}</div>;
  }

  return (
    <div className="card erase-card">
      {!open ? (
        <button type="button" className="erase-link" onClick={() => setOpen(true)}><ShieldOff size={15} /> {t('erase_open')}</button>
      ) : (
        <>
          <h3 className="card-title"><ShieldOff size={18} color="var(--danger, #b4332a)" /> {t('erase_title')}</h3>
          <p className="form-note">{t('erase_explain')}</p>
          <ul className="erase-points">
            <li>{t('erase_point_removed')}</li>
            <li>{t('erase_point_kept')}</li>
            <li>{t('erase_point_updates')}</li>
          </ul>
          <label className="erase-agree"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> {t('erase_agree')}</label>
          {error && <div className="alert"><AlertCircle size={16} /> {error}</div>}
          <div className="erase-actions">
            <button type="button" className="button danger" disabled={!agree || busy} onClick={erase}>
              {busy ? <Loader size={15} className="spin" /> : <ShieldOff size={15} />} {t('erase_confirm')}
            </button>
            <button type="button" className="button secondary" onClick={() => { setOpen(false); setAgree(false); }}>{t('erase_cancel')}</button>
          </div>
        </>
      )}
    </div>
  );
}
