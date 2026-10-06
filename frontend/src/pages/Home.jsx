import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, Search, MessageCircle, Sparkles, ShieldCheck, Languages, Mic, MapPin, Route, CheckCircle2,
  Receipt, Droplets, FileText, Building2, LayoutGrid, Phone, Clock, ChevronRight, ArrowUpRight
} from 'lucide-react';
import useLabels from '../hooks/useLabels';
import useReveal from '../hooks/useReveal';
import useCountUp from '../hooks/useCountUp';
import { useMeta } from '../context/MetaContext';
import api from '../services/api';
import Skyline from '../components/Skyline';
import { ReportTypes, Contacts } from '../components/HomeSections';

const openAssistant = () => window.dispatchEvent(new Event('pcmc:open-chat'));

// Official links verified from PCMC / Government of India pages (see nlp/knowledge/pcmc_kb.json).
const SERVICES = [
  { key: 'property_tax', icon: Receipt, url: 'https://publicptaxpcmc.in', tone: 'violet' },
  { key: 'water', icon: Droplets, url: 'https://water.pcmcindia.gov.in/online_payment/waterbillpayment.html', tone: 'sky' },
  { key: 'certificates', icon: FileText, url: 'https://crsorgi.gov.in', tone: 'rose' },
  { key: 'building', icon: Building2, url: 'https://bldp.pcmcindia.gov.in/BPAMSClient/', tone: 'amber' },
  { key: 'eseva', icon: LayoutGrid, url: 'https://www.pcmcindia.gov.in/e-seva.php', tone: 'teal' },
  { key: 'helpline', icon: Phone, url: 'tel:8888006666', tone: 'indigo' },
];

const STEPS = [
  { key: 'report', icon: Mic },
  { key: 'understand', icon: Sparkles },
  { key: 'route', icon: Route },
  { key: 'resolve', icon: CheckCircle2 },
];

// Hero illustration: one example complaint moving through the pipeline (illustrative, not live data).
function JourneyCard() {
  const { t } = useLabels();
  const [stage, setStage] = useState(0);
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;
    const timer = setInterval(() => setStage((s) => (s + 1) % 3), 2600);
    return () => clearInterval(timer);
  }, []);
  const stages = [
    { icon: MapPin, title: t('home_demo_reported'), detail: t('home_demo_reported_detail'), tone: 'amber' },
    { icon: Sparkles, title: t('home_demo_routed'), detail: t('home_demo_routed_detail'), tone: 'violet' },
    { icon: CheckCircle2, title: t('home_demo_resolved'), detail: t('home_demo_resolved_detail'), tone: 'teal' },
  ];
  return (
    <div className="journey" aria-hidden="true">
      <div className="journey-glow" />
      <div className="journey-card">
        <div className="journey-head">
          <span className="journey-ticket">PCMC-100245</span>
          <span className={`journey-status tone-${stages[stage].tone}`}>{stages[stage].title}</span>
        </div>
        <p className="journey-text">{t('home_demo_text')}</p>
        <div className="journey-steps">
          {stages.map((s, i) => (
            <div key={s.title} className={`journey-step ${i === stage ? 'active' : ''} ${i < stage ? 'done' : ''}`}>
              <span className={`journey-dot tone-${s.tone}`}><s.icon size={15} /></span>
              <div>
                <strong>{s.title}</strong>
                <span>{s.detail}</span>
              </div>
            </div>
          ))}
          <div className="journey-progress"><span style={{ height: `${(stage / 2) * 100}%` }} /></div>
        </div>
      </div>
      <div className="journey-float float-a"><Languages size={16} /> English · हिंदी · मराठी</div>
      <div className="journey-float float-b"><ShieldCheck size={16} /> {t('home_demo_private')}</div>
    </div>
  );
}

