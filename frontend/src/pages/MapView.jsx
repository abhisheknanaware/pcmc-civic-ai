import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet';
import { Link } from 'react-router-dom';
import { Loader, MapPin, AlertCircle, Clock, ChevronRight } from 'lucide-react';
import L from 'leaflet';
import useLabels from '../hooks/useLabels';
import { PRIORITIES } from '../constants';
import api from '../services/api';
import { useMeta } from '../context/MetaContext';

// Fix Leaflet's default icon path issues
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

const getMarkerColor = (priority) => {
  switch(priority) {
    case 'P1': return '#dc2626'; // red
    case 'P2': return '#ea580c'; // orange
    case 'P3': return '#2563eb'; // blue
    default: return '#64748b'; // grey
  }
};

function ChangeView({ center, zoom }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, zoom);
  }, [map, center, zoom]);
  return null;
}

function AutoResize() {
  const map = useMap();
  useEffect(() => {
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);
  return null;
}

export default function MapView() {
  const labels = useLabels();
  const { t } = labels;
  const { departmentIds = [], corporation } = useMeta();
  const [complaints, setComplaints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeComplaint, setActiveComplaint] = useState(null);

  // RBAC Filter State
  const [activeRole, setActiveRole] = useState('ALL');

  // Pimpri-Chinchwad centre from config/pcmc.json
  const cityCenter = corporation?.mapCenter || [18.6298, 73.7997];
  const [mapCenter, setMapCenter] = useState(cityCenter);
  const [mapZoom, setMapZoom] = useState(12);

  useEffect(() => {
    const fetchComplaints = async () => {
      try {
        const response = await api.get('/complaints');
        const geoComplaints = response.data.filter(c => c.location && c.location.latitude && c.location.longitude && c.status !== 'CLOSED' && c.status !== 'RESOLVED');
        setComplaints(geoComplaints);
      } catch (error) {
        console.error('Error fetching complaints:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchComplaints();
  }, []);

  const handleCardClick = (c) => {
    setMapCenter([c.location.latitude, c.location.longitude]);
    setMapZoom(16);
    setActiveComplaint(c._id);
  };

  if (loading) {
    return (
      <div className="page-loading"><Loader className="spin" size={28} /> {t('loading_map')}</div>
    );
  }


  // Filter complaints based on RBAC Role
  const filteredComplaints = complaints.filter(c =>
    activeRole === 'ALL' || c.department === activeRole
  );

  return (
    <div className="map-page">
      <header className="page-header map-header">
        <div>
          <p className="eyebrow">{t('map_eyebrow')}</p>
          <h1 className="page-title">{t('map_title')}</h1>
          <p className="page-subtitle">{t('map_subtitle', { count: filteredComplaints.length })}</p>
        </div>

        <div className="map-role-filter">
          <label htmlFor="map-department-filter">{t('label_department')}</label>
          <select
            id="map-department-filter"
            value={activeRole}
            onChange={(e) => setActiveRole(e.target.value)}
          >
            <option value="ALL">{t('all_departments')}</option>
            {departmentIds.map(d => <option key={d} value={d}>{labels.department(d)}</option>)}
          </select>
        </div>
      </header>

      <div className="map-workspace">
        {/* Sidebar List */}
        <div className="map-ticket-list">
          {filteredComplaints.length === 0 && <p className="card empty-state">{t('map_empty')}</p>}
          {filteredComplaints.map(c => (
            <div
              key={c._id}
              onClick={() => handleCardClick(c)}
              style={{
                background: activeComplaint === c._id ? '#eef2ff' : '#fff',
                border: `1px solid ${activeComplaint === c._id ? 'var(--primary)' : 'var(--border)'}`,
                borderRadius: '12px',
                padding: '16px',
                cursor: 'pointer',
                transition: 'all 0.2s',
                boxShadow: activeComplaint === c._id ? '0 4px 12px rgba(79,70,229,0.1)' : '0 2px 8px rgba(0,0,0,0.02)'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                <span className={`badge ${c.priority === 'P1' ? 'critical' : c.priority === 'P2' ? 'high' : 'medium'}`}>
                  {c.priority}
                </span>
                <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 'bold' }}>{c.zone ? `${t('label_zone')} ${c.zone}` : c.ward || t('general')}</span>
              </div>
              <h4 style={{ margin: '0 0 4px 0', fontSize: '15px', color: 'var(--ink)' }}>{labels.category(c.category)}</h4>
              <p style={{ margin: '0 0 12px 0', fontSize: '13px', color: '#64748b', lineHeight: '1.4' }}>
                {c.originalText.substring(0, 80)}...
              </p>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #f1f5f9', paddingTop: '12px' }}>
                 <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: '#94a3b8' }}>
                    <MapPin size={12} /> {c.location.address ? c.location.address.substring(0, 20) : 'Pimpri-Chinchwad'}
                 </div>
                 <Link to={`/ticket/${c._id}`} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: 'var(--primary)', fontWeight: 'bold', textDecoration: 'none' }}>
                    {t('open')} <ChevronRight size={14} />
                 </Link>
              </div>
            </div>
          ))}
        </div>

        {/* Map Container */}
        <div className="card map-canvas">
          <MapContainer center={cityCenter} zoom={12} style={{ height: '100%', width: '100%', zIndex: 0 }}>
            <ChangeView center={mapCenter} zoom={mapZoom} />
            <AutoResize />
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            {filteredComplaints.map(c => (
              <CircleMarker
                key={c._id}
                center={[c.location.latitude, c.location.longitude]}
                pathOptions={{
                  fillColor: getMarkerColor(c.priority),
                  color: '#ffffff',
                  weight: 2,
                  fillOpacity: 0.8
                }}
                radius={10}
                eventHandlers={{
                  click: () => setActiveComplaint(c._id),
                }}
              >
                <Popup>
                  <div style={{ minWidth: '220px', padding: '4px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                      <span className={`badge ${c.priority === 'P1' ? 'critical' : c.priority === 'P2' ? 'high' : 'medium'}`}>
                        {c.priority}
                      </span>
                    </div>

                    {c.imageUrl && (
                      <img src={c.imageUrl} alt="Evidence" style={{ width: '100%', height: '120px', objectFit: 'cover', borderRadius: '6px', marginBottom: '12px' }} />
                    )}

                    <h4 style={{ margin: '0 0 4px 0', fontSize: '14px', fontFamily: 'Plus Jakarta Sans, sans-serif' }}>{labels.category(c.category)}</h4>
                    <p style={{ margin: '0 0 16px 0', fontSize: '13px', color: '#4b5569', lineHeight: '1.4' }}>
                      {c.originalText.substring(0, 60)}...
                    </p>

                    <Link to={`/ticket/${c._id}`} className="btn btn-primary" style={{ width: '100%', minHeight: '32px', fontSize: '12px', borderRadius: '6px' }}>
                      {t('view_ticket_details')}
                    </Link>
                  </div>
                </Popup>
              </CircleMarker>
            ))}
          </MapContainer>

          {/* Floating Legend */}
          <div style={{ position: 'absolute', bottom: '20px', right: '20px', background: 'white', padding: '16px', borderRadius: '12px', boxShadow: '0 8px 30px rgba(0,0,0,0.12)', zIndex: 400, border: '1px solid var(--border)' }}>
             <h5 style={{ margin: '0 0 12px 0', fontSize: '13px', color: 'var(--ink)' }}>{t('map_legend')}</h5>
             <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {PRIORITIES.map(p => (
                  <span key={p} style={{ fontSize: '12px', color: '#475569', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ width: '12px', height: '12px', borderRadius: '50%', background: getMarkerColor(p), border: '1px solid white', boxShadow: `0 0 0 1px ${getMarkerColor(p)}` }}></span> {labels.priority(p)}
                  </span>
                ))}
             </div>
          </div>
        </div>
      </div>
    </div>
  );
}
