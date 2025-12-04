import { initializeStore, store, fetchAndDisplayScanWorks } from './store.js';
import { renderApp, getDOM, showNotification, showConsolidatedUpdatePopup, loadingManager, updateFaviconBadge, appendCardsToContainer, generateSkeletonCards } from './ui.js';
import { getLastCheckTimestamp, setLastCheckTimestamp, setMangaCache, setMangaCacheVersion, getMangaCache, getMangaCacheVersion, saveScansListToCache, loadScansListFromCache, getMetadata, setMetadata, clearMangaCache, saveLightIndexToCache, loadLightIndexFromCache } from './cache.js';
import { SCANS_INDEX_URL, INDEX_URL, UPDATE_CHECK_INTERVAL_MS, ITEMS_PER_PAGE } from './constants.js';

import { SmartDebounce, SmartAutocomplete } from './smart-debounce.js';
import { searchEngine, keyboardShortcuts, parseQueryFilters } from './search-engine.js';
import { errorNotificationManager } from './error-handler.js';
import { GestureNavigationManager } from './touch-gestures.js';
import { analytics } from './local-analytics.js';

// Lazy Loading PageManager
import * as PageManager from './page-manager.js';

import './shared-utils.js';

// Sistema global de debug
window.GIKAMURA_DEBUG = localStorage.getItem('gikamura_debug') === 'true';

// Feature flag para lazy loading (ativar gradualmente)
// LAZY_LOADING_ENABLED: true = usa PageManager com sliding window
// LAZY_LOADING_ENABLED: false = comportamento anterior (carrega tudo)
const LAZY_LOADING_ENABLED = localStorage.getItem('gikamura_lazy_loading') !== 'false'; // Default: true

// Helper para alternar lazy loading
window.toggleLazyLoading = () => {
    const current = localStorage.getItem('gikamura_lazy_loading') !== 'false';
    localStorage.setItem('gikamura_lazy_loading', (!current).toString());
    console.log(`Lazy loading ${!current ? 'ativado' : 'desativado'}. Recarregue a página.`);
    return !current;
};

// Intervalo de verificação periódica
let updateCheckInterval = null;

// Helper para alternar debug
window.toggleGikamuraDebug = () => {
    window.GIKAMURA_DEBUG = !window.GIKAMURA_DEBUG;
    localStorage.setItem('gikamura_debug', window.GIKAMURA_DEBUG.toString());
    console.log(`Debug ${window.GIKAMURA_DEBUG ? 'ativado' : 'desativado'}`);
    return window.GIKAMURA_DEBUG;
};

// Sistema integrado de busca e autocomplete
let autocomplete = null;
let searchDebounce = null;
let isSearchSystemInitialized = false;

// Flag para evitar que a verificação de updates rode antes do fim do carregamento inicial
let isInitialLoadComplete = false;

// Sistema de autocomplete para scans
let scanAutocomplete = null;
let scanSearchDebounce = null;
let currentScanUrl = null; // Track qual scan tem autocomplete ativo

// Debug helper
const debugLog = (message, data = {}) => {
    if (window.GIKAMURA_DEBUG) {
        console.log(`[GIKAMURA_DEBUG] ${message}`, data);
    }
};

const setupIntegratedSearchSystem = () => {
    if (isSearchSystemInitialized) {
        debugLog('Sistema de busca já inicializado, ignorando');
        return;
    }

    const dom = getDOM();
    const { allManga, favorites } = store.getState();

    if (allManga.length === 0) {
        debugLog('Dados ainda não carregados, aguardando');
        return;
    }

    try {
        // Limpar sistema anterior se existir
        if (autocomplete) {
            autocomplete.destroy();
            autocomplete = null;
        }
        if (searchDebounce) {
            searchDebounce.cancel();
            searchDebounce = null;
        }

        // Remover event listeners anteriores do input de busca
        const newInput = dom.searchInput.cloneNode(true);
        dom.searchInput.parentNode.replaceChild(newInput, dom.searchInput);
        dom.searchInput = newInput;

        // Registrar fonte de dados no SearchEngine
        searchEngine.registerDataSource('library', () => {
            const state = store.getState();
            return state.allManga.map(m => ({
                ...m,
                isFavorite: state.favorites.has(m.url)
            }));
        });

        // Configurar sistema de busca principal com debounce adaptativo
        searchDebounce = new SmartDebounce(
            (query) => {
                debugLog('Executando busca principal', { query });
                
                // Extrair filtros inline da query
                const { filters, query: cleanQuery } = parseQueryFilters(query);
                
                // Aplicar filtros automaticamente se detectados
                if (filters.type && filters.type !== 'all') {
                    store.setActiveTypeFilter(filters.type);
                }
                if (filters.status && filters.status !== 'all') {
                    store.setActiveStatusFilter(filters.status);
                }
                
                // Atualizar query de busca (sem os filtros inline)
                store.setSearchQuery(cleanQuery || query);
                store.setCurrentPage(1);

                // Adicionar ao histórico do SearchEngine
                if (query.length >= 2) {
                    const results = searchEngine.search(query, { sources: ['library'] });
                    searchEngine.addToHistory(query, results.results.length);
                    analytics?.trackSearch(query, results.results.length, 'search_input');
                }
            },
            {
                wait: 150, // Mais rápido para busca instantânea
                minLength: 0,
                maxWait: 500,
                immediate: false
            }
        );

        // Configurar autocomplete de forma isolada
        autocomplete = new SmartAutocomplete(dom.searchInput, allManga, {
            maxSuggestions: 10, // Mais sugestões
            showRecentSearches: true,
            onSelect: (suggestion) => {
                debugLog('Autocomplete selecionado', { suggestion });
                searchDebounce.execute(suggestion.text);

                analytics?.trackUserInteraction('autocomplete', 'select', {
                    suggestionType: suggestion.type,
                    query: suggestion.text
                });
            },
            onInput: (query) => {
                debugLog('Input no autocomplete', { query });
                
                // Busca instantânea para queries longas
                if (searchEngine.shouldSearchInstantly(query)) {
                    searchDebounce.execute(query);
                } else {
                    searchDebounce.execute(query);
                }
            }
        });

        // Configurar atalhos de teclado
        keyboardShortcuts.on('focusSearch', () => {
            dom.searchInput.focus();
            dom.searchInput.select();
        });
        
        keyboardShortcuts.on('clearSearch', () => {
            dom.searchInput.value = '';
            store.setSearchQuery('');
            store.setCurrentPage(1);
        });
        
        keyboardShortcuts.on('blurSearch', () => {
            if (autocomplete) {
                autocomplete.hide();
            }
        });

        isSearchSystemInitialized = true;
        debugLog('Sistema de busca avançado inicializado com sucesso');

    } catch (error) {
        console.error('Erro ao configurar sistema de busca:', error);
        debugLog('Erro na configuração do sistema de busca', { error: error.message, stack: error.stack });

        errorNotificationManager.showError(
            'Erro no Sistema de Busca',
            'O sistema de busca encontrou um problema. Recarregue a página se necessário.',
            'warning'
        );

        // Analytics: track error
        analytics?.trackError(error, {
            context: 'search_system_setup',
            severity: 'warning'
        });
    }
};

