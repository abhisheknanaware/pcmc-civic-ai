import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { AlertCircle, Loader, Search, CheckCircle, Clock } from 'lucide-react';
import useLabels from '../hooks/useLabels';
import { useMeta } from '../context/MetaContext';
import { getComplaintStatus } from '../services/api';

// Citizens look up their own complaint with the ticket number and the email they filed it with.
export default function TrackComplaint() {
  const L = useLabels();
  const { t } = L;
  const { zones } = useMeta();
  const location = useLocation();
  const [ticketNumber, setTicketNumber] = useState(location.state?.ticketNumber || '');
  const [email, setEmail] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setResult(null);
    try {
      setResult(await getComplaintStatus(ticketNumber.trim(), email.trim()));
    } catch (err) {
      const status = err.response?.status;
      setError(t(status === 404 ? 'track_not_found' : status === 429 ? 'too_many_requests' : 'track_failed'));
    } finally {
      setLoading(false);
    }
  };

  const closed = result && ['RESOLVED', 'CLOSED'].includes(result.status);
  const zone = result?.zone && zones[result.zone];

  return (
    <div className="submit-page">
      <div className="page-intro centered-intro">
        <p className="eyebrow">{t('pmc_title')}</p>
        <h1 className="page-title">{t('track_title')}</h1>
        <p className="page-copy">{t('track_subtitle')}</p>
      </div>

      <form className="card track-form" onSubmit={handleSubmit}>
        {error && <div className="alert"><AlertCircle size={18} /> {error}</div>}
        <div className="grid grid-2">
          <div className="form-group">
            <label htmlFor="track-ticket">{t('ticket_number_label')}</label>
            <input id="track-ticket" value={ticketNumber} onChange={(e) => setTicketNumber(e.target.value)} placeholder="PCMC-100001" required />
          </div>
          <div className="form-group">
            <label htmlFor="track-email">{t('email_label')}</label>
            <input id="track-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('email_placeholder')} required />
          </div>
        </div>
        <button className="button full" type="submit" disabled={loading}>
          {loading ? <Loader size={18} className="spin" /> : <Search size={18} />} {t('track_btn')}
        </button>
      </form>

      {result && (
        <div className="card track-result">
          <div className="track-result-head">
            <span className="ticket-id">{result.ticketNumber}</span>
            <span className={`badge ${closed ? 'success' : 'neutral'}`}>{closed ? <CheckCircle size={12} /> : <Clock size={12} />} {L.status(result.status)}</span>
          </div>
          <div className="metadata-list">
            <p><strong>{t('label_category')}</strong>{L.category(result.category)}</p>
            <p><strong>{t('label_department')}</strong>{L.department(result.department)}</p>
            <p><strong>{t('label_zone')}</strong>{zone ? `${result.zone} – ${zone.name}` : t('not_specified')}</p>
            <p><strong>{t('label_ward')}</strong>{result.ward && result.ward !== 'Unknown Ward' ? result.ward : t('unknown')}</p>
            <p><strong>{t('label_priority')}</strong>{L.priority(result.priority)}</p>
            <p><strong>{t('submitted_on')}</strong>{L.date(result.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}</p>
            <p><strong>{t('last_updated')}</strong>{L.date(result.updatedAt, { dateStyle: 'medium', timeStyle: 'short' })}</p>
            {!closed && result.slaDeadline && <p><strong>{t('expected_by')}</strong>{L.date(result.slaDeadline, { dateStyle: 'medium' })}</p>}
          </div>
          {result.finalReply && (
            <section className="detail-section">
              <h4 className="detail-label">{t('resolution_note')}</h4>
              <p className="request-copy">{result.finalReply}</p>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
