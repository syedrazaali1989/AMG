// Mocked end-to-end test for the on-chain ROUND 5 ship candidate
// (ONCHAIN-ROUND5-REPORT.md): standard entry + core ATR levels,
// basket-wide. Live Binance/Blockchain.info are replaced with canned
// data from the canonical backtest set so the FIRE path (core fires
// -> whale veto passes -> BTC signal + 10 alt legs) is exercised
// deterministically. The live smoke test (next start + real APIs)
// covers the no-signal path.
//
// Event used: hour 872 of the canonical window — a known D0 LONG WIN
// (entry 69258.9, core confidence 70). All assertions compare the
// production code's output against an independent evaluation of the
// same core on the same data.
//
// Run:
//   npx tsc -p scripts/tsconfig.test-onchain-round5.json
//   BT_DATA_DIR=$HOME/workspace/.amg-bt/data node /tmp/amg-bt-build/scripts/test-onchain-round5.js
// Exit code 0 = ALL CHECKS PASSED, 1 = any failure.

import * as fs from 'fs';
import * as path from 'path';
import { OnChainSignalGenerator } from '../src/lib/signals/onChainGenerator';
import { MarketDataManager } from '../src/lib/signals/marketData';
import { BinanceAPI } from '../src/lib/signals/binanceAPI';
import { BlockchainInfoAPI, LargeTransaction } from '../src/lib/signals/blockchainInfoAPI';
import {
    evaluateSignalCore,
    DEFAULT_RULES,
    calculateCoreLevels,
    calculateATR
} from '../src/lib/signals/engineCore';
import { TechnicalIndicators } from '../src/lib/signals/indicators';
import {
    MarketData,
    MarketType,
    SignalType,
    SignalDirection
} from '../src/lib/signals/types';

Math.random = () => 0.5;

const DATA_DIR = process.env.BT_DATA_DIR || '/tmp/amg-backtest-data';
const WINDOW = 100;
const EVENT_HOUR = 872; // known D0 LONG WIN in the backtest

const BASKET_FILES: Record<string, string> = {
    'BTC/USDT': 'BTCUSDT.json',
    'ETH/USDT': 'ETHUSDT.json',
    'SOL/USDT': 'SOLUSDT.json',
    'AVAX/USDT': 'AVAXUSDT.json',
    'POL/USDT': 'POLUSDT.json',   // MATIC slot
    'BNB/USDT': 'BNBUSDT.json',
    'LTC/USDT': 'LTCUSDT.json',
    'DOT/USDT': 'DOTUSDT.json',
    'LINK/USDT': 'LINKUSDT.json',
    'APT/USDT': 'APTUSDT.json',
    'UNI/USDT': 'UNIUSDT.json'
};

interface CandleSeries {
    openTime: number[];
    high: number[];
    low: number[];
    close: number[];
    volume: number[];
}

const series: Record<string, CandleSeries> = {};
for (const [pair, file] of Object.entries(BASKET_FILES)) {
    series[pair] = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8')) as CandleSeries;
}

function closes4hAt(close: number[], i: number): number[] {
    const out: number[] = [];
    const fullBlocks = Math.floor((i + 1) / 4);
    for (let b = 0; b < fullBlocks; b++) out.push(close[4 * b + 3]);
    if ((i + 1) % 4 !== 0) out.push(close[i]);
    return out;
}

function marketDataAt(pair: string, i: number): MarketData {
    const s = series[pair];
    return {
        pair,
        marketType: MarketType.CRYPTO,
        prices: s.close.slice(i - WINDOW + 1, i + 1),
        highs: s.high.slice(i - WINDOW + 1, i + 1),
        lows: s.low.slice(i - WINDOW + 1, i + 1),
        volumes: s.volume.slice(i - WINDOW + 1, i + 1),
        timestamps: s.openTime.slice(i - WINDOW + 1, i + 1).map(t => new Date(t)),
        currentPrice: s.close[i]
    };
}

