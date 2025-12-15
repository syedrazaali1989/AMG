// Real Binance Price Fetcher
// Fetches current prices from Binance API

export async function fetchBinancePrice(pair: string): Promise<number | null> {
    try {
        const symbol = pair.replace('/', ''); // BTC/USDT → BTCUSDT
        const response = await fetch(
            `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`,
            { cache: 'no-store' }
        );

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        return parseFloat(data.price);
    } catch (error) {
        console.warn(`Failed to fetch price for ${pair}:`, error);
        return null;
    }
}

export async function fetchMultiplePrices(pairs: string[]): Promise<Map<string, number>> {
    const priceMap = new Map<string, number>();

    const results = await Promise.allSettled(
        pairs.map(async (pair) => {
            const price = await fetchBinancePrice(pair);
            if (price !== null) {
                priceMap.set(pair, price);
            }
        })
    );

    return priceMap;
}
