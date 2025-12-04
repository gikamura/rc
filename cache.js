import './cache-coordinator.js';

const DB_NAME = 'gikamuraDB';
const DB_VERSION = 4; // Incrementado para adicionar store de light index
// Versão do cache de scans agora é dinâmica (vem do scan_info.version)

const MANGA_STORE = 'mangaCatalog';
const FAVORITES_STORE = 'favorites';
const UPDATES_STORE = 'updates';
const SETTINGS_STORE = 'settings';
const METADATA_STORE = 'metadata';
const SCANS_LIST_STORE = 'scansList';
const SCAN_WORKS_STORE = 'scanWorks';
const LIGHT_INDEX_STORE = 'lightIndex'; // Cache do índice leve para lazy loading

let db;
let cacheCoordinator;

const initDB = () => {
    return new Promise((resolve, reject) => {
        if (db) return resolve(db);

        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = (event) => {
            console.error("Erro ao abrir o IndexedDB:", event);
            reject("Erro ao abrir o banco de dados.");
        };

        request.onsuccess = (event) => {
            db = event.target.result;
            resolve(db);
        };

        request.onupgradeneeded = (event) => {
            const dbInstance = event.target.result;
            if (!dbInstance.objectStoreNames.contains(MANGA_STORE)) {
                dbInstance.createObjectStore(MANGA_STORE, { keyPath: 'url' });
            }
            if (!dbInstance.objectStoreNames.contains(FAVORITES_STORE)) {
                dbInstance.createObjectStore(FAVORITES_STORE, { keyPath: 'url' });
            }
            if (!dbInstance.objectStoreNames.contains(UPDATES_STORE)) {
                const updatesStore = dbInstance.createObjectStore(UPDATES_STORE, { autoIncrement: true });
                updatesStore.createIndex('timestamp', 'timestamp', { unique: false });
            }
            if (!dbInstance.objectStoreNames.contains(SETTINGS_STORE)) {
                dbInstance.createObjectStore(SETTINGS_STORE, { keyPath: 'key' });
            }
            if (!dbInstance.objectStoreNames.contains(METADATA_STORE)) {
                dbInstance.createObjectStore(METADATA_STORE, { keyPath: 'key' });
            }
            // Novas stores para Scans
            if (!dbInstance.objectStoreNames.contains(SCANS_LIST_STORE)) {
                dbInstance.createObjectStore(SCANS_LIST_STORE, { keyPath: 'url' });
            }
            if (!dbInstance.objectStoreNames.contains(SCAN_WORKS_STORE)) {
                const scanWorksStore = dbInstance.createObjectStore(SCAN_WORKS_STORE, { keyPath: 'scanUrl' });
                scanWorksStore.createIndex('timestamp', 'timestamp', { unique: false });
            }
            // Store para light index (lazy loading)
            if (!dbInstance.objectStoreNames.contains(LIGHT_INDEX_STORE)) {
                dbInstance.createObjectStore(LIGHT_INDEX_STORE, { keyPath: 'key' });
            }
        };
    });
};

const getStore = (storeName, mode) => {
    return db.transaction(storeName, mode).objectStore(storeName);
};

const clearStore = (storeName) => {
    return new Promise((resolve, reject) => {
        const store = getStore(storeName, 'readwrite');
        const request = store.clear();
        request.onsuccess = () => resolve();
        request.onerror = (event) => reject(`Erro ao limpar a store ${storeName}: ${event.target.error}`);
    });
};

export const getMangaCache = async () => {
    await initDB();
    return new Promise((resolve, reject) => {
        const store = getStore(MANGA_STORE, 'readonly');
        const request = store.getAll();
        request.onsuccess = () => {
            const result = request.result;
            resolve(result.length > 0 ? result : null);
        };
        request.onerror = (event) => {
            console.error("Erro ao buscar cache de mangás:", event.target.error);
            reject(null);
        };
    });
};

export const setMangaCache = async (data) => {
    await initDB();
    
    // Limpar store primeiro
    await new Promise((resolve, reject) => {
        const clearTx = db.transaction(MANGA_STORE, 'readwrite');
        const clearStore = clearTx.objectStore(MANGA_STORE);
        const clearReq = clearStore.clear();
        clearReq.onsuccess = () => resolve();
        clearReq.onerror = (event) => reject(event.target.error);
    });
    
    // Salvar em lotes de 500 para evitar timeout/quota no mobile
    const BATCH_SIZE = 500;
    const totalBatches = Math.ceil(data.length / BATCH_SIZE);
    
    for (let i = 0; i < totalBatches; i++) {
        const start = i * BATCH_SIZE;
        const end = Math.min(start + BATCH_SIZE, data.length);
        const batch = data.slice(start, end);
        
        await new Promise((resolve, reject) => {
            const transaction = db.transaction(MANGA_STORE, 'readwrite');
            const store = transaction.objectStore(MANGA_STORE);
            
            batch.forEach(item => store.put(item));
            
            transaction.oncomplete = () => resolve();
            transaction.onerror = (event) => {
                console.error(`Erro ao salvar lote ${i + 1}/${totalBatches}:`, event.target.error);
                reject(event.target.error);
            };
        });
    }
    
    console.log(`Cache salvo: ${data.length} itens em ${totalBatches} lotes`);
};

