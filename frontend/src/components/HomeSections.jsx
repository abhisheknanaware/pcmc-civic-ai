import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Trash2, Construction, Droplets, Waves, Lightbulb, TreePine, Store, Dog, HeartPulse, ArrowRight,
  Siren, AlertTriangle, Clock, CalendarClock, Phone, Building, Mail, Zap, ChevronDown
} from 'lucide-react';
import useLabels from '../hooks/useLabels';
import { useMeta } from '../context/MetaContext';

// The nine most common complaint types. Department names come from config/pcmc.json via /api/meta.
const REPORT_TYPES = [
  { category: 'Garbage & Solid Waste', key: 'garbage', icon: Trash2, tone: 'amber' },
  { category: 'Road & Potholes', key: 'roads', icon: Construction, tone: 'rose' },
  { category: 'Water Supply', key: 'water', icon: Droplets, tone: 'sky' },
  { category: 'Drainage & Sewerage', key: 'drainage', icon: Waves, tone: 'indigo' },
  { category: 'Street Lights & Electrical', key: 'lights', icon: Lightbulb, tone: 'amber' },
  { category: 'Tree & Garden', key: 'trees', icon: TreePine, tone: 'teal' },
  { category: 'Encroachment', key: 'encroachment', icon: Store, tone: 'rose' },
  { category: 'Stray Animals', key: 'animals', icon: Dog, tone: 'sky' },
  { category: 'Public Health & Sanitation', key: 'health', icon: HeartPulse, tone: 'teal' },
];

export function ReportTypes() {
  const L = useLabels();
  const { t } = L;
  const { routing = {} } = useMeta();
  return (
    <section className="home-section">
      <div className="section-intro" data-reveal>
        <p className="eyebrow">{t('report_eyebrow')}</p>
        <h2>{t('report_title')}</h2>
        <p className="section-copy">{t('report_copy')}</p>
      </div>
      <div className="report-types">
        {REPORT_TYPES.map(({ category, key, icon: Icon, tone }, i) => (
          <article key={key} className={`report-type tone-card-${tone}`} data-reveal style={{ '--delay': `${(i % 3) * 80}ms` }}>
            <div className="report-type-head">
              <span className="report-type-icon"><Icon size={20} /></span>
              <h3>{L.category(category)}</h3>
            </div>
            <ul>
              {[1, 2, 3].map((n) => <li key={n}>{t(`ex_${key}_${n}`)}</li>)}
            </ul>
            <p className="report-type-dept">{t('report_handled_by', { dept: routing[category] ? L.department(routing[category]) : '—' })}</p>
          </article>
        ))}
      </div>
      <div className="section-action" data-reveal>
        <Link to="/report" className="button button-lg">{t('home_cta_report')} <ArrowRight size={18} /></Link>
        <span className="form-note">{t('report_more')}</span>
      </div>
    </section>
  );
}

const SLA = [
  { priority: 'P1', icon: Siren, tone: 'critical' },
  { priority: 'P2', icon: AlertTriangle, tone: 'high' },
  { priority: 'P3', icon: Clock, tone: 'medium' },
  { priority: 'P4', icon: CalendarClock, tone: 'low' },
];

export function SlaTargets() {
  const L = useLabels();
  const { t } = L;
  const { slaHours = { P1: 24, P2: 48, P3: 168, P4: 336 } } = useMeta();
  return (
    <section className="home-section">
      <div className="section-intro" data-reveal>
        <p className="eyebrow">{t('sla_eyebrow')}</p>
        <h2>{t('sla_title')}</h2>
        <p className="section-copy">{t('sla_copy')}</p>
      </div>
      <div className="sla-grid">
        {SLA.map(({ priority, icon: Icon, tone }, i) => (
          <article key={priority} className={`sla-card sla-${tone}`} data-reveal style={{ '--delay': `${i * 80}ms` }}>
            <span className="sla-icon"><Icon size={20} /></span>
            <span className="sla-priority">{L.priority(priority)}</span>
            <strong className="sla-time">{t('sla_within', { time: slaHours[priority] <= 48 ? t('sla_hours', { count: slaHours[priority] }) : t('sla_days', { count: slaHours[priority] / 24 }) })}</strong>
            <p>{t(`sla_${priority}_examples`)}</p>
          </article>
        ))}
      </div>
      <p className="sla-note" data-reveal>{t('sla_note')}</p>
    </section>
  );
}

export function Contacts() {
  const { t } = useLabels();
  const { corporation } = useMeta();
  const helpline = corporation?.sarathiHelpline || '8888006666';
  const items = [
    { key: 'sarathi', icon: Phone, value: helpline, href: `tel:${helpline}` },
    { key: 'main', icon: Building, value: '020-67333333', href: 'tel:02067333333' },
    { key: 'email', icon: Mail, value: 'egov@pcmcindia.gov.in', href: 'mailto:egov@pcmcindia.gov.in' },
    { key: 'power', icon: Zap, value: '1912', href: 'tel:1912' },
  ];
  return (
    <section className="home-section">
      <div className="section-intro" data-reveal>
        <p className="eyebrow">{t('contacts_eyebrow')}</p>
        <h2>{t('contacts_title')}</h2>
      </div>
      <div className="contacts">
        {items.map(({ key, icon: Icon, value, href }, i) => (
          <a key={key} className={`contact-card ${key === 'power' ? 'contact-external' : ''}`} href={href} data-reveal style={{ '--delay': `${i * 70}ms` }}>
            <span className="contact-icon"><Icon size={20} /></span>
            <span className="contact-label">{t(`contact_${key}`)}</span>
            <strong>{value}</strong>
            <span className="contact-text">{t(`contact_${key}_text`)}</span>
          </a>
        ))}
      </div>
    </section>
  );
}

export function Faq() {
  const { t } = useLabels();
  const [open, setOpen] = useState(1);
  return (
    <section className="home-section faq-section">
      <div className="section-intro" data-reveal>
        <p className="eyebrow">{t('faq_eyebrow')}</p>
        <h2>{t('faq_title')}</h2>
      </div>
      <div className="faq" data-reveal>
        {[1, 2, 3, 4, 5, 6].map((n) => {
          const isOpen = open === n;
          return (
            <div key={n} className={`faq-item ${isOpen ? 'open' : ''}`}>
              <button type="button" className="faq-question" aria-expanded={isOpen} aria-controls={`faq-${n}`} onClick={() => setOpen(isOpen ? 0 : n)}>
                <span>{t(`faq_q${n}`)}</span>
                <ChevronDown size={18} />
              </button>
              <div id={`faq-${n}`} className="faq-answer" role="region" hidden={!isOpen}>
                <p>{t(`faq_a${n}`)}</p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
