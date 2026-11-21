let connection;
export function storage(prefix = 'real') {
  async function access(mode, operation) {
    connection ??= new Promise((resolve, reject) => {
      const request = indexedDB.open('serendipity-tube', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('state');
      request.onsuccess = () => resolve(request?.result);
      request.onerror = () => reject(request.error);
    });
    const database = await connection;
    return new Promise((resolve, reject) => {
      const tx = database.transaction('state', mode);
      const request = operation(tx.objectStore('state'));
      tx.oncomplete = () => resolve(request?.result);
      tx.onabort = () => reject(tx.error);
    });
  }
  return {
    async get(key, fallback) {
      try { return (await access('readonly', store => store.get(prefix + ':' + key))) ?? fallback; }
      catch { return key === 'settings' ? JSON.parse(localStorage.getItem(prefix + ':settings') || 'null') ?? fallback : fallback; }
    },
    async set(key, value) {
      try { await access('readwrite', store => store.put(value, prefix + ':' + key)); }
      catch (error) {
        if (key !== 'settings') throw error;
        localStorage.setItem(prefix + ':settings', JSON.stringify(value));
      }
    },
    async replace(values) {
      await access('readwrite', store => {
        for (const [key, value] of Object.entries(values)) store.put(value, prefix + ':' + key);
        return null;
      });
    },
    async clear() {
      await access('readwrite', store => store.delete(IDBKeyRange.bound(prefix + ':', prefix + ':\uffff')));
      localStorage.removeItem(prefix + ':settings');
    }
  };
}
