import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Loader, Download, Inbox, Clock, CheckCircle, Timer, ShieldCheck, AlertOctagon,
  AlertTriangle, Copy, Frown, Cpu, ChevronRight, MessageCircle, MessagesSquare, FilePlus, Search, MousePointerClick
} from 'lucide-react';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend,
  ResponsiveContainer, PieChart, Pie, Cell
} from 'recharts';
import useLabels from '../hooks/useLabels';
import api from '../services/api';
import { useMeta } from '../context/MetaContext';

const BRAND = '#0d9488';
const SERIES = { received: '#0d9488', resolved: '#d97706' };
const PRIORITY_COLORS = { P1: '#c43c45', P2: '#d97706', P3: '#0d9488', P4: '#94a3b8' };
const SLA_COLORS = { 'On Track': '#138a62', 'Breached': '#c43c45', 'No SLA': '#94a3b8' };
const SENTIMENT_COLORS = { Negative: '#c43c45', Frustrated: '#e0707a', Neutral: '#94a3b8', Positive: '#138a62' };
// Sequential single-hue ramp: older backlog reads darker.
const AGING_COLORS = ['#8fcfc4', '#4fb3a4', '#1f9384', '#0f766e', '#0b4f49'];
const FALLBACK_COLOR = '#94a3b8';
const RANGES = [7, 30, 90, 0];
// A white gap separates slices; a single full slice would otherwise show a seam.
const sliceStroke = (list) => (list.length > 1 ? 2 : 0);

const axisProps = { tick: { fill: '#6e7890', fontSize: 12 }, axisLine: false, tickLine: false };
const tooltipProps = {
  cursor: { fill: 'rgba(13,148,136,0.07)' },
  contentStyle: { borderRadius: 10, border: '1px solid #e7eaf1', boxShadow: '0 10px 30px rgba(29,39,64,.1)', fontSize: 13 }
};
const legendProps = { iconType: 'circle', iconSize: 8, wrapperStyle: { fontSize: 13 } };

const ChartCard = ({ title, subtitle, empty, emptyText, className = '', children }) => (
  <div className={`card chart-card ${className}`}>
    <div className="chart-head">
      <h3 className="chart-title">{title}</h3>
      {subtitle && <p className="chart-subtitle">{subtitle}</p>}
    </div>
    {empty ? <p className="chart-empty">{emptyText}</p> : <div className="chart-body"><ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer></div>}
  </div>
);

const KpiTile = ({ icon: Icon, label, value, hint, tone = '' }) => (
  <div className={`kpi-tile ${tone}`}>
    <span className={`stat-icon ${tone}`}><Icon size={18} /></span>
    <div className="kpi-text">
      <span className="stat-label">{label}</span>
      <span className="kpi-value">{value}</span>
      {hint && <span className="kpi-hint">{hint}</span>}
    </div>
  </div>
);

const complianceTone = (value) => (value == null ? '' : value >= 90 ? 'good' : value >= 70 ? 'warn' : 'bad');

const downloadCsv = (filename, rows) => {
  const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = '﻿' + rows.map((r) => r.map(escape).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: filename });
  link.click();
  URL.revokeObjectURL(url);
};

