// Cerimonial BAGL exclusivamente online: desativa o service worker da versão antiga.
// Limpa SOMENTE cache estático do próprio Cerimonial; preserva o IndexedDB.
self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('cerimonial-bagl-static-')).map(k => caches.delete(k)));
    await self.registration.unregister();
    await self.clients.claim();
  })());
});
// Sem fetch handler. Sempre utilizar a rede.
