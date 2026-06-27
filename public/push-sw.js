// Dedicated service worker for Web Push notifications.
// Deliberately separate from /sw.js (the PWA offline-cache worker, which
// self-destructs on activate) so the two never conflict.

self.addEventListener('install', () => {
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('push', event => {
    let data = { title: 'TradeMasters', body: 'New update available', url: '/' };
    try {
        if (event.data) {
            data = { ...data, ...event.data.json() };
        }
    } catch (e) {
        // payload wasn't JSON — fall back to defaults
    }

    const options = {
        body: data.body,
        icon: '/trademasters-logo.png',
        badge: '/trademasters-logo.png',
        data: { url: data.url || '/' },
        tag: 'trademasters-signal',
        renotify: true,
    };

    event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    const targetUrl = (event.notification.data && event.notification.data.url) || '/';

    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
            for (const client of clientList) {
                if (client.url.includes(self.location.origin) && 'focus' in client) {
                    client.navigate(targetUrl);
                    return client.focus();
                }
            }
            if (self.clients.openWindow) {
                return self.clients.openWindow(targetUrl);
            }
        })
    );
});
