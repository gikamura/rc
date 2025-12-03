# Copilot Instructions - Gikamura Reader

## ⚠️ REGRA CRÍTICA DE DEPLOY

**NUNCA fazer push para `origin` sem autorização explícita do usuário.**

| Remote   | Repo               | Ação                              |
|----------|--------------------|------------------------------------|
| `rc`     | `gikamura/rc.git`  | TESTE - pode fazer push livremente |
| `origin` | `gikamura/reader`  | PRODUÇÃO - REQUER AUTORIZAÇÃO      |

**Sempre usar `git push rc main` por padrão.** Ao fazer push para produção, incrementar versão em `sw.js`:
```bash
sed -i "s/gikamura-v[0-9]\+\.[0-9]\+/gikamura-v2.X/" sw.js
```

---

## Visão Geral

PWA de leitura de mangás 100% frontend. **Vanilla JS (ES Modules), Tailwind CSS via CDN, sem build step.**

## Arquitetura

```
app.js           → Ponto de entrada, Workers, Service Worker, sistema de busca
store.js         → Estado centralizado (observer pattern) - suppressNotify para batches
ui.js            → Renderização DOM, getDOM() para cache de queries
shared-utils.js  → Funções compartilhadas com Workers (usa importScripts)
sw.js            → Service Worker (offline, cache) - ATUALIZAR VERSÃO a cada deploy
update-worker.js → Web Worker para fetch pesado em lotes
```

## Fluxo de Dados

1. `app.js` → `initializeStore()` → carrega cache → cria Worker
2. Worker busca GitHub Raw → processa em lotes de 200 → `postMessage()` por batch
3. `store.setSuppressNotify(true)` durante batches → evita re-render a cada item
4. Store notifica subscribers → UI renderiza uma vez no final

## Comandos

```bash
# Servir local
python -m http.server 8000

# Validar sintaxe (SEMPRE antes de commit)
for f in *.js; do node --check "$f" 2>&1; done

# Deploy
git push rc main      # Teste: https://gikamura.github.io/rc/
git push origin main  # Prod: https://gikamura.github.io/reader/ (REQUER AUTORIZAÇÃO)
```

## Padrões Críticos

### Web Workers - NUNCA ES6 modules
```javascript
// ❌ Workers não suportam import/export
import { func } from './module.js';

// ✅ Use importScripts (início do worker)
importScripts('./shared-utils.js');
```

### Performance com 3000+ obras
```javascript
// ❌ sort() modifica array original do state
state.allManga.sort((a, b) => ...);

// ✅ Criar cópia OU filtrar para novo array
const sorted = [...state.allManga].sort(...);
// OU filtrar inline evitando criar intermediários:
const filtered = [];
for (let i = 0; i < state.allManga.length; i++) {
    if (matchesFilter(state.allManga[i])) filtered.push(state.allManga[i]);
}
```

### Batch Loading Pattern
```javascript
// app.js - evitar re-render durante carregamento
store.setSuppressNotify(true);
// ... processar muitos itens ...
store.setSuppressNotify(false);
renderApp(); // Uma renderização no final
```

### getDOM() - Cache de Queries
```javascript
// ❌ querySelector repetido
document.getElementById('search-input').value;
document.getElementById('search-input').focus();

// ✅ Use getDOM() uma vez
const dom = getDOM();
dom.searchInput.value;
dom.searchInput.focus();
```

### Validação XSS
```javascript
import { InputValidator } from './input-validator.js';
const validator = new InputValidator();
const safe = validator.validateString(userInput); // Sanitiza HTML
```

## Service Worker

**SEMPRE incrementar versão ao fazer deploy:**
```javascript
// sw.js linha 2
const CACHE_VERSION = 'gikamura-v2.2'; // ← Incrementar aqui
```

Estratégias de cache:
- `cacheFirst`: Assets estáticos (JS, icons)
- `networkFirst`: API calls (raw.githubusercontent.com)
- `staleWhileRevalidate`: Outros recursos

## Debugging

```javascript
window.toggleGikamuraDebug()  // Ativa logs detalhados
localStorage.setItem('gikamura_debug', 'true') // Persistente
```

**Problemas Comuns:**
- Cards vazios → Network tab: verificar GitHub Raw responses
- SW desatualizado → DevTools > Application > Service Workers > Update
- Cache corrompido → `localStorage.clear()` + hard refresh

## Dados Externos

Source: `raw.githubusercontent.com` (sem CORS)

**Index Principal** (`constants.js → INDEX_URL`):
```json
{
  "metadata": { "lastUpdated": 1759256696, "totalMangas": 1085 },
  "mangas": { "KR1017": { "title": "...", "type": "manhwa" } }
}
```

**Tipos de obra**: `manga` (JP), `manhwa` (KR), `manhua` (CH) - inferido do prefixo da chave ou campo `type`
