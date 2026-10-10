import { useEffect, useState } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { Send, AlertCircle, Loader, MapPin, CheckCircle, Search, Sparkles } from 'lucide-react';
import VoiceUpload from '../components/VoiceUpload';
import WebcamUpload from '../components/WebcamUpload';
import LocationPicker from '../components/LocationPicker';
import api, { submitComplaint } from '../services/api';
import useLabels from '../hooks/useLabels';
import { useTranslation } from 'react-i18next';
import { useMeta } from '../context/MetaContext';

const SubmitComplaint = () => {
  const { t } = useTranslation();
  const L = useLabels();
  const location = useLocation();
  const { zones } = useMeta();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(null);

  // The chatbot can hand over a complaint it detected ("Register complaint"), pre-filling the description.
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    location: '',
    zone: '',
    complaint: location.state?.complaint || ''
  });
  // A later hand-off from the chatbot while already on this page updates the description too.
  useEffect(() => {
    if (location.state?.fromChat) {
      setSubmitted(null);
      setFormData((prev) => ({ ...prev, complaint: location.state.complaint || prev.complaint }));
    }
  }, [location.state?.fromChat]);

  const [audioFile, setAudioFile] = useState(null);
  const [imageFile, setImageFile] = useState(null);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [photoHint, setPhotoHint] = useState(null);

  // When a photo is added, ask the AI what it shows (only a hint; officers and the text classifier still decide).
  useEffect(() => {
    setPhotoHint(null);
    if (!imageFile) return undefined;
    let cancelled = false;
    const form = new FormData();
    form.append('image', imageFile);
    setPhotoHint({ loading: true });
    api.post('/complaints/classify-image', form)
      .then(({ data }) => { if (!cancelled) setPhotoHint(data.category ? data : null); })
      .catch(() => { if (!cancelled) setPhotoHint(null); });
    return () => { cancelled = true; };
  }, [imageFile]);
  const [coordinates, setCoordinates] = useState(null);

  const handleGetLocation = () => {
    if (!navigator.geolocation) {
      setError(t('geo_unsupported'));
      return;
    }
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        pickPoint({ latitude, longitude });
        setGpsLoading(false);
      },
      (error) => {
        console.error("Error getting location:", error);
        setError(t('geo_failed'));
        setGpsLoading(false);
      }
    );
  };

  // A point chosen on the map (or by GPS) fills the location field unless the citizen typed an address.
  const [autoLocation, setAutoLocation] = useState(false);
  const pickPoint = (point) => {
    setCoordinates(point);
    if (formData.location && !autoLocation) return;
    setAutoLocation(true);
    setFormData((prev) => ({ ...prev, location: t('gps_value', { lat: point.latitude.toFixed(5), lng: point.longitude.toFixed(5) }) }));
  };

  const handleChange = (e) => {
    if (e.target.name === 'location') setAutoLocation(false);
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.complaint && !audioFile) {
      setError(t('error_need_input'));
      return;
    }

    setLoading(true);
    setError('');

    const data = new FormData();
    data.append('name', formData.name);
    data.append('email', formData.email);
    data.append('location', formData.location);
    if (formData.zone) data.append('zone', formData.zone);
    if (location.state?.chatSessionId) data.append('chatSessionId', location.state.chatSessionId);
    if (formData.complaint) data.append('complaint', formData.complaint);
    if (audioFile) data.append('audio', audioFile);
    if (imageFile) data.append('image', imageFile);
    if (coordinates) {
      data.append('latitude', coordinates.latitude);
      data.append('longitude', coordinates.longitude);
    }

    try {
      const { complaint } = await submitComplaint(data);
      setSubmitted(complaint);
    } catch (err) {
      setError(err.response?.status === 429 ? t('too_many_requests') : err.response?.data?.message || t('error_submit'));
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="submit-page">
        <div className="card submit-success">
          <CheckCircle size={44} className="success-icon" />
          <h1 className="page-title">{t('submit_success_title')}</h1>
          <p className="page-copy">{t('submit_success_copy')}</p>
          <div className="ticket-callout">
            <span>{t('ticket_number_label')}</span>
            <strong>{submitted.ticketNumber}</strong>
          </div>
          <p className="form-note">{t('submit_success_note')}</p>
          <div className="success-actions">
            <Link to="/track" state={{ ticketNumber: submitted.ticketNumber }} className="button"><Search size={16} /> {t('nav_track')}</Link>
            <button type="button" className="button secondary" onClick={() => { setSubmitted(null); setFormData({ name: '', email: '', location: '', zone: '', complaint: '' }); }}>
              {t('submit_another')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="submit-page">

      <div className="page-intro centered-intro">
        <p className="eyebrow">{t('pmc_title')}</p>
        <h1 className="page-title">{t('portal_title')}</h1>
        <p className="page-copy" style={{ margin: '0 auto' }}>{t('subtitle')}</p>
      </div>

    <div className="card">

      {error && (
        <div className="alert">
          <AlertCircle size={20} /> {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="grid grid-2">
          <div className="form-group">
          <label htmlFor="citizen-name">{t('name_label')}</label>
            <input id="citizen-name" type="text" name="name" value={formData.name} onChange={handleChange} required placeholder={t('name_placeholder')} />
          </div>
          <div className="form-group">
          <label htmlFor="citizen-email">{t('email_label')}</label>
            <input id="citizen-email" type="email" name="email" value={formData.email} onChange={handleChange} required placeholder={t('email_placeholder')} />
          </div>
        </div>

        <div className="form-group">
          <label>
            <span>{t('location_label')}</span>
            <button type="button" onClick={handleGetLocation} disabled={gpsLoading}>
              {gpsLoading ? <Loader size={14} className="spin" /> : <MapPin size={14} />}
              {gpsLoading ? t('fetching') : t('use_location')}
            </button>
          </label>
          <div className="input-with-icon">
            <MapPin size={17} aria-hidden="true" />
            <input id="citizen-location" aria-label={t('location_label')} type="text" name="location" value={formData.location} onChange={handleChange} required placeholder={t('location_placeholder')} />
          </div>
          <LocationPicker coordinates={coordinates} onChange={pickPoint} email={formData.email} />
        </div>

        <div className="form-group">
          <label htmlFor="citizen-zone">{t('zone_label')} <span className="form-note">{t('optional')}</span></label>
          <select id="citizen-zone" name="zone" value={formData.zone} onChange={handleChange}>
            <option value="">{t('zone_unknown')}</option>
            {Object.entries(zones).map(([id, zone]) => (
              <option key={id} value={id}>{t('zone_option', { id, name: zone.name, office: zone.office.split(',').slice(-2).join(',').trim() })}</option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label htmlFor="citizen-complaint">{t('describe_label')}</label>
          <textarea
            id="citizen-complaint"
            name="complaint"
            value={formData.complaint}
            onChange={handleChange}
            rows="5"
            maxLength={1000}
            placeholder={t('describe_placeholder')}
          />
          <div className="form-note character-count">{formData.complaint.length}/1000</div>
        </div>

        <VoiceUpload onAudioSet={setAudioFile} />

        <WebcamUpload onCapture={setImageFile} />
        {photoHint && (
          <p className="photo-hint">
            {photoHint.loading ? <><Loader size={14} className="spin" /> {t('photo_hint_checking')}</>
              : <><Sparkles size={14} /> {t('photo_hint', { category: L.category(photoHint.category), pct: Math.round(photoHint.confidence * 100) })}</>}
          </p>
        )}

        <div className="mt-4">
          <button className="button full" type="submit" disabled={loading}>
            {loading ? <><Loader size={20} className="spin" /> {t('submitting_btn')}</> : <><Send size={20} /> {t('submit_btn')}</>}
          </button>
        </div>
      </form></div>
    </div>
  );
};

export default SubmitComplaint;
