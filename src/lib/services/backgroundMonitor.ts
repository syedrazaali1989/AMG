import { Signal, MarketType, SignalStatus } from '../signals/types';
import { SignalManager } from './signalManager';
import { SignalGenerator } from '../signals/generator';
import { fetchBinancePrice } from '../utils/binancePrices';
import { ExnessAPI } from '../signals/exnessAPI';

/**
 * Background Monitor Service
 * Continuously monitors REAL prices and closes signals using the shared
 * honest outcome rules (full TP = COMPLETED, SL = STOPPED, expiry = EXPIRED).
 * If a real price cannot be fetched, the signal is simply not updated -
 * prices are never simulated.
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

        // Then run every 1 second
        this.intervalId = setInterval(() => {
            this.updateAllSignals();
        }, 1000);

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

        // DEBUG: Log signal count
        console.log(`🔄 BackgroundMonitor: Updating ${type} signals - Found ${signals.length} active signals`);

        if (signals.length === 0) {
            console.warn(`⚠️ No ${type} signals found to update`);
            return;
        }

        // Update each signal
        for (const signal of signals) {
            try {
                // Fetch a REAL price. If unavailable, skip this signal -
                // never substitute a simulated price.
                const newPrice = await this.fetchNewPrice(signal);
                if (newPrice === null) {
                    continue;
                }

                // Apply the shared outcome logic: partial TPs are milestones,
                // only the FULL take profit completes a signal, the stop loss
                // stops it, and expiry marks it EXPIRED. Realised P/L is set
                // at the exit price by the updater.
                const updatedSignal = SignalGenerator.updateSignal(signal, newPrice);

                if (updatedSignal.status !== SignalStatus.ACTIVE) {
                    // Persist the closed state, then move it to the record
                    SignalManager.updateSignal(updatedSignal, type);
                    SignalManager.completeSignal(signal.id, type);

                    if (updatedSignal.status === SignalStatus.COMPLETED) {
                        console.log(`✅ Signal completed at full TP: ${signal.pair} ${signal.direction} (${(updatedSignal.profitLossPercentage || 0).toFixed(2)}%)`);
                        this.showNotification(signal, updatedSignal.profitLossPercentage || 0);
                    } else {
                        console.log(`ℹ️ Signal closed as ${updatedSignal.status}: ${signal.pair} ${signal.direction} (${(updatedSignal.profitLossPercentage || 0).toFixed(2)}%)`);
                    }
                } else {
                    // Still active - just persist the price update
                    SignalManager.updateSignal(updatedSignal, type);
                }
            } catch (error) {
                // Silently continue with other signals
                console.debug(`Error updating ${signal.pair}:`, error);
            }
        }
    }

    /**
     * Fetch a REAL new price for a signal.
     * Returns null when no real price is available - the caller then skips
     * the update. (The previous implementation fabricated a random-walk
     * price with a deliberate bias toward the TP target "to ensure signals
     * complete in reasonable time"; that has been removed.)
     */
    private static async fetchNewPrice(signal: Signal): Promise<number | null> {
        // For crypto, fetch real Binance price
        if (signal.marketType === MarketType.CRYPTO) {
            try {
                const realPrice = await fetchBinancePrice(signal.pair);
                if (realPrice) {
                    return realPrice;
                }
            } catch (error) {
                console.debug(`⚠️ ${signal.pair}: Binance fetch failed, skipping update`);
            }
            return null;
        }

        // For Forex, fetch Exness-compatible price
        if (signal.marketType === MarketType.FOREX) {
            try {
                const realPrice = await ExnessAPI.getCurrentForexPrice(signal.pair);
                if (realPrice) {
                    return realPrice;
                }
            } catch (error) {
                console.debug(`⚠️ ${signal.pair}: Exness fetch failed, skipping update`);
            }
            return null;
        }

        return null;
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
