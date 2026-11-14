import { appFetch } from './transport';
export function token() { return localStorage.getItem('studyflow_jwt') || localStorage.getItem('studyflow_token'); }
export function profile() { try { return JSON.parse(localStorage.getItem(localStorage.getItem('studyflow_role') === 'teacher' ? 'studyflow_user' : 'studyflow_student') || '{}'); } catch { return {}; } }
export function owner() { const p = profile(); return `${localStorage.getItem('studyflow_role')}:${p.id ?? p.ID}`; }
export async function authFetch(url, options = {}) {
  const response = await appFetch(url, options);
  if (response.status === 401 && options.headers?.Authorization) window.dispatchEvent(new Event('session-expired'));
  return response;
}
export async function api(url, options = {}) {
  const response = await authFetch(url, { ...options, headers: { ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), Authorization: `Bearer ${token()}`, ...options.headers } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not complete this request. Please retry.');
  return data;
}
export async function pdfBlob(url) {
  if (!url.startsWith('/uploads/')) throw new Error('Invalid material address.');
  const response = await authFetch(url, { headers: { Authorization: `Bearer ${token()}` } });
  if (!response.ok) throw new Error('This PDF could not be opened. Check your connection and access.');
  return response.blob();
}
export async function logout() {
  try { const reg=await navigator.serviceWorker?.getRegistration();const sub=await reg?.pushManager?.getSubscription();if(sub){await api('/api/notifications/unsubscribe',{method:'POST',body:JSON.stringify({endpoint:sub.endpoint})}).catch(()=>{});await sub.unsubscribe();} } catch {}
  try { const reg=await navigator.serviceWorker?.getRegistration();const notifications=await reg?.getNotifications();notifications?.forEach(n=>n.close()); } catch {}
  await import('./saved').then(m => m.clearSaved()).catch(() => {});
  Object.keys(localStorage).filter(k => k.startsWith('studyflow')).forEach(k => localStorage.removeItem(k));
  window.location.assign('/');
}
