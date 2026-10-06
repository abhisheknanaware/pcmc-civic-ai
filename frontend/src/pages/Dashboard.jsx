import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, Inbox, AlertTriangle, CheckCircle, Clock, Trash2, Loader } from 'lucide-react';
import useLabels from '../hooks/useLabels';
import { PRIORITIES } from '../constants';
import api from '../services/api';
import { useMeta } from '../context/MetaContext';
import { useAuth } from '../context/AuthContext';

const filterCards = [
  { key: 'ALL', label: 'stat_total', icon: Inbox, tone: '' },
  { key: 'OPEN', label: 'stat_open', icon: Clock, tone: '' },
  { key: 'HIGH_PRIORITY', label: 'stat_high', icon: AlertTriangle, tone: 'warning' },
  { key: 'RESOLVED', label: 'stat_resolved', icon: CheckCircle, tone: 'success' },
];

const isClosed = (c) => c.status === 'RESOLVED' || c.status === 'CLOSED';
const isHighPriority = (c) => c.priority === 'P1' || c.priority === 'P2';
const matchesCard = {
  ALL: () => true,
  OPEN: (c) => c.status === 'OPEN',
  HIGH_PRIORITY: isHighPriority,
  RESOLVED: isClosed,
};

export default function Dashboard() {
  const L = useLabels();
  const { t } = L;
  const { departmentIds = [], categories, zones } = useMeta();
  const { officer } = useAuth();
  // Department officers are scoped by the server; only admins get the department filter.
  const canFilterDepartment = officer?.role === 'admin' || !officer?.department;
  const [zoneFilter, setZoneFilter] = useState('ALL');
  const [complaints, setComplaints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('ALL');

  const [departmentFilter, setDepartmentFilter] = useState('ALL');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [priorityFilter, setPriorityFilter] = useState('ALL');

  useEffect(() => { fetchComplaints(); }, []);

  useEffect(() => {
    const isAnyProcessing = complaints.some(c => c.category === 'Processing...');
    if (isAnyProcessing) {
      const interval = setInterval(() => {
        fetchComplaints(true);
      }, 2500);
      return () => clearInterval(interval);
    }
  }, [complaints]);

  const fetchComplaints = async (isPolling = false) => {
    try {
      if (!isPolling) setLoading(true);
      const response = await api.get('/complaints');
      setComplaints(response.data);
    } catch (error) { console.error('Failed to fetch complaints:', error); }
    finally { if (!isPolling) setLoading(false); }
  };

  const countFor = (key) => complaints.filter(matchesCard[key]).length;

  const filteredComplaints = complaints.filter(c =>
    matchesCard[filter](c) &&
    (departmentFilter === 'ALL' || c.department === departmentFilter) &&
    (categoryFilter === 'ALL' || c.category === categoryFilter) &&
    (zoneFilter === 'ALL' || c.zone === zoneFilter) &&
    (priorityFilter === 'ALL' || c.priority === priorityFilter)
  );

  if (loading) return <div className="page-loading"><Loader className="spin" size={28} /> {t('loading_workspace')}</div>;

  const handleReset = async () => {
    if (window.confirm(t('confirm_clear'))) {
      try {
        await api.delete('/complaints/reset');
        setComplaints([]);
        alert(t('db_cleared'));
      } catch (error) {
        console.error('Failed to reset DB:', error);
        alert(t('db_clear_failed'));
      }
    }
  };

  return <div className="page-container">
    <header className="page-header dashboard-header">
      <div>
        <p className="eyebrow">{t('dash_eyebrow')}</p>
        <h1 className="page-title">{t('dash_title')}</h1>
        <p className="page-subtitle">{t('dash_subtitle')}</p>
      </div>
      <div className="dashboard-actions">
        {officer?.role === 'admin' && <button onClick={handleReset} className="button secondary clear-db"><Trash2 size={17} />{t('clear_db')}</button>}
        <Link to="/analytics" className="button secondary"><BarChart3 size={17} />{t('view_analytics')}</Link>
      </div>
    </header>

    <div className="stats-grid">
      {filterCards.map(({ key, label, icon: Icon, tone }) => (
        <button key={key} type="button" onClick={() => setFilter(key)} className={`stat-card ${filter === key ? 'active' : ''}`}>
          <span className={`stat-icon ${tone}`}><Icon size={19} /></span>
          <span className="stat-info"><span className="stat-label">{t(label)}</span><span className="stat-number">{L.number(countFor(key))}</span></span>
        </button>
      ))}
    </div>

    <div className="card">
      <div className="table-filters">
        {canFilterDepartment ? (
          <div className="filter-field filter-role">
            <label htmlFor="department-filter">{t('label_department')}</label>
            <select id="department-filter" value={departmentFilter} onChange={(e) => setDepartmentFilter(e.target.value)}>
              <option value="ALL">{t('all_departments')}</option>
              {departmentIds.map(d => <option key={d} value={d}>{L.department(d)}</option>)}
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
            {categories.map(c => <option key={c} value={c}>{L.category(c)}</option>)}
          </select>
        </div>
        <div className="filter-field filter-priority">
          <label htmlFor="priority-filter">{t('filter_priority')}</label>
          <select id="priority-filter" value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}>
            <option value="ALL">{t('all_priorities')}</option>
            {PRIORITIES.map(p => <option key={p} value={p}>{L.priority(p)}</option>)}
          </select>
        </div>
      </div>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t('col_id')}</th><th>{t('col_category')}</th><th>{t('col_department')}</th><th>{t('label_zone')}</th><th>{t('col_priority')}</th>
              <th>{t('col_sla')}</th><th>{t('col_status')}</th><th aria-label={t('col_actions')} />
            </tr>
          </thead>
          <tbody>
            {filteredComplaints.map(c => {
              const isBreached = c.slaDeadline && new Date(c.slaDeadline) < new Date();
              return (
                <tr key={c._id}>
                  <td className="ticket-id">{c.ticketNumber || `#${c._id.slice(-6)}`}</td>
                  <td>{L.category(c.category)}</td>
                  <td>{L.department(c.department, t('general'))}</td>
                  <td>{c.zone || '—'}</td>
                  <td><span className={`priority priority-${(c.priority || 'P4').toLowerCase()}`}>{c.priority || 'P4'}</span></td>
                  <td>
                    {c.slaDeadline ? (
                      <div className="sla-cell">
                        <span className={`badge ${isBreached ? 'critical' : 'success'}`}>
                          {L.sla(isBreached ? 'Breached' : 'On Track')}
                        </span>
                        <span className={`sla-time ${isBreached ? 'overdue' : ''}`}>{L.timeRemaining(c.slaDeadline)}</span>
                      </div>
                    ) : (
                      <span className="badge neutral">{L.sla('No SLA')}</span>
                    )}
                  </td>
                  <td><span className={`badge ${isClosed(c) ? 'success' : 'neutral'}`}>{L.status(c.status || 'OPEN')}</span></td>
                  <td><Link to={`/ticket/${c._id}`} className="button small">{t('view')}</Link></td>
                </tr>
              )
            })}
            {filteredComplaints.length === 0 && <tr><td colSpan="8" className="empty-state">{t('no_tickets')}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  </div>;
}
