export const mode = import.meta.env.VITE_API_MODE === 'demo' ? 'demo' : 'live';
export const milestoneBackend =
  mode === 'live' && import.meta.env.VITE_BACKEND_PROFILE !== 'document';
export const apiBase = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
