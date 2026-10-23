/**
 * Cerimonial BAGL — Service Worker Oficial (PWA Offline-First & Atualização Controlada)
 *
 * Princípios de Segurança e Proteção de Dados:
 * 1. Armazena em cache EXCLUSIVAMENTE os arquivos estáticos da aplicação (HTML, CSS, JS, Fontes, Brasões e libs locais).
 * 2. NUNCA armazena, altera, limpa ou interfere no IndexedDB ('CerimonialBAGL_DB') nem no localStorage.
 * 3. NUNCA executa skipWaiting() automaticamente ao detectar nova versão: aguarda mensagem explícita
 *    { type: 'SKIP_WAITING' } enviada somente após confirmação do operador na interface, evitando
 *    misturar scripts de versões diferentes ou recarregar a página durante o registro de presenças.
 * 4. Tratamento resiliente de falhas de cache e rede (Cache-First com fallback para rede e página principal).
 */

const CACHE_VERSION = 'v1.6.0-sync';
const STATIC_CACHE_NAME = `cerimonial-bagl-static-${CACHE_VERSION}`;

const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/css/styles.css',
  './assets/libs/tailwind.min.js',
  './assets/libs/pdf.min.js',
  './assets/libs/pdf.worker.min.js',
  './assets/img/emblema-bagl.png',
  './assets/img/heraldica-fab.jpg',
  './assets/img/icon-180.png',
  './assets/img/icon-192.png',
  './assets/img/icon-512.png',
  './assets/fonts/cinzel-800-normal-latin-ext.woff2',
  './assets/fonts/cinzel-800-normal-latin.woff2',
  './assets/fonts/inter-700-normal-latin-ext.woff2',
  './assets/fonts/inter-700-normal-latin.woff2',
  './assets/fonts/lora-400-italic-latin-ext.woff2',
  './assets/fonts/lora-400-italic-latin.woff2',
  './assets/fonts/lora-600-normal-latin-ext.woff2',
  './assets/fonts/lora-600-normal-latin.woff2',
  './data/initial-data.js',
  './data/default-carometro.json',
  './js/utils/toast.js',
  './js/utils/photo-utils.js',
  './js/utils/rank-parser.js',
  './js/core/db.js',
  './js/modules/nominata.js',
  './js/modules/pdf-importer.js',
  './js/modules/pwa.js',
  './js/modules/sync.js',
  './js/app.js'
];

// Instalação: pré-carrega de forma atômica/resiliente os ativos estáticos no cache versionado
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE_NAME).then(async (cache) => {
      // Precaching individual resiliente para garantir que todos os arquivos estáticos sejam armazenados
      const results = await Promise.allSettled(
        STATIC_ASSETS.map(async (assetUrl) => {
          const req = new Request(assetUrl, { cache: 'reload' });
          const resp = await fetch(req);
          if (!resp || !resp.ok) {
            throw new Error(`Falha ao armazenar em cache o recurso estático: ${assetUrl} (${resp ? resp.status : 'sem resposta'})`);
          }
          await cache.put(assetUrl, resp);
          return assetUrl;
        })
      );

      const failed = results.filter((r) => r.status === 'rejected');
      if (failed.length > 0) {
        console.warn('[SW Cerimonial BAGL] Aviso durante precache de recursos:', failed);
      }
      // IMPORTANTE: Não chamamos self.skipWaiting() aqui automaticamente!
      // Se já houver um Service Worker ativo controlando a página, este novo SW ficará em estado "waiting"
      // até que o operador confirme a atualização na interface.
      return true;
    })
  );
});

// Ativação: remove apenas caches estáticos de versões antigas, preservando integralmente o IndexedDB
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((name) => {
            if (name.startsWith('cerimonial-bagl-static-') && name !== STATIC_CACHE_NAME) {
              return caches.delete(name);
            }
            return Promise.resolve(false);
          })
        );
      })
      .then(() => self.clients.claim())
  );
});

// Comunicação com a interface: permite aplicar atualização somente após confirmação explícita do operador
self.addEventListener('message', (event) => {
  if (!event.data) return;
  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  } else if (event.data.type === 'GET_VERSION') {
    if (event.ports && event.ports[0]) {
      event.ports[0].postMessage({ version: CACHE_VERSION, cacheName: STATIC_CACHE_NAME });
    }
  }
});

// Interceptação de requisições (Cache-First para arquivos estáticos dentro do escopo da aplicação, compatível com subdiretórios HTTPS como GitHub Pages)
self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Ignorar métodos não-GET ou esquemas como blob:, data:, chrome-extension:
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if (url.origin !== self.location.origin) return;

  // Determinar o diretório base onde o Service Worker está hospedado (ex: '/' ou '/Cerimonial/')
  const scopeBasePath = new URL('./', self.location.href).pathname;
  if (!url.pathname.startsWith(scopeBasePath)) return;

  event.respondWith(
    caches.open(STATIC_CACHE_NAME).then(async (cache) => {
      try {
        // 1. Tentar localizar exatamente no cache versionado (ignorando query string de cache-busting eventual)
        let cachedResponse =
          (await cache.match(request)) || (await cache.match(request, { ignoreSearch: true }));

        // Caso a requisição seja para a raiz do subdiretório (ex: /Cerimonial/), mapear também para index.html relativo ao escopo
        if (!cachedResponse && (url.pathname === scopeBasePath || url.pathname === scopeBasePath.replace(/\/$/, ''))) {
          const indexUrl = new URL('./index.html', self.location.href).href;
          cachedResponse = await cache.match(indexUrl, { ignoreSearch: true });
        }

        if (cachedResponse) {
          return cachedResponse;
        }

        // 2. Se não estava no cache, buscar na rede e armazenar caso seja um recurso estático válido
        const networkResponse = await fetch(request);
        if (networkResponse && networkResponse.ok && networkResponse.status === 200) {
          try {
            await cache.put(request, networkResponse.clone());
          } catch (cachePutErr) {
            console.warn('[SW Cerimonial BAGL] Falha não-crítica ao gravar no cache:', cachePutErr);
          }
        }
        return networkResponse;
      } catch (err) {
        // 3. Tratamento de falha offline: se for uma navegação de página dentro do subdiretório, retornar o index.html relativo ao escopo
        if (request.mode === 'navigate' || (request.headers.get('accept') || '').includes('text/html')) {
          const indexUrl = new URL('./index.html', self.location.href).href;
          const rootScopeUrl = new URL('./', self.location.href).href;
          const fallbackHtml =
            (await cache.match(indexUrl, { ignoreSearch: true })) ||
            (await cache.match(rootScopeUrl, { ignoreSearch: true })) ||
            (await cache.match('./index.html')) ||
            (await cache.match('index.html')) ||
            (await cache.match('./'));
          if (fallbackHtml) return fallbackHtml;
        }
        return new Response('Recurso indisponível no modo offline.', {
          status: 503,
          statusText: 'Service Unavailable (Offline)',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' }
        });
      }
    })
  );
});
