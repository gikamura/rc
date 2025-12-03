import { store } from './store.js';
import { ITEMS_PER_PAGE } from './constants.js';
import { calculateRelevanceScore, similarity } from './search-engine.js';

// Sistema de fallback inteligente para imagens com AllOrigins
window.handleImageError = function(img, originalUrl) {
    // Se já tentou o proxy, vai para placeholder final
    if (img.dataset.proxyAttempted === 'true') {
        img.onerror = null;

        // Detectar tamanho da imagem para placeholder adequado
        const width = img.classList.contains('w-12') ? 48 : 256;
        const height = img.classList.contains('h-16') ? 64 : 384;

        img.src = `https://placehold.co/${width}x${height}/1f2937/ef4444?text=Indisponivel`;
        console.log(`❌ Imagem falhou após proxy: ${originalUrl}`);
        return;
    }

    // Marcar que vai tentar o proxy
    img.dataset.proxyAttempted = 'true';

    // Validar e corrigir URL se necessário
    let validUrl = originalUrl;
    const validExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
    const hasValidExtension = validExtensions.some(ext => originalUrl.toLowerCase().endsWith(ext));

    if (!hasValidExtension) {
        // Se termina com .jp ou outra extensão inválida, trocar por .jpg
        validUrl = originalUrl.replace(/\.[^.]+$/, '.jpg');
        console.log(`🔧 Corrigindo extensão: ${originalUrl} → ${validUrl}`);
    }

    // Tentar com proxy AllOrigins (suporta MyAnimeList e outros CDNs bloqueados)
    const proxiedUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(validUrl)}`;

    console.log(`🔄 Tentando proxy AllOrigins para: ${validUrl}`);
    img.src = proxiedUrl;
};

// Sistema de loading states e feedback visual
class LoadingStateManager {
    constructor() {
        this.activeStates = new Set();
        this.feedbackQueue = [];
    }

    show(stateId, message = 'Carregando...', options = {}) {
        this.activeStates.add(stateId);

        const loader = document.getElementById('main-loader');
        if (loader) {
            const subtitle = document.getElementById('subtitle');
            if (subtitle) {
                subtitle.textContent = message;
                subtitle.setAttribute('aria-live', 'polite');
            }

            if (options.showProgress && options.total) {
                this.showProgressBar(stateId, 0, options.total);
            }
        }

        // Debug
        if (window.GIKAMURA_DEBUG) {
            console.log(`[LoadingState] Showing: ${stateId} - ${message}`);
        }
    }

    hide(stateId) {
        this.activeStates.delete(stateId);

        if (this.activeStates.size === 0) {
            const loader = document.getElementById('main-loader');
            if (loader && !loader.classList.contains('hidden')) {
                loader.classList.add('hidden');
            }
        }

        // Debug
        if (window.GIKAMURA_DEBUG) {
            console.log(`[LoadingState] Hiding: ${stateId}`);
        }
    }

    updateProgress(stateId, current, total, message) {
        const progressBar = document.querySelector(`[data-progress-id="${stateId}"]`);
        if (progressBar) {
            const percentage = Math.round((current / total) * 100);
            progressBar.style.width = `${percentage}%`;
            progressBar.setAttribute('aria-valuenow', percentage);

            const subtitle = document.getElementById('subtitle');
            if (subtitle && message) {
                subtitle.textContent = `${message} (${percentage}%)`;
            }
        }
    }

    showProgressBar(stateId, current, total) {
        const loader = document.getElementById('main-loader');
        if (!loader) return;

        let progressContainer = loader.querySelector('.progress-container');
        if (!progressContainer) {
            progressContainer = document.createElement('div');
            progressContainer.className = 'progress-container mt-4 w-64';

            const progressBg = document.createElement('div');
            progressBg.className = 'w-full bg-neutral-700 rounded-full h-2';

            const progressBar = document.createElement('div');
            progressBar.className = 'bg-blue-600 h-2 rounded-full transition-all duration-300';
            progressBar.setAttribute('data-progress-id', stateId);
            progressBar.setAttribute('role', 'progressbar');
            progressBar.setAttribute('aria-valuemin', '0');
            progressBar.setAttribute('aria-valuemax', '100');
            progressBar.setAttribute('aria-valuenow', '0');

            progressBg.appendChild(progressBar);
            progressContainer.appendChild(progressBg);
            loader.appendChild(progressContainer);
        }

        this.updateProgress(stateId, current, total);
    }

    showFeedback(message, type = 'info', duration = 3000) {
        const feedback = document.createElement('div');
        feedback.className = `feedback-toast fixed bottom-4 left-4 p-3 rounded-lg shadow-lg z-50 transform translate-y-full opacity-0 transition-all duration-300`;

        const bgColor = type === 'success' ? 'bg-green-600' :
                       type === 'error' ? 'bg-red-600' :
                       type === 'warning' ? 'bg-yellow-600' : 'bg-blue-600';

        feedback.classList.add(bgColor, 'text-white');
        feedback.textContent = message;
        feedback.setAttribute('role', 'status');
        feedback.setAttribute('aria-live', 'polite');

        document.body.appendChild(feedback);

        // Animação de entrada
        setTimeout(() => {
            feedback.classList.remove('translate-y-full', 'opacity-0');
        }, 100);

        // Remover após duração
        setTimeout(() => {
            feedback.classList.add('translate-y-full', 'opacity-0');
            setTimeout(() => feedback.remove(), 300);
        }, duration);
    }
}

export const loadingManager = new LoadingStateManager();

let dom = null;
export function getDOM() {
    if (!dom) {
        dom = {
            subtitle: document.getElementById('subtitle'),
            mainLoader: document.getElementById('main-loader'),
            tabs: document.getElementById('tabs'),
            searchContainer: document.getElementById('search-container'),
            searchInput: document.getElementById('search-input'),
            contentContainer: document.getElementById('content-container'),
            paginationControls: document.getElementById('pagination-controls'),
            notification: document.getElementById('notification'),
            typeFilterContainer: document.getElementById('type-filter-container'),
            statusFilterContainer: document.getElementById('status-filter-container'),
            sortContainer: document.getElementById('sort-container'),
            libraryControls: document.getElementById('library-controls'),
            updatesContent: document.getElementById('updates-content'),
            updatesList: document.getElementById('updates-list'),
            updatesBadge: document.getElementById('updates-badge'),
            scansContent: document.getElementById('scans-content'), // Adicionado
            notificationsEnabledToggle: document.getElementById('notifications-enabled'),
            popupsEnabledToggle: document.getElementById('popups-enabled'),
            updatePopupContainer: document.getElementById('update-popup-container'),
            markAllAsReadBtn: document.getElementById('mark-all-as-read-btn'),
        };
    }
    return dom;
}

let notificationTimeout;
export function showNotification(message, duration = 4000) {
    const { notification } = getDOM();
    if (!notification) return;
    clearTimeout(notificationTimeout);
    notification.textContent = message;
    notification.classList.remove('translate-y-20', 'opacity-0');
    notificationTimeout = setTimeout(() => {
        notification.classList.add('translate-y-20', 'opacity-0');
    }, duration);
}

let popupQueue = [];
let isShowingPopup = false;

function processPopupQueue() {
    if (isShowingPopup || popupQueue.length === 0) return;
    isShowingPopup = true;
    const popupHTML = popupQueue.shift();
    const dom = getDOM();
    
    const popupNode = document.createElement('div');
    popupNode.innerHTML = popupHTML;
    
    dom.updatePopupContainer.appendChild(popupNode);
    const popupElement = popupNode.querySelector('.notification-popup');
    
    popupElement.classList.add('show');

    popupElement.addEventListener('click', () => removePopup(popupElement, popupNode), { once: true });
    setTimeout(() => removePopup(popupElement, popupNode), 6000);
}

function removePopup(popupElement, popupNode) {
    if (!popupElement || !popupNode.parentNode) return;
    popupElement.classList.remove('show');
    popupElement.classList.add('hide');
    popupElement.addEventListener('animationend', () => {
        popupNode.remove();
        isShowingPopup = false;
        processPopupQueue();
    }, { once: true });
}

// Pop-up consolidado com informações de tipo
function createGroupedPopupHTML(count, updates) {
    const newWorks = updates.filter(u => u.type === 'new_work');
    const newChapters = updates.filter(u => u.type === 'new_chapters' || !u.type);
    
    let message = '';
    let icon = '';
    
    if (newWorks.length > 0 && newChapters.length > 0) {
        message = `<strong>${newWorks.length}</strong> nova(s) obra(s) e <strong>${newChapters.length}</strong> capítulo(s) novo(s)`;
        icon = `<div class="flex-shrink-0 w-12 h-12 bg-gradient-to-br from-green-600 to-blue-600 rounded-lg flex items-center justify-center mr-3">
            <svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"></path>
            </svg>
        </div>`;
    } else if (newWorks.length > 0) {
        message = newWorks.length === 1 
            ? `Nova obra: <strong>${newWorks[0].manga.title}</strong>`
            : `<strong>${newWorks.length}</strong> novas obras adicionadas`;
        icon = `<div class="flex-shrink-0 w-12 h-12 bg-green-600 rounded-lg flex items-center justify-center mr-3">
            <svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path>
            </svg>
        </div>`;
    } else {
        message = newChapters.length === 1
            ? `Novo capítulo em <strong>${newChapters[0].manga.title}</strong>`
            : `<strong>${newChapters.length}</strong> obras com novos capítulos`;
        icon = `<div class="flex-shrink-0 w-12 h-12 bg-blue-600 rounded-lg flex items-center justify-center mr-3">
            <svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
            </svg>
        </div>`;
    }
    
    return `
    <a href="#" data-tab-target="updates" class="notification-popup notification-grouped flex items-center w-96 max-w-md bg-[#1a1a1a] border border-neutral-700 rounded-xl shadow-2xl overflow-hidden cursor-pointer hover:bg-neutral-800 transition-colors">
        <div class="p-4 flex items-center w-full">
            ${icon}
            <div class="overflow-hidden flex-grow">
                <h4 class="font-bold text-white text-sm">Novas Atualizações</h4>
                <p class="text-sm text-gray-300 truncate">${message}</p>
                <p class="text-xs text-blue-400 mt-1">Clique para ver detalhes →</p>
            </div>
        </div>
    </a>`;
}

export function showConsolidatedUpdatePopup(updates) {
    const { settings } = store.getState();
    if (!settings.popupsEnabled || updates.length === 0) return;

    popupQueue.push(createGroupedPopupHTML(updates.length, updates));
    processPopupQueue();
}

function createUpdateHistoryItemHTML(update) {
    const { manga, newChapters, read, type } = update;
    const updateTime = new Date(update.timestamp).toLocaleString('pt-BR');
    const escapedTitle = manga.title ? manga.title.replace(/"/g, '&quot;') : '';
    const unreadClass = read === false ? 'border-l-4 border-l-blue-500 bg-blue-900/20' : 'border-l-4 border-l-transparent bg-[#050505]/50';
    
    // Ícones para tipos de atualização
    const iconNewWork = `<svg class="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path></svg>`;
    const iconNewChapter = `<svg class="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>`;
    
    const isNewWork = type === 'new_work';
    const icon = isNewWork ? iconNewWork : iconNewChapter;
    const badgeClass = isNewWork ? 'bg-green-600' : 'bg-blue-600';
    const badgeText = isNewWork ? 'Nova Obra' : `${newChapters.length} cap.`;
    
    // Texto descritivo
    let descriptionText = '';
    if (isNewWork) {
        descriptionText = manga.description 
            ? manga.description.substring(0, 100) + (manga.description.length > 100 ? '...' : '')
            : 'Nova obra adicionada ao catálogo';
    } else {
        const chapterText = newChapters.slice(0, 3).map(c => c.title).join(', ');
        const moreText = newChapters.length > 3 ? ` +${newChapters.length - 3} mais` : '';
        descriptionText = chapterText + moreText;
    }

    return `
    <a href="${manga.url}" target="_blank" rel="noopener noreferrer" 
       class="flex items-start p-4 rounded-lg hover:bg-neutral-800/80 transition-all ${unreadClass} border border-neutral-800/60">
        <div class="relative flex-shrink-0 mr-4">
            <img src="${manga.imageUrl}" alt="Capa de ${escapedTitle}" 
                 class="w-16 h-24 object-cover rounded-md shadow-md" loading="lazy" 
                 onerror="handleImageError(this, '${manga.imageUrl.replace(/'/g, "\\'")}')">
            <span class="absolute -top-2 -right-2 ${badgeClass} text-white text-xs font-bold px-2 py-0.5 rounded-full shadow">
                ${badgeText}
            </span>
        </div>
        <div class="flex-grow overflow-hidden">
            <div class="flex items-center gap-2 mb-1">
                ${icon}
                <h3 class="font-bold text-white truncate">${manga.title}</h3>
            </div>
            <p class="text-sm text-gray-400 line-clamp-2 mb-2">${descriptionText}</p>
            <div class="flex items-center gap-3 text-xs text-gray-500">
                <span class="flex items-center gap-1">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                    </svg>
                    ${updateTime}
                </span>
                ${manga.type ? `<span class="bg-neutral-700 px-2 py-0.5 rounded">${manga.type}</span>` : ''}
            </div>
        </div>
        ${read === false ? '<span class="w-2 h-2 bg-blue-500 rounded-full flex-shrink-0 ml-2 animate-pulse"></span>' : ''}
    </a>`;
}

