import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  BarChart3, Inbox, AlertTriangle, CheckCircle, Clock, Trash2, Loader, Search, ArrowRight, ShieldAlert, Sparkles, Map,
} from 'lucide-react';
import useLabels from '../hooks/useLabels';
import { PRIORITIES } from '../constants';
import api from '../services/api';
import { useMeta } from '../context/MetaContext';
import { useAuth } from '../context/AuthContext';

const filterCards = [
  { key: 'ALL', label: 'stat_total', icon: Inbox, tone: 'teal' },
  { key: 'OPEN', label: 'stat_open', icon: Clock, tone: 'sky' },
  { key: 'HIGH_PRIORITY', label: 'stat_high', icon: AlertTriangle, tone: 'amber' },
  { key: 'RESOLVED', label: 'stat_resolved', icon: CheckCircle, tone: 'green' },
];

const STATUS_TONE = {
  OPEN: 'sky', ASSIGNED: 'violet', IN_PROGRESS: 'amber', WAITING_FOR_CUSTOMER: 'rose', RESOLVED: 'green', CLOSED: 'green',
};

const isClosed = (c) => c.status === 'RESOLVED' || c.status === 'CLOSED';
const isHighPriority = (c) => c.priority === 'P1' || c.priority === 'P2';
const isBreached = (c) => !isClosed(c) && c.slaDeadline && new Date(c.slaDeadline) < new Date();
const DUE_SOON_MS = 24 * 60 * 60 * 1000;
// Still on time, but the deadline is within the next 24 hours.
const isDueSoon = (c) => {
  if (isClosed(c) || !c.slaDeadline) return false;
  const left = new Date(c.slaDeadline) - new Date();
  return left > 0 && left <= DUE_SOON_MS;
};
const SLA_FILTERS = { overdue: isBreached, soon: isDueSoon };
const matchesCard = {
  ALL: () => true,
  OPEN: (c) => c.status === 'OPEN',
  HIGH_PRIORITY: isHighPriority,
  RESOLVED: isClosed,
};

const greetingKey = () => {
  const hour = new Date().getHours();
  return hour < 12 ? 'dash_greeting_morning' : hour < 17 ? 'dash_greeting_afternoon' : 'dash_greeting_evening';
};

const preview = (c) => {
  const text = (c.translatedText || c.sanitizedText || '').replace(/\s+/g, ' ').trim();
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
};

