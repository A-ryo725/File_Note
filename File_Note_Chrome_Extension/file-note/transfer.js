const openDatabase = () =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open('file-note-file-transfer', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('files', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
export async function queuePdf(file) {
  if (file.size > 200 * 1024 * 1024) throw new Error('200MB以下のファイルを選んでください。');
  const db = await openDatabase(),
    id = crypto.randomUUID();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction('files', 'readwrite'),
        store = tx.objectStore('files');
      store.put({ id, filename: file.name, file, created: Date.now() });
      const cursor = store.openCursor();
      cursor.onsuccess = () => {
        const item = cursor.result;
        if (!item) return;
        if (item.value.created < Date.now() - 1800000) item.delete();
        item.continue();
      };
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    return id;
  } finally {
    db.close();
  }
}
export async function consumePdf(id) {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('files', 'readwrite'),
        store = tx.objectStore('files');
      let value;
      const request = store.get(id);
      request.onsuccess = () => {
        value = request.result;
        store.delete(id);
      };
      tx.oncomplete = () => resolve(value);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
