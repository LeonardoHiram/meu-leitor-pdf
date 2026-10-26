const CACHE_NAME = 'leitor-pdf-dinamico';

const STATIC_LIBRARIES = [
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf_viewer.min.css',
  'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_LIBRARIES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 1. INTERCEPTADOR DE PDF ENVIADO PELO ANDROID (Web Share Target POST)
  if (event.request.method === 'POST' && url.searchParams.has('shared-pdf')) {
    event.respondWith((async () => {
      try {
        const formData = await event.request.formData();
        const file = formData.get('pdf') || formData.getAll('pdf')[0];
        if (file) {
          const cache = await caches.open(CACHE_NAME);
          const headers = new Headers({
            'Content-Type': file.type || 'application/pdf',
            'X-File-Name': encodeURIComponent(file.name || 'documento.pdf')
          });
          await cache.put('./__shared_pdf__', new Response(file, { headers }));
        }
      } catch (err) {
        console.error('Erro ao capturar PDF no Service Worker:', err);
      }
      // Redireciona para o index.html sinalizando que há um PDF pronto na memória
      return Response.redirect('./index.html?load-shared=1', 303);
    })());
    return;
  }

  // Ignora outras requisições que não sejam GET
  if (event.request.method !== 'GET') return;

  // 2. Bibliotecas estáticas pesadas: Cache-First
  if (STATIC_LIBRARIES.some(lib => event.request.url.includes(lib))) {
    event.respondWith(
      caches.match(event.request).then(cached => cached || fetch(event.request))
    );
    return;
  }

  // 3. Arquivos do próprio app: Network-First com fallback offline
  event.respondWith(
    fetch(event.request)
      .then(networkResponse => {
        const responseClone = networkResponse.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, responseClone);
        });
        return networkResponse;
      })
      .catch(() => caches.match(event.request))
  );
});