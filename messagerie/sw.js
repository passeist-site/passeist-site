// Service worker de la messagerie passéist : affiche les notifications de
// nouveaux messages (envoyées par netlify/functions/chat.js) et ouvre la
// conversation au toucher.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data && e.data.text() }; }
  e.waitUntil((async () => {
    await self.registration.showNotification(d.title || 'passéist · nouveau message', {
      body: d.body || '',
      tag: d.tag || 'passeist-chat',
      renotify: true,
      icon: '/img/favicon-192.png',
      badge: '/img/favicon-192.png',
      data: { url: d.url || '/messagerie/' },
    });
    // Page ouverte : on lui demande de rafraîchir la liste
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    wins.forEach(w => w.postMessage({ type: 'new-message' }));
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/messagerie/';
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (w.url.includes('/messagerie/')) { await w.focus(); w.navigate(url); return; }
    }
    await self.clients.openWindow(url);
  })());
});
