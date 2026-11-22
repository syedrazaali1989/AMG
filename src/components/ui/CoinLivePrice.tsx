'use client';

import { useEffect, useState } from 'react';

/**
 * CoinLivePrice - the coin page header price, kept live client-side.
 *
 * The coin page header is server-rendered (revalidate = 60); this
 * drops in for the price value only and re-fetches
 * /api/binance/prices every 60 seconds so the price on screen follows
 * the market while the page is open. A failed tick silently keeps the
 * last shown price. The 24h change line and the high/low/volume
 * cards stay server-rendered.
 *
 * The formatter mirrors formatCoinPrice in lib/signals/coinData.ts;
 * it is kept local so the server data layer (and its engine imports)
 * is not pulled into the client bundle for one pure function.
 */

function formatLivePrice(price: number): string {
    if (!Number.isFinite(price)) return '-';
    if (price >= 1000) {
        return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    if (price >= 1) return price.toFixed(2);
    if (price >= 0.01) return price.toFixed(4);
    return price.toFixed(8);
}

interface CoinLivePriceProps {
    /** Binance symbol, e.g. 'BTCUSDT' - the /api/binance/prices key */
    symbol: string;
    /** Server-rendered price shown until the first tick lands */
    initialPrice: number;
}

export function CoinLivePrice({ symbol, initialPrice }: CoinLivePriceProps) {
    const [price, setPrice] = useState(initialPrice);

    useEffect(() => {
        let cancelled = false;

        const loadPrice = () => {
            fetch('/api/binance/prices')
                .then(r => {
                    if (!r.ok) throw new Error(`prices ${r.status}`);
                    return r.json();
                })
                .then(data => {
                    if (cancelled) return;
                    const next = data?.prices?.[symbol];
                    if (typeof next === 'number' && Number.isFinite(next) && next > 0) {
                        setPrice(next);
                    }
                })
                .catch(() => {
                    // Silent: keep the last shown price on a failed tick.
                });
        };

        const interval = setInterval(loadPrice, 60_000);
        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, [symbol]);

    return (
        <p className="text-2xl md:text-3xl font-bold text-gradient">
            ${formatLivePrice(price)}
        </p>
    );
}
