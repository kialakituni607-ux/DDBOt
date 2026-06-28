const API_BASE = 'https://api.trademasters.site';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

export const isPushSupported = (): boolean =>
    'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export const getPushPermissionState = (): NotificationPermission | 'unsupported' => {
    if (!isPushSupported()) return 'unsupported';
    return Notification.permission;
};

export const subscribeToPush = async (): Promise<{ ok: boolean; error?: string }> => {
    if (!isPushSupported()) {
        return { ok: false, error: 'Push notifications are not supported in this browser.' };
    }
    try {
        console.log('[push] step 1: requesting permission');
        const permission = await Notification.requestPermission();
        console.log('[push] step 2: permission =', permission);
        if (permission !== 'granted') {
            return { ok: false, error: 'Notification permission was not granted.' };
        }
        console.log('[push] step 3: registering service worker');
        const registration = await navigator.serviceWorker.register('/push-sw.js', {
            scope: '/',
        });
        console.log('[push] step 4: sw registered, waiting for ready');
        await navigator.serviceWorker.ready;
        console.log('[push] step 5: sw ready, fetching vapid key');
        const keyRes = await fetch(`${API_BASE}/api/push/vapid-public-key`);
        console.log('[push] step 6: vapid fetch status', keyRes.status);
        const keyData = await keyRes.json();
        console.log('[push] step 7: vapid key received', !!keyData.publicKey);
        if (!keyData.publicKey) {
            return { ok: false, error: 'Push is not configured on the server yet.' };
        }
        console.log('[push] step 8: checking existing subscription');
        let subscription = await registration.pushManager.getSubscription();
        console.log('[push] step 9: existing sub =', !!subscription);
        if (!subscription) {
            console.log('[push] step 10: subscribing to pushManager');
            subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(keyData.publicKey) as BufferSource,
            });
            console.log('[push] step 11: pushManager.subscribe resolved');
        }
        const subJson = subscription.toJSON();
        const res = await fetch(`${API_BASE}/api/push/subscribe`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint: subJson.endpoint, keys: subJson.keys }),
        });
        if (!res.ok) {
            return { ok: false, error: 'Failed to save subscription on the server.' };
        }
        try {
            localStorage.setItem('push_subscribed', 'true');
        } catch {
            /* ignore */
        }
        return { ok: true };
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error subscribing to push.';
        return { ok: false, error: message };
    }
};

export const unsubscribeFromPush = async (): Promise<{ ok: boolean; error?: string }> => {
    if (!isPushSupported()) {
        return { ok: false, error: 'Push notifications are not supported in this browser.' };
    }
    try {
        const registration = await navigator.serviceWorker.getRegistration('/push-sw.js');
        if (!registration) {
            try {
                localStorage.removeItem('push_subscribed');
            } catch {
                /* ignore */
            }
            return { ok: true };
        }
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) {
            const endpoint = subscription.endpoint;
            await subscription.unsubscribe();
            await fetch(`${API_BASE}/api/push/unsubscribe`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ endpoint }),
            }).catch(() => {
                /* best effort — local unsubscribe already succeeded */
            });
        }
        try {
            localStorage.removeItem('push_subscribed');
        } catch {
            /* ignore */
        }
        return { ok: true };
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error unsubscribing from push.';
        return { ok: false, error: message };
    }
};

export const isLikelySubscribed = (): boolean => {
    try {
        return localStorage.getItem('push_subscribed') === 'true';
    } catch {
        return false;
    }
};