export default function Analytics() {
  const L = useLabels();
  const { t } = L;
  const { departmentIds = [], zones } = useMeta();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [days, setDays] = useState(30);
  const [department, setDepartment] = useState('ALL');

  useEffect(() => {
    const fetchAnalytics = async () => {
      setRefreshing(true);
      try {
        const response = await api.get('/analytics', { params: { days: days || undefined, department } });
        setData(response.data);
      } catch (error) {
        console.error('Failed to fetch analytics:', error);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    };
    fetchAnalytics();
  }, [days, department]);

  if (loading) return <div className="page-loading"><Loader className="spin" size={28} /> {t('loading_analytics')}</div>;
  if (!data) return <div className="page-container"><p className="empty-state">{t('no_analytics')}</p></div>;

  const k = data.kpis;
  const chat = data.chatbot;
  const named = (list, label) => list.map((d) => ({ ...d, name: label(d._id) }));
  const trend = data.trend.map((d) => ({ ...d, label: L.date(d.date) }));
  const hasTrend = data.trend.some((d) => d.received || d.resolved);
  const pipeline = named(data.statusDistribution, L.status);
  const aging = data.agingDistribution.map((d) => ({ ...d, name: t(`age.${d._id}`) }));
  const zoneHotspots = data.zoneHotspots.map((z) => ({ ...z, label: z.zone ? `${z.zone} – ${zones[z.zone]?.name || ''}` : t('unknown') }));
  const departments = data.departmentPerformance;

  const exportDepartments = () => {
    downloadCsv(`pmc-department-performance-${new Date().toISOString().slice(0, 10)}.csv`, [
      [t('col_department'), t('col_total'), t('col_open'), t('col_resolved'), t('col_resolution_rate'), t('col_sla_compliance'), t('col_breached'), t('col_avg_time')],
      ...departments.map((d) => [
        L.department(d.department), d.total, d.open, d.resolved,
        d.resolutionRate ?? '', d.slaCompliance ?? '', d.breached, d.avgResolutionHours ?? ''
      ]),
    ]);
  };

  return (
    <div className={`page-container analytics-page ${refreshing ? 'is-refreshing' : ''}`}>
      <header className="page-header analytics-header">
        <div>
          <p className="eyebrow">{t('an_eyebrow')}</p>
          <h1 className="page-title">{t('an_title')}</h1>
          <p className="page-subtitle">{t('an_subtitle', { count: L.number(data.total) })}</p>
        </div>
      </header>

      <div className="analytics-filters card">
        <div className="filter-field">
          <span className="filter-caption" id="range-label">{t('an_range')}</span>
          <div className="segmented" role="group" aria-labelledby="range-label">
            {RANGES.map((r) => (
              <button key={r} type="button" className={days === r ? 'active' : ''} aria-pressed={days === r} onClick={() => setDays(r)}>
                {t(r ? `range_${r}` : 'range_all')}
              </button>
            ))}
          </div>
        </div>
        <div className="filter-field">
          <label htmlFor="analytics-department" className="filter-caption">{t('an_department')}</label>
          <select id="analytics-department" value={department} onChange={(e) => setDepartment(e.target.value)}>
            <option value="ALL">{t('all_departments')}</option>
            {departmentIds.map((d) => <option key={d} value={d}>{L.department(d)}</option>)}
          </select>
        </div>
        <button type="button" className="button secondary export-btn" onClick={exportDepartments} disabled={!departments.length}>
          <Download size={16} /> {t('export_csv')}
        </button>
      </div>

      <section className="kpi-grid">
        <KpiTile icon={Inbox} label={t('kpi_total')} value={L.number(k.total)} />
        <KpiTile icon={Clock} label={t('kpi_open')} value={L.number(k.open)} />
        <KpiTile icon={CheckCircle} tone="success" label={t('kpi_resolution_rate')} value={L.percent(k.resolutionRate)} hint={t('kpi_hint_resolved', { count: L.number(k.resolved) })} />
        <KpiTile icon={Timer} label={t('kpi_avg_resolution')} value={L.duration(k.avgResolutionHours)} />
        <KpiTile icon={ShieldCheck} tone={complianceTone(k.slaCompliance) === 'bad' ? 'critical' : 'success'} label={t('kpi_sla')} value={L.percent(k.slaCompliance)} hint={t('kpi_hint_sla')} />
        <KpiTile icon={AlertOctagon} tone={k.breachedOpen ? 'critical' : ''} label={t('kpi_breached')} value={L.number(k.breachedOpen)} hint={t('kpi_hint_breached')} />
        <KpiTile icon={AlertTriangle} tone={k.highPriorityOpen ? 'warning' : ''} label={t('kpi_high_open')} value={L.number(k.highPriorityOpen)} hint={t('kpi_hint_high')} />
        <KpiTile icon={Copy} label={t('kpi_duplicates')} value={L.percent(k.duplicateRate)} />
        <KpiTile icon={Frown} label={t('kpi_negative')} value={L.percent(k.negativeShare)} />
        <KpiTile icon={Cpu} label={t('kpi_ai_confidence')} value={L.percent(k.avgAiConfidence)} />
      </section>

      <ChartCard className="chart-wide" title={t('chart_trend')} subtitle={t('chart_trend_sub', { days: data.filters.trendDays })} empty={!hasTrend} emptyText={t('no_data')}>
        <LineChart data={trend} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef0f6" />
          <XAxis dataKey="label" {...axisProps} minTickGap={24} />
          <YAxis allowDecimals={false} {...axisProps} />
          <RechartsTooltip contentStyle={tooltipProps.contentStyle} cursor={{ stroke: '#bcd8cf', strokeWidth: 1 }} />
          <Legend {...legendProps} />
          <Line type="monotone" dataKey="received" name={t('series_received')} stroke={SERIES.received} strokeWidth={2} dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: '#fff' }} />
          <Line type="monotone" dataKey="resolved" name={t('series_resolved')} stroke={SERIES.resolved} strokeWidth={2} dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: '#fff' }} />
        </LineChart>
      </ChartCard>

      <div className="chart-grid">
        <ChartCard title={t('chart_pipeline')} empty={!data.total} emptyText={t('no_data')}>
          <BarChart data={pipeline} layout="vertical" margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#eef0f6" />
            <XAxis type="number" allowDecimals={false} {...axisProps} />
            <YAxis dataKey="name" type="category" width={130} {...axisProps} />
            <RechartsTooltip {...tooltipProps} />
            <Bar dataKey="count" name={t('series_complaints')} fill={BRAND} radius={[0, 4, 4, 0]} maxBarSize={22} />
          </BarChart>
        </ChartCard>

        <ChartCard title={t('chart_aging')} empty={!k.open} emptyText={t('no_data')}>
          <BarChart data={aging} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef0f6" />
            <XAxis dataKey="name" {...axisProps} interval={0} />
            <YAxis allowDecimals={false} {...axisProps} />
            <RechartsTooltip {...tooltipProps} />
            <Bar dataKey="count" name={t('series_open')} radius={[4, 4, 0, 0]} maxBarSize={48}>
              {aging.map((d, i) => <Cell key={d._id} fill={AGING_COLORS[i]} />)}
            </Bar>
          </BarChart>
        </ChartCard>
      </div>

      <div className="card table-card">
        <div className="chart-head"><h3 className="chart-title">{t('chart_dept')}</h3></div>
        {departments.length ? (
          <div className="table-scroll">
            <table className="data-table dept-table">
              <thead>
                <tr>
                  <th>{t('col_department')}</th><th className="num">{t('col_total')}</th><th className="num">{t('col_open')}</th>
                  <th className="num">{t('col_resolved')}</th><th className="num">{t('col_resolution_rate')}</th>
                  <th>{t('col_sla_compliance')}</th><th className="num">{t('col_breached')}</th><th className="num">{t('col_avg_time')}</th>
                </tr>
              </thead>
              <tbody>
                {departments.map((d) => (
                  <tr key={d.department}>
                    <td className="dept-name">{L.department(d.department)}</td>
                    <td className="num">{L.number(d.total)}</td>
                    <td className="num">{L.number(d.open)}</td>
                    <td className="num">{L.number(d.resolved)}</td>
                    <td className="num">{L.percent(d.resolutionRate)}</td>
                    <td>
                      <div className={`meter ${complianceTone(d.slaCompliance)}`}>
                        <span className="meter-track"><span className="meter-fill" style={{ width: `${d.slaCompliance ?? 0}%` }} /></span>
                        <span className="meter-value">{L.percent(d.slaCompliance)}</span>
                      </div>
                    </td>
                    <td className="num">{d.breached ? <span className="badge critical">{L.number(d.breached)}</span> : L.number(0)}</td>
                    <td className="num">{L.duration(d.avgResolutionHours)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="chart-empty">{t('no_data')}</p>}
      </div>

      <div className="chart-grid">
        <ChartCard title={t('chart_zones')} subtitle={t('chart_zones_sub')} empty={!zoneHotspots.length} emptyText={t('no_data')}>
          <BarChart data={zoneHotspots} layout="vertical" margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#eef0f6" />
            <XAxis type="number" allowDecimals={false} {...axisProps} />
            <YAxis dataKey="label" type="category" width={150} {...axisProps} />
            <RechartsTooltip {...tooltipProps} />
            <Legend {...legendProps} />
            <Bar dataKey="open" name={t('series_open')} fill={BRAND} radius={[0, 4, 4, 0]} maxBarSize={18} />
            <Bar dataKey="highPriority" name={t('series_high')} fill={PRIORITY_COLORS.P2} radius={[0, 4, 4, 0]} maxBarSize={18} />
          </BarChart>
        </ChartCard>

        <div className="card chart-card attention-card">
          <div className="chart-head">
            <h3 className="chart-title">{t('chart_attention')}</h3>
            <p className="chart-subtitle">{t('chart_attention_sub')}</p>
          </div>
          {data.attentionTickets.length ? (
            <ul className="attention-list">
              {data.attentionTickets.map((c) => (
                <li key={c._id}>
                  <Link to={`/ticket/${c._id}`}>
                    <span className={`priority priority-${(c.priority || 'P4').toLowerCase()}`}>{c.priority}</span>
                    <span className="attention-main">
                      <strong>{L.category(c.category)}</strong>
                      <span>{c.ticketNumber} · {c.zone ? `${t('label_zone')} ${c.zone}` : t('unknown')} · {L.department(c.department)}</span>
                    </span>
                    <span className={`attention-due ${c.breached ? 'overdue' : ''}`}>
                      {c.slaDeadline ? L.timeRemaining(c.slaDeadline) : L.sla('No SLA')}
                    </span>
                    <ChevronRight size={15} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : <p className="chart-empty">{t('no_attention')}</p>}
        </div>
      </div>

      <section className="analytics-section">
        <div className="section-head">
          <h2 className="section-title"><MessageCircle size={18} /> {t('chatbot_section')}</h2>
          <p className="chart-subtitle">{t('chatbot_section_sub')}</p>
        </div>
        <div className="kpi-grid kpi-grid-6">
          <KpiTile icon={MessagesSquare} label={t('kpi_conversations')} value={L.number(chat.conversations)} hint={t('kpi_hint_questions', { count: L.number(chat.questions) })} />
          <KpiTile icon={CheckCircle} tone="success" label={t('kpi_answer_rate')} value={L.percent(chat.answerRate)} hint={t('kpi_hint_answer_rate')} />
          <KpiTile icon={AlertTriangle} tone={chat.unanswered ? 'warning' : ''} label={t('kpi_unanswered')} value={L.number(chat.unanswered)} hint={t('kpi_hint_unanswered')} />
          <KpiTile icon={FilePlus} label={t('kpi_conversions')} value={L.number(chat.complaintConversions)} hint={t('kpi_hint_conversions')} />
          <KpiTile icon={Search} label={t('kpi_status_checks')} value={L.number(chat.statusChecks)} />
          <KpiTile icon={Timer} label={t('kpi_chat_response')} value={chat.avgResponseSeconds == null ? '—' : t('seconds_short', { value: L.number(chat.avgResponseSeconds, { maximumFractionDigits: 1 }) })} hint={t('kpi_hint_clicks', { count: L.number(chat.serviceClicks) })} />
        </div>
        <div className="chart-grid chart-grid-3">
          <ChartCard title={t('chart_chat_intents')} empty={!chat.intents.length} emptyText={t('no_data')}>
            <BarChart data={chat.intents.map((d) => ({ ...d, name: t(`intent.${d._id}`, { defaultValue: d._id }) }))} layout="vertical" margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#eef0f6" />
              <XAxis type="number" allowDecimals={false} {...axisProps} />
              <YAxis dataKey="name" type="category" width={120} {...axisProps} />
              <RechartsTooltip {...tooltipProps} />
              <Bar dataKey="count" name={t('series_messages')} fill={BRAND} radius={[0, 4, 4, 0]} maxBarSize={20} />
            </BarChart>
          </ChartCard>
          <ChartCard title={t('chart_chat_topics')} empty={!chat.topics.length} emptyText={t('no_data')}>
            <BarChart data={chat.topics.slice(0, 6).map((d) => ({ ...d, name: t(`topic.${d._id}`, { defaultValue: d._id }) }))} layout="vertical" margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#eef0f6" />
              <XAxis type="number" allowDecimals={false} {...axisProps} />
              <YAxis dataKey="name" type="category" width={120} {...axisProps} />
              <RechartsTooltip {...tooltipProps} />
              <Bar dataKey="count" name={t('series_messages')} fill="#4fb3a4" radius={[0, 4, 4, 0]} maxBarSize={20} />
            </BarChart>
          </ChartCard>
          <div className="card chart-card attention-card">
            <div className="chart-head">
              <h3 className="chart-title">{t('chart_unanswered')}</h3>
              <p className="chart-subtitle">{t('chart_unanswered_sub')}</p>
            </div>
            {chat.unansweredQuestions.length ? (
              <ul className="unanswered-list">{chat.unansweredQuestions.map((q, i) => <li key={i}>{q}</li>)}</ul>
            ) : <p className="chart-empty">{t('no_unanswered')}</p>}
          </div>
        </div>
      </section>

      <div className="chart-grid chart-grid-3">
        <ChartCard title={t('chart_priority')} empty={!data.priorityDistribution.length} emptyText={t('no_data')}>
          <PieChart>
            <Pie data={named(data.priorityDistribution, L.priority)} dataKey="count" nameKey="name" cx="50%" cy="45%" outerRadius={85} stroke="#fff" strokeWidth={sliceStroke(data.priorityDistribution)}>
              {data.priorityDistribution.map((e) => <Cell key={e._id} fill={PRIORITY_COLORS[e._id] || FALLBACK_COLOR} />)}
            </Pie>
            <RechartsTooltip {...tooltipProps} />
            <Legend {...legendProps} />
          </PieChart>
        </ChartCard>

        <ChartCard title={t('chart_sentiment')} empty={!data.sentimentDistribution.length} emptyText={t('no_data')}>
          <PieChart>
            <Pie data={named(data.sentimentDistribution, L.sentiment)} dataKey="count" nameKey="name" cx="50%" cy="45%" innerRadius={55} outerRadius={85} stroke="#fff" strokeWidth={sliceStroke(data.sentimentDistribution)}>
              {data.sentimentDistribution.map((e) => <Cell key={e._id} fill={SENTIMENT_COLORS[e._id] || FALLBACK_COLOR} />)}
            </Pie>
            <RechartsTooltip {...tooltipProps} />
            <Legend {...legendProps} />
          </PieChart>
        </ChartCard>

        <ChartCard title={t('chart_sla')} empty={!data.slaDistribution.length} emptyText={t('no_data')}>
          <PieChart>
            <Pie data={named(data.slaDistribution, L.sla)} dataKey="count" nameKey="name" cx="50%" cy="45%" innerRadius={55} outerRadius={85} stroke="#fff" strokeWidth={sliceStroke(data.slaDistribution)}>
              {data.slaDistribution.map((e) => <Cell key={e._id} fill={SLA_COLORS[e._id] || FALLBACK_COLOR} />)}
            </Pie>
            <RechartsTooltip {...tooltipProps} />
            <Legend {...legendProps} />
          </PieChart>
        </ChartCard>
      </div>

      <div className="chart-grid">
        <ChartCard title={t('chart_category')} empty={!data.categoryDistribution.length} emptyText={t('no_data')}>
          <BarChart data={named(data.categoryDistribution, L.category)} layout="vertical" margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#eef0f6" />
            <XAxis type="number" allowDecimals={false} {...axisProps} />
            <YAxis dataKey="name" type="category" width={150} {...axisProps} />
            <RechartsTooltip {...tooltipProps} />
            <Bar dataKey="count" name={t('series_complaints')} fill={BRAND} radius={[0, 4, 4, 0]} maxBarSize={22} />
          </BarChart>
        </ChartCard>

        <ChartCard title={t('chart_language')} empty={!data.languageDistribution.length} emptyText={t('no_data')}>
          <BarChart data={named(data.languageDistribution, L.language)} layout="vertical" margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#eef0f6" />
            <XAxis type="number" allowDecimals={false} {...axisProps} />
            <YAxis dataKey="name" type="category" width={100} {...axisProps} />
            <RechartsTooltip {...tooltipProps} />
            <Bar dataKey="count" name={t('series_complaints')} fill="#4fb3a4" radius={[0, 4, 4, 0]} maxBarSize={22} />
          </BarChart>
        </ChartCard>
      </div>
    </div>
  );
}