// Sistema de autocomplete para busca nas scans
const setupScanSearchAutocomplete = () => {
    const scanSearchInput = document.getElementById('scan-search-input');
    const { scanWorks, selectedScan } = store.getState();

    if (!scanSearchInput || scanWorks.length === 0 || !selectedScan) {
        debugLog('Input de busca ou obras das scans não disponíveis');
        return;
    }

    // Verificar se já está configurado para esta scan
    const scanUrl = selectedScan.url || JSON.stringify(selectedScan.scan_info);
    if (currentScanUrl === scanUrl && scanAutocomplete) {
        debugLog('Autocomplete já configurado para esta scan, ignorando');
        return;
    }

    try {
        // Limpar autocomplete anterior se existir
        if (scanAutocomplete) {
            scanAutocomplete.destroy();
            scanAutocomplete = null;
        }
        if (scanSearchDebounce) {
            scanSearchDebounce.cancel();
            scanSearchDebounce = null;
        }

        // Atualizar scan atual
        currentScanUrl = scanUrl;

        // Configurar debounce para busca nas scans
        scanSearchDebounce = new SmartDebounce(
            (query) => {
                debugLog('Executando busca em scan', { query });
                store.setScanSearchQuery(query);

                // Analytics
                if (query.length >= 2) {
                    analytics?.trackSearch(query, 0, 'scan_search_input');
                }
            },
            {
                wait: 250,
                minLength: 0,
                maxWait: 1000,
                immediate: false
            }
        );

        // Configurar autocomplete para scans
        scanAutocomplete = new SmartAutocomplete(scanSearchInput, scanWorks, {
            maxSuggestions: 8,
            showRecentSearches: false, // Desabilitar histórico para scans
            onSelect: (suggestion) => {
                debugLog('Autocomplete de scan selecionado', { suggestion });
                scanSearchDebounce.execute(suggestion.text);

                // Analytics
                analytics?.trackUserInteraction('scan_autocomplete', 'select', {
                    suggestionType: suggestion.type,
                    query: suggestion.text
                });
            },
            onInput: (query) => {
                debugLog('Input no autocomplete de scan', { query });
                scanSearchDebounce.execute(query);
            }
        });

        debugLog('Autocomplete de scans inicializado com sucesso', { worksCount: scanWorks.length });

    } catch (error) {
        console.error('Erro ao configurar autocomplete de scans:', error);
        debugLog('Erro na configuração do autocomplete de scans', { error: error.message });
    }
};

async function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        try {
            // Service Worker clássico (não é módulo ES6)
            const registration = await navigator.serviceWorker.register('./sw.js');
            console.log('Service Worker registrado com sucesso:', registration);
            
            if ('periodicSync' in registration) {
                const status = await navigator.permissions.query({ name: 'periodic-background-sync' });
                if (status.state === 'granted') {
                    await registration.periodicSync.register('check-for-updates', {
                        minInterval: 6 * 60 * 60 * 1000,
                    });
                    console.log('Sincronização periódica registrada.');
                } else {
                    console.log('Permissão para sincronização periódica não concedida.');
                }
            }
        } catch (error) {
            console.error('Falha ao registrar o Service Worker:', error);
        }
    }
}

async function handleNotificationsPermission() {
    const { settings } = store.getState();
    if (!settings.notificationsEnabled) return;

    if ('Notification' in window && Notification.permission === 'default') {
        await Notification.requestPermission();
    }
}

