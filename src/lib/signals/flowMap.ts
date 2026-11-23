/**
 * Money Flow Map - server-side cross-asset data layer.
 *
 * A public-data rebuild of the "MONEY FLOW MAP" concept: where money is
 * moving across crypto, US stocks, precious metals, oil, bonds, the
 * dollar and stablecoins. Every number is computed from a fetched
 * public series - NOTHING is invented, and any asset whose source
 * fails is reported as 'unavailable', never faked.
 *
 * Sources (each verified live on 2026-11-23):
 *   - BTC, ETH, Gold: Binance public market data (data-api.binance.vision,
 *     via BinanceAPI - the same source as the rest of the site). Gold is
 *     PAXG/USDT, the tokenised ounce this site's Gold page already uses.
 *   - Silver, Crude Oil, S&P 500, Nasdaq 100, US Bonds (TLT), US Dollar
 *     (DXY), VIX: Yahoo Finance chart API. (Stooq's daily CSV was the
 *     first choice but is behind a JavaScript browser check that a
 *     server fetch cannot pass, so Yahoo is the working source.)
 *   - Stablecoins: DefiLlama public API - aggregate circulating supply
 *     of all tracked stablecoins.
 *   - The Fed: the Federal Reserve's published FOMC meeting calendar,
 *     held as a static list below (decision days only).
 *
 * Per asset the map shows: latest price, % change (24h for crypto from
 * the Binance ticker; last daily session for TradFi; 7-day change for
 * stablecoin supply) and a z-score: how unusual the latest daily
 * return is versus the trailing 90 daily returns, in standard
 * deviations (shown as σ on the page).
 */

import { BinanceAPI } from './binanceAPI';

export type FlowGroup = 'risk' | 'safety' | 'volatility';

export interface FlowAsset {
    id: string;
    name: string;
    group: FlowGroup;
    status: 'ok' | 'unavailable';
    /** Latest price. For stablecoins: total circulating supply in USD. */
    price: number | null;
    /** % change - see changeLabel for the window it covers. */
    changePct: number | null;
    changeLabel: '24h' | 'last session' | '7d';
    /** Z-score of the latest daily return vs the trailing 90 daily returns. */
    zScore: number | null;
    /** Human-readable data source, shown on the card. */
    source: string;
}

export interface FedDecision {
    /** ISO instant of the scheduled announcement (2:00 PM New York). */
    date: string;
    /** e.g. 'Wed, Dec 9, 2026' */
    label: string;
}

export interface FlowSummary {
    inflowName: string;
    inflowZ: number;
    outflowName: string;
    outflowZ: number;
}

export interface FlowMapData {
    assets: FlowAsset[];
    /** -100 (extreme risk-off) .. +100 (extreme risk-on); null if too few assets are live. */
    riskMeter: { score: number; label: 'RISK-ON' | 'RISK-OFF' | 'NEUTRAL' } | null;
    flowSummary: FlowSummary | null;
    fed: FedDecision | null;
    /** Unix ms when this snapshot was computed. */
    updatedAt: number;
}

// ---------------------------------------------------------------------------
// Z-score helper
// ---------------------------------------------------------------------------

interface LatestReturn {
    /** Latest daily return as a fraction (0.01 = +1%). */
    latestReturn: number;
    /** Z-score of that return vs the trailing 90 daily returns. */
    z: number;
}

/**
 * Daily returns from a close series (oldest first); the latest return
 * is scored against the 90 returns before it. Returns null when there
 * is not enough history to say anything honest.
 */
function zScoreOfLatest(closes: number[]): LatestReturn | null {
    const returns: number[] = [];
    for (let i = 1; i < closes.length; i++) {
        if (closes[i - 1] > 0 && Number.isFinite(closes[i])) {
            returns.push(closes[i] / closes[i - 1] - 1);
        }
    }
    if (returns.length < 31) return null;

    const latest = returns[returns.length - 1];
    const window = returns.slice(-91, -1);
    if (window.length < 30) return null;

    const mean = window.reduce((a, b) => a + b, 0) / window.length;
    const variance =
        window.reduce((a, b) => a + (b - mean) * (b - mean), 0) / window.length;
    const std = Math.sqrt(variance);
    if (!(std > 0)) return null;

    return { latestReturn: latest, z: (latest - mean) / std };
}

// ---------------------------------------------------------------------------
// Fetchers - each returns a fully-formed FlowAsset, 'unavailable' on failure
// ---------------------------------------------------------------------------

function unavailable(base: Omit<FlowAsset, 'status' | 'price' | 'changePct' | 'zScore'>): FlowAsset {
    return { ...base, status: 'unavailable', price: null, changePct: null, zScore: null };
}

