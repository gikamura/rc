/**
 * Page Manager - Sistema de Paginação com Janela Deslizante
 * 
 * Gerencia o carregamento lazy de páginas com window de 11 páginas:
 * - 5 páginas antes da atual
 * - Página atual
 * - 5 páginas após a atual
 * 
 * Páginas fora da janela são removidas da memória.
 */

import { ITEMS_PER_PAGE, INDEX_URL } from './constants.js';

// Configuração da janela deslizante
const WINDOW_SIZE = 5; // Páginas antes e depois da atual

/**
 * Fetch com timeout (não depende de SharedUtils)
 */
async function fetchWithTimeout(url, options = {}) {
    const { timeout = 30000 } = options;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(timeoutId);
        return response;
    } catch (error) {
        clearTimeout(timeoutId);
        throw error;
    }
}

/**
 * Estado interno do PageManager
 */
let state = {
    // Light Index: {id, title, type, cover_url} para todas as obras
    lightIndex: [],
    // Mapa de páginas carregadas: pageNumber -> [manga completos]
    loadedPages: new Map(),
    // Metadata do índice
    metadata: {
        totalMangas: 0,
        lastUpdated: 0,
        version: ''
    },
    // Página atual
    currentPage: 1,
    // Flag de inicialização
    initialized: false,
    // Callbacks
    onPageLoaded: null,
    onLoadingStart: null,
    onLoadingEnd: null
};

/**
 * Calcula o total de páginas baseado no metadata
 */
export function getTotalPages() {
    return Math.ceil(state.metadata.totalMangas / ITEMS_PER_PAGE);
}

/**
 * Retorna o metadata do índice
 */
export function getMetadata() {
    return { ...state.metadata };
}

/**
 * Retorna o light index completo (para busca)
 */
export function getLightIndex() {
    return state.lightIndex;
}

/**
 * Verifica se uma página está carregada
 */
export function isPageLoaded(pageNumber) {
    return state.loadedPages.has(pageNumber);
}

/**
 * Retorna as obras de uma página específica
 */
export function getPageData(pageNumber) {
    return state.loadedPages.get(pageNumber) || [];
}

/**
 * Retorna todas as obras carregadas atualmente
 */
export function getAllLoadedManga() {
    const allManga = [];
    // Ordenar por página para manter ordem consistente
    const sortedPages = [...state.loadedPages.keys()].sort((a, b) => a - b);
    for (const page of sortedPages) {
        allManga.push(...state.loadedPages.get(page));
    }
    return allManga;
}

/**
 * Calcula quais páginas devem estar na janela
 */
function getWindowPages(currentPage) {
    const totalPages = getTotalPages();
    const pages = new Set();
    
    // Adicionar páginas na janela: [current - WINDOW_SIZE, current + WINDOW_SIZE]
    for (let i = currentPage - WINDOW_SIZE; i <= currentPage + WINDOW_SIZE; i++) {
        if (i >= 1 && i <= totalPages) {
            pages.add(i);
        }
    }
    
    return pages;
}

/**
 * Remove páginas fora da janela da memória
 */
function pruneOutOfWindowPages(currentPage) {
    const windowPages = getWindowPages(currentPage);
    const pagesToRemove = [];
    
    for (const loadedPage of state.loadedPages.keys()) {
        if (!windowPages.has(loadedPage)) {
            pagesToRemove.push(loadedPage);
        }
    }
    
    for (const page of pagesToRemove) {
        state.loadedPages.delete(page);
        console.log(`🗑️ Página ${page} removida da memória (fora da janela)`);
    }
    
    return pagesToRemove.length;
}

/**
 * Converte entrada do índice para formato light
 */
function indexEntryToLight(key, entry) {
    const chapter = entry.chapters?.[0] || {};
    return {
        id: key,
        title: entry.title || chapter.title || 'Sem título',
        type: chapter.type || inferTypeFromKey(key),
        cover_url: chapter.cover_url || '',
        url: chapter.url || ''
    };
}

/**
 * Infere o tipo da obra pela chave
 */
function inferTypeFromKey(key) {
    if (key.startsWith('makr_')) return 'manhwa';
    if (key.startsWith('majp_')) return 'manga';
    if (key.startsWith('mach_')) return 'manhua';
    if (key.startsWith('maoel_')) return 'oel';
    if (key.startsWith('maot_')) return 'outro';
    return 'manga';
}

