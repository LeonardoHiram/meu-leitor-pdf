const CACHE_NAME = 'leitor-pdf-v3';
const SHARED_PDF_KEY = 'https://shared-pdf.local/documento.pdf';
const SHARED_STATUS_KEY = 'https://shared-pdf.local/status.json';

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
  // 1. INTERCEPTADOR DE PDF ENVIADO PELO ANDROID (Web Share Target POST)
  if (event.request.method === 'POST') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const formData = await event.request.formData();
        let file = formData.get('pdf');

        if (!file) {
          for (const [, value] of formData.entries()) {
            if (value && typeof value === 'object' && 'size' in value && value.size > 0) {
              file = value;
              break;
            }
          }
        }

        if (file && file.size > 0) {
          const buffer = await file.arrayBuffer();
          const headers = new Headers({
            'Content-Type': file.type || 'application/pdf',
            'Content-Length': String(buffer.byteLength),
            'X-File-Name': encodeURIComponent(file.name || 'documento.pdf')
          });

          await cache.put(SHARED_PDF_KEY, new Response(buffer, { headers }));
          await cache.put(SHARED_STATUS_KEY, new Response(JSON.stringify({ ok: true, name: file.name, size: buffer.byteLength })));

          const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
          for (const client of clientsList) {
            client.postMessage({ type: 'SHARED_PDF_READY' });
          }
        } else {
          await cache.put(SHARED_STATUS_KEY, new Response(JSON.stringify({ ok: false, reason: 'O Android abriu o POST, mas não anexou o arquivo no formulário.' })));
        }
      } catch (err) {
        await cache.put(SHARED_STATUS_KEY, new Response(JSON.stringify({ ok: false, reason: err.message })));
      }

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
      .catch(() => caches.match(event.request, { ignoreSearch: true }))
  );
});