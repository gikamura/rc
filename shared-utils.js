/**
 * Utilitários compartilhados entre contexto principal e Web Workers
 * Este arquivo pode ser usado tanto com import quanto com importScripts
 */

// Configurações compartilhadas
const SHARED_CONFIG = {
    INDEX_URL: 'https://raw.githubusercontent.com/gikawork/data/refs/heads/main/hub/index.json',
    DEFAULT_TIMEOUT: 20000,
    WORKER_TIMEOUT: 15000,
    BATCH_SIZE: 200,
    BATCH_DELAY: 300,
    MAX_RETRIES: 2
};

// Fetch com timeout e retry usando AbortController
const fetchWithTimeout = async (resource, options = {}) => {
    const {
        timeout = SHARED_CONFIG.DEFAULT_TIMEOUT,
        retries = SHARED_CONFIG.MAX_RETRIES,
        ...fetchOptions
    } = options;

    for (let attempt = 0; attempt <= retries; attempt++) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        try {
            const response = await fetch(resource, {
                ...fetchOptions,
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            return response;

        } catch (error) {
            clearTimeout(timeoutId);

            // AbortError é específico do timeout
            if (error.name === 'AbortError') {
                error.message = `Timeout após ${timeout}ms`;
            }

            // Se é a última tentativa, throw error
            if (attempt === retries) {
                throw error;
            }

            // Exponential backoff: wait antes de retry
            const delay = 1000 * Math.pow(2, attempt);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
};

const b64DecodeUnicode = (str) => {
    try {
        return decodeURIComponent(atob(str).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
    } catch (e) {
        console.error('b64DecodeUnicode error:', e);
        return '';
    }
};

// NOVO: Decodifica a URL de um gist do Cubari para obter a URL raw do JSON
const decodeCubariUrl = (cubariUrl) => {
    try {
        const parts = cubariUrl.split('/gist/');
        if (parts.length < 2) return null;
        const gistPart = parts[1].split('/')[0];
        return b64DecodeUnicode(gistPart);
    } catch (error) {
        console.error('Falha ao decodificar URL do Cubari:', error);
        return null;
    }
};

// Determina o tipo da obra - prioriza o type do JSON, fallback para prefixo da chave
const getWorkType = (workKey, workData) => {
    // Se já tem type definido nos dados, usar diretamente
    if (workData.type) {
        return workData.type;
    }
    
    // Fallback: inferir pelo prefixo da chave (ex: KR1017, JP608, CH115)
    if (workKey) {
        const prefix = workKey.substring(0, 2).toUpperCase();
        switch (prefix) {
            case 'KR': return 'manhwa';
            case 'JP': return 'manga';
            case 'CH': return 'manhua';
        }
    }
    
    return 'N/A';
};

// Validação de URL robusta
const validateUrl = (url) => {
    try {
        if (!url || typeof url !== 'string') return false;
        const parsed = new URL(url.trim());
        return ['https:', 'http:'].includes(parsed.protocol);
    } catch {
        return false;
    }
};

// Sanitização de entrada melhorada
const sanitizeInput = (str) => {
    if (typeof str !== 'string') {
        if (str === null || str === undefined) return '';
        str = String(str);
    }

    // Remove caracteres perigosos e scripts
    return str
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/javascript:/gi, '')
        .replace(/on\w+\s*=/gi, '')
        .replace(/[<>'"&]/g, '')
        .trim()
        .substring(0, 1000); // Limita tamanho
};

// Processamento de URL do Cubari com validação robusta
const processMangaUrl = async (chapterUrl, preFetchedData = {}) => {
    try {
        // Validação de entrada
        if (!chapterUrl || typeof chapterUrl !== 'string') {
            throw new Error('URL inválida ou vazia');
        }

        if (!validateUrl(chapterUrl)) {
            throw new Error('Formato de URL inválido');
        }

        const cubariMatch = chapterUrl.match(/cubari\.moe\/read\/gist\/([^/]+)/);
        if (!cubariMatch) {
            return {
                url: chapterUrl,
                error: true,
                title: sanitizeInput(preFetchedData.title) || 'URL Inválida',
                errorDetails: {
                    type: 'validation',
                    message: 'URL não é do formato Cubari esperado',
                    timestamp: Date.now(),
                    retryable: false
                }
            };
        }

        const base64url = decodeURIComponent(cubariMatch[1]);
        let b64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
        while (b64.length % 4) { b64 += '='; }

        let decodedPath = b64DecodeUnicode(b64);

        // FIX: Remove a parte incorreta do caminho para URLs de scans
        decodedPath = decodedPath.replace('/refs/heads/', '/');

        // FIX: Decodifica completamente o caminho para evitar dupla codificação
        try {
            decodedPath = decodeURIComponent(decodedPath);
        } catch (e) {
            // Ignora o erro, o caminho pode já estar decodificado
            console.warn('Falha ao decodificar o caminho, continuando...', e);
        }

        if (decodedPath.startsWith('raw/')) decodedPath = decodedPath.substring(4);

        const pathSegments = decodedPath.split('/');
        const encodedPath = pathSegments.map(segment => encodeURIComponent(segment)).join('/');

        const jsonUrl = `https://raw.githubusercontent.com/${encodedPath}`;

        // Validar URL construída
        if (!validateUrl(jsonUrl)) {
            throw new Error('URL construída é inválida');
        }

        const response = await fetchWithTimeout(jsonUrl, {
            timeout: SHARED_CONFIG.WORKER_TIMEOUT
        });

        const data = await response.json();

        // Validação dos dados recebidos
        if (!data || typeof data !== 'object') {
            throw new Error('Dados JSON inválidos recebidos');
        }

        const latestChapter = Object.values(data.chapters || {}).reduce((latest, chap) =>
            !latest || parseInt(chap.last_updated) > parseInt(latest.last_updated) ? chap : latest, null);

        const imageUrl = preFetchedData.cover_url
            ? preFetchedData.cover_url
            : (data.cover ? data.cover : 'https://placehold.co/256x384/1f2937/7ca3f5?text=Sem+Capa');

        // Tentar diferentes campos para o status (algumas scans usam nomes diferentes)
        const statusValue = data.status || data.Status || data.publication_status || 'Ongoing';

        // NÃO armazenar chapters completo - economiza MUITA memória
        // Os chapters são carregados sob demanda quando o usuário abre a obra
        return {
            url: chapterUrl,
            title: sanitizeInput(preFetchedData.title || data.title) || 'N/A',
            description: sanitizeInput(data.description) || '',
            imageUrl: imageUrl,
            author: sanitizeInput(data.author),
            artist: sanitizeInput(data.artist),
            genres: Array.isArray(data.genres) ? data.genres.map(g => sanitizeInput(g)) : [],
            type: preFetchedData.type || null,
            status: sanitizeInput(statusValue),
            // chapters: data.chapters, // REMOVIDO - economiza ~90% da memória
            chapterCount: data.chapters ? Object.keys(data.chapters).length : null,
            lastUpdated: latestChapter ? parseInt(latestChapter.last_updated) * 1000 : 0,
            error: false
        };
    } catch (error) {
        console.error(`Falha ao processar ${chapterUrl} para a obra "${preFetchedData.title}":`, error);
        return {
            url: chapterUrl,
            title: sanitizeInput(preFetchedData.title) || 'Falha ao Carregar',
            description: `Erro: ${error.message}`,
            imageUrl: 'https://placehold.co/256x384/1f2937/ef4444?text=Erro',
            error: true,
            errorDetails: {
                type: 'processing',
                originalError: error.message,
                timestamp: Date.now(),
                retryable: !error.message.includes('URL Inválida') && !error.message.includes('validation')
            }
        };
    }
};

// Processamento em lotes otimizado
const processInBatches = async (items, batchSize = SHARED_CONFIG.BATCH_SIZE, delay = SHARED_CONFIG.BATCH_DELAY, onBatchProcessed) => {
    let results = [];

    for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);

        const batchPromises = batch.map(([key, mangaSeries]) => {
            const representativeChapter = mangaSeries.chapters[0];
            if (!representativeChapter || !representativeChapter.url) {
                console.warn('Série sem capítulos ou URL válida:', mangaSeries.title);
                return null;
            }

            // Usar o type diretamente do chapter (já vem do index.json)
            const type = representativeChapter.type || null;

            const preFetchedData = {
                title: mangaSeries.title,
                cover_url: representativeChapter.cover_url || null,
                type: type
            };
            return processMangaUrl(representativeChapter.url, preFetchedData);

        }).filter(p => p !== null);

        const batchResults = await Promise.all(batchPromises);

        if (onBatchProcessed) {
            onBatchProcessed(batchResults);
        }

        results = results.concat(batchResults);

        // Delay entre batches (exceto no último)
        if (i + batchSize < items.length) {
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    return results;
};

// Função principal de fetch e processamento
const fetchAndProcessMangaData = async (updateStatus, onBatchProcessed) => {
    updateStatus('Verificando por atualizações...');

    try {
        updateStatus('Buscando índice do GitHub...');
        const response = await fetchWithTimeout(SHARED_CONFIG.INDEX_URL, {
            timeout: SHARED_CONFIG.WORKER_TIMEOUT
        });

        const indexData = await response.json();

        // Validação dos dados do índice
        if (!indexData || !indexData.mangas) {
            throw new Error('Dados do índice inválidos ou incompletos');
        }

        updateStatus('Processando dados do catálogo...');
        const allMangaSeries = Object.entries(indexData.mangas);

        const allMangaResults = await processInBatches(allMangaSeries, SHARED_CONFIG.BATCH_SIZE, SHARED_CONFIG.BATCH_DELAY, onBatchProcessed);

        const allManga = allMangaResults.filter(m => m && !m.error);
        const failedCount = allMangaResults.length - allManga.length;

        if (failedCount > 0) {
            console.warn(`${failedCount} mangás falharam ao carregar de ${allMangaResults.length} total`);
            updateStatus(`Carregado: ${allManga.length} de ${allMangaResults.length} mangás (${failedCount} falharam)`);
        } else {
            updateStatus(`${allManga.length} mangás carregados com sucesso`);
        }

        return {
            data: allManga,
            updated: true,
            version: indexData.metadata?.version || Date.now(),
            lastUpdated: indexData.metadata?.lastUpdated || Math.floor(Date.now() / 1000),
            stats: {
                total: allMangaResults.length,
                successful: allManga.length,
                failed: failedCount
            }
        };
    } catch (error) {
        console.error('Erro crítico ao buscar dados:', error);
        throw error;
    }
};

// Exportação para ES6 modules (contexto principal)
if (typeof module !== 'undefined' && module.exports) {
    // Node.js environment
    module.exports = {
        SHARED_CONFIG,
        fetchWithTimeout,
        b64DecodeUnicode,
        validateUrl,
        sanitizeInput,
        processMangaUrl,
        processInBatches,
        fetchAndProcessMangaData
    };
} else if (typeof window !== 'undefined') {
    // Browser main thread - ES6 modules
    window.SharedUtils = {
        SHARED_CONFIG,
        fetchWithTimeout,
        b64DecodeUnicode,
        decodeCubariUrl, // Adicionado
        getWorkType, // Adicionado
        validateUrl,
        sanitizeInput,
        processMangaUrl,
        processInBatches,
        fetchAndProcessMangaData
    };
}

// Para Web Workers - as funções ficam no escopo global
if (typeof self !== 'undefined' && typeof importScripts === 'function') {
    // Web Worker environment - adicionar ao escopo global
    self.SHARED_CONFIG = SHARED_CONFIG;
    self.fetchWithTimeout = fetchWithTimeout;
    self.b64DecodeUnicode = b64DecodeUnicode;
    self.validateUrl = validateUrl;
    self.sanitizeInput = sanitizeInput;
    self.processMangaUrl = processMangaUrl;
    self.processInBatches = processInBatches;
    self.fetchAndProcessMangaData = fetchAndProcessMangaData;
}