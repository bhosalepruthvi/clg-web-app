import { owner, pdfBlob } from './api';
function db() { return new Promise((resolve, reject) => {
  const request = indexedDB.open('studyflow-saved', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('files', { keyPath: 'key' });
  request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
}); }
async function run(mode, action) {
  const database = await db();
  return new Promise((resolve, reject) => { const tx = database.transaction('files', mode); const req = action(tx.objectStore('files')); tx.oncomplete = () => { database.close(); resolve(req.result); }; tx.onerror = () => { database.close(); reject(tx.error); }; });
}
export async function saveFile(file) {
  const blob = await pdfBlob(file.file_url ?? file.FILE_URL);
  await run('readwrite', store => store.put({ key: `${owner()}:${file.id ?? file.ID}`, owner: owner(), file, blob, savedAt: new Date().toISOString() }));
}
export async function savedFiles() { return (await run('readonly', store => store.getAll())).filter(x => x.owner === owner()); }
export async function savedBlob(file) { return (await run('readonly', store => store.get(`${owner()}:${file.id ?? file.ID}`)))?.blob; }
export function removeSaved(file) { return run('readwrite', store => store.delete(`${owner()}:${file.id ?? file.ID}`)); }
export function clearSaved() { return run('readwrite', store => store.clear()); }