/**
 * Converte entrada do índice para formato completo (para cards)
 */
async function indexEntryToFull(key, entry) {
    const chapter = entry.chapters?.[0] || {};
    const cubariUrl = chapter.url || '';
    
    // Dados básicos do índice
    const manga = {
        id: key,
        title: entry.title || chapter.title || 'Sem título',
        type: chapter.type || inferTypeFromKey(key),
        cover_url: chapter.cover_url || '',
        url: cubariUrl,
        // Status será obtido do cubari se necessário
        status: 'unknown',
        chapters: {},
        chapterCount: 0
    };
    
    // Tentar obter detalhes do Cubari (status, capítulos)
    // Por enquanto, usamos apenas dados do índice para performance
    // O fetch detalhado pode ser feito sob demanda
    
    return manga;
}

/**
 * Carrega os dados completos de uma página
 */
async function loadPageData(pageNumber) {
    if (state.loadedPages.has(pageNumber)) {
        return state.loadedPages.get(pageNumber);
    }
    
    const startIndex = (pageNumber - 1) * ITEMS_PER_PAGE;
    const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, state.lightIndex.length);
    
    if (startIndex >= state.lightIndex.length) {
        return [];
    }
    
    const pageItems = state.lightIndex.slice(startIndex, endIndex);
    
    // Converter para formato completo (com dados para renderização)
    // Importante: adicionar imageUrl pois createCardHTML espera esse campo
    const fullItems = pageItems.map(light => ({
        ...light,
        imageUrl: light.cover_url || '', // createCardHTML usa imageUrl
        status: 'unknown', // Pode ser atualizado depois via fetch
        chapters: {},
        chapterCount: 0,
        author: 'N/A',
        artist: 'N/A',
        description: 'Carregando detalhes...'
    }));
    
    state.loadedPages.set(pageNumber, fullItems);
    console.log(`📖 Página ${pageNumber} carregada: ${fullItems.length} obras`);
    
    return fullItems;
}

/**
 * Carrega páginas necessárias para a janela atual
 */
async function loadWindowPages(currentPage) {
    const windowPages = getWindowPages(currentPage);
    const pagesToLoad = [];
    
    for (const page of windowPages) {
        if (!state.loadedPages.has(page)) {
            pagesToLoad.push(page);
        }
    }
    
    if (pagesToLoad.length === 0) {
        return;
    }
    
    // Notificar início do loading
    state.onLoadingStart?.();
    
    console.log(`📚 Carregando ${pagesToLoad.length} páginas: [${pagesToLoad.join(', ')}]`);
    
    // Carregar páginas em paralelo
    await Promise.all(pagesToLoad.map(page => loadPageData(page)));
    
    // Notificar fim do loading
    state.onLoadingEnd?.();
}

/**
 * Navega para uma página específica
 */
export async function goToPage(pageNumber) {
    const totalPages = getTotalPages();
    
    if (pageNumber < 1 || pageNumber > totalPages) {
        console.warn(`Página ${pageNumber} fora do range [1, ${totalPages}]`);
        return false;
    }
    
    state.currentPage = pageNumber;
    
    // Remover páginas fora da janela
    const pruned = pruneOutOfWindowPages(pageNumber);
    if (pruned > 0) {
        console.log(`🧹 ${pruned} páginas removidas da memória`);
    }
    
    // Carregar páginas da nova janela
    await loadWindowPages(pageNumber);
    
    // Notificar callback se configurado
    state.onPageLoaded?.(pageNumber, getPageData(pageNumber));
    
    return true;
}

/**
 * Retorna a página atual
 */
export function getCurrentPage() {
    return state.currentPage;
}

/**
 * Inicializa o PageManager com o índice
 */
