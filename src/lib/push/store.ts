import { Redis } from '@upstash/redis';

/**
 * Storage + configuration for Web Push notifications.
 *
 * Everything is env-driven and degrades cleanly: when the storage env
 * vars are absent, getPushRedis() returns null and callers answer an
 * honest "not configured" state instead of crashing. NO secret value is
 * ever committed to this (public) repo - keys live only in the host's
 * environment variables.
 *
 * Accepted env names (Vercel's Upstash integration has used both):
 *   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
 *   KV_REST_API_URL        / KV_REST_API_TOKEN
 */

let cachedRedis: Redis | null | undefined;

export function getPushRedis(): Redis | null {
    if (cachedRedis !== undefined) return cachedRedis;
    const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
    cachedRedis = url && token ? new Redis({ url, token }) : null;
    return cachedRedis;
}

export function getVapidPublicKey(): string | null {
    return process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || null;
}

export function getVapidPrivateKey(): string | null {
    return process.env.VAPID_PRIVATE_KEY || null;
}

export function getVapidSubject(): string {
    return process.env.VAPID_SUBJECT || 'mailto:admin@amgtrading.vercel.app';
}

/** Storage (Upstash Redis) reachable. Subscriptions can be stored. */
export function isStorageConfigured(): boolean {
    return getPushRedis() !== null;
}

/** Storage + VAPID keys present. Pushes can actually be sent. */
export function isPushConfigured(): boolean {
    return isStorageConfigured() && getVapidPublicKey() !== null && getVapidPrivateKey() !== null;
}

export interface StoredSubscription {
    endpoint: string;
    keys: {
        p256dh: string;
        auth: string;
    };
}

const SUBS_KEY = 'push:subs';

export async function listSubscriptions(redis: Redis): Promise<StoredSubscription[]> {
    const all = await redis.hgetall(SUBS_KEY);
    if (!all) return [];
    const subs: StoredSubscription[] = [];
    for (const raw of Object.values(all as Record<string, unknown>)) {
        try {
            const parsed = (typeof raw === 'string' ? JSON.parse(raw) : raw) as StoredSubscription;
            if (parsed && typeof parsed.endpoint === 'string' && parsed.keys?.p256dh && parsed.keys?.auth) {
                subs.push({
                    endpoint: parsed.endpoint,
                    keys: { p256dh: parsed.keys.p256dh, auth: parsed.keys.auth }
                });
            }
        } catch {
            // Skip malformed entries rather than failing the whole send pass.
        }
    }
    return subs;
}

export async function saveSubscription(redis: Redis, sub: StoredSubscription): Promise<void> {
    await redis.hset(SUBS_KEY, { [sub.endpoint]: JSON.stringify(sub) });
}

export async function removeSubscription(redis: Redis, endpoint: string): Promise<void> {
    await redis.hdel(SUBS_KEY, endpoint);
}
