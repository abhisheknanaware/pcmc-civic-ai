// Zones, departments and categories come from GET /api/meta (config/pcmc.json); see context/MetaContext.
export const PRIORITIES = ['P1', 'P2', 'P3', 'P4'];
export const STATUSES = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_FOR_CUSTOMER', 'RESOLVED', 'CLOSED'];
// Empty in the Docker build: nginx serves the app and proxies /api to the backend on the same origin.
export const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:5000';