const getMetadata = async (key) => {
    await initDB();
    return new Promise((resolve) => {
        const store = getStore(METADATA_STORE, 'readonly');
        const request = store.get(key);
        request.onsuccess = () => resolve(request.result ? request.result.value : null);
        request.onerror = () => resolve(null);
    });
};

const setMetadata = async (key, value) => {
    await initDB();
    return new Promise((resolve, reject) => {
        const store = getStore(METADATA_STORE, 'readwrite');
        const request = store.put({ key, value });
        request.onsuccess = () => resolve();
        request.onerror = (event) => reject(`Erro ao salvar metadado ${key}: ${event.target.error}`);
    });
};

// ==========================================================
// FUNÇÃO ADICIONADA DE VOLTA
// ==========================================================
export const clearMangaCache = async () => {
    await initDB();
    await clearStore(MANGA_STORE);
    await setMetadata('cacheVersion', null); // Também limpa a versão
};
// ==========================================================

export const loadFavoritesFromCache = async () => {
    await initDB();
    return new Promise((resolve, reject) => {
        const store = getStore(FAVORITES_STORE, 'readonly');
        const request = store.getAll();
        request.onsuccess = () => {
            const favUrls = request.result.map(item => item.url);
            resolve(new Set(favUrls));
        };
        request.onerror = () => resolve(new Set());
    });
};

export const saveFavoritesToCache = async (favoritesSet) => {
    await initDB();
    const transaction = db.transaction(FAVORITES_STORE, 'readwrite');
    const store = transaction.objectStore(FAVORITES_STORE);
    store.clear();
    Array.from(favoritesSet).forEach(url => store.put({ url }));
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = (event) => reject(event.target.error);
    });
};

export const getMangaCacheVersion = () => getMetadata('cacheVersion');
export const setMangaCacheVersion = (version) => setMetadata('cacheVersion', version);
export const getLastCheckTimestamp = () => getMetadata('lastCheckTimestamp');
export const setLastCheckTimestamp = (timestamp) => setMetadata('lastCheckTimestamp', timestamp);

// Exportar getMetadata e setMetadata para uso direto
export { getMetadata, setMetadata };

export const loadSettingsFromCache = async () => {
    await initDB();
    return new Promise((resolve) => {
        const store = getStore(SETTINGS_STORE, 'readonly');
        const request = store.getAll();
        request.onsuccess = () => {
            const defaults = { notificationsEnabled: true, popupsEnabled: true };
            const settingsFromDB = request.result.reduce((acc, setting) => {
                acc[setting.key] = setting.value;
                return acc;
            }, {});
            resolve({ ...defaults, ...settingsFromDB });
        };
        request.onerror = () => resolve({ notificationsEnabled: true, popupsEnabled: true });
    });
};

export const saveSettingsToCache = async (settingsObject) => {
    await initDB();
    const transaction = db.transaction(SETTINGS_STORE, 'readwrite');
    const store = transaction.objectStore(SETTINGS_STORE);
    for (const key in settingsObject) {
        store.put({ key: key, value: settingsObject[key] });
    }
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = (event) => reject(event.target.error);
    });
};

export const loadUpdatesFromCache = async () => {
    await initDB();
    return new Promise((resolve) => {
        const updates = [];
        const store = getStore(UPDATES_STORE, 'readonly');
        const index = store.index('timestamp');
        const request = index.openCursor(null, 'prev'); 
        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                updates.push(cursor.value);
                cursor.continue();
            } else {
                resolve(updates);
            }
        };
        request.onerror = (event) => {
            console.error("Erro ao carregar atualizações via cursor:", event.target.error);
            resolve([]);
        };
    });
};

export const saveUpdatesToCache = async (updatesArray) => {
    await initDB();
    const transaction = db.transaction(UPDATES_STORE, 'readwrite');
    const store = transaction.objectStore(UPDATES_STORE);
    store.clear();
    updatesArray.slice(0, 50).forEach(update => {
        store.add(update);
    });
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = (event) => reject(event.target.error);
    });
};

// ============================================
// NOVAS FUNÇÕES PARA CACHE DE SCANS
// ============================================

/**
 * Salva a lista de scans no IndexedDB
 */
export const saveScansListToCache = async (scansList) => {
    try {
        await initDB();
        const transaction = db.transaction(SCANS_LIST_STORE, "readwrite");
        const store = transaction.objectStore(SCANS_LIST_STORE);
        store.clear();
        scansList.forEach(scan => {
            if (scan && scan.url) {
                store.add({ ...scan, timestamp: Date.now() });
            }
        });
        return new Promise((resolve, reject) => {
            transaction.oncomplete = () => resolve();
            transaction.onerror = (event) => reject(event.target.error);
        });
    } catch (error) {
        console.error("Erro ao salvar scans no cache:", error);
    }
};