function renderUpdatesTab(state) {
    const dom = getDOM();
    dom.notificationsEnabledToggle.checked = state.settings.notificationsEnabled;
    dom.popupsEnabledToggle.checked = state.settings.popupsEnabled;
    dom.popupsEnabledToggle.disabled = !state.settings.notificationsEnabled;
    dom.popupsEnabledToggle.closest('label').classList.toggle('disabled', dom.popupsEnabledToggle.disabled);
    
    dom.markAllAsReadBtn.classList.toggle('hidden', state.unreadUpdates === 0);

    if (state.updates.length === 0) {
        dom.updatesList.innerHTML = `
            <div class="text-center py-12">
                <svg class="w-16 h-16 mx-auto text-gray-600 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"></path>
                </svg>
                <p class="text-gray-500 text-lg">Nenhuma atualização recente</p>
                <p class="text-gray-600 text-sm mt-2">Novas obras e capítulos aparecerão aqui</p>
            </div>`;
    } else {
        // Separar por tipo de atualização
        const newWorks = state.updates.filter(u => u.type === 'new_work');
        const newChapters = state.updates.filter(u => u.type === 'new_chapters' || !u.type);
        
        let html = '';
        
        // Resumo no topo
        if (state.unreadUpdates > 0) {
            html += `
            <div class="bg-blue-900/30 border border-blue-700/50 rounded-lg p-4 mb-6">
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-3">
                        <div class="bg-blue-600 p-2 rounded-full">
                            <svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"></path>
                            </svg>
                        </div>
                        <div>
                            <p class="text-white font-semibold">${state.unreadUpdates} ${state.unreadUpdates === 1 ? 'nova atualização' : 'novas atualizações'}</p>
                            <p class="text-blue-300 text-sm">
                                ${newWorks.filter(u => !u.read).length} obras novas • 
                                ${newChapters.filter(u => !u.read).length} capítulos novos
                            </p>
                        </div>
                    </div>
                </div>
            </div>`;
        }
        
        // Seção de novas obras
        if (newWorks.length > 0) {
            html += `
            <div class="mb-6">
                <h3 class="flex items-center gap-2 text-lg font-bold text-green-400 mb-3">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path>
                    </svg>
                    Novas Obras (${newWorks.length})
                </h3>
                <div class="space-y-3">
                    ${newWorks.map(createUpdateHistoryItemHTML).join('')}
                </div>
            </div>`;
        }
        
        // Seção de novos capítulos
        if (newChapters.length > 0) {
            html += `
            <div>
                <h3 class="flex items-center gap-2 text-lg font-bold text-blue-400 mb-3">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                    </svg>
                    Novos Capítulos (${newChapters.length})
                </h3>
                <div class="space-y-3">
                    ${newChapters.map(createUpdateHistoryItemHTML).join('')}
                </div>
            </div>`;
        }
        
        dom.updatesList.innerHTML = html;
    }
}