// Continuously scrolling strip of the real PCMC departments complaints are routed to (pauses on hover).
function DepartmentMarquee() {
  const L = useLabels();
  const { departments } = useMeta();
  const names = departments.filter((d) => !d.external).map((d) => L.department(d.id));
  if (!names.length) return null;
  const row = [...names, ...names]; // duplicated so the loop is seamless
  return (
    <section className="trust" data-reveal>
      <p className="trust-title">{L.t('home_trust_title')}</p>
      <div className="marquee" aria-label={L.t('home_trust_title')}>
        <div className="marquee-track">
          {row.map((name, i) => <span key={i} className="marquee-item" aria-hidden={i >= names.length}>{name}</span>)}
        </div>
      </div>
    </section>
  );
}

function ResolutionRing({ percent }) {
  const [ref, value] = useCountUp(percent ?? 0);
  const circumference = 2 * Math.PI * 36;
  return (
    <div className="ring" ref={ref}>
      <svg viewBox="0 0 88 88" aria-hidden="true">
        <circle cx="44" cy="44" r="36" className="ring-track" />
        <circle cx="44" cy="44" r="36" className="ring-value" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - value / 100)} />
      </svg>
      <strong>{percent == null ? '—' : `${value}%`}</strong>
    </div>
  );
}

// Defined at module level (not inside Bento) so count-up re-renders never remount the tiles.
function ServiceTile({ k, delay = 0 }) {
  const { t } = useLabels();
  const { icon: Icon, url, tone } = SERVICES.find((x) => x.key === k);
  return (
    <a className={`bento-tile tile-${tone}`} href={url} target={url.startsWith('http') ? '_blank' : undefined} rel="noreferrer" data-reveal style={{ '--delay': `${delay}ms` }}>
      <span className="tile-arrow"><ArrowUpRight size={16} /></span>
      <span className="tile-icon"><Icon size={20} /></span>
      <h3>{t(`home_service_${k}`)}</h3>
      <p>{t(`home_service_${k}_text`)}</p>
      <p className="tile-need"><span>{t('service_need')}</span> {t(`home_service_${k}_need`)}</p>
    </a>
  );
}

