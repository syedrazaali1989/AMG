import { Signal, SignalType, SignalDirection, MarketType, SignalStatus, Timeframe } from './types';
import { BlockchainInfoAPI, LargeTransaction } from './blockchainInfoAPI';
import { ExchangeAvailability } from './exchangeAvailability';
import { MarketDataManager } from './marketData';
import { CorrelatedSignalGenerator } from './correlatedSignalGenerator';

/** Minimum combined-score magnitude required to issue the BTC signal. */
export const ONCHAIN_SCORE_THRESHOLD = 10;

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
    technicalScore: number | null;
    rsi: number | null;
    combinedScore: number | null;
    threshold: number;
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
            technicalScore: null,
            rsi: null,
            combinedScore: null,
            threshold: ONCHAIN_SCORE_THRESHOLD,
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
     * Generate signal for Bitcoin using real blockchain data
     */
    private static async generateSignalForBitcoin(
        transactions: LargeTransaction[],
        diagnostics: OnChainDiagnostics
    ): Promise<Signal | null> {
        const pair = 'BTC/USDT';

        // Get REAL market data from Binance API (throws if unavailable)
        const marketData = await MarketDataManager.generateMarketData(pair, MarketType.CRYPTO, 100);
        const currentPrice = marketData.prices[marketData.prices.length - 1];

        // Calculate on-chain score from real Bitcoin transactions
        const onChainScore = this.calculateBitcoinOnChainScore(transactions);

        // Calculate technical score
        const technicalScore = this.calculateTechnicalScore(marketData.prices);

        // Combine scores
        const combinedScore = {
            onChain: onChainScore.score,
            technical: technicalScore.score,
            total: (onChainScore.score * 0.5) + (technicalScore.score * 0.5)
        };

        diagnostics.technicalScore = technicalScore.score;
        diagnostics.rsi = technicalScore.rsi;
        diagnostics.combinedScore = combinedScore.total;

        // Debug logging
        console.log(`📊 BTC Scoring: OnChain=${onChainScore.score}, Technical=${technicalScore.score}, Total=${combinedScore.total}`);
        console.log(`🐋 Flow: ${onChainScore.sentiment} (In:${onChainScore.inflow}, Out:${onChainScore.outflow})`);
        console.log(`📈 Technical: RSI=${technicalScore.rsi}, MACD=${technicalScore.macd.toFixed(2)}`);

        // Minimum score threshold
        if (Math.abs(combinedScore.total) < ONCHAIN_SCORE_THRESHOLD) {
            console.log(`⚠️ BTC signal too weak (${combinedScore.total.toFixed(1)}), need ≥${ONCHAIN_SCORE_THRESHOLD}`);
            return null;
        }

        // Determine direction
        const direction = combinedScore.total > 0 ? SignalDirection.LONG : SignalDirection.SHORT;
        const confidence = Math.min(Math.round(Math.abs(combinedScore.total)), 95);

        // Calculate TP/SL levels
        const { tp1, tp2, tp3, stopLoss } = this.calculateLevels(currentPrice, direction);

        // Get available exchanges
        const availableExchanges = ExchangeAvailability.getAvailableExchanges(pair, MarketType.CRYPTO);

        // Get exchange flow summary
        const flow = BlockchainInfoAPI.calculateExchangeFlow(transactions);

        // FUTURE signals expire after 48h (repo-wide convention); the
        // outcome updater marks an unfilled signal EXPIRED at that point,
        // never a win. TP1/TP2 are milestones - only the final TP (tp3)
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
            takeProfit: tp3,
            takeProfit1: tp1,
            takeProfit2: tp2,
            takeProfit3: tp3,
            stopLoss,
            confidence,
            rsi: technicalScore.rsi,
            macdValue: technicalScore.macd,
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
            rationalePoints: this.generateBitcoinRationale(onChainScore, technicalScore, flow, direction, transactions.length)
        };

        console.log(`✅ Generated BTC ${direction} signal (confidence: ${confidence}%)`);
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
     * Generate rationale for Bitcoin signal using real data
     */
    private static generateBitcoinRationale(
        onChain: any,
        technical: any,
        flow: any,
        direction: SignalDirection,
        txCount: number
    ): string[] {
        const rationale: string[] = [];

        rationale.push(`🔗 ${txCount} real Bitcoin transactions analyzed (≥$500K each, live Blockchain.info feed)`);

        // On-chain rationale
        if (direction === SignalDirection.LONG) {
            if (onChain.outflow > onChain.inflow) {
                rationale.push(`🐋 ${onChain.outflow} withdrawals from exchanges - Bullish accumulation`);
            }
            if (technical.rsi < 40) {
                rationale.push(`📊 RSI oversold (${technical.rsi}) - Bounce expected`);
            }
        } else {
            if (onChain.inflow > onChain.outflow) {
                rationale.push(`🐋 ${onChain.inflow} deposits to exchanges - Selling pressure`);
            }
            if (technical.rsi > 60) {
                rationale.push(`📊 RSI overbought (${technical.rsi}) - Correction expected`);
            }
        }

        rationale.push(`💱 Net flow: ${flow.sentiment} ($${(Math.abs(flow.net) / 1000000).toFixed(1)}M)`);

        return rationale;
    }

    /**
     * Calculate technical score
     */
    private static calculateTechnicalScore(prices: number[]): {
        score: number;
        rsi: number;
        macd: number;
    } {
        let score = 0;

        // Simple RSI calculation
        const rsi = this.calculateRSI(prices, 14);

        // RSI scoring
        if (rsi < 30) score += 30; // Oversold = bullish
        else if (rsi > 70) score -= 30; // Overbought = bearish
        else if (rsi < 40) score += 15;
        else if (rsi > 60) score -= 15;

        // Simple MACD
        const ema12 = this.calculateEMA(prices, 12);
        const ema26 = this.calculateEMA(prices, 26);
        const macd = ema12 - ema26;

        // MACD scoring
        if (macd > 0) score += 20; // Bullish
        else score -= 20; // Bearish

        return { score, rsi: Math.round(rsi), macd };
    }

    /**
     * Calculate RSI
     */
    private static calculateRSI(prices: number[], period: number = 14): number {
        if (prices.length < period + 1) return 50;

        let gains = 0;
        let losses = 0;

        for (let i = prices.length - period; i < prices.length; i++) {
            const change = prices[i] - prices[i - 1];
            if (change > 0) gains += change;
            else losses -= change;
        }

        const avgGain = gains / period;
        const avgLoss = losses / period;

        if (avgLoss === 0) return 100;
        const rs = avgGain / avgLoss;
        return 100 - (100 / (1 + rs));
    }

    /**
     * Calculate EMA
     */
    private static calculateEMA(prices: number[], period: number): number {
        const multiplier = 2 / (period + 1);
        let ema = prices[prices.length - period];

        for (let i = prices.length - period + 1; i < prices.length; i++) {
            ema = (prices[i] - ema) * multiplier + ema;
        }

        return ema;
    }

    /**
     * Calculate TP/SL levels (aggressive whale targets)
     */
    private static calculateLevels(entryPrice: number, direction: SignalDirection) {
        if (direction === SignalDirection.LONG) {
            return {
                tp1: entryPrice * 1.05,  // 5% - whale quick move
                tp2: entryPrice * 1.08,  // 8% - main whale target
                tp3: entryPrice * 1.12,  // 12% - strong whale signal
                stopLoss: entryPrice * 0.97 // -3% stop
            };
        } else {
            return {
                tp1: entryPrice * 0.95,  // 5%
                tp2: entryPrice * 0.92,  // 8%
                tp3: entryPrice * 0.88,  // 12%
                stopLoss: entryPrice * 1.03 // -3% stop
            };
        }
    }
}
