import type { MetadataRoute } from 'next';
import { COIN_PAIRS } from '@/lib/signals/coinData';

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://amgtrading.vercel.app';

export default function sitemap(): MetadataRoute.Sitemap {
    const now = new Date();

    const staticRoutes = [
        '',
        '/dashboard',
        '/scalping',
        '/scalping-v2',
        '/money-rotation',
        '/on-chain',
        '/gold',
        '/flow-map',
        '/completed',
        '/coins'
    ].map(route => ({
        url: `${BASE_URL}${route}`,
        lastModified: now,
        changeFrequency: 'hourly' as const,
        priority: route === '' ? 1 : 0.8
    }));

    const coinRoutes = COIN_PAIRS.map(coin => ({
        url: `${BASE_URL}/coin/${coin.symbol}`,
        lastModified: now,
        changeFrequency: 'hourly' as const,
        priority: 0.6
    }));

    return [...staticRoutes, ...coinRoutes];
}