async function binanceAsset(
    id: string,
    name: string,
    group: FlowGroup,
    symbol: string
): Promise<FlowAsset> {
    const base = {
        id,
        name,
        group,
        changeLabel: '24h' as const,
        source: 'Binance'
    };
    try {
        const [klines, ticker] = await Promise.all([
            BinanceAPI.getKlines(symbol, '1d', 120),
            BinanceAPI.get24hTicker(symbol)
        ]);
        const closes = klines
            .map(k => parseFloat(String(k[4])))
            .filter(n => Number.isFinite(n) && n > 0);
        const scored = zScoreOfLatest(closes);
        const price = parseFloat(ticker.lastPrice);
        const changePct = parseFloat(ticker.priceChangePercent);
        if (!scored || !Number.isFinite(price) || !Number.isFinite(changePct)) {
            return unavailable(base);
        }
        return {
            ...base,
            status: 'ok',
            price,
            changePct,
            zScore: scored.z
        };
    } catch {
        return unavailable(base);
    }
}

async function yahooAsset(
    id: string,
    name: string,
    group: FlowGroup,
    symbol: string
): Promise<FlowAsset> {
    const base = {
        id,
        name,
        group,
        changeLabel: 'last session' as const,
        source: 'Yahoo Finance'
    };
    try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
            symbol
        )}?range=1y&interval=1d`;
        const response = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AMGTrading/1.0)' },
            signal: AbortSignal.timeout(12_000)
        });
        if (!response.ok) return unavailable(base);

        const json = await response.json();
        const result = json?.chart?.result?.[0];
        const rawCloses: unknown[] = result?.indicators?.quote?.[0]?.close ?? [];
        const closes = rawCloses.filter(
            (c): c is number => typeof c === 'number' && Number.isFinite(c) && c > 0
        );
        const scored = zScoreOfLatest(closes);
        if (!scored) return unavailable(base);

        const metaPrice = result?.meta?.regularMarketPrice;
        const price =
            typeof metaPrice === 'number' && Number.isFinite(metaPrice) && metaPrice > 0
                ? metaPrice
                : closes[closes.length - 1];

        return {
            ...base,
            status: 'ok',
            price,
            changePct: scored.latestReturn * 100,
            zScore: scored.z
        };
    } catch {
        return unavailable(base);
    }
}

async function stablecoinAsset(): Promise<FlowAsset> {
    const base = {
        id: 'stablecoins',
        name: 'Stablecoins',
        group: 'safety' as FlowGroup,
        changeLabel: '7d' as const,
        source: 'DefiLlama'
    };
    try {
        const response = await fetch('https://stablecoins.llama.fi/stablecoincharts/all', {
            signal: AbortSignal.timeout(15_000)
        });
        if (!response.ok) return unavailable(base);

        const points: Array<{ totalCirculatingUSD?: Record<string, number> }> =
            await response.json();
        const totals: number[] = [];
        for (const point of points) {
            if (!point.totalCirculatingUSD) continue;
            const total = Object.values(point.totalCirculatingUSD).reduce(
                (sum, v) => sum + (typeof v === 'number' && Number.isFinite(v) ? v : 0),
                0
            );
            if (total > 0) totals.push(total);
        }
        if (totals.length < 40) return unavailable(base);

        const scored = zScoreOfLatest(totals);
        if (!scored) return unavailable(base);

        const latest = totals[totals.length - 1];
        const weekAgo = totals[totals.length - 8];
        return {
            ...base,
            status: 'ok',
            price: latest,
            changePct: (latest / weekAgo - 1) * 100,
            zScore: scored.z
        };
    } catch {
        return unavailable(base);
    }
}

// ---------------------------------------------------------------------------
// The Fed - published FOMC decision days (second day of each meeting,
// announcement 2:00 PM New York). Source: federalreserve.gov meeting
// calendar, checked 2026-11-23. The Nov 2027 entry on that calendar is
// a strategy meeting, not a rate decision, so it is not listed. When
// this list runs out the node honestly shows as unavailable.
// ---------------------------------------------------------------------------

const FOMC_DECISIONS: FedDecision[] = [
    { date: '2026-01-28T19:00:00Z', label: 'Wed, Jan 28, 2026' },
    { date: '2026-03-18T18:00:00Z', label: 'Wed, Mar 18, 2026' },
    { date: '2026-04-29T18:00:00Z', label: 'Wed, Apr 29, 2026' },
    { date: '2026-06-17T18:00:00Z', label: 'Wed, Jun 17, 2026' },
    { date: '2026-07-29T18:00:00Z', label: 'Wed, Jul 29, 2026' },
    { date: '2026-09-16T18:00:00Z', label: 'Wed, Sep 16, 2026' },
    { date: '2026-10-28T18:00:00Z', label: 'Wed, Oct 28, 2026' },
    { date: '2026-12-09T19:00:00Z', label: 'Wed, Dec 9, 2026' },
    { date: '2027-01-27T19:00:00Z', label: 'Wed, Jan 27, 2027' },
    { date: '2027-03-17T18:00:00Z', label: 'Wed, Mar 17, 2027' },
    { date: '2027-04-28T18:00:00Z', label: 'Wed, Apr 28, 2027' },
    { date: '2027-06-09T18:00:00Z', label: 'Wed, Jun 9, 2027' },
    { date: '2027-07-28T18:00:00Z', label: 'Wed, Jul 28, 2027' },
    { date: '2027-09-15T18:00:00Z', label: 'Wed, Sep 15, 2027' },
    { date: '2027-10-27T18:00:00Z', label: 'Wed, Oct 27, 2027' }
];

function nextFedDecision(nowMs: number): FedDecision | null {
    return FOMC_DECISIONS.find(d => new Date(d.date).getTime() > nowMs) ?? null;
}

// ---------------------------------------------------------------------------
// Assembly (5-minute server-side cache, mirroring /api/candles)
// ---------------------------------------------------------------------------

const CACHE_TTL = 5 * 60 * 1000;
let cache: { data: FlowMapData; timestamp: number } | null = null;

export async function getFlowMap(): Promise<FlowMapData> {
    if (cache && Date.now() - cache.timestamp < CACHE_TTL) {
        return cache.data;
    }

    const assets = await Promise.all([
        binanceAsset('btc', 'Bitcoin', 'risk', 'BTCUSDT'),
        binanceAsset('eth', 'Ethereum', 'risk', 'ETHUSDT'),
        binanceAsset('gold', 'Gold (PAXG)', 'safety', 'PAXGUSDT'),
        yahooAsset('silver', 'Silver', 'risk', 'SI=F'),
        yahooAsset('crude', 'Crude Oil', 'risk', 'CL=F'),
        yahooAsset('spx', 'S&P 500', 'risk', '^GSPC'),
        yahooAsset('nasdaq', 'Nasdaq 100', 'risk', '^IXIC'),
        yahooAsset('bonds', 'US Bonds (TLT)', 'safety', 'TLT'),
        yahooAsset('dollar', 'US Dollar (DXY)', 'safety', 'DX-Y.NYB'),
        stablecoinAsset(),
        yahooAsset('vix', 'VIX', 'volatility', '^VIX')
    ]);

    // Risk-On / Risk-Off meter:
    //   score = clamp( (mean z-score of risk assets
    //                   − mean z-score of safety assets) × 25, −100, +100 )
    // Risk assets: BTC, ETH, silver, crude oil, S&P 500, Nasdaq 100.
    // Safety assets: gold, US bonds, US dollar, stablecoin supply.
    // VIX is excluded - it is a volatility gauge, not a flow destination.
    // The ×25 scale maps a ±4σ average divergence between the two groups
    // onto the ±100 ends of the meter. Computed only from live assets,
    // and only when at least 2 assets on each side are available.
    const live = assets.filter(a => a.status === 'ok' && a.zScore !== null);
    const riskZ = live.filter(a => a.group === 'risk').map(a => a.zScore as number);
    const safetyZ = live.filter(a => a.group === 'safety').map(a => a.zScore as number);

    let riskMeter: FlowMapData['riskMeter'] = null;
    if (riskZ.length >= 2 && safetyZ.length >= 2) {
        const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
        const raw = (mean(riskZ) - mean(safetyZ)) * 25;
        const score = Math.max(-100, Math.min(100, Math.round(raw)));
        riskMeter = {
            score,
            label: score <= -20 ? 'RISK-OFF' : score >= 20 ? 'RISK-ON' : 'NEUTRAL'
        };
    }

    // "What the flow says": the strongest inflow is the live asset with
    // the highest z-score, the strongest outflow the lowest. VIX is
    // excluded - money does not flow into a volatility index.
    const flowAssets = live.filter(a => a.group !== 'volatility');
    let flowSummary: FlowSummary | null = null;
    if (flowAssets.length >= 2) {
        const sorted = [...flowAssets].sort((a, b) => (b.zScore as number) - (a.zScore as number));
        const top = sorted[0];
        const bottom = sorted[sorted.length - 1];
        flowSummary = {
            inflowName: top.name,
            inflowZ: top.zScore as number,
            outflowName: bottom.name,
            outflowZ: bottom.zScore as number
        };
    }

    const data: FlowMapData = {
        assets,
        riskMeter,
        flowSummary,
        fed: nextFedDecision(Date.now()),
        updatedAt: Date.now()
    };

    cache = { data, timestamp: Date.now() };
    return data;
}