function setupEventListeners() {
    const dom = getDOM();
    const { fetchWithTimeout } = window.SharedUtils; // ADICIONAR ESTA LINHA AQUI TAMBÉM

    dom.tabs.addEventListener('click', (e) => {
        const tabButton = e.target.closest('.tab');
        if (tabButton) {
            const tabName = tabButton.dataset.tab;

            // Atualizar atributos de acessibilidade
            dom.tabs.querySelectorAll('.tab').forEach(tab => {
                tab.setAttribute('aria-selected', 'false');
                tab.classList.remove('active');
            });

            tabButton.setAttribute('aria-selected', 'true');
            tabButton.classList.add('active');

            if (tabName === 'updates' && window.location.hash !== '#updates') {
                window.location.hash = 'updates';
            }

            store.setActiveTab(tabName);

            // Focar no conteúdo principal para navegação por teclado
            const mainContent = document.getElementById('main-content');
            if (mainContent) {
                mainContent.focus();
            }



            // Analytics: track tab navigation
            analytics?.trackPageView(tabName);
            debugLog('Tab navegada', { tabName, timestamp: Date.now() });
        }
    });
    
    dom.markAllAsReadBtn.addEventListener('click', () => {
        store.markAllUpdatesAsRead();

        // Analytics: track mark all as read
        analytics?.trackUserInteraction('mark_all_read_btn', 'click');
    });

    // NOVO: Adicionar manipulador de eventos para a página de Scans
    dom.scansContent.addEventListener('click', async (e) => {
        const scanCard = e.target.closest('.scan-card');
        const backButton = e.target.closest('#back-to-scans-btn');
        const favoriteBtn = e.target.closest('.favorite-btn');
        const paginationBtn = e.target.closest('.pagination-btn');

        if (scanCard) {
            const url = scanCard.dataset.url;
            // A action fetchAndDisplayScanWorks agora orquestra todo o processo
            fetchAndDisplayScanWorks(url);
        }

        if (backButton) {
            // Limpar autocomplete ao voltar para lista de scans
            if (scanAutocomplete) {
                scanAutocomplete.destroy();
                scanAutocomplete = null;
            }
            if (scanSearchDebounce) {
                scanSearchDebounce.cancel();
                scanSearchDebounce = null;
            }
            currentScanUrl = null;

            store.clearSelectedScan();
        }

        if (favoriteBtn) {
            e.preventDefault();
            e.stopPropagation(); // Evitar abrir o link ao clicar

            const mangaUrl = favoriteBtn.dataset.url;
            const { favorites } = store.getState();
            const action = favorites.has(mangaUrl) ? 'remove' : 'add';

            store.toggleFavorite(mangaUrl);

            favoriteBtn.classList.add('pulsing');
            favoriteBtn.addEventListener('animationend', () => favoriteBtn.classList.remove('pulsing'), { once: true });

            // Analytics: track favorite action
            analytics?.trackFavoriteAction(mangaUrl, action);
        }

        if (paginationBtn) {
            const page = parseInt(paginationBtn.dataset.page, 10);
            store.setScanWorksCurrentPage(page);
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    });

    // O event listener de busca nas scans agora é gerenciado pelo SmartAutocomplete
    // configurado via setupScanSearchAutocomplete() quando as obras são renderizadas

    // Sistema de busca será configurado após carregamento dos dados
    // Nota: removido o event listener direto para evitar conflitos

    dom.paginationControls.addEventListener('click', async (e) => {
        if (e.target.matches('.pagination-btn')) {
            const page = parseInt(e.target.dataset.page, 10);
            
            // Se lazy loading está habilitado, usar handleLazyPageChange
            if (LAZY_LOADING_ENABLED && PageManager.getLightIndex().length > 0) {
                await handleLazyPageChange(page);
            } else {
                store.setCurrentPage(page);
            }
            
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    });

    document.getElementById('sort-select')?.addEventListener('change', (e) => {
        store.setLibrarySortOrder(e.target.value);
    });

    document.body.addEventListener('click', (e) => {
        const typeButton = e.target.closest('#type-filter-container .filter-btn');
        const statusButton = e.target.closest('#status-filter-container .filter-btn');

        if (LAZY_LOADING_ENABLED && (typeButton || statusButton)) {
            const currentFilters = store.getState();
            const newType = typeButton ? typeButton.dataset.type : currentFilters.activeTypeFilter;
            const newStatus = statusButton ? statusButton.dataset.status : currentFilters.activeStatusFilter;

            // Update store first (this will trigger a re-render of the button states)
            if (typeButton) store.setActiveTypeFilter(newType);
            if (statusButton) store.setActiveStatusFilter(newStatus);
            
            // Then, command the PageManager to create a new filtered index
            PageManager.applyFilters({
                type: newType,
                status: newStatus,
                query: currentFilters.searchQuery
            });
            
            // Finally, navigate to the first page of the new filtered view
            // This will trigger the new window loading logic in PageManager
            handleLazyPageChange(1);

        } else {
            // Fallback or non-lazy-loading behavior
            if (typeButton) store.setActiveTypeFilter(typeButton.dataset.type);
            if (statusButton) store.setActiveStatusFilter(statusButton.dataset.status);
        }
        
        const favoriteBtn = e.target.closest('.favorite-btn');
        if (favoriteBtn) {
            const mangaUrl = favoriteBtn.dataset.url;
            const { favorites } = store.getState();
            const action = favorites.has(mangaUrl) ? 'remove' : 'add';

            store.toggleFavorite(mangaUrl);
            favoriteBtn.classList.add('pulsing');
            favoriteBtn.addEventListener('animationend', () => favoriteBtn.classList.remove('pulsing'), { once: true });

            // Analytics: track favorite action
            analytics?.trackFavoriteAction(mangaUrl, action);
        }

        if (e.target.id === 'reload-page-btn') window.location.reload();

        const groupedNotification = e.target.closest('.notification-grouped');
        if (groupedNotification) {
            e.preventDefault();
            store.setActiveTab('updates');
        }

        // Analytics: track manga view
        const mangaLink = e.target.closest('a[href]');
        if (mangaLink && mangaLink.href.includes('cubari.moe')) {
            analytics?.trackMangaView(mangaLink.href, mangaLink.querySelector('h3')?.textContent || 'Unknown', 'card_click');
        }
    });

    const backToTopButton = document.getElementById('back-to-top');
    window.addEventListener('scroll', () => {
        backToTopButton.classList.toggle('hidden', window.scrollY <= 300);
    });
    backToTopButton.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

    // Configurar autocomplete quando obras das scans forem renderizadas
    window.addEventListener('scan-works-rendered', () => {
        debugLog('Evento scan-works-rendered recebido, configurando autocomplete');
        setupScanSearchAutocomplete();
    });

    dom.notificationsEnabledToggle.addEventListener('change', (e) => {
        store.setSettings({ notificationsEnabled: e.target.checked });
        if (e.target.checked) {
            handleNotificationsPermission();
            startPeriodicUpdateCheck();
        } else {
            stopPeriodicUpdateCheck();
        }
    });

    dom.popupsEnabledToggle.addEventListener('change', (e) => {
        store.setSettings({ popupsEnabled: e.target.checked });
    });

    // Controle de visibilidade: pausar/retomar verificação periódica
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            checkForUpdatesOnFocus();
            // Retomar verificação periódica
            const { settings } = store.getState();
            if (settings.notificationsEnabled && !updateCheckInterval) {
                startPeriodicUpdateCheck();
            }
        } else {
            // Pausar verificação quando aba não está visível (economia de recursos)
            stopPeriodicUpdateCheck();
        }
    });

    window.addEventListener('load', () => {
        if (window.location.hash === '#updates') {
            store.setActiveTab('updates');
        }
    });
}

