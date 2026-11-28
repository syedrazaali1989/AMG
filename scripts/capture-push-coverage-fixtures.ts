// Scratch capture script (KEEP — re-run to refresh fixtures): records the
// live data the deterministic push-coverage test feeds the generators.
//
//   1. Live 5m klines (48) for the top-30 scalping pairs, via Binance.
//      A scalping signal fires often; the test re-timestamps this fixture
//      to "now" (prices are the recorded live data, only the candle open
//      times shift) so the 30-min strict freshness gate passes on reruns.
//      The script also runs the live scalping generator once and prints
//      which pairs fire, so a capture with zero firing pairs is caught
//      here, not in the test.
//   2. Live Blockchain.info feed (ticker + latestblock + rawblock),
//      filtered to the >= $500K transactions getLargeTransactions keeps.
//      The net flow of the captured feed picks the on-chain event
//      direction (SHORT when net <= 0, else LONG) so the whale veto
//      passes in the test.
//   3. The 1H event window from the canonical backtest dataset
//      (~/workspace/.amg-bt/data): last 100 1H candles per pair ending at
//      a REAL core-firing bar (found by scripts/find-firing-bars.ts),
//      plus that pair's 4H closes (250) derived from the same series.
//      No freshness gate exists on 1H data, so these timestamps stay.
//
// Output: scripts/fixtures/push-coverage-fixtures.json
import * as fs from 'fs';
import * as path from 'path';
import { BinanceAPI } from '../src/lib/signals/binanceAPI';
import { BlockchainInfoAPI, LargeTransaction } from '../src/lib/signals/blockchainInfoAPI';
import { MarketDataManager } from '../src/lib/signals/marketData';
import { ScalpingSignalGenerator } from '../src/lib/signals/scalpingGenerator';
import { MarketType, SignalType } from '../src/lib/signals/types';

const DATA_DIR = process.env.BT_DATA_DIR || '/home/hatch/workspace/.amg-bt/data';
const OUT = path.join(process.cwd(), 'scripts', 'fixtures', 'push-coverage-fixtures.json');

// Firing bars found by scripts/find-firing-bars.ts (core fires, pinned Math.random).
const SHORT_BAR = { index: 3111, iso: '2026-11-21T05:00:00.000Z' };
const LONG_BAR = { index: 1233, iso: '2026-09-03T23:00:00.000Z' };

const SCALPING_UNIVERSE = MarketDataManager.getCryptoPairs()
    .slice(0, 30)
    .map(p => (p === 'MATIC/USDT' ? 'POL/USDT' : p));

interface CandleSeries {
    openTime: number[];
    high: number[];
    low: number[];
    close: number[];
    volume: number[];
}

function loadSeries(symbol: string): CandleSeries {
    return JSON.parse(
        fs.readFileSync(path.join(DATA_DIR, `${symbol}.json`), 'utf8')
    ) as CandleSeries;
}

/** Binance kline array from dataset columns; open = previous close. */
function toKlines(s: CandleSeries, endIndex: number, count: number): number[][] {
    const out: number[][] = [];
    const start = endIndex - count + 1;
    for (let j = start; j <= endIndex; j++) {
        const open = j > 0 ? s.close[j - 1] : s.close[j];
        const ot = s.openTime[j];
        out.push([
            ot, open, s.high[j], s.low[j], s.close[j], s.volume[j],
            ot + 3599999, s.volume[j] * s.close[j], 0, 0, 0, 0
        ]);
    }
    return out;
}

/** 4H closes visible at 1H index i — same construction as the backtest
 *  harness (full 4-blocks + the partial block holding i), last 250. */
function closes4hAt(s: CandleSeries, i: number): number[] {
    const out: number[] = [];
    const fullBlocks = Math.floor((i + 1) / 4);
    for (let b = 0; b < fullBlocks; b++) out.push(s.close[4 * b + 3]);
    if ((i + 1) % 4 !== 0) out.push(s.close[i]);
    return out.slice(-250);
}