const createCardMetadata = (icon, title, value) => `
    <div class="flex items-center gap-1.5 text-gray-300 truncate" title="${title}: ${value}">
        ${icon}
        <span class="truncate">${value}</span>
    </div>`;

// Exportada para uso no carregamento progressivo
export const createCardHTML = (data, isFavorite) => {
    const iconUser = `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clip-rule="evenodd" /></svg>`;
    const iconPaintBrush = `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor"><path d="M17.414 2.586a2 2 0 00-2.828 0L7 10.172V13h2.828l7.586-7.586a2 2 0 000-2.828z" /><path fill-rule="evenodd" d="M2 6a2 2 0 012-2h4a1 1 0 010 2H4v10h10v-4a1 1 0 112 0v4a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" clip-rule="evenodd" /></svg>`;
    const iconBookOpen = `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor"><path d="M9 4.804A7.968 7.968 0 005.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 015.5 14c1.669 0 3.218.51 4.5 1.385A7.962 7.962 0 0114.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 11-2 0V4.804z" /></svg>`;
    const author = data.author || 'N/A';
    const artist = data.artist || 'N/A';
    const status = data.status || 'N/A';
    const type = data.type ? data.type.charAt(0).toUpperCase() + data.type.slice(1) : 'N/A';
    const description = data.description || 'Sem descrição disponível.';
    const chapterCount = data.chapterCount || 'N/A';
    const escapedTitle = data.title ? data.title.replace(/"/g, '&quot;') : 'N/A';

    // Card ORIGINAL do desktop (SEM NENHUMA MODIFICAÇÃO além de hidden/block)
    return `
    <div class="contents">
        <!-- MOBILE -->
        <div class="block md:hidden relative bg-[#1a1a1a] rounded-lg shadow-lg overflow-hidden">
            <a href="${data.url}" target="_blank" rel="noopener noreferrer" class="block">
                <div class="aspect-[2/3] relative">
                    <img src="${data.imageUrl}" alt="${escapedTitle}" class="w-full h-full object-cover" loading="lazy" onerror="handleImageError(this, '${data.imageUrl.replace(/'/g, "\\'")}')">
                    <div class="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black via-black/80 to-transparent p-2">
                        <h3 class="text-xs font-bold text-white line-clamp-2 leading-tight">${data.title}</h3>
                        <div class="flex gap-1 mt-1">
                            <span class="px-1 py-0.5 text-[9px] font-medium rounded bg-purple-600 text-white">${type}</span>
                            <span class="px-1 py-0.5 text-[9px] font-medium rounded ${status.toLowerCase().includes('complet') ? 'bg-blue-500' : 'bg-green-500'} text-white">${status}</span>
                        </div>
                    </div>
                </div>
            </a>
            <button class="favorite-btn absolute top-1 right-1 p-1 bg-black/60 rounded-full z-10" data-url="${data.url}">
                <svg class="h-3.5 w-3.5 pointer-events-none ${isFavorite ? 'text-red-500' : 'text-white/70'}" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z" clip-rule="evenodd"/>
                </svg>
            </button>
        </div>
        <!-- DESKTOP (ORIGINAL EXATO) -->
        <div class="hidden md:block relative bg-[#1a1a1a] rounded-lg shadow-lg overflow-hidden transition-transform transform hover:-translate-y-1 hover:shadow-2xl group" style="height: 16rem;">
            <a href="${data.url}" target="_blank" rel="noopener noreferrer" class="relative flex flex-grow w-full h-full">
                <div class="w-1/3 flex-shrink-0 bg-[#050505]">
                    <img src="${data.imageUrl}" alt="Capa de ${escapedTitle}" class="w-full h-full object-cover" loading="lazy" onerror="handleImageError(this, '${data.imageUrl.replace(/'/g, "\\'")}')">
                </div>
                <div class="flex flex-col flex-grow p-4 text-white overflow-hidden w-2/3">
                    <div class="h-10"></div>
                    <div class="relative flex-grow">
                        <p class="text-sm text-gray-400 leading-snug line-clamp-4 flex-grow" style="-webkit-box-orient: vertical;">${description}</p>
                        <div class="absolute inset-0 bg-[#1a1a1a] p-2 text-sm text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity duration-300 overflow-auto pointer-events-none group-hover:pointer-events-auto rounded description-scroll">${description}</div>
                    </div>
                    <div class="mt-auto pt-3 border-t border-neutral-800 text-xs flex items-center justify-start space-x-4 overflow-hidden">
                        ${createCardMetadata(iconUser, 'Autor', author)}
                        ${createCardMetadata(iconPaintBrush, 'Artista', artist)}
                        ${createCardMetadata(iconBookOpen, 'Capítulos', chapterCount)}
                    </div>
                </div>
                <div class="absolute top-0 left-0 right-0 px-4 py-2 bg-gradient-to-b from-black/70 to-transparent z-10 pointer-events-none">
                    <h3 class="text-lg font-bold truncate text-white" title="${escapedTitle}">${data.title}</h3>
                </div>
                <div class="absolute bottom-2 left-2 flex items-center gap-2 z-10">
                    <span class="bg-[#050505]/70 text-white font-semibold px-2 py-1 rounded-md text-xs backdrop-blur-sm" title="Status">${status}</span>
                    <span class="bg-blue-600 text-white font-semibold px-2 py-1 rounded-md text-xs">${type}</span>
                </div>
            </a>
            <button class="favorite-btn absolute top-2 right-2 p-1.5 bg-black/50 rounded-full text-white hover:text-red-500 backdrop-blur-sm transition-colors z-20" data-url="${data.url}" title="Favoritar">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 pointer-events-none" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z" class="${isFavorite ? 'text-red-500' : 'text-white/80'}" clip-rule="evenodd" />
                </svg>
            </button>
        </div>
    </div>`;
};

const renderCards = (container, cardDataList, favoritesSet) => {
    const { activeTab } = store.getState();
    if (!cardDataList || cardDataList.length === 0) {
        let message = activeTab === 'favorites' ? 'Você ainda não adicionou nenhum favorito.' : 'Nenhum resultado encontrado.';
        container.innerHTML = `<div class="col-span-full text-center text-gray-400 p-8"><p>${message}</p></div>`;
        return;
    }
    container.innerHTML = cardDataList.map(data => createCardHTML(data, favoritesSet.has(data.url))).join('');
};

// Função para adicionar cards incrementalmente (carregamento progressivo)
export const appendCardsToContainer = (newItems, favoritesSet) => {
    const dom = getDOM();
    const container = dom.contentContainer;
    if (!container || !newItems || newItems.length === 0) return;
    
    // Remover mensagem de "nenhum resultado" se existir
    const emptyMessage = container.querySelector('.col-span-full');
    if (emptyMessage) emptyMessage.remove();
    
    // Criar fragment para adicionar todos de uma vez (melhor performance)
    const fragment = document.createDocumentFragment();
    const tempDiv = document.createElement('div');
    
    newItems.forEach(data => {
        tempDiv.innerHTML = createCardHTML(data, favoritesSet.has(data.url));
        // Cada card gera 2 elementos (mobile + desktop), adicionar ambos
        while (tempDiv.firstChild) {
            fragment.appendChild(tempDiv.firstChild);
        }
    });
    
    container.appendChild(fragment);


};

const renderPagination = (controlsContainer, totalItems, currentPage) => {
    const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);
    if (totalPages <= 1) {
        controlsContainer.innerHTML = '';
        return;
    }

    const getPaginationItems = (currentPage, totalPages) => {
        const delta = 2; // Páginas a mostrar ao redor da atual
        const left = currentPage - delta;
        const right = currentPage + delta;
        const range = [];
        const rangeWithDots = [];
        let l;

        for (let i = 1; i <= totalPages; i++) {
            if (i === 1 || i === totalPages || (i >= left && i <= right)) {
                range.push(i);
            }
        }

        for (let i of range) {
            if (l) {
                if (i - l === 2) {
                    rangeWithDots.push(l + 1);
                } else if (i - l !== 1) {
                    rangeWithDots.push('...');
                }
            }
            rangeWithDots.push(i);
            l = i;
        }

        return rangeWithDots;
    };

    const paginationItems = getPaginationItems(currentPage, totalPages);
    
    const buttonsHTML = paginationItems.map(item => {
        if (item === '...') {
            return `<span class="px-4 py-2 text-sm font-medium text-gray-500">...</span>`;
        }

        const isActive = item === currentPage;
        return `<button data-page="${item}" class="pagination-btn px-4 py-2 text-sm font-medium rounded-md ${isActive ? 'bg-blue-600 text-white' : 'bg-neutral-700 hover:bg-neutral-600'}">${item}</button>`;
    }).join('');

    controlsContainer.innerHTML = buttonsHTML;
};