async function checkForUpdatesOnFocus() {
    const { settings, allManga } = store.getState();
    if (!settings.notificationsEnabled || allManga.length === 0) return;

    // Verificar se já passou tempo suficiente desde a última verificação (5 minutos)
    const lastCheck = parseInt(await getLastCheckTimestamp() || '0');
    const now = Date.now();
    const minInterval = 5 * 60 * 1000; // 5 minutos
    
    if (now - lastCheck < minInterval) {
        debugLog('Verificação ignorada - muito recente', { 
            lastCheck: new Date(lastCheck).toISOString(),
            elapsed: Math.round((now - lastCheck) / 1000) + 's'
        });
        return;
    }

    debugLog("Verificando atualizações ao focar na aba (leve)");
    
    // Usar apenas verificação leve (só metadata, não faz fetch completo)
    await checkForUpdatesInBackground(true);
}

async function findNewChapterUpdates(oldManga, newManga) {
    const oldMangaMap = new Map(oldManga.map(m => [m.url, m]));
    const newUpdates = [];
    const lastCheckTimestamp = parseInt(await getLastCheckTimestamp() || '0');

    newManga.forEach(manga => {
        const oldVersion = oldMangaMap.get(manga.url);
        
        // Detectar obra completamente nova (não existia antes)
        if (!oldVersion) {
            newUpdates.push({
                type: 'new_work',
                manga,
                newChapters: [],
                timestamp: Date.now()
            });
            return;
        }
        
        if (!manga.chapters) return;

        // OTIMIZADO: Usar apenas timestamp para detectar capítulos novos/atualizados
        // Não precisa comparar chaves - se last_updated > lastCheck, é novidade
        const newChaptersInManga = [];
        for (const chapterKey in manga.chapters) {
            const chapter = manga.chapters[chapterKey];
            const chapterTimestamp = parseInt(chapter.last_updated) * 1000;
            
            // Capítulo é novo se timestamp > última verificação
            if (chapterTimestamp > lastCheckTimestamp) {
                newChaptersInManga.push({ 
                    title: chapter.title || `Capítulo ${chapterKey}`, 
                    timestamp: chapterTimestamp,
                    key: chapterKey
                });
            }
        }
        
        if (newChaptersInManga.length > 0) {
            newUpdates.push({
                type: 'new_chapters',
                manga,
                newChapters: newChaptersInManga.sort((a, b) => b.timestamp - a.timestamp),
                timestamp: Date.now()
            });
        }
    });
    
    return newUpdates.sort((a, b) => b.timestamp - a.timestamp);
}

// NOVO: Função para buscar o índice de scans
async function fetchScansIndex() {
    const { fetchWithTimeout } = window.SharedUtils;

    try {
        // Etapa 0: Tentar carregar do cache primeiro
        const cachedScans = await loadScansListFromCache();
        if (cachedScans && cachedScans.length > 0) {
            console.log(`✅ ${cachedScans.length} scans carregadas do cache`);
            store.setScansList(cachedScans);
            // Continuar buscando dados frescos em background
        }

        // Etapa 1: Buscar índice fresco
        const response = await fetchWithTimeout(SCANS_INDEX_URL);
        const index = await response.json();

        // Etapa 2: Buscar informações de cada scan
        const scanPromises = Object.values(index).map(async (scanUrl) => {
            const scanResponse = await fetchWithTimeout(scanUrl);
            const scanData = await scanResponse.json();
            return {
                scan_info: scanData.scan_info,
                url: scanUrl
            };
        });

        const scansList = await Promise.all(scanPromises);

        // Etapa 3: Atualizar store e salvar no cache
        store.setScansList(scansList);
        await saveScansListToCache(scansList);
        console.log(`💾 ${scansList.length} scans salvas no cache`);

    } catch (error) {
        console.error('Falha ao buscar índice de scans:', error);

        // Se falhar e não tem cache, define vazio
        const cachedScans = await loadScansListFromCache();
        if (!cachedScans || cachedScans.length === 0) {
            store.setScansList([]);
        }
    }
}

// ============================================
// LAZY LOADING - Sistema de Paginação Sob Demanda
// ============================================

/**
 * Inicializa o app usando lazy loading com PageManager
 * - Carrega light index (~200KB) para busca
 * - Carrega apenas página atual + janela de ±5 páginas
 * - Remove páginas fora da janela da memória
 */