export async function initialize(options = {}) {
    if (state.initialized) {
        console.log('⚠️ PageManager já inicializado');
        return state.metadata;
    }
    
    const { 
        onPageLoaded, 
        onLoadingStart, 
        onLoadingEnd,
        cachedLightIndex = null,
        cachedMetadata = null
    } = options;
    
    // Configurar callbacks
    state.onPageLoaded = onPageLoaded;
    state.onLoadingStart = onLoadingStart;
    state.onLoadingEnd = onLoadingEnd;
    
    // Se temos cache, usar
    if (cachedLightIndex && cachedMetadata) {
        state.lightIndex = cachedLightIndex;
        state.metadata = cachedMetadata;
        state.initialized = true;
        console.log(`📦 PageManager inicializado do cache: ${state.lightIndex.length} obras`);
        return state.metadata;
    }
    
    // Buscar índice do servidor
    state.onLoadingStart?.();
    
    try {
        const response = await fetchWithTimeout(INDEX_URL, { timeout: 30000 });
        const indexData = await response.json();
        
        // Extrair metadata
        state.metadata = {
            totalMangas: indexData.metadata?.totalMangas || 0,
            lastUpdated: indexData.metadata?.lastUpdated || 0,
            version: indexData.metadata?.version || '1.0.0'
        };
        
        // Converter para light index
        const entries = Object.entries(indexData.mangas || {});
        state.lightIndex = entries.map(([key, entry]) => indexEntryToLight(key, entry));
        
        // Atualizar totalMangas se necessário
        if (state.metadata.totalMangas === 0) {
            state.metadata.totalMangas = state.lightIndex.length;
        }
        
        state.initialized = true;
        console.log(`✅ PageManager inicializado: ${state.lightIndex.length} obras, ${getTotalPages()} páginas`);
        
    } catch (error) {
        console.error('❌ Erro ao inicializar PageManager:', error);
        throw error;
    } finally {
        state.onLoadingEnd?.();
    }
    
    return state.metadata;
}

/**
 * Busca obras no light index
 * @param {string} query - Termo de busca
 * @param {object} filters - Filtros {type, status}
 * @returns {Array} Resultados ordenados por relevância
 */
export function search(query, filters = {}) {
    let results = [...state.lightIndex];
    
    // Aplicar filtro de tipo
    if (filters.type && filters.type !== 'all') {
        results = results.filter(m => m.type === filters.type);
    }
    
    // Aplicar busca por texto
    if (query && query.trim()) {
        const searchTerm = query.toLowerCase().trim();
        results = results.filter(m => {
            const title = (m.title || '').toLowerCase();
            return title.includes(searchTerm);
        });
        
        // Ordenar por relevância (títulos que começam com o termo primeiro)
        results.sort((a, b) => {
            const aTitle = (a.title || '').toLowerCase();
            const bTitle = (b.title || '').toLowerCase();
            const aStarts = aTitle.startsWith(searchTerm);
            const bStarts = bTitle.startsWith(searchTerm);
            
            if (aStarts && !bStarts) return -1;
            if (!aStarts && bStarts) return 1;
            return aTitle.localeCompare(bTitle);
        });
    }
    
    return results;
}

/**
 * Encontra em qual página uma obra está
 * @param {string} mangaId - ID da obra no light index
 * @returns {number} Número da página (1-indexed) ou -1 se não encontrado
 */
export function findMangaPage(mangaId) {
    const index = state.lightIndex.findIndex(m => m.id === mangaId);
    if (index === -1) return -1;
    return Math.floor(index / ITEMS_PER_PAGE) + 1;
}

/**
 * Reseta o estado do PageManager
 */
export function reset() {
    state.lightIndex = [];
    state.loadedPages.clear();
    state.metadata = { totalMangas: 0, lastUpdated: 0, version: '' };
    state.currentPage = 1;
    state.initialized = false;
    console.log('🔄 PageManager resetado');
}

/**
 * Força recarga de uma página específica
 */
export async function reloadPage(pageNumber) {
    state.loadedPages.delete(pageNumber);
    return loadPageData(pageNumber);
}

/**
 * Retorna estatísticas de memória
 */
export function getMemoryStats() {
    let loadedCount = 0;
    for (const [_, items] of state.loadedPages) {
        loadedCount += items.length;
    }
    
    return {
        lightIndexSize: state.lightIndex.length,
        loadedPages: state.loadedPages.size,
        loadedMangaCount: loadedCount,
        totalPages: getTotalPages(),
        currentPage: state.currentPage,
        windowSize: WINDOW_SIZE * 2 + 1
    };
}

// =====================================================
// DETALHES DAS OBRAS - Fetch do Cubari em batches
// =====================================================

// Cache de detalhes já buscados (evita refetch)
const detailsCache = new Map();

// Fila de obras aguardando detalhes
let detailsQueue = [];
let isProcessingDetails = false;

// Callback para notificar quando detalhes são atualizados
let onDetailsUpdated = null;

/**
 * Configura callback para quando detalhes são atualizados
 */
