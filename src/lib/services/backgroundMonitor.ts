import { Signal, MarketType } from '../signals/types';
import { SignalManager } from './signalManager';
import { fetchBinancePrice } from '../utils/binancePrices';

/**
 * Background Monitor Service
 * Continuously monitors prices and auto-completes signals
 */

export class BackgroundMonitor {
    private static intervalId: NodeJS.Timeout | null = null;
    private static isRunning = false;
    private static updateCount = 0;

    /**
     * Start background monitoring
     */
    static start(): void {
        if (this.isRunning) {
            console.log('📊 Background monitor already running');
            return;
        }

        console.log('🚀 Starting background monitor...');

        // Run immediately first time
        this.updateAllSignals();

        // Then run every 3 seconds
        this.intervalId = setInterval(() => {
            this.updateAllSignals();
        }, 3000);

        this.isRunning = true;
    }

    /**
     * Stop background monitoring
     */
    static stop(): void {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        this.isRunning = false;
        console.log('🛑 Background monitor stopped');
    }

    /**
     * Check if monitor is running
     */
    static get running(): boolean {
        return this.isRunning;
    }

    /**
     * Update all active signals
     */
    private static async updateAllSignals(): Promise<void> {
        this.updateCount++;

        try {
            // Update each signal type
            await this.updateSignalsOfType('standard');
            await this.updateSignalsOfType('scalping');
            await this.updateSignalsOfType('onchain');

            // Clear expired signals every ~5 minutes (100 updates * 3 seconds)
            if (this.updateCount % 100 === 0) {
                SignalManager.clearExpiredSignals();
            }
        } catch (error) {
            console.error('Background update error:', error);
        }
    }

    /**
     * Update signals of a specific type
     */
    private static async updateSignalsOfType(type: 'standard' | 'scalping' | 'onchain'): Promise<void> {
        const signals = SignalManager.getActiveSignals(type);
        if (signals.length === 0) return;

        // Update each signal
        for (const signal of signals) {
            try {
                // Simulate price movement (or fetch real price)
                const newPrice = await this.fetchNewPrice(signal);

                // Calculate RSI change based on price movement
                const priceChange = (newPrice - signal.currentPrice) / signal.currentPrice;
                const oldRsi = signal.currentRsi || signal.rsi || 50;
                let newRsi = oldRsi;

                if (priceChange > 0) {
                    newRsi = Math.min(oldRsi + Math.abs(priceChange) * 500, 100);
                } else {
                    newRsi = Math.max(oldRsi - Math.abs(priceChange) * 500, 0);
                }

                newRsi = Math.max(0, Math.min(100, newRsi + (Math.random() - 0.5) * 2));

                // Check TP/SL levels
                const { tp1Hit, tp2Hit, tp3Hit, profitLoss } = this.checkTPSL(signal, newPrice);

                // Update signal
                const updatedSignal: Signal = {
                    ...signal,
                    currentPrice: newPrice,
                    currentRsi: Math.round(newRsi),
                    tp1Hit: signal.tp1Hit || tp1Hit,
                    tp2Hit: signal.tp2Hit || tp2Hit,
                    tp3Hit: signal.tp3Hit || tp3Hit,
                    highestPrice: Math.max(signal.highestPrice || newPrice, newPrice),
                    lowestPrice: Math.min(signal.lowestPrice || newPrice, newPrice),
                    profitLossPercentage: profitLoss,
                    tp1HitTime: tp1Hit && !signal.tp1Hit ? new Date() : signal.tp1HitTime,
                    tp2HitTime: tp2Hit && !signal.tp2Hit ? new Date() : signal.tp2HitTime,
                    tp3HitTime: tp3Hit && !signal.tp3Hit ? new Date() : signal.tp3HitTime,
                };

                // Auto-complete if TP2 or TP3 hit
                if ((tp2Hit || tp3Hit) && !signal.tp2Hit && !signal.tp3Hit) {
                    console.log(`✅ Auto-completing signal: ${signal.pair} ${signal.direction} (+${profitLoss.toFixed(2)}%)`);

                    // Add to completed signals
                    updatedSignal.status = 'COMPLETED' as any;
                    SignalManager.completeSignal(signal.id, type);

                    // Show browser notification (if permitted)
                    this.showNotification(signal, profitLoss);
                } else {
                    // Just update the signal
                    SignalManager.updateSignal(updatedSignal, type);
                }
            } catch (error) {
                // Silently continue with other signals
                console.debug(`Error updating ${signal.pair}:`, error);
            }
        }
    }

    /**
     * Fetch new price for a signal
     */
    private static async fetchNewPrice(signal: Signal): Promise<number> {
        // For crypto, try to fetch real Binance price
        if (signal.marketType === MarketType.CRYPTO) {
            try {
                const realPrice = await fetchBinancePrice(signal.pair);
                if (realPrice) return realPrice;
            } catch (error) {
                // Fallback to simulation
            }
        }

        // Simulate price movement
        const volatility = signal.timeframe === '5m' ? 0.002 : 0.005; // Scalping has lower volatility
        const change = (Math.random() - 0.5) * volatility;
        return signal.currentPrice * (1 + change);
    }

    /**
     * Check if TP/SL levels are hit
     */
    private static checkTPSL(signal: Signal, newPrice: number): {
        tp1Hit: boolean;
        tp2Hit: boolean;
        tp3Hit: boolean;
        profitLoss: number;
    } {
        const isLong = signal.direction === 'LONG' || signal.direction === 'BUY';

        const tp1Hit = isLong
            ? newPrice >= (signal.takeProfit1 || 0)
            : newPrice <= (signal.takeProfit1 || Infinity);

        const tp2Hit = isLong
            ? newPrice >= (signal.takeProfit2 || 0)
            : newPrice <= (signal.takeProfit2 || Infinity);

        const tp3Hit = isLong
            ? newPrice >= (signal.takeProfit3 || 0)
            : newPrice <= (signal.takeProfit3 || Infinity);

        const profitLoss = isLong
            ? ((newPrice - signal.entryPrice) / signal.entryPrice) * 100
            : ((signal.entryPrice - newPrice) / signal.entryPrice) * 100;

        return { tp1Hit, tp2Hit, tp3Hit, profitLoss };
    }

    /**
     * Show browser notification
     */
    private static showNotification(signal: Signal, profitLoss: number): void {
        if (typeof window === 'undefined') return;

        // Request permission first time
        if (Notification.permission === 'default') {
            Notification.requestPermission();
        }

        // Show notification if permitted
        if (Notification.permission === 'granted') {
            try {
                new Notification('🎯 TP Hit!', {
                    body: `${signal.pair} ${signal.direction} - Profit: ${profitLoss.toFixed(2)}%`,
                    icon: '/favicon.ico',
                    tag: signal.id
                });
            } catch (error) {
                console.debug('Notification error:', error);
            }
        }
    }

    /**
     * Get monitor stats
     */
    static getStats() {
        return {
            isRunning: this.isRunning,
            updateCount: this.updateCount,
            activeSignalsCount: SignalManager.getActiveSignals().length
        };
    }
}