async function initializeAppWithLazyLoading(dom) {
    debugLog('Iniciando com LAZY LOADING habilitado');
    console.log('📖 Modo Lazy Loading ativado');
    
    // Mostrar skeleton cards enquanto carrega
    const grid = document.getElementById('manga-grid');
    if (grid) {
        grid.innerHTML = generateSkeletonCards(ITEMS_PER_PAGE);
    }
    
    try {
        // Tentar carregar light index do cache
        const cachedIndex = await loadLightIndexFromCache();
        
        // Inicializar PageManager
        const metadata = await PageManager.initialize({
            cachedLightIndex: cachedIndex?.data || null,
            cachedMetadata: cachedIndex?.metadata || null,
            onLoadingStart: () => {
                store.setPageLoading(true);
                debugLog('PageManager: loading start');
            },
            onLoadingEnd: () => {
                store.setPageLoading(false);
                debugLog('PageManager: loading end');
            },
            onPageLoaded: (pageNumber, pageData) => {
                debugLog('PageManager: página carregada', { pageNumber, itemCount: pageData.length });
            }
        });
        
        // Salvar light index no cache se veio do servidor
        if (!cachedIndex) {
            const lightIndex = PageManager.getLightIndex();
            await saveLightIndexToCache(lightIndex, metadata);
        }
        
        // Atualizar store com metadata e light index
        store.setLightIndex(PageManager.getLightIndex());
        store.setCatalogMetadata(metadata);
        console.log('📊 Metadata setado no store:', metadata);

        // PERSISTIR lastUpdated para que o indicador de atualização funcione corretamente
        await setMetadata('catalogLastUpdated', metadata.lastUpdated.toString());
        await setMangaCacheVersion(metadata.version);
        debugLog('LastUpdated e Version persistidos no cache:', { lastUpdated: metadata.lastUpdated, version: metadata.version });
        
        // Configurar callback para quando detalhes são atualizados
        PageManager.setOnDetailsUpdated(() => {
            // Re-renderizar apenas se não estiver em loading
            if (!store.getState().isPageLoading) {
                renderApp();
            }
        });
        
        // Carregar primeira página
        await PageManager.goToPage(1);
        const firstPageData = PageManager.getPageData(1);
        console.log('📖 Dados da página 1:', firstPageData.length, 'itens');
        
        // Setar obras no store (apenas da página 1)
        store.setAllManga(firstPageData);
        store.setLoading(false);
        
        // Agendar busca de detalhes para páginas carregadas
        PageManager.scheduleDetailsForLoadedPages();
        
        // Atualizar subtítulo com total do metadata (não só o que está carregado)
        dom.subtitle.textContent = `${metadata.totalMangas} obras no catálogo`;
        
        // Configurar sistema de busca com light index
        setupLazyLoadingSearchSystem();
        
        // Stats de memória
        const stats = PageManager.getMemoryStats();
        debugLog('PageManager stats', stats);
        console.log(`✅ Lazy loading: ${stats.loadedMangaCount}/${stats.lightIndexSize} obras em memória (${stats.loadedPages} páginas)`);
        
        return true;
        
    } catch (error) {
        console.error('❌ Erro no lazy loading, voltando para modo tradicional:', error);
        debugLog('Erro no lazy loading', { error: error.message });
        
        // Limpar skeleton
        if (grid) grid.innerHTML = '';
        
        // Fallback: retornar false para usar modo tradicional
        return false;
    }
}

/**
 * Configura sistema de busca para lazy loading (usa light index)
 */
const setupLazyLoadingSearchSystem = () => {
    if (isSearchSystemInitialized) {
        debugLog('Sistema de busca já inicializado');
        return;
    }

    const dom = getDOM();
    const lightIndex = PageManager.getLightIndex();

    if (lightIndex.length === 0) {
        debugLog('Light index vazio, aguardando');
        return;
    }

    try {
        // Limpar sistema anterior
        if (autocomplete) {
            autocomplete.destroy();
            autocomplete = null;
        }
        if (searchDebounce) {
            searchDebounce.cancel();
            searchDebounce = null;
        }

        // Remover listeners anteriores
        const newInput = dom.searchInput.cloneNode(true);
        dom.searchInput.parentNode.replaceChild(newInput, dom.searchInput);
        dom.searchInput = newInput;

        // Registrar fonte de dados com light index
        searchEngine.registerDataSource('library', () => {
            const { favorites } = store.getState();
            return lightIndex.map(m => ({
                ...m,
                isFavorite: favorites.has(m.url)
            }));
        });

        // Configurar debounce para busca
        searchDebounce = new SmartDebounce(
            (query) => {
                debugLog('Busca lazy loading', { query });
                
                const { filters, query: cleanQuery } = parseQueryFilters(query);
                store.setSearchQuery(cleanQuery || query);
                
                // Aplicar filtros inline, se houver
                if (filters.type && filters.type !== 'all') {
                    store.setActiveTypeFilter(filters.type);
                }
                if (filters.status && filters.status !== 'all') {
                    store.setActiveStatusFilter(filters.status);
                }

                // Usar o novo mecanismo centralizado de filtros do PageManager
                const state = store.getState();
                PageManager.applyFilters({
                    type: state.activeTypeFilter,
                    status: state.activeStatusFilter,
                    query: cleanQuery || query
                });

                // Navegar para a primeira página dos resultados filtrados
                handleLazyPageChange(1);

                if (query.length >= 2) {
                    const searchResults = PageManager.search(query, {}); // Apenas para contagem
                    searchEngine.addToHistory(query, searchResults.length);
                    analytics?.trackSearch(query, searchResults.length, 'search_input');
                }
            },
            {
                wait: 150,
                minLength: 0,
                maxWait: 500,
                immediate: false
            }
        );

        // Configurar autocomplete
        autocomplete = new SmartAutocomplete(dom.searchInput, lightIndex, {
            maxSuggestions: 10,
            showRecentSearches: true,
            onSelect: (suggestion) => {
                debugLog('Autocomplete selecionado (lazy)', { suggestion });
                
                // Encontrar em qual página está a obra selecionada
                const mangaId = suggestion.id || suggestion.url;
                if (mangaId) {
                    const page = PageManager.findMangaPage(mangaId);
                    if (page > 0) {
                        // Navegar para a página e destacar
                        handleLazyPageChange(page);
                    }
                }
                
                searchDebounce.execute(suggestion.text);
                analytics?.trackUserInteraction('autocomplete', 'select', {
                    suggestionType: suggestion.type,
                    query: suggestion.text
                });
            },
            onInput: (query) => {
                debugLog('Input autocomplete (lazy)', { query });
                searchDebounce.execute(query);
            }
        });

        // Configurar atalhos de teclado
        keyboardShortcuts.on('focusSearch', () => {
            dom.searchInput.focus();
            dom.searchInput.select();
        });
        
        keyboardShortcuts.on('clearSearch', () => {
            dom.searchInput.value = '';
            store.setSearchQuery('');
            // Voltar para página 1 após limpar busca
            handleLazyPageChange(1);
        });
        
        keyboardShortcuts.on('blurSearch', () => {
            if (autocomplete) autocomplete.hide();
        });

        isSearchSystemInitialized = true;
        debugLog('Sistema de busca lazy loading inicializado');

    } catch (error) {
        console.error('Erro ao configurar busca lazy loading:', error);
        errorNotificationManager.showError(
            'Erro no Sistema de Busca',
            'O sistema de busca encontrou um problema.',
            'warning'
        );
    }
};

