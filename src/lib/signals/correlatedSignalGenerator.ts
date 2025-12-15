// Correlated Signal Generator
// Generates altcoin signals based on Bitcoin whale movements

import { Signal, SignalType, SignalDirection, MarketType, SignalStatus, Timeframe } from './types';
import { CorrelationMatrix, CorrelationData } from './correlationMatrix';
import { ExchangeAvailability } from './exchangeAvailability';
import { MarketDataManager } from './marketData';

export class CorrelatedSignalGenerator {
    /**
     * Generate correlated altcoin signals from BTC signal
     * @param btcSignal Primary BTC signal from whale movements
     * @param includeAllCoins If true, generates signals for all correlated coins
     */
    static async generateCorrelatedSignals(
        btcSignal: Signal,
        includeAllCoins: boolean = true
    ): Promise<Signal[]> {
        try {
            // Get RANDOM correlated coins (10 random from 15+ pool) for MORE variety
            const correlatedCoins = CorrelationMatrix.getRandomCorrelatedCoins(10, 0.74);

            const signals: Signal[] = [];

            for (const coinData of correlatedCoins) {
                const signal = await this.generateSignalForCoin(btcSignal, coinData);
                if (signal) {
                    signals.push(signal);
                }
            }

            console.log(`✅ Generated ${signals.length} random correlated signals: ${correlatedCoins.map(c => c.symbol).join(', ')}`);
            return signals;
        } catch (error) {
            console.error('Correlated signal generation error:', error);
            return [];
        }
    }

    /**
     * Generate signal for specific correlated coin
     */
    private static async generateSignalForCoin(
        btcSignal: Signal,
        coinData: CorrelationData
    ): Promise<Signal | null> {
        try {
            // Get real market data for the altcoin
            const marketData = await MarketDataManager.generateMarketData(
                coinData.pair,
                MarketType.CRYPTO,
                100
            );
            const currentPrice = marketData.prices[marketData.prices.length - 1];

            // Same direction as BTC (correlation-based)
            const direction = btcSignal.direction;

            // STRONG CONFIDENCE (user requested)
            // Keep BTC confidence or slightly higher due to correlation
            const confidence = Math.min(btcSignal.confidence + 2, 95);

            // Calculate technical indicators for this altcoin
            const rsi = this.calculateRSI(marketData.prices, 14);
            const ema12 = this.calculateEMA(marketData.prices, 12);
            const ema26 = this.calculateEMA(marketData.prices, 26);
            const macdValue = ema12 - ema26;

            // Calculate TP/SL levels (same % as BTC)
            const { tp1, tp2, tp3, stopLoss } = this.calculateLevels(
                currentPrice,
                direction,
                coinData.correlation
            );

            // Get available exchanges
            const availableExchanges = ExchangeAvailability.getAvailableExchanges(
                coinData.pair,
                MarketType.CRYPTO
            );

            // Create signal
            const signal: Signal = {
                id: `CORR_${coinData.symbol}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                pair: coinData.pair,
                direction,
                entryPrice: currentPrice,
                currentPrice,
                takeProfit: tp3,
                takeProfit1: tp1,
                takeProfit2: tp2,
                takeProfit3: tp3,
                stopLoss,
                confidence,
                rsi,              // ✅ Added RSI
                macdValue,        // ✅ Added MACD
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
                profitLossPercentage: 0,
                availableExchanges,
                rationalePoints: this.generateRationale(btcSignal, coinData, rsi, macdValue)
            };

            return signal;
        } catch (error) {
            console.error(`Failed to generate signal for ${coinData.symbol}:`, error);
            return null;
        }
    }

    /**
     * Calculate TP/SL levels for correlated coin
     * Same aggressive targets as BTC (5%, 8%, 12%)
     */
    private static calculateLevels(
        entryPrice: number,
        direction: SignalDirection,
        correlation: number
    ) {
        // Altcoins often move MORE than BTC
        // But we keep same targets for consistency
        if (direction === SignalDirection.LONG) {
            return {
                tp1: entryPrice * 1.05,  // 5%
                tp2: entryPrice * 1.08,  // 8%
                tp3: entryPrice * 1.12,  // 12%
                stopLoss: entryPrice * 0.97 // -3%
            };
        } else {
            return {
                tp1: entryPrice * 0.95,  // 5%
                tp2: entryPrice * 0.92,  // 8%
                tp3: entryPrice * 0.88,  // 12%
                stopLoss: entryPrice * 1.03 // -3%
            };
        }
    }

    /**
     * Generate rationale for correlated signal
     */
    private static generateRationale(
        btcSignal: Signal,
        coinData: CorrelationData,
        rsi: number,
        macdValue: number
    ): string[] {
        const rationale: string[] = [];
        const correlationPercent = Math.round(coinData.correlation * 100);
        const strengthLabel = CorrelationMatrix.getStrengthLabel(coinData.correlation);

        // Correlation-based rationale
        rationale.push(`🔗 Following BTC whale movement (${correlationPercent}% correlation - ${strengthLabel})`);

        if (btcSignal.direction === SignalDirection.LONG) {
            rationale.push(`📈 BTC LONG signal detected - ${coinData.symbol} typically follows upward`);
            rationale.push(`🐋 Bitcoin whales accumulating - altcoin momentum expected`);
        } else {
            rationale.push(`📉 BTC SHORT signal detected - ${coinData.symbol} typically follows downward`);
            rationale.push(`🐋 Bitcoin whales distributing - altcoin pressure expected`);
        }

        rationale.push(`💎 ${coinData.label} - Strong historical correlation with BTC`);
        rationale.push(`📊 RSI: ${Math.round(rsi)} | MACD: ${macdValue > 0 ? 'Bullish' : 'Bearish'}`);
        rationale.push(`⚡ Same aggressive targets as BTC (5%, 8%, 12%)`);

        return rationale;
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
}
