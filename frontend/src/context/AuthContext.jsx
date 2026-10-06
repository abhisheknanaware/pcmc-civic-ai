import { createContext, useContext, useEffect, useState } from 'react';
import api, { getToken, setToken } from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [officer, setOfficer] = useState(null);
  const [checking, setChecking] = useState(Boolean(getToken()));

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

  const login = async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    setToken(data.token);
    setOfficer({ _id: data._id, name: data.name, email: data.email, role: data.role, department: data.department });
  };

  const logout = () => {
    setToken(null);
    setOfficer(null);
  };

  return <AuthContext.Provider value={{ officer, checking, login, logout }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
