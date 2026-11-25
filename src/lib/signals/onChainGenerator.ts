import { Signal, SignalType, SignalDirection, MarketType, SignalStatus, Timeframe } from './types';
import { BlockchainInfoAPI, LargeTransaction } from './blockchainInfoAPI';
import { BinanceAPI } from './binanceAPI';
import { evaluateSignalCore, DEFAULT_RULES } from './engineCore';
import { ExchangeAvailability } from './exchangeAvailability';
import { MarketDataManager } from './marketData';
import { CorrelatedSignalGenerator } from './correlatedSignalGenerator';

/** Minimum transaction value (USD) counted as a "large" BTC transfer. */
export const ONCHAIN_MIN_TX_USD = 500000;

/**
 * Auditable evidence for one on-chain generation pass: the real inputs
 * (large transactions, exchange flow) and the scores they produced, so a
 * "no signal" outcome can be verified instead of taken on trust.
 */
export interface OnChainDiagnostics {
    minTxUSD: number;
    transactionsAnalyzed: number;
    exchangeInflowCount: number;
    exchangeOutflowCount: number;
    unknownCount: number;
    exchangeInflowUSD: number;
    exchangeOutflowUSD: number;
    netFlowUSD: number;
    flowSentiment: string;
    onChainScore: number;
    /** Standard-engine core scores for the BTC evaluation (null when the
     *  core issued nothing). The toy RSI/MACD technical half was replaced
     *  by the core in round 5 — there is no separate technical score. */
    buyScore: number | null;
    sellScore: number | null;
    coreConfidence: number | null;
    rsi: number | null;
    /** BTC regime at the moment of the core evaluation (same definition
     *  as the standard engine: price vs 4H EMA200 via
     *  BinanceAPI.getBtcRegime). Null when the regime was unavailable. */
    btcRegime: 'UP' | 'DOWN' | 'NEUTRAL' | null;
    /** Signals the core issued but the whale veto blocked, by direction.
     *  The veto is live-only: whale flow must not oppose the direction
     *  (LONG needs net flow >= 0, SHORT needs net flow <= 0); neutral
     *  flow never blocks. */
    whaleVetoBlockedLong: number;
    whaleVetoBlockedShort: number;
    btcSignalIssued: boolean;
    correlatedIssued: number;
}

export interface OnChainReport {
    signals: Signal[];
    transactions: LargeTransaction[];
    diagnostics: OnChainDiagnostics;
}

/**
 * On-Chain Signal Generator
 * Combines real large BTC transfers with technical analysis
 * CRYPTO FUTURES only
 *
 * Data honesty: every input is live - large transactions come from the
 * Blockchain.info mempool feed and prices from Binance. If a source is
 * unreachable the report method THROWS; nothing is ever generated from
 * simulated transactions or prices.
 */
export class OnChainSignalGenerator {
    /**
     * Full generation pass returning the signals AND the real transaction
     * feed plus scoring diagnostics. Used by the server route
     * (/api/on-chain/signals) so every visitor sees the same result.
     *
     * Throws when a live data source is unavailable.
     */
    static async generateOnChainReport(): Promise<OnChainReport> {
        // Get REAL Bitcoin transactions from Blockchain.info (min $500K).
        // Throws if the source is down - the caller surfaces that honestly.
        const transactions = await BlockchainInfoAPI.getLargeTransactions(ONCHAIN_MIN_TX_USD);

        const flow = BlockchainInfoAPI.calculateExchangeFlow(transactions);
        const onChainScore = this.calculateBitcoinOnChainScore(transactions);

        const diagnostics: OnChainDiagnostics = {
            minTxUSD: ONCHAIN_MIN_TX_USD,
            transactionsAnalyzed: transactions.length,
            exchangeInflowCount: onChainScore.inflow,
            exchangeOutflowCount: onChainScore.outflow,
            unknownCount: transactions.length - onChainScore.inflow - onChainScore.outflow,
            exchangeInflowUSD: flow.inflow,
            exchangeOutflowUSD: flow.outflow,
            netFlowUSD: flow.net,
            flowSentiment: flow.sentiment,
            onChainScore: onChainScore.score,
            buyScore: null,
            sellScore: null,
            coreConfidence: null,
            rsi: null,
            btcRegime: null,
            whaleVetoBlockedLong: 0,
            whaleVetoBlockedShort: 0,
            btcSignalIssued: false,
            correlatedIssued: 0
        };

        if (transactions.length === 0) {
            console.log('🔗 No large Bitcoin transactions in the live feed right now');
            return { signals: [], transactions, diagnostics };
        }

        console.log(`🔗 Processing ${transactions.length} real Bitcoin transactions...`);

        // Generate PRIMARY signal for Bitcoin (whale-backed)
        const btcSignal = await this.generateSignalForBitcoin(transactions, diagnostics);

        if (!btcSignal) {
            return { signals: [], transactions, diagnostics };
        }

        diagnostics.btcSignalIssued = true;

        // Generate CORRELATED signals for altcoins (derived from the BTC
        // signal via historical correlation - labelled as correlated)
        console.log(`🔄 Generating correlated altcoin signals...`);
        const correlatedSignals = await CorrelatedSignalGenerator.generateCorrelatedSignals(btcSignal, true);
        diagnostics.correlatedIssued = correlatedSignals.length;

        // Combine: BTC + Altcoins
        const allSignals = [btcSignal, ...correlatedSignals];
        console.log(`✅ Total: ${allSignals.length} signals (1 BTC + ${correlatedSignals.length} correlated)`);

        return { signals: allSignals, transactions, diagnostics };
    }

