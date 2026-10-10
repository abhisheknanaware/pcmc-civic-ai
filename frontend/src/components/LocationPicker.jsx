import { useEffect, useMemo, useState } from 'react';
import { MapContainer, AttributionControl, TileLayer, Marker, CircleMarker, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { Users, Loader, ThumbsUp, CheckCircle, MapPin } from 'lucide-react';
import useLabels from '../hooks/useLabels';
import { useMeta } from '../context/MetaContext';
import api from '../services/api';

// Leaflet's default marker images don't resolve through Vite, so the pin is drawn with CSS.
const pinIcon = L.divIcon({ className: 'picker-pin', html: '<span></span>', iconSize: [28, 28], iconAnchor: [14, 28] });

function ClickToPlace({ onPick }) {
  useMapEvents({ click: (e) => onPick({ latitude: e.latlng.lat, longitude: e.latlng.lng }) });
  return null;
}

function FollowPoint({ point }) {
  const map = useMap();
  useEffect(() => { if (point) map.setView([point.latitude, point.longitude], Math.max(map.getZoom(), 16)); }, [point, map]);
  return null;
}

/**
 * Map to pin the exact spot of a problem, plus the open complaints within 500 m so the citizen can
 * add "Me too" instead of filing a duplicate. Coordinates are reported to the parent form.
 */
export default function LocationPicker({ coordinates, onChange, email }) {
  const L10n = useLabels();
  const { t } = L10n;
  const { corporation } = useMeta();
  const center = useMemo(() => corporation?.mapCenter || [18.6298, 73.7997], [corporation]);
  const [nearby, setNearby] = useState([]);
  const [loading, setLoading] = useState(false);
  const [supported, setSupported] = useState({});
  const [message, setMessage] = useState(null);

  useEffect(() => {
    if (!coordinates) return undefined;
    setLoading(true);
    const timer = setTimeout(() => {
      api.get('/complaints/nearby', { params: { lat: coordinates.latitude, lng: coordinates.longitude } })
        .then(({ data }) => setNearby(data.nearby || []))
        .catch(() => setNearby([]))
        .finally(() => setLoading(false));
    }, 400);
    return () => clearTimeout(timer);
  }, [coordinates]);

  const support = async (item) => {
    setMessage(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '')) {
      setMessage({ type: 'warn', text: t('metoo_need_email') });
      document.getElementById('citizen-email')?.focus();
      return;
    }
    try {
      const { data } = await api.post('/complaints/support', { ticketNumber: item.ticketNumber, email });
      setSupported((s) => ({ ...s, [item.ticketNumber]: true }));
      setNearby((list) => list.map((n) => (n.ticketNumber === item.ticketNumber ? { ...n, affected: data.affected } : n)));
      setMessage({ type: 'ok', text: t('metoo_done', { ticket: item.ticketNumber }) });
    } catch (err) {
      const code = err.response?.data?.message;
      if (code === 'already_supported') {
        setSupported((s) => ({ ...s, [item.ticketNumber]: true }));
        setMessage({ type: 'ok', text: t('metoo_already') });
      } else {
        setMessage({ type: 'warn', text: t(code === 'own_complaint' ? 'metoo_own' : err.response?.status === 429 ? 'too_many_requests' : 'metoo_failed') });
      }
    }
  };

  return (
    <div className="picker">
      <div className="picker-map">
        <MapContainer attributionControl={false} center={center} zoom={13} scrollWheelZoom={false} style={{ height: '100%', width: '100%' }}>
            <AttributionControl prefix='<a href="https://leafletjs.com" target="_blank" rel="noreferrer">Leaflet</a>' />
          <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <ClickToPlace onPick={onChange} />
          <FollowPoint point={coordinates} />
          {nearby.map((n) => (
            <CircleMarker key={n.ticketNumber} center={[n.lat, n.lng]} radius={9} pathOptions={{ color: '#d97706', fillColor: '#f5b041', fillOpacity: 0.8, weight: 2 }}>
              <Tooltip>{L10n.category(n.category)} · {t('metoo_affected', { count: n.affected })}</Tooltip>
            </CircleMarker>
          ))}
          {coordinates && (
            <Marker position={[coordinates.latitude, coordinates.longitude]} icon={pinIcon} draggable
              eventHandlers={{ dragend: (e) => { const p = e.target.getLatLng(); onChange({ latitude: p.lat, longitude: p.lng }); } }} />
          )}
        </MapContainer>
        {!coordinates && <span className="picker-hint"><MapPin size={14} /> {t('picker_hint')}</span>}
      </div>

      {coordinates && (
        <div className="picker-nearby">
          <strong className="picker-nearby-title">
            {loading ? <><Loader size={14} className="spin" /> {t('metoo_checking')}</>
              : nearby.length ? t('metoo_found', { count: nearby.length }) : <><CheckCircle size={14} /> {t('metoo_none')}</>}
          </strong>
          {nearby.length > 0 && !loading && <p className="form-note">{t('metoo_explain')}</p>}
          <ul>
            {nearby.map((n) => (
              <li key={n.ticketNumber}>
                <div>
                  <strong>{L10n.category(n.category)}</strong>
                  <span>{t('metoo_distance', { m: n.distanceM })} · {L10n.status(n.status)} · {L10n.date(n.createdAt, { dateStyle: 'medium' })}</span>
                  <span className="picker-affected"><Users size={13} /> {t('metoo_affected', { count: n.affected })}</span>
                </div>
                <button type="button" className={`metoo-btn ${supported[n.ticketNumber] ? 'done' : ''}`} disabled={supported[n.ticketNumber]} onClick={() => support(n)}>
                  {supported[n.ticketNumber] ? <CheckCircle size={15} /> : <ThumbsUp size={15} />} {t(supported[n.ticketNumber] ? 'metoo_added' : 'metoo_btn')}
                </button>
              </li>
            ))}
          </ul>
          {message && <p className={`picker-msg ${message.type}`}>{message.text}</p>}
        </div>
      )}
    </div>
  );
}