// NOVO: Função para criar o card de uma scan
const createScanCardHTML = (scan) => {
    const { name, icon_url, description, total_works } = scan.scan_info;
    return `
    <div class="scan-card cursor-pointer bg-[#1a1a1a] rounded-lg shadow-lg overflow-hidden transition-transform transform hover:-translate-y-1 hover:shadow-2xl flex flex-col p-4 border border-neutral-800/60" data-url="${scan.url}">
        <div class="flex items-center mb-4">
            <img src="${icon_url}" alt="Ícone de ${name}" class="w-16 h-16 object-cover rounded-full mr-4 border-2 border-neutral-700">
            <div>
                <h3 class="text-xl font-bold text-white">${name}</h3>
                <p class="text-sm text-gray-400">${total_works || 'N/A'} obras</p>
            </div>
        </div>
        <p class="text-gray-300 text-sm flex-grow">${description}</p>
    </div>
    `;
};

// NOVO: Função para renderizar a lista de scans
function renderScansList(state) {
    const dom = getDOM();
    dom.scansContent.innerHTML = `
        <h2 class="text-2xl font-bold text-white mb-4">Explorar Scans</h2>
        <div id="scans-grid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            ${state.scansList.map(scan => createScanCardHTML(scan)).join('')}
        </div>
    `;
}