    /**
     * Generate on-chain signals combining whale data + technical analysis.
     * Signals only - kept for existing callers. Throws on live-data
     * failure (no simulated fallback exists anymore).
     */
    static async generateOnChainSignals(): Promise<Signal[]> {
        const report = await this.generateOnChainReport();
        return report.signals;
    }

    /**
     * Generate signal for Bitcoin: the STANDARD engine's decision core
     * (evaluateSignalCore, verbatim — the same code the /api/signals
     * route runs) decides entry/direction/levels, and the live whale
     * flow acts as a veto only — it must not oppose the core's
     * direction. Round 5 backtest (ONCHAIN-ROUND5-REPORT.md): standard
     * entry + core ATR levels, basket-wide — 12 events, 70.9% win,
     * +0.497R expectancy, all four gate conditions met.
     *
     * The old toy entry (RSI/MACD score combined 50/50 with the whale
     * score, fire at |combined| >= 10) is gone: rounds 1-4 proved it
     * loses money (-0.545R baseline) and that MACD sign alone could
     * fire a signal. The whale half is NOT part of the entry decision
     * anymore — it cannot be backtested historically, so it only ever
     * removes signals, never creates them.
     */
    private static async generateSignalForBitcoin(
        transactions: LargeTransaction[],
        diagnostics: OnChainDiagnostics
    ): Promise<Signal | null> {
        const pair = 'BTC/USDT';

        // Market data + core context, exactly as the standard route
        // builds it (standardSignals.generateStandardSignals): 100x 1H
        // closes, 4H closes for the MTF filter, BTC regime.
        // fundingRate is intentionally left undefined — the backtest
        // had no historical funding data, and the core treats undefined
        // funding as neutral (never blocks).
        const marketData = await MarketDataManager.generateMarketData(pair, MarketType.CRYPTO, 100);
        const currentPrice = marketData.prices[marketData.prices.length - 1];

        const btcRegime = await BinanceAPI.getBtcRegime();
        diagnostics.btcRegime = btcRegime ?? null;
        marketData.btcTrend = btcRegime;
        try {
            marketData.closes4h = await BinanceAPI.get4hCloses(pair, 250);
        } catch {
            console.warn('4H closes unavailable for BTC/USDT (MTF filter neutral)');
        }

        // The standard engine's decision, verbatim.
        const core = evaluateSignalCore(marketData, SignalType.FUTURE, DEFAULT_RULES);
        if (!core) {
            console.log(`🔗 No on-chain BTC signal: standard core issued nothing for this bar`);
            return null;
        }

        diagnostics.buyScore = core.buyScore;
        diagnostics.sellScore = core.sellScore;
        diagnostics.coreConfidence = core.confidence;
        diagnostics.rsi = core.rsi;

        const direction = core.direction;
        const isLong = direction === SignalDirection.LONG || direction === SignalDirection.BUY;

        // WHALE VETO (live-only): the whale flow must not oppose the
        // core's direction. LONG needs net flow >= 0, SHORT needs net
        // flow <= 0; neutral flow never blocks. Fail-neutral: if the
        // flow cannot be computed, do not block.
        const flow = BlockchainInfoAPI.calculateExchangeFlow(transactions);
        if (isLong && flow.net < 0) {
            diagnostics.whaleVetoBlockedLong++;
            console.log(`🚫 On-chain BTC LONG blocked by whale veto (net flow $${(flow.net / 1000000).toFixed(1)}M, bearish)`);
            return null;
        }
        if (!isLong && flow.net > 0) {
            diagnostics.whaleVetoBlockedShort++;
            console.log(`🚫 On-chain BTC SHORT blocked by whale veto (net flow $${(flow.net / 1000000).toFixed(1)}M, bullish)`);
            return null;
        }

        // Levels come from the core (verbatim) — same as the standard
        // engine: takeProfit is the final TP, takeProfit1/2/3 are
        // milestones. (The old fixed -3%/+5/+8/+12% levels are gone:
        // round 4 proved the entry starves on them.)
        const onChainScore = this.calculateBitcoinOnChainScore(transactions);

        // Get available exchanges
        const availableExchanges = ExchangeAvailability.getAvailableExchanges(pair, MarketType.CRYPTO);

        // FUTURE signals expire after 48h (repo-wide convention); the
        // outcome updater marks an unfilled signal EXPIRED at that point,
        // never a win. TP1/TP2 are milestones - only the final TP
        // completes the trade.
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 48);