// Simple numbers band: title on the left, four serif figures with labels on the right.
function ImpactStrip({ stats }) {
  const { t } = useLabels();
  const [totalRef, total] = useCountUp(stats?.total);
  const [rateRef, rate] = useCountUp(stats?.resolutionRate);
  const figures = [
    { ref: totalRef, value: stats?.total == null ? '—' : total.toLocaleString('en-IN'), label: t('home_stat_total') },
    { ref: rateRef, value: stats?.resolutionRate == null ? '—' : `${rate}%`, label: t('home_stat_resolved') },
    { value: stats?.zones ?? 10, label: t('home_stat_zones') },
    { value: stats?.languages ?? 4, label: t('home_stat_languages') },
  ];
  return (
    <section className="numbers-band" data-reveal>
      <h2>{t('numbers_title_1')} <span className="serif-accent">{t('numbers_title_2')}</span></h2>
      <div className="numbers-grid">
        {figures.map((f) => (
          <div key={f.label} className="figure">
            <strong ref={f.ref} className="figure-value">{f.value}</strong>
            <span className="figure-label">{f.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Services() {
  const { t } = useLabels();
  return (
    <section className="home-section">
      <div className="section-intro" data-reveal>
        <p className="eyebrow">{t('home_services_eyebrow')}</p>
        <h2>{t('home_services_title')}</h2>
        <p className="section-copy">{t('home_services_copy')}</p>
      </div>
      <div className="services">
        {SERVICES.map(({ key }, i) => <ServiceTile key={key} k={key} delay={i * 70} />)}
      </div>
    </section>
  );
}

export default function Home() {
  const L = useLabels();
  const { t } = L;
  const { zones } = useMeta();
  const [stats, setStats] = useState(null);
  useReveal([zones]);

  useEffect(() => {
    api.get('/meta/stats').then(({ data }) => setStats(data)).catch(() => setStats(null));
  }, []);

  return (
    <div className="home">
      <section className="hero">
        <div className="hero-bg" aria-hidden="true"><span className="blob b1" /><span className="blob b2" /><span className="blob b3" /><span className="grid-lines" /></div>
        <div className="hero-copy">
          <span className="pill" data-reveal><Sparkles size={14} /> {t('home_pill')}</span>
          <h1 className="hero-title" data-reveal>
            {t('home_title_1')} <span className="serif-accent gradient-text">{t('home_title_2')}</span>
          </h1>
          <p className="hero-subtitle" data-reveal>{t('home_subtitle')}</p>
          <div className="hero-actions" data-reveal>
            <Link to="/report" className="button button-lg glow">{t('home_cta_report')} <ArrowRight size={18} /></Link>
            <Link to="/track" className="button button-lg secondary"><Search size={18} /> {t('nav_track')}</Link>
          </div>
          <button type="button" className="link-button" onClick={openAssistant} data-reveal>
            <MessageCircle size={16} /> {t('home_cta_assistant')} <ChevronRight size={15} />
          </button>
        </div>
        <JourneyCard />
      </section>

      <section className="skyline-band" data-reveal>
        <Skyline variant="color" />
      </section>

      <DepartmentMarquee />

      <ImpactStrip stats={stats} />

      <section className="home-section">
        <div className="section-intro" data-reveal>
          <p className="eyebrow">{t('home_how_eyebrow')}</p>
          <h2>{t('home_how_title')}</h2>
        </div>
        <div className="steps">
          {STEPS.map(({ key, icon: Icon }, i) => (
            <article key={key} className="step" data-reveal style={{ '--delay': `${i * 110}ms` }}>
              <span className="step-number">{String(i + 1).padStart(2, '0')}</span>
              <span className="step-icon"><Icon size={22} /></span>
              <h3>{t(`home_step_${key}`)}</h3>
              <p>{t(`home_step_${key}_text`)}</p>
            </article>
          ))}
        </div>
      </section>

      <ReportTypes />

      <Services />


      <section className="home-section">
        <div className="section-intro" data-reveal>
          <p className="eyebrow">{t('home_zones_eyebrow')}</p>
          <h2>{t('home_zones_title')}</h2>
          <p className="section-copy">{t('home_zones_copy')}</p>
        </div>
        <div className="zone-grid">
          {Object.entries(zones).map(([id, z], i) => (
            <div key={id} className="zone-card" data-reveal style={{ '--delay': `${i * 45}ms` }} tabIndex={0}>
              <span className="zone-letter">{id}</span>
              <div>
                <strong>{z.name} <span className="zone-mr">{z.mr}</span></strong>
                <span className="zone-office">{z.office.split(',').slice(-2).join(',').trim()}</span>
                <span className="zone-wards">{t('home_zone_wards', { wards: z.wards.join(', ') })}</span>
                <span className="zone-contact">
                  {z.phone && <a href={`tel:${z.phone.replace(/[^0-9]/g, '')}`}>{z.phone}</a>}
                  <a href={`mailto:${z.email}`}>{z.email}</a>
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <Contacts />

      <section className="cta-banner" data-reveal>
        <div className="cta-orbit" aria-hidden="true"><span /><span /><span /></div>
        <div className="cta-copy">
          <h2>{t('home_cta_title')}</h2>
          <p>{t('home_cta_copy')}</p>
        </div>
        <div className="cta-actions">
          <button type="button" className="button button-lg light" onClick={openAssistant}><MessageCircle size={18} /> {t('chat_open')}</button>
          <Link to="/report" className="button button-lg outline-light">{t('home_cta_report')} <ArrowRight size={18} /></Link>
        </div>
        <p className="cta-note"><Clock size={14} /> {t('home_cta_note')}</p>
      </section>
    </div>
  );
}