async function main(): Promise<void> {
    // --- 1. Live scalping 5m klines -------------------------------------
    console.log('capturing live 5m klines for', SCALPING_UNIVERSE.length, 'pairs...');
    const scalping5m: Record<string, number[][]> = {};
    await Promise.allSettled(
        SCALPING_UNIVERSE.map(async pair => {
            const symbol = BinanceAPI.pairToBinanceSymbol(pair);
            scalping5m[symbol] = await BinanceAPI.getKlines(symbol, '5m', 48);
        })
    );
    const capturedPairs = Object.keys(scalping5m).length;
    console.log(`captured 5m klines for ${capturedPairs}/${SCALPING_UNIVERSE.length} pairs`);

    // Live check: which pairs fire right now (same data, seconds later).
    const settled = await Promise.allSettled(
        SCALPING_UNIVERSE.map(pair =>
            ScalpingSignalGenerator.generateScalpingSignals(
                [{ pair, marketType: MarketType.CRYPTO }],
                SignalType.FUTURE,
                { strict: true }
            )
        )
    );
    const firing: string[] = [];
    settled.forEach((r, idx) => {
        if (r.status === 'fulfilled' && r.value.signals.length > 0) {
            firing.push(`${SCALPING_UNIVERSE[idx]} ${r.value.signals[0].direction}`);
        }
    });
    console.log(`live scalping firing pairs: ${firing.length > 0 ? firing.join(', ') : 'NONE'}`);

    // --- 2. Live Blockchain.info feed -----------------------------------
    console.log('capturing live Blockchain.info feed...');
    const liveReport = await BlockchainInfoAPI.getLargeTransactions(500000);
    const flow = BlockchainInfoAPI.calculateExchangeFlow(liveReport);
    console.log(`live large txs: ${liveReport.length}, net flow $${(flow.net / 1e6).toFixed(2)}M (${flow.sentiment})`);

    const tickerRes = await fetch('https://blockchain.info/ticker');
    const ticker = await tickerRes.json();
    const latestRes = await fetch('https://blockchain.info/latestblock?format=json');
    const latest = await latestRes.json();
    const blockRes = await fetch(`https://blockchain.info/rawblock/${latest.hash}?format=json`);
    const block = await blockRes.json();
    const btcPrice = ticker?.USD?.last as number;
    const rawTxs = (block.tx || []).filter((tx: any) => {
        const total = (tx.out || []).reduce((s: number, o: any) => s + (o.value || 0), 0);
        return (total / 1e8) * btcPrice >= 500000;
    }).map((tx: any) => ({
        // Only the fields getLargeTransactions reads (keeps the fixture small).
        hash: tx.hash,
        time: tx.time,
        size: tx.size,
        inputs: (tx.inputs || []).map((i: any) => ({ prev_out: { addr: i.prev_out?.addr, value: i.prev_out?.value } })),
        out: (tx.out || []).map((o: any) => ({ addr: o.addr, value: o.value }))
    }));
    console.log(`raw block ${latest.hash.slice(0, 12)}... height ${block.height}: ${rawTxs.length} txs >= $500K (of ${(block.tx || []).length})`);
    // Cross-check: the parsed live list must be a subset of the raw txs.
    const rawHashes = new Set(rawTxs.map((t: any) => t.hash));
    const missing = liveReport.filter(t => !rawHashes.has(t.hash)).length;
    console.log(`cross-check: ${liveReport.length - missing}/${liveReport.length} live-parsed txs present in raw capture`);

    // Direction: the veto passes when the flow does not oppose it.
    // SHORT needs net <= 0, LONG needs net >= 0; neutral (0) passes both.
    const event = flow.net <= 0 ? SHORT_BAR : LONG_BAR;
    const direction = flow.net <= 0 ? 'SHORT' : 'LONG';
    console.log(`event direction ${direction} (net ${flow.net >= 0 ? '+' : ''}${(flow.net / 1e6).toFixed(2)}M), bar ${event.iso} (index ${event.index})`);

    // --- 3. 1H event window from the dataset -----------------------------
    const klines1h: Record<string, number[][]> = {};
    const closes4h: Record<string, number[]> = {};
    const pairs1h = new Set<string>();
    // Standard universe (what generateStandardSignals scans) + basket alts.
    for (const p of [
        'BTC/USDT', 'ETH/USDT', 'BNB/USDT', 'SOL/USDT', 'XRP/USDT', 'DOGE/USDT',
        'ADA/USDT', 'AVAX/USDT', 'DOT/USDT', 'LINK/USDT', 'UNI/USDT', 'NEAR/USDT',
        'SUI/USDT', 'OP/USDT', 'ARB/USDT', 'ATOM/USDT', 'FIL/USDT',
        'INJ/USDT', 'FET/USDT', 'TIA/USDT', 'PEPE/USDT', 'WLD/USDT',
        'APT/USDT', 'LTC/USDT', 'POL/USDT'
    ]) pairs1h.add(BinanceAPI.pairToBinanceSymbol(p));
    for (const symbol of pairs1h) {
        const s = loadSeries(symbol);
        klines1h[symbol] = toKlines(s, event.index, 100);
        closes4h[symbol] = closes4hAt(s, event.index);
    }
    // MATIC/USDT is served from the POL series (same mapping as the
    // on-chain fix: the MATIC spot series is frozen).
    klines1h['MATICUSDT'] = klines1h['POLUSDT'];
    closes4h['MATICUSDT'] = closes4h['POLUSDT'];

    const fixture = {
        capturedAt: new Date().toISOString(),
        scalping5m,
        scalpingFiringLive: firing,
        blockchain: {
            btcPrice,
            latestHash: latest.hash as string,
            blockHeight: block.height as number,
            prevBlock: block.prev_block as string,
            txs: rawTxs
        },
        blockchainLive: {
            parsedCount: liveReport.length,
            netFlowUSD: flow.net,
            sentiment: flow.sentiment,
            crossCheckMissing: missing
        },
        event: { ...event, direction },
        klines1h,
        closes4h
    };

    fs.mkdirSync(path.join(process.cwd(), 'scripts', 'fixtures'), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(fixture));
    console.log(`wrote ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
    console.log(`event bar ${event.iso} ${direction}; 1h pairs: ${Object.keys(klines1h).length}`);
}

main().catch(err => {
    console.error('CAPTURE FAILED:', err);
    process.exit(1);
});
