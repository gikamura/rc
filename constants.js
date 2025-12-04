export const ITEMS_PER_PAGE = 21;
export const CACHE_KEY = 'mangaCatalogCache';
export const CACHE_VERSION_KEY = 'mangaCatalogVersion';
export const FAVORITES_KEY = 'mangaFavorites';
export const CACHE_DURATION_MS = 6 * 60 * 60 * 1000; // 6 horas
export const UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutos - verificação periódica
export const INDEX_URL = 'https://raw.githubusercontent.com/gikawork/data/refs/heads/main/hub/index.json';

// Configurações de paginação lazy
export const PAGE_WINDOW_SIZE = 5; // Páginas antes e depois da atual na janela

// NOVO: URL do índice que lista todas as scans
export const SCANS_INDEX_URL = 'https://raw.githubusercontent.com/gikawork/scan/refs/heads/main/index.json';

/**
 * Retorna o estado inicial da aplicação.
 * Usado para inicializar o store e para resetar o estado se necessário.
 */
export function getInitialState() {
    return {
        allManga: [],
        favorites: new Set(),
        updates: [],
        settings: {
            notificationsEnabled: true,
            popupsEnabled: true,
        },
        unreadUpdates: 0, // NOVO: Contador para notificações não lidas
        currentPage: 1,
        searchQuery: '',
        activeTab: 'home',
        activeTypeFilter: 'all',
        activeStatusFilter: 'all',
        librarySortOrder: 'title', // Ordenação da biblioteca
        isLoading: true,
        error: null,
        // LAZY LOADING: Light index para busca rápida
        lightIndex: [], // {id, title, type, cover_url, url} para todas as obras
        catalogMetadata: {
            totalMangas: 0,
            lastUpdated: 0,
            version: ''
        },
        isPageLoading: false, // Loading de página específica
        // NOVOS ESTADOS PARA SCANS
        scansList: [],
        selectedScan: null, // Armazenará os dados da scan selecionada (info e lista de obras)
        isLoadingScans: true,
        scanWorks: [], // Armazenará os detalhes completos das obras da scan selecionada
        scanWorksCurrentPage: 1, // Paginação para as obras da scan
        scanSearchQuery: '', // Busca dentro das obras de uma scan
    };
}

