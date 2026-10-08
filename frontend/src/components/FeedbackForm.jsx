import { useState } from 'react';
import { Star, ThumbsUp, ThumbsDown, Loader, Send } from 'lucide-react';
import useLabels from '../hooks/useLabels';
import { submitFeedback } from '../services/api';

/** "Was your issue fixed?" after resolution. "No" reopens the complaint on the server. */
export default function FeedbackForm({ ticketNumber, email, onDone }) {
  const { t } = useLabels();
  const [resolved, setResolved] = useState(null);
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setSending(true);
    setError('');
    try {
      const data = await submitFeedback({ ticketNumber, email, resolved, rating: resolved && rating ? rating : undefined, comment });
      onDone(data);
    } catch (err) {
      setError(t(err.response?.status === 429 ? 'too_many_requests' : 'feedback_failed'));
    } finally {
      setSending(false);
    }
  };

  return (
    <form className="feedback-card" onSubmit={submit}>
      <h4>{t('feedback_title')}</h4>
      <p className="form-note">{t('feedback_subtitle')}</p>
      <div className="feedback-choice" role="radiogroup" aria-label={t('feedback_title')}>
        <button type="button" role="radio" aria-checked={resolved === true} className={`feedback-option yes ${resolved === true ? 'active' : ''}`} onClick={() => setResolved(true)}>
          <ThumbsUp size={18} /> {t('feedback_yes')}
        </button>
        <button type="button" role="radio" aria-checked={resolved === false} className={`feedback-option no ${resolved === false ? 'active' : ''}`} onClick={() => setResolved(false)}>
          <ThumbsDown size={18} /> {t('feedback_no')}
        </button>
      </div>

      {resolved === true && (
        <div className="feedback-rating">
          <span>{t('feedback_rate')}</span>
          <div className="stars" onMouseLeave={() => setHover(0)}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" aria-label={t('feedback_stars', { n })} aria-pressed={rating === n}
                className={`star ${(hover || rating) >= n ? 'on' : ''}`} onMouseEnter={() => setHover(n)} onClick={() => setRating(n)}>
                <Star size={24} />
              </button>
            ))}
          </div>
        </div>
      )}
      {resolved === false && <p className="feedback-warn">{t('feedback_reopen_note')}</p>}

      {resolved !== null && (
        <>
          <textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500}
            placeholder={t(resolved ? 'feedback_comment_yes' : 'feedback_comment_no')} aria-label={t('feedback_comment_label')} />
          {error && <p className="chat-error">{error}</p>}
          <button type="submit" className="button" disabled={sending}>
            {sending ? <Loader size={16} className="spin" /> : <Send size={16} />} {t(resolved ? 'feedback_submit' : 'feedback_submit_reopen')}
          </button>
        </>
      )}
    </form>
  );
}