/**
 * Manipula mudança de página no modo lazy loading
 */
async function handleLazyPageChange(pageNumber) {
    debugLog('Mudando para página (lazy)', { pageNumber });
    
    const grid = document.getElementById('manga-grid');
    
    // Verificar se página já está carregada
    if (!PageManager.isPageLoaded(pageNumber)) {
        // Mostrar skeleton enquanto carrega
        if (grid) {
            grid.innerHTML = generateSkeletonCards(ITEMS_PER_PAGE);
        }
    }
    
    // Navegar no PageManager (carrega se necessário, remove páginas fora da janela)
    await PageManager.goToPage(pageNumber);
    
    // Atualizar store
    store.setCurrentPage(pageNumber);
    const pageData = PageManager.getPageData(pageNumber);
    
    // Sempre atualizar o `allManga` do store com os dados da página recém-carregada.
    // A lógica de filtragem/busca já foi tratada pelo PageManager.
    store.setAllManga(pageData);
    
    // Agendar busca de detalhes para a nova página
    PageManager.scheduleDetailsForPage(pageNumber);
    
    // Log de memória
    const stats = PageManager.getMemoryStats();
    debugLog('Lazy page change complete', { 
        page: pageNumber, 
        loadedPages: stats.loadedPages,
        loadedManga: stats.loadedMangaCount 
    });
}

// Exportar para uso global (event listeners de paginação)
window.handleLazyPageChange = handleLazyPageChange;

// Flag para evitar reinicialização múltipla
let appInitialized = false;