        // Create signal
        const signal: Signal = {
            id: `ONCHAIN_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            pair,
            direction,
            entryPrice: currentPrice,
            currentPrice,
            takeProfit: core.takeProfit,
            takeProfit1: core.takeProfit1,
            takeProfit2: core.takeProfit2,
            takeProfit3: core.takeProfit3,
            stopLoss: core.stopLoss,
            confidence: core.confidence,
            rsi: core.rsi,
            macdValue: core.macd.macd,
            marketType: MarketType.CRYPTO,
            signalType: SignalType.FUTURE,
            status: SignalStatus.ACTIVE,
            timestamp: new Date(),
            expiresAt,
            timeframe: Timeframe.ONE_HOUR,
            tp1Hit: false,
            tp2Hit: false,
            tp3Hit: false,
            highestPrice: currentPrice,
            lowestPrice: currentPrice,
            profitLossPercentage: 0, // Initial P/L
            availableExchanges,
            rationalePoints: this.generateBitcoinRationale(onChainScore, core, flow, direction, transactions.length)
        };

        console.log(`✅ Generated BTC ${direction} signal (standard core, confidence: ${core.confidence}%, whale flow ${flow.sentiment})`);
        return signal;
    }

    /**
     * Calculate on-chain score from real Bitcoin transactions
     */
    private static calculateBitcoinOnChainScore(transactions: LargeTransaction[]): {
        score: number;
        inflow: number;
        outflow: number;
        sentiment: string;
    } {
        let score = 0;
        let inflowCount = 0;
        let outflowCount = 0;

        transactions.forEach(tx => {
            const sentiment = BlockchainInfoAPI.analyzeSentiment(tx);

            if (sentiment === 'BEARISH') {
                score -= 20; // Exchange inflow = selling pressure
                inflowCount++;
            } else if (sentiment === 'BULLISH') {
                score += 20; // Exchange outflow = holding/buying
                outflowCount++;
            }
        });

        const sentiment = score > 0 ? 'BULLISH' : score < 0 ? 'BEARISH' : 'NEUTRAL';

        return {
            score,
            inflow: inflowCount,
            outflow: outflowCount,
            sentiment
        };
    }

    /**
     * Generate rationale for Bitcoin signal using real data.
     * Entry comes from the standard engine's core; the whale feed is
     * shown as the veto evidence, not as the entry reason.
     */
    private static generateBitcoinRationale(
        onChain: any,
        core: any,
        flow: any,
        direction: SignalDirection,
        txCount: number
    ): string[] {
        const rationale: string[] = [];

        rationale.push(`🔗 ${txCount} real Bitcoin transactions analyzed (≥$500K each, live Blockchain.info feed)`);

        if (direction === SignalDirection.LONG || direction === SignalDirection.BUY) {
            rationale.push(`📊 Standard engine LONG (buy score ${core.buyScore}, confidence ${core.confidence}%)`);
            if (onChain.outflow > onChain.inflow) {
                rationale.push(`🐋 ${onChain.outflow} withdrawals from exchanges - Bullish accumulation`);
            }
            if (core.rsi < 40) {
                rationale.push(`📊 RSI oversold (${core.rsi}) - Bounce expected`);
            }
        } else {
            rationale.push(`📊 Standard engine SHORT (sell score ${core.sellScore}, confidence ${core.confidence}%)`);
            if (onChain.inflow > onChain.outflow) {
                rationale.push(`🐋 ${onChain.inflow} deposits to exchanges - Selling pressure`);
            }
            if (core.rsi > 60) {
                rationale.push(`📊 RSI overbought (${core.rsi}) - Correction expected`);
            }
        }

        rationale.push(`💱 Net flow: ${flow.sentiment} ($${(Math.abs(flow.net) / 1000000).toFixed(1)}M)`);

        return rationale;
    }
}
