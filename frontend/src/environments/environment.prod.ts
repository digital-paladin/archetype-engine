export const environment = {
  production: true,
  apiUrl: (window as any).__ENV__?.API_URL || 'http://localhost:3000'
};