async function initializeApp() {
    // Proteção contra reinicialização
    if (appInitialized) {
        console.warn('⚠️ initializeApp chamado novamente - ignorando');
        debugLog('initializeApp chamado novamente - ignorando');
        return;
    }
    appInitialized = true;
    console.log('🚀 initializeApp iniciando...');
    
    const dom = getDOM();
    await initializeStore();
    store.subscribe(renderApp);
    setupEventListeners();
    renderApp();

    // Iniciar a busca do índice de scans em paralelo
    fetchScansIndex();

    // Configurar gestos touch
    let gestureManager = null;
    if ('ontouchstart' in window) {
        gestureManager = new GestureNavigationManager(store);
    }

    // ============================================
    // LAZY LOADING: Novo fluxo de inicialização
    // ============================================
    if (LAZY_LOADING_ENABLED) {
        debugLog('Tentando inicialização com lazy loading');
        
        const lazySuccess = await initializeAppWithLazyLoading(dom);
        
        if (lazySuccess) {
            // Lazy loading funcionou, configurar resto do app
            await registerServiceWorker();
            await handleNotificationsPermission();
            
            // Iniciar verificação periódica
            const { settings } = store.getState();
            if (settings.notificationsEnabled) {
                startPeriodicUpdateCheck();
            }
            
            isInitialLoadComplete = true;
            return; // Sucesso no lazy loading
        }
        
        // Se lazy loading falhou, continuar com fluxo tradicional
        console.log('⚠️ Lazy loading falhou, usando modo tradicional');
    }

    // ============================================
    // FLUXO TRADICIONAL: Cache completo ou Worker
    // ============================================
    
    // Tentar carregar do cache primeiro
    const cachedManga = await getMangaCache();
    const localVersion = await getMangaCacheVersion();
    const localLastUpdated = await getMetadata('catalogLastUpdated');
    const hasCachedData = cachedManga && cachedManga.length > 0 && localVersion;

    if (hasCachedData) {
        // Cache existe - carregar imediatamente
        debugLog('Carregando do cache (modo tradicional)', { 
            items: cachedManga.length, 
            version: localVersion,
            lastUpdated: localLastUpdated 
        });
        
        store.setAllManga(cachedManga);
        store.setLoading(false);
        dom.subtitle.textContent = `${cachedManga.length} obras no catálogo`;
        
        // Configurar sistema de busca
        setupIntegratedSearchSystem();

        // Registrar Service Worker e permissões
        await registerServiceWorker();
        await handleNotificationsPermission();

        // Se não tiver catalogLastUpdated salvo, buscar do servidor e salvar
        // Isso evita que sempre detecte "atualização disponível" na primeira vez
        if (!localLastUpdated) {
            debugLog('catalogLastUpdated não existe, buscando do servidor...');
            try {
                const { fetchWithTimeout } = window.SharedUtils;
                const response = await fetchWithTimeout(INDEX_URL, { timeout: 10000 });
                const indexData = await response.json();
                const serverLastUpdated = indexData.metadata?.lastUpdated;
                if (serverLastUpdated) {
                    await setMetadata('catalogLastUpdated', serverLastUpdated.toString());
                    debugLog('catalogLastUpdated inicializado', { lastUpdated: serverLastUpdated });
                }
            } catch (e) {
                debugLog('Erro ao buscar lastUpdated inicial', { error: e.message });
            }
        }

        // Verificar se há nova versão em background (baseado no lastUpdated do metadata)
        // Só verificar se já temos catalogLastUpdated para evitar falsos positivos
        if (localLastUpdated) {
            checkForUpdatesInBackground();
        }
        
        // Iniciar verificação periódica
        const { settings } = store.getState();
        if (settings.notificationsEnabled) {
            startPeriodicUpdateCheck();
        }
        
        isInitialLoadComplete = true;
        return;
    }

    // Sem cache - carregar via Worker
    debugLog('Sem cache, carregando via Worker');
    
    const updateWorker = new Worker('./update-worker.js');
    
    // Timeout para Worker principal
    let workerMainTimeout = setTimeout(() => {
        debugLog('Worker principal timeout');
        updateWorker.terminate();
        store.setError('Timeout ao carregar dados. Recarregue a página.');
        store.setLoading(false);

        errorNotificationManager.showError(
            'Timeout no Carregamento',
            'O carregamento demorou muito. Recarregue a página.',
            'error'
        );
    }, 180000); // 3 minutos

    // Suprimir notificações durante carregamento em lote
    store.setSuppressNotify(true);

    updateWorker.onmessage = async (event) => {
        try {
            const { type, payload } = event.data;
            debugLog('Worker principal message', { type, payload: typeof payload });

            switch (type) {
                case 'status-update':
                    dom.subtitle.textContent = payload;
                    break;
                case 'batch-processed':
                    // Esconder loader na primeira batch
                    if (store.getState().isLoading) {
                        const dom = getDOM();
                        dom.mainLoader?.classList.add('hidden');
                    }
                    
                    // Adicionar ao store (sem notificar subscribers)
                    store.addMangaToCatalog(payload);
                    
                    // Renderizar cards progressivamente no DOM
                    const { favorites } = store.getState();
                    appendCardsToContainer(payload, favorites);

                    const currentCount = store.getState().allManga.length;
                    dom.subtitle.textContent = `Carregando... ${currentCount} obras`;
                    break;
                case 'complete':
                    // Reativar notificações
                    store.setSuppressNotify(false);
                    
                    clearTimeout(workerMainTimeout);
                    const { data, updated, version, lastUpdated } = payload;

                    // Se recebemos dados no complete e o store está vazio, usar esses dados
                    // (caso contrário, os batches já popularam o store)
                    if (data && data.length > 0 && store.getState().allManga.length === 0) {
                        store.setAllManga(data);
                    }

                    const totalLoaded = store.getState().allManga.length;
                    dom.subtitle.textContent = `${totalLoaded} obras no catálogo`;

                    if(store.getState().isLoading) store.setLoading(false);

                    // Configurar sistema integrado de busca final
                    setupIntegratedSearchSystem();
                    
                    // Terminar worker antes de salvar cache (libera memória)
                    updateWorker.terminate();
                    
                    // Salvar cache de forma ASSÍNCRONA após render para não bloquear
                    // Isso evita crash de memória no mobile
                    if (updated && version) {
                        setTimeout(async () => {
                            try {
                                const dataToCache = store.getState().allManga;
                                await setMangaCache(dataToCache);
                                await setMangaCacheVersion(version);
                                await setLastCheckTimestamp(Date.now().toString());
                                if (lastUpdated) {
                                    await setMetadata('catalogLastUpdated', lastUpdated.toString());
                                }
                                debugLog('Cache atualizado em background', { version, itemCount: dataToCache.length });
                            } catch (cacheError) {
                                debugLog('Erro ao salvar cache', { error: cacheError.message });
                                console.error('Erro ao salvar cache:', cacheError);
                            }
                        }, 2000); // Aguardar 2s para UI estabilizar
                    }
                    
                    // Iniciar verificação periódica
                    const { settings } = store.getState();
                    if (settings.notificationsEnabled) {
                        startPeriodicUpdateCheck();
                    }

                    isInitialLoadComplete = true;
                    break;
                case 'error':
                    // Reativar notificações em caso de erro
                    store.setSuppressNotify(false);
                    
                    clearTimeout(workerMainTimeout);
                    debugLog('Erro do Worker principal', { error: payload });

                    store.setError(`Erro no carregamento: ${payload}`);
                    store.setLoading(false);
                    updateWorker.terminate();

                    errorNotificationManager.showError(
                        'Erro no Carregamento',
                        'Falha ao carregar dados. Verifique sua conexão.',
                        'error'
                    );

                    // Analytics: track worker error
                    analytics?.trackError(new Error(payload), {
                        context: 'update_worker',
                        severity: 'error'
                    });
                    break;
            }
        } catch (error) {
            // Reativar notificações em caso de exceção
            store.setSuppressNotify(false);
            
            clearTimeout(workerMainTimeout);
            debugLog('Erro ao processar mensagem do Worker', { error: error.message, stack: error.stack });

            store.setError('Erro interno ao processar dados');
            store.setLoading(false);
            updateWorker.terminate();

            errorNotificationManager.showCriticalError(
                'Erro interno ao processar dados do servidor'
            );

            // Analytics: track critical error
            analytics?.trackError(error, {
                context: 'worker_message_processing',
                severity: 'critical'
            });
        }
    };

    updateWorker.onerror = (error) => {
        clearTimeout(workerMainTimeout);
        debugLog('Erro crítico no Worker principal', { error: error.message });

        store.setError('Falha crítica no carregamento');
        store.setLoading(false);
        updateWorker.terminate();

        errorNotificationManager.showCriticalError(
            'Falha crítica no sistema de carregamento'
        );
    };
    
    updateWorker.postMessage({ command: 'start-fetch' });
    
    await registerServiceWorker();
    await handleNotificationsPermission();
}

