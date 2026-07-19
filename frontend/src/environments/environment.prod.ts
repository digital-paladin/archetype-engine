/** Prod API — prefer runtime `window.__ENV__.API_URL` (public/env.js); never fall back to localhost. */
const PROD_API_FALLBACK =
  'https://digital-paladin-gamification-system-production.up.railway.app';

export const environment = {
  production: true,
  apiUrl: (window as any).__ENV__?.API_URL || PROD_API_FALLBACK,
};
