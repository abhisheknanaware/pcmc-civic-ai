import { useState } from 'react';
import { useLocation, useNavigate, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Loader, LogIn, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const { t } = useTranslation();
  const { officer, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const destination = location.state?.from || '/dashboard';

  if (officer) return <Navigate to={destination} replace />;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await login(email.trim(), password);
      navigate(destination, { replace: true });
    } catch (err) {
      setError(err.response?.status === 401 ? t('login_invalid') : t('login_failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="page-intro centered-intro">
        <p className="eyebrow">{t('officer_portal')}</p>
        <h1 className="page-title">{t('login_title')}</h1>
        <p className="page-copy">{t('login_subtitle')}</p>
      </div>
      <form className="card auth-card" onSubmit={handleSubmit}>
        {error && <div className="alert"><AlertCircle size={18} /> {error}</div>}
        <div className="form-group">
          <label htmlFor="login-email">{t('email_label')}</label>
          <input id="login-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="form-group">
          <label htmlFor="login-password">{t('password_label')}</label>
          <input id="login-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        <button className="button full" type="submit" disabled={loading}>
          {loading ? <Loader size={18} className="spin" /> : <LogIn size={18} />} {t('login_btn')}
        </button>
        <p className="form-note auth-note"><ShieldCheck size={14} /> {t('login_note')}</p>
      </form>
    </div>
  );
}