// BTC regime at the event hour, same computation as the harness.
const btc = series['BTC/USDT'];
const btcTrendAt: ('UP' | 'DOWN' | 'NEUTRAL')[] = new Array(btc.close.length).fill('NEUTRAL');
for (let i = 0; i < btc.close.length; i++) {
    const c4 = closes4hAt(btc.close, i);
    if (c4.length >= 200) {
        const ema200 = TechnicalIndicators.calculateEMA(c4, 200);
        btcTrendAt[i] = btc.close[i] > ema200 ? 'UP' : 'DOWN';
    }
}

function outflowTx(hash: string, usd: number): LargeTransaction {
    return {
        hash,
        timestamp: Date.now(),
        valueBTC: usd / btc.close[EVENT_HOUR],
        valueUSD: usd,
        from: ['bc1qexchange'],
        to: ['bc1qcold'],
        type: 'exchange_outflow',
        blockHeight: 977380
    };
}

function inflowTx(hash: string, usd: number): LargeTransaction {
    return { ...outflowTx(hash, usd), from: ['bc1qcold'], to: ['bc1qexchange'], type: 'exchange_inflow' };
}

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
    if (cond) {
        console.log(`  PASS: ${name}`);
    } else {
        failures++;
        console.log(`  FAIL: ${name}${detail ? ' — ' + detail : ''}`);
    }
}