// NOVO: Lógica aprimorada para renderizar as obras de uma scan
function renderScanWorks(state) {
    const dom = getDOM();
    const { name, description } = state.selectedScan.scan_info;

    // Verificar se precisa criar o layout inicial (só na primeira vez)
    let grid = document.getElementById('scan-works-grid');
    if (!grid) {
        // Prepara o layout inicial com cabeçalho e busca (só cria uma vez)
        dom.scansContent.innerHTML = `
            <div class="mb-6">
                <button id="back-to-scans-btn" class="text-blue-400 hover:text-blue-300 mb-4">&larr; Voltar para a lista de Scans</button>
                <h2 class="text-3xl font-bold text-white">${name}</h2>
                <p class="text-gray-400 mt-1">${description}</p>
            </div>
            <div class="mb-6">
                <div class="relative">
                    <label for="scan-search-input" class="sr-only">Buscar obras nesta scan</label>
                    <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <svg class="h-5 w-5 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                    </div>
                    <input type="search" id="scan-search-input" placeholder="Buscar nesta scan..." value="${state.scanSearchQuery}" class="w-full bg-neutral-800 text-gray-200 border border-neutral-700 rounded-lg pl-10 pr-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors">
                </div>
            </div>
            <div id="scan-works-grid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"></div>
            <div id="scan-pagination-controls" class="flex justify-center items-center mt-8 space-x-2"></div>
        `;
        grid = document.getElementById('scan-works-grid');
    }

    const paginationContainer = document.getElementById('scan-pagination-controls');

    if (state.isLoadingScans && state.scanWorks.length === 0) {
        grid.innerHTML = `<div class="col-span-full flex justify-center items-center py-16"><div class="loader"></div><p class="ml-4">Carregando obras...</p></div>`;
        return;
    }

    if (state.scanWorks.length === 0) {
        grid.innerHTML = `<p class="col-span-full text-center text-gray-500 py-8">Nenhuma obra encontrada para esta scan.</p>`;
        return;
    }

    // Filtrar obras baseado na busca com ranking de relevância
    let filteredWorks = state.scanWorks;
    if (state.scanSearchQuery && state.scanSearchQuery.length >= 2) {
        filteredWorks = state.scanWorks
            .map(work => {
                const { score } = calculateRelevanceScore(work, state.scanSearchQuery, {
                    fuzzyThreshold: 0.6,
                    enableFuzzy: true
                });
                return { ...work, _score: score };
            })
            .filter(work => work._score > 0)
            .sort((a, b) => b._score - a._score);
    }

    if (filteredWorks.length === 0) {
        grid.innerHTML = `<p class="col-span-full text-center text-gray-500 py-8">Nenhuma obra encontrada para "${state.scanSearchQuery}".</p>`;
        paginationContainer.innerHTML = '';
        return;
    }

    // Lógica de paginação
    const totalItems = filteredWorks.length;
    const itemsToDisplay = filteredWorks.slice(
        (state.scanWorksCurrentPage - 1) * ITEMS_PER_PAGE,
        state.scanWorksCurrentPage * ITEMS_PER_PAGE
    );

    grid.innerHTML = itemsToDisplay.map(work => createCardHTML(work, state.favorites.has(work.url))).join('');
    renderPagination(paginationContainer, totalItems, state.scanWorksCurrentPage);
}