export function setOnDetailsUpdated(callback) {
    onDetailsUpdated = callback;
}

/**
 * Extrai o gist ID de uma URL do Cubari
 */
function extractGistId(cubariUrl) {
    // URL formato: https://cubari.moe/read/gist/cmF3L2dpa2F3b3JrL2RhdGEvcmVmcy9oZWFkcy9tYWluL21oYXcvbWFrcl8xOTcwLmpzb24/
    const match = cubariUrl.match(/\/gist\/([^/]+)/);
    return match ? match[1] : null;
}

/**
 * Busca detalhes de uma obra do Cubari
 */
async function fetchMangaDetails(manga) {
    const cacheKey = manga.url || manga.id;
    
    // Verificar cache
    if (detailsCache.has(cacheKey)) {
        return detailsCache.get(cacheKey);
    }
    
    const gistId = extractGistId(manga.url);
    if (!gistId) {
        return null;
    }
    
    try {
        // Decodificar gist ID (base64) para obter URL do JSON
        const decodedPath = atob(gistId);
        const jsonUrl = `https://raw.githubusercontent.com/${decodedPath}`;
        
        const response = await fetchWithTimeout(jsonUrl, { timeout: 10000 });
        if (!response.ok) {
            return null;
        }
        
        const data = await response.json();
        
        // Extrair detalhes
        const details = {
            author: data.author || 'N/A',
            artist: data.artist || 'N/A',
            description: data.description || '',
            status: data.status || 'unknown',
            chapterCount: Object.keys(data.chapters || {}).length,
            chapters: data.chapters || {}
        };
        
        // Salvar no cache
        detailsCache.set(cacheKey, details);
        
        return details;
        
    } catch (error) {
        console.warn(`⚠️ Erro ao buscar detalhes de ${manga.title}:`, error.message);
        return null;
    }
}

/**
 * Processa a fila de detalhes em batches
 */
async function processDetailsQueue() {
    if (isProcessingDetails || detailsQueue.length === 0) {
        return;
    }
    
    isProcessingDetails = true;
    const BATCH_SIZE = 10; // Processar 10 por vez para não sobrecarregar
    const BATCH_DELAY = 100; // 100ms entre batches
    
    console.log(`📋 Processando fila de detalhes: ${detailsQueue.length} obras`);
    
    while (detailsQueue.length > 0) {
        const batch = detailsQueue.splice(0, BATCH_SIZE);
        
        // Buscar detalhes em paralelo (dentro do batch)
        const results = await Promise.allSettled(
            batch.map(async (manga) => {
                const details = await fetchMangaDetails(manga);
                if (details) {
                    // Atualizar o objeto manga diretamente
                    Object.assign(manga, details);
                    return manga;
                }
                return null;
            })
        );
        
        // Contar sucessos
        const updated = results.filter(r => r.status === 'fulfilled' && r.value).length;
        if (updated > 0) {
            console.log(`✅ ${updated} detalhes atualizados`);
            // Notificar que detalhes foram atualizados
            onDetailsUpdated?.();
        }
        
        // Pausa entre batches
        if (detailsQueue.length > 0) {
            await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
        }
    }
    
    isProcessingDetails = false;
    console.log('📋 Fila de detalhes processada');
}

/**
 * Agenda busca de detalhes para as obras de uma página
 * @param {number} pageNumber - Número da página
 */
export function scheduleDetailsForPage(pageNumber) {
    const pageData = state.loadedPages.get(pageNumber);
    if (!pageData) return;
    
    // Adicionar obras que ainda não têm detalhes
    for (const manga of pageData) {
        const cacheKey = manga.url || manga.id;
        // Só adicionar se não está no cache e não está na fila
        if (!detailsCache.has(cacheKey) && manga.author === 'N/A') {
            if (!detailsQueue.includes(manga)) {
                detailsQueue.push(manga);
            }
        }
    }
    
    // Iniciar processamento se não está rodando
    processDetailsQueue();
}

/**
 * Busca detalhes para todas as páginas carregadas atualmente
 */
export function scheduleDetailsForLoadedPages() {
    for (const pageNumber of state.loadedPages.keys()) {
        scheduleDetailsForPage(pageNumber);
    }
}

/**
 * Limpa cache de detalhes
 */
export function clearDetailsCache() {
    detailsCache.clear();
    detailsQueue = [];
}
