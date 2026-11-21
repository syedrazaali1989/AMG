import { Signal, SignalStatus } from '../signals/types';
import { SignalManager } from './signalManager';
import { SignalGenerator } from '../signals/generator';
import { fetchBinancePrice } from '../utils/binancePrices';
import { ExnessAPI } from '../signals/exnessAPI';

/**
 * Signal Catch-Up Service
 * Checks all signals against current prices when page loads
 * This handles signals that may have hit TP while browser was closed.
 *
 * Outcome rules are the shared honest ones from SignalGenerator.updateSignal:
 * a signal closes as COMPLETED only at the FULL take profit, STOPPED at the
 * stop loss, or EXPIRED at expiry. Partial TP touches never complete it.
 */
export class SignalCatchup {
    /**
     * Check all active signals and complete any that hit TP targets
     */
    static async catchupAllSignals(): Promise<void> {
        console.log('🔄 Catching up on signals...');

        const types: ('standard' | 'scalping' | 'onchain')[] = ['standard', 'scalping', 'onchain'];

        for (const type of types) {
            await this.catchupSignalsOfType(type);
        }

        console.log('✅ Signal catch-up complete');
    }

    /**
     * Catch up signals of a specific type
     */
    private static async catchupSignalsOfType(type: 'standard' | 'scalping' | 'onchain'): Promise<void> {
        const signals = SignalManager.getActiveSignals(type);
        if (signals.length === 0) return;

        console.log(`🔍 Checking ${signals.length} ${type} signals...`);

        for (const signal of signals) {
            await this.checkSignal(signal, type);
        }
    }

    /**
     * Check a single signal against current price
     */
    private static async checkSignal(signal: Signal, type: 'standard' | 'scalping' | 'onchain'): Promise<void> {
        try {
            // Fetch current price
            let currentPrice = signal.currentPrice;

            if (signal.marketType === 'CRYPTO') {
                try {
                    const realPrice = await fetchBinancePrice(signal.pair);
                    if (realPrice) {
                        currentPrice = realPrice;
                        console.log(`📊 ${signal.pair}: Current price = ${currentPrice.toFixed(8)}`);
                    }
                } catch (error) {
                    console.warn(`⚠️ Could not fetch ${signal.pair} price, using last known`);
                }
            } else if (signal.marketType === 'FOREX') {
                try {
                    const realPrice = await ExnessAPI.getCurrentForexPrice(signal.pair);
                    if (realPrice) {
                        currentPrice = realPrice;
                        console.log(`💱 ${signal.pair}: Current price = ${currentPrice.toFixed(5)}`);
                    }
                } catch (error) {
                    console.warn(`⚠️ Could not fetch ${signal.pair} price, using last known`);
                }
            }

            // Apply the shared outcome logic (full TP = COMPLETED, SL = STOPPED,
            // expiry = EXPIRED, partial TPs are milestones only). Note: only the
            // current price is available here, so this checks the current level
            // against the targets - it does not invent intra-period highs/lows.
            const updatedSignal = SignalGenerator.updateSignal(signal, currentPrice);

            if (updatedSignal.status !== SignalStatus.ACTIVE) {
                // Persist the closed state first, then move it to the record
                SignalManager.updateSignal(updatedSignal, type);
                SignalManager.completeSignal(signal.id, type);
                console.log(`🎯 ${signal.pair}: Signal closed as ${updatedSignal.status}`);
            } else {
                SignalManager.updateSignal(updatedSignal, type);
            }

        } catch (error) {
            console.error(`Error checking signal ${signal.pair}:`, error);
        }
    }
}
