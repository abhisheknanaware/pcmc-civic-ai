import { createContext, useContext, useEffect, useRef, useState } from 'react';
import api, { getToken, setToken } from '../services/api';

const AuthContext = createContext(null);
const IDLE_LIMIT_MS = 30 * 60 * 1000; // sign officers out after 30 minutes without activity
const LOGOUT_REASON = 'pcmc_logout_reason';

export function AuthProvider({ children }) {
  const [officer, setOfficer] = useState(null);
  const [checking, setChecking] = useState(Boolean(getToken()));
  const lastActive = useRef(Date.now());

  useEffect(() => {
    if (!getToken()) return;
    api.get('/auth/me')
      .then(({ data }) => setOfficer(data))
      .catch(() => setToken(null))
      .finally(() => setChecking(false));
  }, []);

  useEffect(() => {
    const onLogout = () => setOfficer(null);
    window.addEventListener('pcmc:logout', onLogout);
    return () => window.removeEventListener('pcmc:logout', onLogout);
  }, []);

  const logout = (reason) => {
    setToken(null);
    setOfficer(null);
    try { if (reason) sessionStorage.setItem(LOGOUT_REASON, reason); } catch { /* storage unavailable */ }
  };

  // Inactivity timeout on shared office computers.
  useEffect(() => {
    if (!officer) return undefined;
    lastActive.current = Date.now();
    const touch = () => { lastActive.current = Date.now(); };
    const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    const timer = setInterval(() => {
      if (Date.now() - lastActive.current > IDLE_LIMIT_MS) logout('idle');
    }, 30 * 1000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, touch));
      clearInterval(timer);
    };
  }, [officer]);

  const login = async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    setToken(data.token);
    try { sessionStorage.removeItem(LOGOUT_REASON); } catch { /* storage unavailable */ }
    setOfficer({ _id: data._id, name: data.name, email: data.email, role: data.role, department: data.department, weakPassword: data.weakPassword });
  };

  // After a password change the server issues a fresh token (older sessions stop working).
  const passwordChanged = (token) => {
    setToken(token);
    setOfficer((o) => (o ? { ...o, weakPassword: false } : o));
  };

  return <AuthContext.Provider value={{ officer, checking, login, logout, passwordChanged }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
export const popLogoutReason = () => {
  try {
    const reason = sessionStorage.getItem(LOGOUT_REASON);
    sessionStorage.removeItem(LOGOUT_REASON);
    return reason;
  } catch {
    return null;
  }
};
