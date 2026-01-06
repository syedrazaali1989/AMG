import { Signal, SignalType, SignalDirection, MarketType, SignalStatus, Timeframe } from './types';
import { BlockchainInfoAPI, LargeTransaction } from './blockchainInfoAPI';
import { ExchangeAvailability } from './exchangeAvailability';
import { MarketDataManager } from './marketData';
import { CorrelatedSignalGenerator } from './correlatedSignalGenerator';

/**
 * On-Chain Signal Generator
 * Combines whale movements with technical analysis
 * CRYPTO FUTURES only
 */
export class OnChainSignalGenerator {
    /**
     * Generate on-chain signals combining whale data + technical analysis
     */
    static async generateOnChainSignals(): Promise<Signal[]> {
        try {
            // Get REAL Bitcoin transactions from Blockchain.info (min $500K)
            const bitcoinTransactions = await BlockchainInfoAPI.getLargeTransactions(500000);

            if (!bitcoinTransactions || bitcoinTransactions.length === 0) {
                console.warn('No large Bitcoin transactions found');
                return [];
            }

            console.log(`🔗 Processing ${bitcoinTransactions.length} real Bitcoin transactions...`);

            // Generate PRIMARY signal for Bitcoin (whale-backed)
            const btcSignal = await this.generateSignalForBitcoin(bitcoinTransactions);

            if (!btcSignal) return [];

            // Generate CORRELATED signals for altcoins
            console.log(`🔄 Generating correlated altcoin signals...`);
            const correlatedSignals = await CorrelatedSignalGenerator.generateCorrelatedSignals(btcSignal, true);

            // Combine: BTC + Altcoins
            const allSignals = [btcSignal, ...correlatedSignals];
            console.log(`✅ Total: ${allSignals.length} signals (1 BTC + ${correlatedSignals.length} correlated)`);

            return allSignals;
        } catch (error) {
            console.error('On-chain signal generation error:', error);
            return [];
        }
    }

    /**
     * Generate signal for Bitcoin using real blockchain data
     */
    private static async generateSignalForBitcoin(
        transactions: LargeTransaction[]
    ): Promise<Signal | null> {
        const pair = 'BTC/USDT';

        // Get REAL market data from Binance API
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

        // Debug logging
        console.log(`📊 BTC Scoring: OnChain=${onChainScore.score}, Technical=${technicalScore.score}, Total=${combinedScore.total}`);
        console.log(`🐋 Flow: ${onChainScore.sentiment} (In:${onChainScore.inflow}, Out:${onChainScore.outflow})`);
        console.log(`📈 Technical: RSI=${technicalScore.rsi}, MACD=${technicalScore.macd.toFixed(2)}`);

        // Minimum score threshold (lowered for more signals)
        if (Math.abs(combinedScore.total) < 10) {
            console.log(`⚠️ BTC signal too weak (${combinedScore.total.toFixed(1)}), need ≥10`);
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

        rationale.push(`🔗 ${txCount} real Bitcoin transactions analyzed (>$1M each)`);

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