// Verificar atualizações em background comparando lastUpdated do metadata
async function checkForUpdatesInBackground(showIndicator = true) {
    if (!isInitialLoadComplete) {
        debugLog('Verificação de atualização ignorada, carregamento inicial em andamento.');
        return { hasUpdates: false };
    }
    debugLog('Verificando atualizações em background');
    
    try {
        const { fetchWithTimeout } = window.SharedUtils;
        
        // Buscar apenas o índice para comparar (requisição leve ~50KB)
        const response = await fetchWithTimeout(INDEX_URL, { timeout: 10000 });
        const indexData = await response.json();
        
        const remoteLastUpdated = indexData.metadata?.lastUpdated;
        const remoteVersion = indexData.metadata?.version;
        const remoteTotalMangas = indexData.metadata?.totalMangas;
        
        // Obter timestamps locais
        const localLastUpdated = parseInt(await getMetadata('catalogLastUpdated') || '0');
        const localVersion = await getMangaCacheVersion();
        const localTotalMangas = store.getState().catalogMetadata?.totalMangas || store.getState().allManga.length;
        
        debugLog('Comparando timestamps', { 
            remoteLastUpdated, 
            localLastUpdated,
            remoteVersion,
            localVersion,
            remoteTotalMangas,
            localTotalMangas
        });
        
        // Calcular diferenças
        const newWorksCount = remoteTotalMangas && localTotalMangas > 0 
            ? Math.max(0, remoteTotalMangas - localTotalMangas) 
            : 0;
        const hasNewWorks = newWorksCount > 0;
        const hasNewChapters = remoteLastUpdated && remoteLastUpdated > localLastUpdated;

        // Comparar lastUpdated - detecta QUALQUER mudança (obras ou capítulos)
        if (hasNewChapters || hasNewWorks) {
            debugLog('Novidades detectadas', { 
                hasNewWorks,
                newWorksCount,
                hasNewChapters,
                remote: remoteLastUpdated, 
                local: localLastUpdated
            });
            
            if (showIndicator) {
                showUpdateAvailableIndicator(newWorksCount, hasNewChapters, remoteLastUpdated);
            }
            
            return { hasUpdates: true, remoteLastUpdated, remoteTotalMangas, newWorksCount, hasNewChapters };
        } 
        // Fallback: comparar versão
        else if (remoteVersion && remoteVersion !== localVersion) {
            debugLog('Nova versão detectada', { remote: remoteVersion, local: localVersion });
            
            if (showIndicator) {
                showUpdateAvailableIndicator(newWorksCount, true);
            }
            
            return { hasUpdates: true, remoteVersion };
        }
        
        debugLog('Catálogo atualizado', { version: localVersion, lastUpdated: localLastUpdated });
        return { hasUpdates: false };
        
    } catch (error) {
        debugLog('Erro ao verificar atualizações', { error: error.message });
        return { hasUpdates: false, error: error.message };
    }
}

// Iniciar verificação periódica
function startPeriodicUpdateCheck() {
    // Limpar intervalo anterior se existir
    if (updateCheckInterval) {
        clearInterval(updateCheckInterval);
    }
    
    debugLog('Iniciando verificação periódica', { intervalMs: UPDATE_CHECK_INTERVAL_MS });
    
    updateCheckInterval = setInterval(async () => {
        const { settings } = store.getState();
        if (!settings.notificationsEnabled) return;
        
        // Só verificar se a aba está visível
        if (document.visibilityState !== 'visible') return;
        
        debugLog('Verificação periódica executando...');
        const result = await checkForUpdatesInBackground(true);
        
        if (result.hasUpdates) {
            // Atualizar badge do favicon
            updateFaviconBadge(store.getState().unreadUpdates + 1);
        }
    }, UPDATE_CHECK_INTERVAL_MS);
}

// Parar verificação periódica
function stopPeriodicUpdateCheck() {
    if (updateCheckInterval) {
        clearInterval(updateCheckInterval);
        updateCheckInterval = null;
        debugLog('Verificação periódica parada');
    }
}

// Mostrar indicador visual de atualização disponível
function showUpdateAvailableIndicator(newWorksCount = 0, hasNewChapters = false, remoteLastUpdated = null) {
    // Evitar duplicatas
    if (document.getElementById('update-indicator')) return;
    
    const hasNewWorks = newWorksCount > 0;
    
    const indicator = document.createElement('button');
    indicator.id = 'update-indicator';
    indicator.className = 'fixed bottom-20 right-4 bg-blue-600 hover:bg-blue-700 text-white px-4 py-3 rounded-xl shadow-2xl z-50 flex items-center gap-3 animate-bounce border border-blue-400/30';
    indicator.style.cssText = 'min-width: 200px; backdrop-filter: blur(8px);';
    
    // Texto dinâmico baseado no tipo de atualização
    let buttonText = 'Novidades disponíveis';
    let subText = 'Clique para atualizar';
    
    if (hasNewWorks && hasNewChapters) {
        buttonText = `+${newWorksCount} obras e capítulos`;
        subText = 'Novas obras e capítulos disponíveis';
    } else if (hasNewWorks) {
        buttonText = `+${newWorksCount} novas obras`;
        subText = 'Novas obras adicionadas';
    } else if (hasNewChapters) {
        buttonText = 'Novos capítulos';
        subText = 'Capítulos atualizados disponíveis';
    }
    
    indicator.innerHTML = `
        <svg class="w-6 h-6 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
        </svg>
        <div class="flex flex-col items-start">
            <span class="font-bold text-sm">${buttonText}</span>
            <span class="text-xs text-blue-200">${subText}</span>
        </div>
    `;
    
    indicator.onclick = async () => {
        // Mostrar loading no botão
        indicator.innerHTML = `
            <svg class="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span>Atualizando...</span>
        `;
        indicator.disabled = true;
        
        try {
            // IMPORTANTE: Limpar cache para forçar nova busca
            await clearMangaCache();
            
            // Resetar o catalogLastUpdated para forçar detecção de nova versão
            await setMetadata('catalogLastUpdated', '0');
            await setMetadata('cacheVersion', null);
            
            debugLog('Cache limpo, recarregando página...');
            
            // Pequeno delay para garantir que cache foi limpo
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Recarregar ignorando cache do browser
            window.location.reload(true);
        } catch (error) {
            console.error('Erro ao limpar cache:', error);
            // Fallback: recarregar mesmo assim
            window.location.reload(true);
        }
    };
    
    document.body.appendChild(indicator);
    
    // Atualizar badge do favicon
    updateFaviconBadge(newWorksCount || 1);
    
    // Mudar de bounce para pulse após 3 segundos
    setTimeout(() => {
        indicator.classList.remove('animate-bounce');
        indicator.classList.add('animate-pulse');
    }, 3000);
    
    // Parar animação após 10 segundos mas manter botão
    setTimeout(() => indicator.classList.remove('animate-pulse'), 10000);
}

document.addEventListener('DOMContentLoaded', initializeApp);

// Export para compatibilidade com modules (se necessário)
export { initializeApp, debugLog };
