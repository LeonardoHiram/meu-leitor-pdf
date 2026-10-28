const CACHE_NAME = 'leitor-pdf-dinamico';
const SHARED_PDF_KEY = 'https://shared-pdf.local/documento.pdf';

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
  // 1. INTERCEPTADOR DE PDF ENVIADO PELO ANDROID (Qualquer requisição POST)
  if (event.request.method === 'POST') {
    event.respondWith((async () => {
      try {
        const formData = await event.request.formData();
        let file = formData.get('pdf');

        // Busca qualquer arquivo válido caso o Android envie com outro nome de campo
        if (!file) {
          for (const [, value] of formData.entries()) {
            if (value && typeof value === 'object' && 'arrayBuffer' in value && value.size > 0) {
              file = value;
              break;
            }
          }
        }

        if (file && file.size > 0) {
          // Copia os bytes para a memória imediatamente antes do Android fechar o stream
          const buffer = await file.arrayBuffer();
          const cache = await caches.open(CACHE_NAME);
          const headers = new Headers({
            'Content-Type': file.type || 'application/pdf',
            'Content-Length': String(buffer.byteLength),
            'X-File-Name': encodeURIComponent(file.name || 'documento.pdf')
          });

          await cache.put(SHARED_PDF_KEY, new Response(buffer, { headers }));

          // Avisa o aplicativo caso ele já esteja aberto em segundo plano
          const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
          for (const client of clientsList) {
            client.postMessage({ type: 'SHARED_PDF_READY' });
          }
        }
      } catch (err) {
        console.error('Erro ao capturar PDF no Service Worker:', err);
      }

      // Cria a URL absoluta exigida pelo padrão do Service Worker no Android
      const redirectUrl = new URL('./index.html?load-shared=1', self.location.href).href;
      return Response.redirect(redirectUrl, 303);
    })());
    return;
  }

  if (event.request.method !== 'GET') return;

  // 2. Bibliotecas estáticas pesadas: Cache-First
  if (STATIC_LIBRARIES.some(lib => event.request.url.includes(lib))) {
    event.respondWith(
      caches.match(event.request).then(cached => cached || fetch(event.request))
    );
    return;
  }

  // 3. Arquivos do próprio app: Network-First com fallback offline (ignorando ?load-shared=1)
  event.respondWith(
    fetch(event.request)
      .then(networkResponse => {
        const responseClone = networkResponse.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, responseClone);
        });
        return networkResponse;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true }))
  );
});