async function main(): Promise<void> {
    // --- Stub the live sources with canned data at the event hour. ---
    (BlockchainInfoAPI as any).getLargeTransactions = async () => [
        outflowTx('a'.repeat(64), 2000000),
        outflowTx('b'.repeat(64), 1500000),
        outflowTx('c'.repeat(64), 1000000)
    ];
    (MarketDataManager as any).generateMarketData = async (pair: string) => {
        const md = marketDataAt(pair, EVENT_HOUR);
        return md;
    };
    (BinanceAPI as any).getBtcRegime = async () => btcTrendAt[EVENT_HOUR];
    (BinanceAPI as any).get4hCloses = async (pair: string) => closes4hAt(series[pair].close, EVENT_HOUR);

    // Independent expectation: the core evaluated on the same BTC data.
    const btcMd = marketDataAt('BTC/USDT', EVENT_HOUR);
    btcMd.btcTrend = btcTrendAt[EVENT_HOUR];
    btcMd.closes4h = closes4hAt(btc.close, EVENT_HOUR);
    const expectedCore = evaluateSignalCore(btcMd, SignalType.FUTURE, DEFAULT_RULES);
    if (!expectedCore) throw new Error('setup error: core did not fire at the chosen event hour');
    console.log(`Setup: core fires ${expectedCore.direction} at hour ${EVENT_HOUR} (entry ${expectedCore.entryPrice}, conf ${expectedCore.confidence}, regime ${btcTrendAt[EVENT_HOUR]})`);

    console.log('\n--- Test 1: veto passes (net outflow) -> full basket fires ---');
    const report = await OnChainSignalGenerator.generateOnChainReport();
    check('11 signals (1 BTC + 10 alts)', report.signals.length === 11, `got ${report.signals.length}`);
    const btcSig = report.signals.find(s => s.pair === 'BTC/USDT');
    check('BTC signal present', !!btcSig);
    if (btcSig) {
        check('BTC direction LONG', btcSig.direction === SignalDirection.LONG, `got ${btcSig.direction}`);
        check('BTC entry = core entry', btcSig.entryPrice === expectedCore.entryPrice, `${btcSig.entryPrice} vs ${expectedCore.entryPrice}`);
        check('BTC SL = core SL', btcSig.stopLoss === expectedCore.stopLoss, `${btcSig.stopLoss} vs ${expectedCore.stopLoss}`);
        check('BTC final TP = core TP', btcSig.takeProfit === expectedCore.takeProfit, `${btcSig.takeProfit} vs ${expectedCore.takeProfit}`);
        check('BTC TP1 = core TP1', btcSig.takeProfit1 === expectedCore.takeProfit1);
        check('BTC TP3 = core TP3', btcSig.takeProfit3 === expectedCore.takeProfit3);
        check('BTC confidence = core confidence', btcSig.confidence === expectedCore.confidence);
        check('BTC signal is FUTURE', btcSig.signalType === SignalType.FUTURE);
    }
    const pairs = report.signals.map(s => s.pair);
    check('basket includes POL/USDT (MATIC slot)', pairs.includes('POL/USDT'), pairs.join(', '));
    check('basket has NO MATIC/USDT (delisted)', !pairs.includes('MATIC/USDT'));
    check('all alt legs inherit LONG', report.signals.filter(s => s.pair !== 'BTC/USDT').every(s => s.direction === SignalDirection.LONG));
    // ETH leg levels must equal the independent core-formula computation
    // (and must NOT equal the old fixed -3%/+5/+8/+12% levels).
    const ethSig = report.signals.find(s => s.pair === 'ETH/USDT');
    if (ethSig) {
        const ethMd = marketDataAt('ETH/USDT', EVENT_HOUR);
        const ethAtr = calculateATR(ethMd.prices, ethMd.highs, ethMd.lows);
        const ethBb = TechnicalIndicators.calculateBollingerBands(ethMd.prices);
        const ethConf = Math.min(expectedCore.confidence + 2, 95);
        const expectedLevels = calculateCoreLevels(ethMd.currentPrice, SignalDirection.LONG, ethAtr, ethConf, ethBb);
        check('ETH leg levels computed', !!expectedLevels);
        if (expectedLevels) {
            check('ETH SL = core-formula SL', ethSig.stopLoss === expectedLevels.stopLoss, `${ethSig.stopLoss} vs ${expectedLevels.stopLoss}`);
            check('ETH final TP = core-formula TP', ethSig.takeProfit === expectedLevels.takeProfit, `${ethSig.takeProfit} vs ${expectedLevels.takeProfit}`);
            check('ETH SL is NOT the old fixed -3%', ethSig.stopLoss !== ethMd.currentPrice * 0.97, `SL ${ethSig.stopLoss} vs fixed ${ethMd.currentPrice * 0.97}`);
            check('ETH final TP is NOT the old fixed +12%', ethSig.takeProfit !== ethMd.currentPrice * 1.12);
        }
        check('ETH expiry is 48h', Math.abs(new Date(ethSig.expiresAt!).getTime() - (Date.now() + 48 * 3600 * 1000)) < 60 * 1000);
    } else {
        check('ETH signal present', false);
    }
    const d = report.diagnostics;
    check('diagnostics: 3 transactions analyzed', d.transactionsAnalyzed === 3, `got ${d.transactionsAnalyzed}`);
    check('diagnostics: flow BULLISH, net +4.5M', d.flowSentiment === 'BULLISH' && d.netFlowUSD === 4500000, `${d.flowSentiment} ${d.netFlowUSD}`);
    check('diagnostics: buyScore set', d.buyScore === expectedCore.buyScore, `${d.buyScore} vs ${expectedCore.buyScore}`);
    check('diagnostics: coreConfidence set', d.coreConfidence === expectedCore.confidence);
    check('diagnostics: btcSignalIssued', d.btcSignalIssued === true);
    check('diagnostics: correlatedIssued 10', d.correlatedIssued === 10, `got ${d.correlatedIssued}`);
    check('diagnostics: whale veto blocked 0', d.whaleVetoBlockedLong === 0 && d.whaleVetoBlockedShort === 0);

    console.log('\n--- Test 2: veto blocks (net inflow opposes LONG) -> 0 signals ---');
    (BlockchainInfoAPI as any).getLargeTransactions = async () => [
        inflowTx('d'.repeat(64), 3000000),
        inflowTx('e'.repeat(64), 1000000)
    ];
    const report2 = await OnChainSignalGenerator.generateOnChainReport();
    check('0 signals when veto blocks', report2.signals.length === 0, `got ${report2.signals.length}`);
    check('diagnostics: whaleVetoBlockedLong 1', report2.diagnostics.whaleVetoBlockedLong === 1, `got ${report2.diagnostics.whaleVetoBlockedLong}`);
    check('diagnostics: btcSignalIssued false', report2.diagnostics.btcSignalIssued === false);
    check('diagnostics: flow BEARISH', report2.diagnostics.flowSentiment === 'BEARISH');

    console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
    console.error('TEST CRASHED:', e);
    process.exit(1);
});
