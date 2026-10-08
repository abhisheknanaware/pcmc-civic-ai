import axios from 'axios';
import { API_BASE } from '../constants';

const TOKEN_KEY = 'pcmc_officer_token';

export const getToken = () => {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
};
export const setToken = (token) => {
  try { token ? localStorage.setItem(TOKEN_KEY, token) : localStorage.removeItem(TOKEN_KEY); } catch { /* storage unavailable */ }
};

const api = axios.create({ baseURL: `${API_BASE}/api` });

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Expired or revoked officer session: drop the token and let the auth context send the officer to login.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && getToken()) {
      setToken(null);
      window.dispatchEvent(new Event('pcmc:logout'));
    }
    return Promise.reject(error);
  }
);

// fetch() with the officer token, for streaming responses axios can't read incrementally.
export const authFetch = (path, options = {}) => {
  const token = getToken();
  return fetch(`${API_BASE}/api${path}`, {
    ...options,
    headers: { ...(options.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
};

export const submitComplaint = async (formData) => {
  const response = await api.post('/complaints', formData);
  return response.data;
};

export const getComplaintStatus = async (ticketNumber, email) => {
  const response = await api.post('/complaints/status', { ticketNumber, email });
  return response.data;
};

export const submitFeedback = async (payload) => {
  const response = await api.post('/complaints/feedback', payload);
  return response.data;
};

export default api;
