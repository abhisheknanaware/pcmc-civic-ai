import { createContext, useContext, useEffect, useState } from 'react';
import api from '../services/api';

// PCMC zones, departments and categories from config/pcmc.json (via GET /api/meta).
const EMPTY = { corporation: null, zones: {}, departments: [], categories: [], ready: false };
const MetaContext = createContext(EMPTY);

export function MetaProvider({ children }) {
  const [meta, setMeta] = useState(EMPTY);

  useEffect(() => {
    api.get('/meta')
      .then(({ data }) => setMeta({ ...data, departmentIds: data.departments.map((d) => d.id), ready: true }))
      .catch((error) => console.error('Failed to load PCMC reference data:', error));
  }, []);

  return <MetaContext.Provider value={meta}>{children}</MetaContext.Provider>;
}

export const useMeta = () => useContext(MetaContext);