export function renderApp() {
    const state = store.getState();
    const dom = getDOM();

    dom.mainLoader.classList.toggle('hidden', !state.isLoading);
    if (state.error) {
        dom.contentContainer.innerHTML = `<div class="col-span-full text-center text-red-400 p-8 bg-[#1a1a1a] rounded-lg space-y-4"><p>${state.error}</p><button id="reload-page-btn" class="bg-blue-600 text-white font-semibold px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors">Atualizar Página</button></div>`;
        return;
    }
    
    dom.tabs.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === state.activeTab));
    
    if (state.unreadUpdates > 0) {
        dom.updatesBadge.textContent = state.unreadUpdates > 9 ? '9+' : state.unreadUpdates;
        dom.updatesBadge.classList.remove('hidden');
    } else {
        dom.updatesBadge.classList.add('hidden');
    }

    const isLibraryActive = state.activeTab === 'library';
    const isUpdatesActive = state.activeTab === 'updates';
    const isScansActive = state.activeTab === 'scans'; // NOVO

    dom.searchContainer.classList.toggle('hidden', !isLibraryActive);
    dom.libraryControls.classList.toggle('hidden', !isLibraryActive);
    dom.updatesContent.classList.toggle('hidden', !isUpdatesActive);
    dom.scansContent.classList.toggle('hidden', !isScansActive); // NOVO
    dom.contentContainer.classList.toggle('hidden', isUpdatesActive || isScansActive); // MODIFICADO
    dom.paginationControls.classList.toggle('hidden', isUpdatesActive || isScansActive); // MODIFICADO

    if (isLibraryActive) {
        dom.typeFilterContainer.querySelectorAll('.filter-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.type === state.activeTypeFilter));
        dom.statusFilterContainer.querySelectorAll('.filter-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.status === state.activeStatusFilter));
    } else if (isUpdatesActive) {
        renderUpdatesTab(state);
    } else if (isScansActive) { // NOVO BLOCO LÓGICO
        if (state.isLoadingScans) {
            dom.scansContent.innerHTML = `<div class="flex justify-center items-center py-16"><div class="loader"></div></div>`;
        } else if (state.selectedScan) {
            renderScanWorks(state);
            // Trigger evento para configurar autocomplete após render
            setTimeout(() => {
                const event = new CustomEvent('scan-works-rendered');
                window.dispatchEvent(event);
            }, 100);
        } else {
            renderScansList(state);
        }
    }

    let itemsToDisplay = [];
    let totalPaginationItems = 0;

    switch (state.activeTab) {
        case 'home':
            // Otimização: usar slice primeiro, depois sort (ordena só 20 itens)
            // Pega os 100 mais recentes aproximadamente, ordena, pega 20
            itemsToDisplay = state.allManga
                .slice(0, Math.min(200, state.allManga.length))
                .sort((a, b) => b.lastUpdated - a.lastUpdated)
                .slice(0, 20);
            break;
        case 'library':
            let filteredLibrary;
            
            // Se há query de busca, usar sistema de relevância com fuzzy
            if (state.searchQuery && state.searchQuery.length >= 2) {
                filteredLibrary = [];
                for (let i = 0; i < state.allManga.length; i++) {
                    const m = state.allManga[i];
                    // Aplicar filtros inline para evitar criar arrays intermediários
                    if (state.activeTypeFilter !== 'all' && m.type !== state.activeTypeFilter) continue;
                    if (state.activeStatusFilter !== 'all' && (m.status || '').toLowerCase() !== state.activeStatusFilter) continue;
                    
                    const { score, matches } = calculateRelevanceScore(m, state.searchQuery, {
                        fuzzyThreshold: 0.6,
                        enableFuzzy: true
                    });
                    if (score > 0) {
                        m._score = score;
                        m._matches = matches;
                        filteredLibrary.push(m);
                    }
                }
                // Ordenar por relevância quando há busca
                filteredLibrary.sort((a, b) => b._score - a._score);
            } else {
                // Sem busca: filtrar e ordenar em uma passada
                filteredLibrary = [];
                for (let i = 0; i < state.allManga.length; i++) {
                    const m = state.allManga[i];
                    if (state.activeTypeFilter !== 'all' && m.type !== state.activeTypeFilter) continue;
                    if (state.activeStatusFilter !== 'all' && (m.status || '').toLowerCase() !== state.activeStatusFilter) continue;
                    filteredLibrary.push(m);
                }
                // Ordenar cópia (não modifica state.allManga)
                filteredLibrary.sort((a, b) => {
                    if (state.librarySortOrder === 'latest') {
                        return b.lastUpdated - a.lastUpdated;
                    }
                    return a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' });
                });
            }
            
            totalPaginationItems = filteredLibrary.length;
            itemsToDisplay = filteredLibrary.slice((state.currentPage - 1) * ITEMS_PER_PAGE, state.currentPage * ITEMS_PER_PAGE);
            break;
        case 'favorites':
            // Otimização: filtrar primeiro, depois combinar (evita processar milhares de não-favoritos)
            const favManga = [];
            const seenUrls = {};
            // Filtrar favoritos de allManga
            for (let i = 0; i < state.allManga.length; i++) {
                const m = state.allManga[i];
                if (state.favorites.has(m.url) && !seenUrls[m.url]) {
                    seenUrls[m.url] = true;
                    favManga.push(m);
                }
            }
            // Adicionar favoritos de scanWorks que não estão em allManga
            for (let i = 0; i < state.scanWorks.length; i++) {
                const w = state.scanWorks[i];
                if (state.favorites.has(w.url) && !seenUrls[w.url]) {
                    seenUrls[w.url] = true;
                    favManga.push(w);
                }
            }
            itemsToDisplay = favManga;
            break;
    }

    if (!isUpdatesActive && !isScansActive) { // MODIFICADO
      renderCards(dom.contentContainer, itemsToDisplay, state.favorites);
      if (state.activeTab === 'library') {
          renderPagination(dom.paginationControls, totalPaginationItems, state.currentPage);
      } else {
          dom.paginationControls.innerHTML = '';
      }
    }
}

// =====================================================
// FAVICON BADGE - Mostra número de atualizações não lidas
// =====================================================
let originalFavicon = null;
let faviconCanvas = null;
let faviconCtx = null;

export function updateFaviconBadge(count) {
    // Guardar favicon original na primeira vez
    if (!originalFavicon) {
        const link = document.querySelector("link[rel*='icon']") || document.createElement('link');
        originalFavicon = link.href || '/icons/icon-192.png';
    }
    
    // Se count é 0, restaurar favicon original
    if (count <= 0) {
        restoreOriginalFavicon();
        return;
    }
    
    // Criar canvas se não existir
    if (!faviconCanvas) {
        faviconCanvas = document.createElement('canvas');
        faviconCanvas.width = 32;
        faviconCanvas.height = 32;
        faviconCtx = faviconCanvas.getContext('2d');
    }
    
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
        // Desenhar ícone original
        faviconCtx.clearRect(0, 0, 32, 32);
        faviconCtx.drawImage(img, 0, 0, 32, 32);
        
        // Desenhar badge
        const badgeText = count > 99 ? '99+' : count.toString();
        const badgeSize = badgeText.length > 2 ? 20 : 16;
        
        // Círculo vermelho
        faviconCtx.beginPath();
        faviconCtx.arc(32 - badgeSize/2, badgeSize/2, badgeSize/2, 0, 2 * Math.PI);
        faviconCtx.fillStyle = '#ef4444';
        faviconCtx.fill();
        
        // Texto branco
        faviconCtx.fillStyle = '#ffffff';
        faviconCtx.font = `bold ${badgeSize - 6}px Arial`;
        faviconCtx.textAlign = 'center';
        faviconCtx.textBaseline = 'middle';
        faviconCtx.fillText(badgeText, 32 - badgeSize/2, badgeSize/2 + 1);
        
        // Atualizar favicon
        setFavicon(faviconCanvas.toDataURL('image/png'));
    };
    img.onerror = () => {
        // Se falhar ao carregar imagem, criar badge simples
        faviconCtx.clearRect(0, 0, 32, 32);
        faviconCtx.fillStyle = '#3b82f6';
        faviconCtx.fillRect(0, 0, 32, 32);
        
        faviconCtx.beginPath();
        faviconCtx.arc(24, 8, 8, 0, 2 * Math.PI);
        faviconCtx.fillStyle = '#ef4444';
        faviconCtx.fill();
        
        faviconCtx.fillStyle = '#ffffff';
        faviconCtx.font = 'bold 10px Arial';
        faviconCtx.textAlign = 'center';
        faviconCtx.textBaseline = 'middle';
        faviconCtx.fillText(count > 9 ? '9+' : count.toString(), 24, 9);
        
        setFavicon(faviconCanvas.toDataURL('image/png'));
    };
    img.src = originalFavicon;
}

function setFavicon(url) {
    let link = document.querySelector("link[rel*='icon']");
    if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        document.head.appendChild(link);
    }
    link.href = url;
}

function restoreOriginalFavicon() {
    if (originalFavicon) {
        setFavicon(originalFavicon);
    }
}

// Resetar badge quando usuário vê as atualizações
store.subscribe(() => {
    const state = store.getState();
    if (state.activeTab === 'updates' && state.unreadUpdates === 0) {
        restoreOriginalFavicon();
    }
});