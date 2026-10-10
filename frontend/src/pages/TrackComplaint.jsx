import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  AlertCircle, Loader, Search, CheckCircle, Clock, Ticket, Mail, Building2, MapPin, Flag, CalendarPlus, RefreshCw,
  FilePlus, Wrench, CheckCircle2, Phone, MessageCircle, Tag, CalendarCheck, AlertTriangle,
} from 'lucide-react';
import useLabels from '../hooks/useLabels';
import { useMeta } from '../context/MetaContext';
import { getComplaintStatus } from '../services/api';
import ComplaintTimeline from '../components/ComplaintTimeline';
import FeedbackForm from '../components/FeedbackForm';
import StarRating from '../components/StarRating';

// Progress shown on the result banner; WAITING_FOR_CUSTOMER sits with "in progress".
const STAGES = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED'];
const stageIndex = (status) => {
  if (status === 'CLOSED') return 3;
  if (status === 'WAITING_FOR_CUSTOMER') return 2;
  return Math.max(0, STAGES.indexOf(status));
};
const TONE = { OPEN: 'sky', ASSIGNED: 'violet', IN_PROGRESS: 'amber', WAITING_FOR_CUSTOMER: 'rose', RESOLVED: 'green', CLOSED: 'green' };

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
  const [feedbackMessage, setFeedbackMessage] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setResult(null);
    setFeedbackMessage('');
    try {
      setResult(await getComplaintStatus(ticketNumber.trim(), email.trim()));
    } catch (err) {
      const status = err.response?.status;
      setError(t(status === 404 ? 'track_not_found' : status === 429 ? 'too_many_requests' : 'track_failed'));
    } finally {
      setLoading(false);
    }
  };

  const status = result?.status || 'OPEN';
  const closed = ['RESOLVED', 'CLOSED'].includes(status);
  const zone = result?.zone && zones[result.zone];
  const stage = stageIndex(status);
  const overdue = result && !closed && result.slaDeadline && new Date(result.slaDeadline) < new Date();
  const fmt = (d) => L.date(d, { dateStyle: 'medium', timeStyle: 'short' });

  const details = result ? [
    { icon: Building2, label: t('label_department'), value: L.department(result.department) },
    { icon: MapPin, label: t('label_zone'), value: zone ? `${result.zone} – ${zone.name}` : t('not_specified') },
    { icon: MapPin, label: t('label_ward'), value: result.ward && result.ward !== 'Unknown Ward' ? result.ward : t('unknown') },
    { icon: Flag, label: t('label_priority'), value: L.priority(result.priority) },
    { icon: CalendarPlus, label: t('submitted_on'), value: fmt(result.createdAt) },
    { icon: RefreshCw, label: t('last_updated'), value: fmt(result.updatedAt) },
  ] : [];

  return (
    <div className="track-page">
      <section className="track-hero">
        <div className="page-intro centered-intro">
          <p className="eyebrow">{t('pmc_title')}</p>
          <h1 className="page-title">{t('track_title')}</h1>
          <p className="page-copy">{t('track_subtitle')}</p>
        </div>

        <form className="track-search" onSubmit={handleSubmit}>
          <label className="track-field">
            <span>{t('ticket_number_label')}</span>
            <span className="track-input"><Ticket size={18} />
              <input id="track-ticket" value={ticketNumber} onChange={(e) => setTicketNumber(e.target.value)} placeholder="PCMC-100001" required autoComplete="off" />
            </span>
          </label>
          <label className="track-field">
            <span>{t('email_label')}</span>
            <span className="track-input"><Mail size={18} />
              <input id="track-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('email_placeholder')} required autoComplete="email" />
            </span>
          </label>
          <button className="button track-submit" type="submit" disabled={loading}>
            {loading ? <Loader size={18} className="spin" /> : <Search size={18} />} {t('track_btn')}
          </button>
          <p className="track-hint">{t('track_hint')}</p>
          {error && <div className="alert track-error"><AlertCircle size={18} /> {error}</div>}
        </form>
      </section>

      {!result && (
        <section className="track-empty">
          <div className="track-how">
            {[
              { icon: FilePlus, title: t('timeline_reported'), text: t('track_how_reported') },
              { icon: Wrench, title: L.status('IN_PROGRESS'), text: t('track_how_progress') },
              { icon: CheckCircle2, title: L.status('RESOLVED'), text: t('track_how_resolved') },
            ].map(({ icon: Icon, title, text }, i) => (
              <div key={title} className="track-how-step" style={{ '--delay': `${i * 80}ms` }}>
                <span className="track-how-num">{i + 1}</span>
                <span className="track-how-icon"><Icon size={20} /></span>
                <strong>{title}</strong>
                <p>{text}</p>
              </div>
            ))}
          </div>
          <div className="track-help">
            <strong>{t('track_help_title')}</strong>
            <p>{t('track_help_text')}</p>
            <div className="track-help-actions">
              <a className="button secondary" href="tel:8888006666"><Phone size={16} /> Sarathi 8888006666</a>
              <Link className="button secondary" to="/ask"><MessageCircle size={16} /> {t('nav_ask')}</Link>
            </div>
          </div>
        </section>
      )}

      {result && (
        <section className="track-result-v2">
          <div className={`track-banner tone-${TONE[status] || 'sky'}`}>
            <div className="track-banner-top">
              <div>
                <span className="track-banner-ticket">{result.ticketNumber}</span>
                <h2><Tag size={20} /> {L.category(result.category)}</h2>
              </div>
              <span className="track-banner-status">{closed ? <CheckCircle size={16} /> : <Clock size={16} />} {L.status(status)}</span>
            </div>

            <div className="track-stepper" aria-label={t('timeline_title')}>
              <div className="track-stepper-bar"><span style={{ width: `${(stage / (STAGES.length - 1)) * 100}%` }} /></div>
              {STAGES.map((s, i) => (
                <div key={s} className={`track-stepper-step ${i <= stage ? 'done' : ''} ${i === stage ? 'current' : ''}`}>
                  <span className="track-stepper-dot">{i < stage || closed ? <CheckCircle size={14} /> : i + 1}</span>
                  <span className="track-stepper-label">{s === 'OPEN' ? t('timeline_reported') : L.status(s)}</span>
                </div>
              ))}
            </div>

            <div className={`track-eta ${closed ? 'done' : overdue ? 'late' : ''}`}>
              {closed ? <CalendarCheck size={18} /> : overdue ? <AlertTriangle size={18} /> : <Clock size={18} />}
              <span>
                {closed ? t('track_resolved_on', { date: L.date(result.resolvedAt || result.updatedAt, { dateStyle: 'long' }) })
                  : result.slaDeadline ? t(overdue ? 'track_overdue_since' : 'track_expected_by', { date: L.date(result.slaDeadline, { dateStyle: 'long' }) })
                  : t('track_no_eta')}
              </span>
            </div>
          </div>

          <div className="track-columns">
            <div className="track-main">
              <div className="card">
                <h3 className="card-title">{t('track_details')}</h3>
                <div className="track-details">
                  {details.map(({ icon: Icon, label, value }) => (
                    <div key={label} className="track-detail">
                      <span className="track-detail-icon"><Icon size={16} /></span>
                      <div><span>{label}</span><strong>{value}</strong></div>
                    </div>
                  ))}
                </div>
                {(result.imageUrl || result.resolutionImageUrl) && (
                  <section className="before-after">
                    <h4 className="detail-label">{t(result.resolutionImageUrl && result.imageUrl ? 'proof_before_after' : result.resolutionImageUrl ? 'proof_after_title' : 'evidence_photo')}</h4>
                    <div className={`before-after-grid ${result.resolutionImageUrl && result.imageUrl ? 'pair' : ''}`}>
                      {result.imageUrl && (
                        <a href={result.imageUrl} target="_blank" rel="noreferrer" className="ba-photo">
                          <img src={result.imageUrl} alt={t('proof_before')} />
                          <span className="ba-tag before">{t('proof_before')}</span>
                        </a>
                      )}
                      {result.resolutionImageUrl && (
                        <a href={result.resolutionImageUrl} target="_blank" rel="noreferrer" className="ba-photo">
                          <img src={result.resolutionImageUrl} alt={t('proof_after')} />
                          <span className="ba-tag after">{t('proof_after')}</span>
                        </a>
                      )}
                    </div>
                  </section>
                )}
                {result.finalReply && (
                  <section className="track-reply">
                    <h4 className="detail-label">{t('resolution_note')}</h4>
                    <p>{result.finalReply}</p>
                  </section>
                )}
              </div>

              {feedbackMessage && (
                <div className={`feedback-done ${feedbackMessage}`}><CheckCircle size={18} /> {t(feedbackMessage === 'reopened' ? 'feedback_done_reopened' : 'feedback_done_thanks')}</div>
              )}
              {result.canGiveFeedback && (
                <FeedbackForm ticketNumber={result.ticketNumber} email={email.trim()}
                  onDone={(data) => { setResult(data.complaint); setFeedbackMessage(data.reopened ? 'reopened' : 'thanks'); }} />
              )}
              {!result.canGiveFeedback && !feedbackMessage && result.feedback && (
                <p className={`feedback-verdict track-feedback-given ${result.feedback.resolved ? 'yes' : 'no'}`}>
                  {t(result.feedback.resolved ? 'feedback_given_yes' : 'feedback_given_no')}
                  {result.feedback.rating ? <StarRating value={result.feedback.rating} /> : null}
                </p>
              )}
            </div>

            <div className="card track-timeline-card">
              <h3 className="card-title">{t('timeline_title')}</h3>
              <ComplaintTimeline timeline={result.timeline} status={status} />
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
