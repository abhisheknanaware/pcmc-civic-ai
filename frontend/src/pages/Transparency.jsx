import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { Inbox, CheckCircle2, Timer, ShieldCheck, Star, ThumbsUp, Loader, Lock, MapPin, Building2, FilePlus } from 'lucide-react';
import useLabels from '../hooks/useLabels';
import { useMeta } from '../context/MetaContext';
import api from '../services/api';

// Public "how is PCMC doing" page. Aggregates only, served by GET /api/meta/transparency.
export default function Transparency() {
  const L = useLabels();
  const { t } = L;
  const { zones } = useMeta();
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    api.get('/meta/transparency').then(({ data: d }) => setData(d)).catch(() => setError(true));
  }, []);

  if (error) return <div className="page-loading">{t('tp_failed')}</div>;
  if (!data) return <div className="page-loading"><Loader className="spin" size={28} /> {t('loading')}</div>;

  const { totals, months } = data;
  const monthLabel = (key) => L.date(`${key}-01T00:00:00`, { month: 'short', year: '2-digit' });
  const chart = months.map((m) => ({ ...m, label: monthLabel(m.month) }));
  const kpis = [
    { icon: Inbox, label: t('tp_received'), value: L.number(totals.received), tone: 'teal' },
    { icon: CheckCircle2, label: t('tp_resolved_rate'), value: L.percent(totals.resolutionRate), hint: t('tp_resolved_count', { count: L.number(totals.resolved) }), tone: 'green' },
    { icon: Timer, label: t('tp_avg_time'), value: L.duration(totals.avgHours), tone: 'sky' },
    { icon: ShieldCheck, label: t('tp_sla'), value: L.percent(totals.slaCompliance), hint: t('tp_sla_hint'), tone: 'violet' },
    { icon: Star, label: t('tp_rating'), value: totals.avgRating == null ? '—' : `${L.number(totals.avgRating, { maximumFractionDigits: 1 })} / 5`, hint: t('tp_rating_hint', { count: L.number(totals.feedback) }), tone: 'amber' },
    { icon: ThumbsUp, label: t('tp_confirmed'), value: L.percent(totals.confirmedFixedRate), hint: t('tp_confirmed_hint'), tone: 'green' },
  ];

  return (
    <div className="tp-page">
      <section className="tp-hero">
        <p className="eyebrow">{t('tp_eyebrow')}</p>
        <h1 className="page-title">{t('tp_title_1')} <span className="serif-accent">{t('tp_title_2')}</span></h1>
        <p className="page-copy">{t('tp_subtitle')}</p>
        <p className="tp-updated"><Lock size={13} /> {t('tp_privacy')} · {t('tp_updated', { date: L.date(data.updatedAt, { dateStyle: 'medium', timeStyle: 'short' }) })}</p>
      </section>

      {totals.received === 0 ? (
        <div className="card tp-empty">
          <Inbox size={30} />
          <p>{t('tp_empty')}</p>
          <Link to="/report" className="button"><FilePlus size={16} /> {t('home_cta_report')}</Link>
        </div>
      ) : (
        <>
          <div className="tp-kpis">
            {kpis.map(({ icon: Icon, label, value, hint, tone }) => (
              <div key={label} className={`tp-kpi tone-${tone}`}>
                <span className="tp-kpi-icon"><Icon size={18} /></span>
                <strong>{value}</strong>
                <span className="tp-kpi-label">{label}</span>
                {hint && <span className="tp-kpi-hint">{hint}</span>}
              </div>
            ))}
          </div>

          <div className="card tp-chart">
            <h2 className="tp-h2">{t('tp_monthly')}</h2>
            <div className="tp-chart-box">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chart} margin={{ top: 10, right: 10, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e8ece9" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={12} />
                  <Tooltip cursor={{ fill: 'rgba(15,94,87,.06)' }} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="received" name={t('tp_received')} fill="#94b8ad" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="resolved" name={t('tp_resolved')} fill="#0f5e57" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <section>
            <h2 className="tp-h2"><MapPin size={18} /> {t('tp_by_zone')}</h2>
            <div className="tp-zones">
              {data.zones.map((z) => (
                <div key={z.id} className="tp-zone">
                  <div className="tp-zone-head">
                    <span className="zone-dot">{z.id}</span>
                    <strong>{zones[z.id]?.name || z.id}</strong>
                    <span className="tp-zone-rate">{L.percent(z.resolutionRate)}</span>
                  </div>
                  <div className="tp-bar"><span style={{ width: `${z.resolutionRate || 0}%` }} /></div>
                  <div className="tp-zone-stats">
                    <span>{t('tp_received_short', { count: z.received })}</span>
                    <span>{t('tp_resolved_short', { count: z.resolved })}</span>
                    <span>{z.avgHours == null ? '—' : t('tp_fix_time', { time: L.duration(z.avgHours) })}</span>
                    {z.overdueOpen > 0 && <span className="late">{t('tp_overdue', { count: z.overdueOpen })}</span>}
                  </div>
                </div>
              ))}
              {data.zones.length === 0 && <p className="form-note">{t('tp_no_zone')}</p>}
            </div>
          </section>

          <div className="tp-split">
            <div className="card">
              <h2 className="tp-h2"><Building2 size={18} /> {t('tp_by_department')}</h2>
              <ul className="tp-depts">
                {data.departments.map((d) => (
                  <li key={d.id}>
                    <div className="tp-dept-row">
                      <span>{L.department(d.id, t('general'))}</span>
                      <strong>{L.percent(d.resolutionRate)}</strong>
                    </div>
                    <div className="tp-bar thin"><span style={{ width: `${d.resolutionRate || 0}%` }} /></div>
                    <span className="tp-dept-meta">{t('tp_received_short', { count: d.received })} · {d.avgHours == null ? '—' : t('tp_fix_time', { time: L.duration(d.avgHours) })}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="card">
              <h2 className="tp-h2">{t('tp_top_issues')}</h2>
              <ul className="tp-cats">
                {data.categories.map((c) => (
                  <li key={c.id}><span>{L.category(c.id)}</span><strong>{L.number(c.count)}</strong></li>
                ))}
              </ul>
              <p className="form-note tp-note">{t('tp_note')}</p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
