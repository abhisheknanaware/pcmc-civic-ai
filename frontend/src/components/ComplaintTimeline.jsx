import { CheckCircle2, Circle, CircleDot, FilePlus, RotateCcw, UserCheck, Wrench, MessageCircleQuestion, Lock } from 'lucide-react';
import useLabels from '../hooks/useLabels';

const ICONS = {
  OPEN: FilePlus, ASSIGNED: UserCheck, IN_PROGRESS: Wrench, WAITING_FOR_CUSTOMER: MessageCircleQuestion,
  RESOLVED: CheckCircle2, CLOSED: Lock, REOPENED: RotateCcw,
};
// The normal path a complaint takes; steps not reached yet are shown greyed out.
const PATH = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED'];

/** Status timeline: what has happened (with dates) followed by the steps still to come. */
export default function ComplaintTimeline({ timeline = [], status }) {
  const L = useLabels();
  const { t } = L;
  const label = (event) => (event === 'OPEN' ? t('timeline_reported') : event === 'REOPENED' ? t('timeline_reopened') : L.status(event));
  const closed = status === 'RESOLVED' || status === 'CLOSED';
  const reached = PATH.indexOf(status === 'WAITING_FOR_CUSTOMER' ? 'IN_PROGRESS' : status);
  const upcoming = closed ? [] : PATH.slice(Math.max(reached, 0) + 1);

  return (
    <ol className="timeline" aria-label={t('timeline_title')}>
      {timeline.map((step, i) => {
        const Icon = ICONS[step.event] || CircleDot;
        const current = i === timeline.length - 1;
        return (
          <li key={`${step.event}-${i}`} className={`timeline-step done ${current ? 'current' : ''} ev-${step.event.toLowerCase()}`}>
            <span className="timeline-dot"><Icon size={15} /></span>
            <div>
              <strong>{label(step.event)}</strong>
              {step.at && <span>{L.date(step.at, { dateStyle: 'medium', timeStyle: 'short' })}</span>}
            </div>
          </li>
        );
      })}
      {upcoming.map((event) => (
        <li key={`next-${event}`} className="timeline-step upcoming">
          <span className="timeline-dot"><Circle size={13} /></span>
          <div><strong>{label(event)}</strong><span>{t('timeline_pending')}</span></div>
        </li>
      ))}
    </ol>
  );
}
