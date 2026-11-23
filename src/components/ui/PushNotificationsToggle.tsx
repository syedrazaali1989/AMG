'use client';

import { Bell, BellOff, BellRing, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';

/**
 * Navbar toggle for Web Push signal notifications.
 *
 * States:
 *  - loading        checking support / configuration / subscription
 *  - unsupported    browser has no Push API (renders nothing)
 *  - not-configured server has no VAPID key yet -> plain "not set up" state
 *  - off / on       subscribed state, click toggles
 *  - busy           a subscribe/unsubscribe request is in flight
 */

type ToggleState = 'loading' | 'unsupported' | 'not-configured' | 'off' | 'on' | 'busy';

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(new ArrayBuffer(rawData.length));
    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

export function PushNotificationsToggle() {
    const [state, setState] = useState<ToggleState>('loading');
    const [note, setNote] = useState<string | null>(null);
    const [publicKey, setPublicKey] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        (async () => {
            if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
                if (!cancelled) setState('unsupported');
                return;
            }

            try {
                const res = await fetch('/api/push/key');
                const data = (await res.json()) as { publicKey: string | null };
                if (cancelled) return;

                if (!data.publicKey) {
                    setState('not-configured');
                    return;
                }
                setPublicKey(data.publicKey);

                const registration = await navigator.serviceWorker.ready;
                const existing = await registration.pushManager.getSubscription();
                if (!cancelled) setState(existing ? 'on' : 'off');
            } catch {
                if (!cancelled) setState('not-configured');
            }
        })();

        return () => {
            cancelled = true;
        };
    }, []);

    const flashNote = (message: string) => {
        setNote(message);
        window.setTimeout(() => setNote(null), 3000);
    };

    const enable = async () => {
        if (!publicKey) return;
        setState('busy');
        try {
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') {
                flashNote('Permission blocked');
                setState('off');
                return;
            }

            const registration = await navigator.serviceWorker.ready;
            const subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(publicKey)
            });

            const res = await fetch('/api/push/subscribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ subscription: subscription.toJSON() })
            });

            if (!res.ok) {
                await subscription.unsubscribe().catch(() => {});
                flashNote(res.status === 503 ? 'Notifications not set up yet' : 'Could not subscribe');
                setState(res.status === 503 ? 'not-configured' : 'off');
                return;
            }

            setState('on');
        } catch {
            flashNote('Could not subscribe');
            setState('off');
        }
    };

    const disable = async () => {
        setState('busy');
        try {
            const registration = await navigator.serviceWorker.ready;
            const subscription = await registration.pushManager.getSubscription();
            if (subscription) {
                await fetch('/api/push/subscribe', {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ endpoint: subscription.endpoint })
                }).catch(() => {});
                await subscription.unsubscribe().catch(() => {});
            }
            setState('off');
        } catch {
            setState('on');
        }
    };

    if (state === 'unsupported') return null;

    const handleClick = () => {
        if (state === 'not-configured') {
            flashNote('Notifications not set up yet');
        } else if (state === 'off') {
            void enable();
        } else if (state === 'on') {
            void disable();
        }
    };

    const Icon =
        state === 'busy' || state === 'loading'
            ? Loader2
            : state === 'on'
              ? BellRing
              : state === 'not-configured'
                ? BellOff
                : Bell;

    const label =
        note ??
        (state === 'on' ? 'Notifications On' : state === 'not-configured' ? 'Notifications' : 'Notifications');

    return (
        <button
            onClick={handleClick}
            disabled={state === 'busy' || state === 'loading'}
            className={`flex items-center gap-1.5 p-2 rounded-lg hover:bg-muted/50 transition-colors text-sm font-medium ${
                state === 'on' ? 'text-[#FFD700]' : 'text-[#D4AF37]'
            } ${state === 'not-configured' ? 'opacity-60' : ''}`}
            aria-label="Toggle signal notifications"
            title={
                state === 'not-configured'
                    ? 'Notifications not set up yet'
                    : state === 'on'
                      ? 'Signal notifications are on - click to turn off'
                      : 'Get a notification when a new signal is generated'
            }
        >
            <Icon className={`w-5 h-5 ${state === 'busy' || state === 'loading' ? 'animate-spin' : ''}`} />
            <span className="hidden lg:inline">{label}</span>
        </button>
    );
}