export const loadScansListFromCache = async () => {
    try {
        await initDB();
        const transaction = db.transaction(SCANS_LIST_STORE, "readonly");
        const store = transaction.objectStore(SCANS_LIST_STORE);
        const request = store.getAll();
        return new Promise((resolve) => {
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => resolve([]);
        });
    } catch (error) {
        return [];
    }
};

export const saveScanWorksToCache = async (scanUrl, works, scanVersion = null) => {
    try {
        await initDB();
        const transaction = db.transaction(SCAN_WORKS_STORE, "readwrite");
        const store = transaction.objectStore(SCAN_WORKS_STORE);
        store.put({ 
            scanUrl, 
            works, 
            timestamp: Date.now(), 
            scanVersion: scanVersion // Versão do scan_info.version
        });
        return new Promise((resolve, reject) => {
            transaction.oncomplete = () => resolve();
            transaction.onerror = (event) => reject(event.target.error);
        });
    } catch (error) {
        console.error("Erro ao salvar obras da scan no cache:", error);
    }
};

export const loadScanWorksFromCache = async (scanUrl, expectedVersion = null) => {
    try {
        await initDB();
        const transaction = db.transaction(SCAN_WORKS_STORE, "readonly");
        const store = transaction.objectStore(SCAN_WORKS_STORE);
        const request = store.get(scanUrl);
        return new Promise((resolve) => {
            request.onsuccess = () => {
                const cached = request.result;
                if (!cached || !cached.works) {
                    resolve({ works: [], version: null });
                    return;
                }
                
                // Se temos versão esperada, validar contra versão do cache
                if (expectedVersion && cached.scanVersion !== expectedVersion) {
                    console.log(`🔄 Cache de scan desatualizado (v${cached.scanVersion || 'N/A'} vs v${expectedVersion}), ignorando`);
                    resolve({ works: [], version: cached.scanVersion });
                    return;
                }
                
                resolve({ works: cached.works, version: cached.scanVersion });
            };
            request.onerror = () => resolve({ works: [], version: null });
        });
    } catch (error) {
        return { works: [], version: null };
    }
};

// ============================================
// FUNÇÕES PARA LAZY LOADING (LIGHT INDEX)
// ============================================

/**
 * Salva o light index (índice leve para busca) no IndexedDB
 * @param {Array} lightIndex - Array de {id, title, type, cover_url, url, status}
 * @param {Object} metadata - {totalMangas, lastUpdated, version}
 */
export const saveLightIndexToCache = async (lightIndex, metadata) => {
    try {
        await initDB();
        const transaction = db.transaction(LIGHT_INDEX_STORE, 'readwrite');
        const store = transaction.objectStore(LIGHT_INDEX_STORE);
        
        // Salva os dados como um único registro para performance
        store.put({ 
            key: 'lightIndex', 
            data: lightIndex, 
            metadata,
            timestamp: Date.now() 
        });
        
        return new Promise((resolve, reject) => {
            transaction.oncomplete = () => {
                console.log(`✅ Light index salvo (${lightIndex.length} obras)`);
                resolve();
            };
            transaction.onerror = (event) => reject(event.target.error);
        });
    } catch (error) {
        console.error('Erro ao salvar light index:', error);
    }
};

/**
 * Carrega o light index do IndexedDB
 * @param {number} expectedVersion - Versão esperada para validação
 * @returns {Object} { data: Array, metadata: Object } ou null
 */
export const loadLightIndexFromCache = async (expectedVersion = null) => {
    try {
        await initDB();
        const transaction = db.transaction(LIGHT_INDEX_STORE, 'readonly');
        const store = transaction.objectStore(LIGHT_INDEX_STORE);
        const request = store.get('lightIndex');
        
        return new Promise((resolve) => {
            request.onsuccess = () => {
                const cached = request.result;
                if (!cached || !cached.data) {
                    resolve(null);
                    return;
                }
                
                // Validar versão se fornecida
                if (expectedVersion && cached.metadata?.version !== expectedVersion) {
                    console.log(`🔄 Light index desatualizado (v${cached.metadata?.version || 'N/A'} vs v${expectedVersion})`);
                    resolve(null);
                    return;
                }
                
                console.log(`📦 Light index carregado do cache (${cached.data.length} obras)`);
                resolve({ data: cached.data, metadata: cached.metadata });
            };
            request.onerror = () => resolve(null);
        });
    } catch (error) {
        console.error('Erro ao carregar light index:', error);
        return null;
    }
};

/**
 * Limpa o light index do cache
 */
export const clearLightIndexCache = async () => {
    try {
        await initDB();
        const transaction = db.transaction(LIGHT_INDEX_STORE, 'readwrite');
        const store = transaction.objectStore(LIGHT_INDEX_STORE);
        store.clear();
        return new Promise((resolve) => {
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => resolve();
        });
    } catch (error) {
        console.error('Erro ao limpar light index:', error);
    }
};
