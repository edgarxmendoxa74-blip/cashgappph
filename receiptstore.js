// =====================================================================
// Receipt photo storage — keeps transaction photos on the phone
//
// Android app: real files in the app's private storage (Capacitor Filesystem)
// Browser / PWA: IndexedDB (far bigger than localStorage)
//
// A saved photo is referenced from a transaction as "local:<id>". Older
// receipts (ImageKit URLs or small data URLs) keep working as before.
// =====================================================================

const ReceiptStore = (() => {
    const PREFIX = 'local:';
    const DB_NAME = 'cashg-receipts';
    const STORE = 'receipts';
    const FOLDER = 'receipts';

    const nativeFs = () => {
        try {
            const cap = window.Capacitor;
            if (cap?.isNativePlatform?.() && cap.Plugins?.Filesystem) return cap.Plugins.Filesystem;
        } catch { /* not native */ }
        return null;
    };

    const isLocal = ref => typeof ref === 'string' && ref.startsWith(PREFIX);
    const idOf = ref => ref.slice(PREFIX.length);

    function blobToDataUrl(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
        });
    }

    // --- IndexedDB (browser) ---
    let dbPromise = null;
    function openDb() {
        if (!dbPromise) {
            dbPromise = new Promise((resolve, reject) => {
                const request = indexedDB.open(DB_NAME, 1);
                request.onupgradeneeded = () => request.result.createObjectStore(STORE);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
            dbPromise.catch(() => { dbPromise = null; });
        }
        return dbPromise;
    }

    async function idb(mode, run) {
        const db = await openDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, mode);
            const request = run(tx.objectStore(STORE));
            tx.oncomplete = () => resolve(request?.result);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
    }

    // Ask the browser not to evict the photos when the phone is low on space
    try { navigator.storage?.persist?.(); } catch { /* ignore */ }

    return {
        isLocal,

        // Saves the photo and returns its "local:<id>" reference
        async save(blob) {
            const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const fs = nativeFs();
            if (fs) {
                const dataUrl = await blobToDataUrl(blob);
                await fs.writeFile({
                    path: `${FOLDER}/${id}.jpg`,
                    data: dataUrl.slice(dataUrl.indexOf(',') + 1),
                    directory: 'DATA',
                    recursive: true
                });
            } else {
                await idb('readwrite', store => store.put(blob, id));
            }
            return PREFIX + id;
        },

        // Returns something an <img> can show, or '' when the photo is gone
        async load(ref) {
            if (!isLocal(ref)) return ref;
            const id = idOf(ref);
            try {
                const fs = nativeFs();
                if (fs) {
                    const file = await fs.readFile({ path: `${FOLDER}/${id}.jpg`, directory: 'DATA' });
                    return `data:image/jpeg;base64,${file.data}`;
                }
                const blob = await idb('readonly', store => store.get(id));
                return blob ? await blobToDataUrl(blob) : '';
            } catch {
                return '';
            }
        },

        async remove(ref) {
            if (!isLocal(ref)) return;
            const id = idOf(ref);
            try {
                const fs = nativeFs();
                if (fs) await fs.deleteFile({ path: `${FOLDER}/${id}.jpg`, directory: 'DATA' });
                else await idb('readwrite', store => store.delete(id));
            } catch { /* already gone */ }
        },

        async removeMany(refs) {
            for (const ref of refs) await this.remove(ref);
        }
    };
})();
