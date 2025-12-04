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
# Copilot Instructions — Gikamura Reader

Aviso rápido: este repositório é um PWA 100% frontend (Vanilla JS, sem build). Siga estritamente os padrões abaixo.

## Regras críticas de deploy
- **NUNCA** dar push para `origin` sem autorização explícita. Use `git push rc main` para testes.
- Ao publicar em `origin`, incremente manualmente a versão do SW em `sw.js` (linha `CACHE_VERSION`) antes do push.
  Exemplo rápido:
  ```bash
  sed -i "s/gikamura-v[0-9]\+\.[0-9]\+/gikamura-v2.X/" sw.js
  ```

## Visão geral e arquitetura (arquivos-chave)
- `app.js`: entrada, registra Service Worker e orquestra Workers/UI/Store.
- `store.js`: estado central (observer pattern). Usa `setSuppressNotify(true/false)` para cargas em lote.
- `ui.js`: renderização DOM; use `getDOM()` para caches de seletores.
- `shared-utils.js`: utilitários reusáveis (disponíveis em `window.SharedUtils` e via `importScripts` nos Workers).
- `update-worker.js`: Web Worker (não é módulo ES6) que chama `fetchAndProcessMangaData` (batches de 200).
- `sw.js`: service worker clássico — contém `CACHE_VERSION` e listas de assets estáticos.

## Padrões e convenções específicos
- Web Workers: NUNCA usar `import`/`export` — use `importScripts('./shared-utils.js')`.
- Batch processing: padrão é BATCH_SIZE ≈ 200 e BATCH_DELAY ≈ 300ms (ver `shared-utils.js`).
- Memória: não armazene `chapters` completos — o projeto deliberadamente mantém apenas `chapterCount` e carrega capítulos sob demanda (`processMangaUrl` em `shared-utils.js`).
- Store perf: evite criar cópias desnecessárias; o código usa push/lookup por objeto para performance com milhares de itens.

## Fluxo de dados resumido
1. `app.js` inicializa store e workers.
2. Worker (`update-worker.js`) busca `INDEX_URL` (GitHub raw) e processa em lotes, enviando `postMessage({ type: 'batch-processed', payload })` por lote.
3. Durante batches, código chama `store.setSuppressNotify(true)` para suprimir renders; ao final `setSuppressNotify(false)` e renderizar uma vez.

## Ferramentas e comandos comuns
- Servir local (sem build):
  ```bash
  python -m http.server 8000
  ```
- Checar sintaxe JS rapidamente:
  ```bash
  for f in *.js; do node --check "$f" 2>&1; done
  ```

## Service Worker e cache
- Sempre atualizar `CACHE_VERSION` em `sw.js` antes do deploy para invalidar caches.
- `sw.js` usa estratégias diferentes: `cacheFirst` para assets/imagens, `networkFirst` para APIs, `stale-while-revalidate` para outros recursos.

## Erros comuns que um agente deve conhecer
- CORS/Raw GitHub: requests para `raw.githubusercontent.com` podem falhar; `shared-utils.fetchWithTimeout` implementa timeout e retries com backoff.
- URLs do Cubari são codificadas em base64 — `shared-utils.decodeCubariUrl` e `processMangaUrl` lidam com isso; valide antes de processar.

## Exemplos práticos (trechos relevantes)
- Suprimir re-renders durante carga em lote:
  ```javascript
  store.setSuppressNotify(true);
  // adicionar many items via store.addMangaToCatalog()
  store.setSuppressNotify(false);
  // UI atualiza uma vez
  ```
- Worker → main thread (batch):
  ```js
  // update-worker.js
  self.postMessage({ type: 'batch-processed', payload: batch });
  ```

## Onde olhar primeiro ao editar/estender
- `shared-utils.js`: regras de fetch, decodificação Cubari, e batch processing — mudanças aqui afetam Workers e thread principal.
- `store.js`: contratos de notificação e performance (evite mudar assinatura de `setSuppressNotify`).
- `sw.js`: atualizar `CACHE_VERSION` para deploy.

Se quiser, aplico essas mudanças diretamente no arquivo ou reduzo/expando se preferir mais exemplos. Alguma parte ficou incompleta ou quer que eu inclua exemplos de arquivos específicos (ex.: `processMangaUrl`)?
}