export default function Dashboard() {
  const L = useLabels();
  const { t } = L;
  const { departmentIds = [], categories, zones } = useMeta();
  const { officer } = useAuth();
  // Department officers are scoped by the server; only admins get the department filter.
  const canFilterDepartment = officer?.role === 'admin' || !officer?.department;
  const [complaints, setComplaints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('ALL');
  const [query, setQuery] = useState('');
  const [zoneFilter, setZoneFilter] = useState('ALL');
  const [departmentFilter, setDepartmentFilter] = useState('ALL');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [priorityFilter, setPriorityFilter] = useState('ALL');
  const [slaFilter, setSlaFilter] = useState(null);

  const fetchComplaints = async (isPolling = false) => {
    try {
      if (!isPolling) setLoading(true);
      const response = await api.get('/complaints');
      setComplaints(response.data);
    } catch (error) { console.error('Failed to fetch complaints:', error); }
    finally { if (!isPolling) setLoading(false); }
  };

  useEffect(() => { fetchComplaints(); }, []);

  // New complaints are classified in the background; refresh until they are.
  useEffect(() => {
    if (!complaints.some((c) => c.category === 'Processing...')) return undefined;
    const interval = setInterval(() => fetchComplaints(true), 2500);
    return () => clearInterval(interval);
  }, [complaints]);

  if (loading) return <div className="page-loading"><Loader className="spin" size={28} /> {t('loading_workspace')}</div>;

  const handleReset = async () => {
    if (!window.confirm(t('confirm_clear'))) return;
    try {
      await api.delete('/complaints/reset');
      setComplaints([]);
      alert(t('db_cleared'));
    } catch (error) {
      console.error('Failed to reset DB:', error);
      alert(t('db_clear_failed'));
    }
  };

  const countFor = (key) => complaints.filter(matchesCard[key]).length;
  const breached = complaints.filter(isBreached).length;
  const dueSoon = complaints.filter(isDueSoon).length;
  const needle = query.trim().toLowerCase();

  const filteredComplaints = complaints.filter((c) =>
    matchesCard[filter](c) &&
    (departmentFilter === 'ALL' || c.department === departmentFilter) &&
    (categoryFilter === 'ALL' || c.category === categoryFilter) &&
    (zoneFilter === 'ALL' || c.zone === zoneFilter) &&
    (priorityFilter === 'ALL' || c.priority === priorityFilter) &&
    (!slaFilter || SLA_FILTERS[slaFilter](c)) &&
    (!needle || [c.ticketNumber, c.category, L.category(c.category), c.translatedText, c.sanitizedText]
      .some((v) => v && String(v).toLowerCase().includes(needle)))
  );

  const firstName = (officer?.name || '').split(' ')[0];
  const scope = officer?.department && officer.role !== 'admin' ? L.department(officer.department) : t('dash_scope_all');

  return <div className="page-container dash">
    <section className="dash-hero">
      <div className="dash-hero-copy">
        <p className="dash-hero-eyebrow"><Sparkles size={14} /> {t('dash_eyebrow')} · {scope}</p>
        <h1>{t(greetingKey(), { name: firstName || t('dash_officer') })}</h1>
        <p className="dash-hero-date">{L.date(new Date(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
        <p className={`dash-hero-alert ${breached ? 'warn' : 'ok'}`}>
          {breached ? <ShieldAlert size={16} /> : <CheckCircle size={16} />}
          {breached ? t('dash_attention', { count: breached }) : t('dash_all_clear')}
        </p>
        {dueSoon > 0 && <p className="dash-hero-alert soon"><Clock size={16} /> {t('dash_due_soon_alert', { count: dueSoon })}</p>}
      </div>
      <div className="dash-hero-actions">
        <Link to="/analytics" className="button light"><BarChart3 size={17} />{t('view_analytics')}</Link>
        <Link to="/map" className="button outline-light"><Map size={17} />{t('nav_map')}</Link>
        {officer?.role === 'admin' && <button type="button" onClick={handleReset} className="button ghost-light"><Trash2 size={16} />{t('clear_db')}</button>}
      </div>
    </section>

    <div className="dash-stats">
      {filterCards.map(({ key, label, icon: Icon, tone }) => {
        const count = countFor(key);
        const share = complaints.length ? Math.round((count / complaints.length) * 100) : 0;
        return (
          <button key={key} type="button" onClick={() => setFilter(key)} className={`dash-stat tone-${tone} ${filter === key ? 'active' : ''}`} aria-pressed={filter === key}>
            <span className="dash-stat-icon"><Icon size={20} /></span>
            <span className="dash-stat-label">{t(label)}</span>
            <span className="dash-stat-number">{L.number(count)}</span>
            <span className="dash-stat-bar"><span style={{ width: `${key === 'ALL' ? 100 : share}%` }} /></span>
            <span className="dash-stat-hint">{key === 'ALL' ? t('dash_hint_total') : t('dash_hint_share', { pct: share })}</span>
          </button>
        );
      })}
    </div>

    <div className="card dash-table-card">
      <div className="dash-toolbar">
        <div className="dash-search">
          <Search size={17} />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('dash_search')} aria-label={t('dash_search')} />
        </div>
        <div className="dash-quick">
          <button type="button" className={`dash-quick-btn late ${slaFilter === 'overdue' ? 'active' : ''}`} aria-pressed={slaFilter === 'overdue'}
            onClick={() => setSlaFilter(slaFilter === 'overdue' ? null : 'overdue')}><AlertTriangle size={14} /> {t('dash_filter_overdue', { count: breached })}</button>
          <button type="button" className={`dash-quick-btn soon ${slaFilter === 'soon' ? 'active' : ''}`} aria-pressed={slaFilter === 'soon'}
            onClick={() => setSlaFilter(slaFilter === 'soon' ? null : 'soon')}><Clock size={14} /> {t('dash_filter_soon', { count: dueSoon })}</button>
          <span className="dash-count">{t('dash_showing', { shown: filteredComplaints.length, total: complaints.length })}</span>
        </div>
      </div>

      <div className="table-filters">
        {canFilterDepartment ? (
          <div className="filter-field filter-role">
            <label htmlFor="department-filter">{t('label_department')}</label>
            <select id="department-filter" value={departmentFilter} onChange={(e) => setDepartmentFilter(e.target.value)}>
              <option value="ALL">{t('all_departments')}</option>
              {departmentIds.map((d) => <option key={d} value={d}>{L.department(d)}</option>)}
            </select>
          </div>
        ) : (
          <div className="filter-field filter-role">
            <span className="filter-caption">{t('label_department')}</span>
            <span className="scope-pill">{L.department(officer.department)}</span>
          </div>
        )}
        <div className="filter-field">
          <label htmlFor="zone-filter">{t('label_zone')}</label>
          <select id="zone-filter" value={zoneFilter} onChange={(e) => setZoneFilter(e.target.value)}>
            <option value="ALL">{t('all_zones')}</option>
            {Object.entries(zones).map(([id, z]) => <option key={id} value={id}>{id} – {z.name}</option>)}
          </select>
        </div>
        <div className="filter-field">
          <label htmlFor="category-filter">{t('filter_category')}</label>
          <select id="category-filter" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="ALL">{t('all_categories')}</option>
            {categories.map((c) => <option key={c} value={c}>{L.category(c)}</option>)}
          </select>
        </div>
        <div className="filter-field filter-priority">
          <label htmlFor="priority-filter">{t('filter_priority')}</label>
          <select id="priority-filter" value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}>
            <option value="ALL">{t('all_priorities')}</option>
            {PRIORITIES.map((p) => <option key={p} value={p}>{L.priority(p)}</option>)}
          </select>
        </div>
      </div>

      <div className="table-scroll">
        <table className="data-table dash-table">
          <thead>
            <tr>
              <th>{t('col_id')}</th><th>{t('col_category')}</th><th>{t('col_department')}</th><th>{t('label_zone')}</th><th>{t('col_priority')}</th>
              <th>{t('col_sla')}</th><th>{t('col_status')}</th><th aria-label={t('col_actions')} />
            </tr>
          </thead>
          <tbody>
            {filteredComplaints.map((c) => {
              const overdue = isBreached(c);
              const soon = isDueSoon(c);
              const priority = c.priority || 'P4';
              const status = c.status || 'OPEN';
              return (
                <tr key={c._id} className={`prio-row-${priority.toLowerCase()} ${overdue ? 'is-overdue' : ''}`}>
                  <td><span className="ticket-chip">{c.ticketNumber || `#${c._id.slice(-6)}`}</span></td>
                  <td className="dash-cat">
                    <strong>{L.category(c.category)}</strong>
                    {preview(c) && <span>{preview(c)}</span>}
                  </td>
                  <td className="dash-dept">{L.department(c.department, t('general'))}</td>
                  <td>{c.zone ? <span className="zone-dot" title={zones[c.zone]?.name}>{c.zone}</span> : <span className="muted">—</span>}</td>
                  <td><span className={`prio-chip prio-${priority.toLowerCase()}`}>{priority}</span></td>
                  <td>
                    {isClosed(c) ? <span className="sla-pill done"><CheckCircle size={13} /> {L.status(status)}</span>
                      : c.slaDeadline ? (
                        <span className={`sla-pill ${overdue ? 'late' : soon ? 'soon' : 'ok'}`} title={soon ? t('dash_due_soon') : undefined}>
                          {overdue ? <AlertTriangle size={13} /> : <Clock size={13} />} {soon && <b>{t('dash_due_soon')} ·</b>} {L.timeRemaining(c.slaDeadline)}
                        </span>
                      ) : <span className="sla-pill none">{L.sla('No SLA')}</span>}
                  </td>
                  <td><span className={`status-chip tone-${STATUS_TONE[status] || 'sky'}`}>{L.status(status)}</span></td>
                  <td><Link to={`/ticket/${c._id}`} className="dash-view" aria-label={`${t('view')} ${c.ticketNumber || ''}`}>{t('view')} <ArrowRight size={15} /></Link></td>
                </tr>
              );
            })}
            {filteredComplaints.length === 0 && (
              <tr><td colSpan="8" className="empty-state"><Inbox size={28} /><br />{t('no_tickets')}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  </div>;
}
