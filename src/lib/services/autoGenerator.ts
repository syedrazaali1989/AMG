import { Signal } from '../signals/types';
import { SignalManager } from './signalManager';

/**
 * Auto Generator Service
 * Automatically generates signals on a schedule.
 *
 * Futures only: the site serves no spot signals, so every config is
 * FUTURE. Standard and on-chain signals are fetched from their
 * server routes; scalping signals are fetched from
 * /api/scalping/signals (server-side generation) - nothing is
 * generated in the visitor's browser anymore.
 */

export interface GenerationConfig {
    market: 'CRYPTO' | 'FOREX';
    signalType: 'FUTURE';
    enabled: boolean;
}

export class AutoGenerator {
    private static intervals: Record<string, NodeJS.Timeout> = {};
    private static configs: Record<string, GenerationConfig> = {};

    // Generation intervals (in milliseconds)
    private static readonly INTERVALS = {
        standard: 10 * 60 * 1000,  // 10 minutes
        scalping: 5 * 60 * 1000,   // 5 minutes
        onchain: 15 * 60 * 1000    // 15 minutes
    };

    /**
     * Start auto-generation for a specific signal type
     */
    static startAutoGeneration(
        type: 'standard' | 'scalping' | 'onchain',
        config: GenerationConfig
    ): void {
        // Stop existing interval if any
        this.stopAutoGeneration(type);

        // Save config
        this.configs[type] = config;

        console.log(`🤖 Starting auto-generation for ${type} (every ${this.INTERVALS[type] / 60000} mins)`);

        // IMPORTANT: Set timestamp BEFORE generating to avoid timer showing 0
        // This ensures the countdown timer always has a valid timestamp
        SignalManager.updateLastGenerated(type);

        // Generate immediately
        this.generateSignals(type, config);

        // Then schedule periodic generation
        this.intervals[type] = setInterval(() => {
            SignalManager.updateLastGenerated(type);
            this.generateSignals(type, config);
        }, this.INTERVALS[type]);

        // Save to preferences
        const prefs = SignalManager.getAutoGenPreferences();
        prefs[type].enabled = true;
        SignalManager.setAutoGenPreferences(prefs);
    }

    /**
     * Stop auto-generation for a specific type
     */
    static stopAutoGeneration(type: 'standard' | 'scalping' | 'onchain'): void {
        if (this.intervals[type]) {
            clearInterval(this.intervals[type]);
            delete this.intervals[type];
            console.log(`⏸️ Stopped auto-generation for ${type}`);
        }

        // Update preferences
        const prefs = SignalManager.getAutoGenPreferences();
        prefs[type].enabled = false;
        SignalManager.setAutoGenPreferences(prefs);
    }

    /**
     * Stop all auto-generation
     */
    static stopAll(): void {
        Object.keys(this.intervals).forEach(type => {
            this.stopAutoGeneration(type as any);
        });
    }

    /**
     * Generate signals based on type and config
     */
    private static async generateSignals(
        type: 'standard' | 'scalping' | 'onchain',
        config: GenerationConfig
    ): Promise<void> {
        try {
            console.log(`🔄 Auto-generating ${type} signals...`);

            let generatedSignals: Signal[] = [];

            switch (type) {
                case 'standard':
                    generatedSignals = await this.generateStandardSignals(config);
                    break;

                case 'scalping':
                    generatedSignals = await this.generateScalpingSignals(config);
                    break;

                case 'onchain':
                    generatedSignals = await this.generateOnChainSignals();
                    break;
            }

            if (generatedSignals.length > 0) {
                // Replace old signals with new ones
                SignalManager.setActiveSignals(generatedSignals, type);

                console.log(`✅ Auto-generated ${generatedSignals.length} ${type} signals`);

                // Show notification
                this.showNotification(type, generatedSignals.length);
            } else {
                console.log(`⚠️ No ${type} signals generated`);
            }
        } catch (error) {
            console.error(`Error auto-generating ${type} signals:`, error);
        }
    }

    /**
     * Generate standard signals.
     *
     * Standard signals are generated SERVER-SIDE by /api/signals (one shared
     * engine instance against live Binance data) so every visitor sees the
     * same signals. This method only fetches them. If live data is
     * unavailable the API returns an error and no signals are produced -
     * there is no client-side or simulated fallback.
     */
    private static async generateStandardSignals(config: GenerationConfig): Promise<Signal[]> {
        if (config.market !== 'CRYPTO') {
            console.warn('Standard auto-generation is only available for CRYPTO (live data source)');
            return [];
        }

        const response = await fetch(`/api/signals?market=CRYPTO`);
        if (!response.ok) {
            throw new Error(`Live signals unavailable (status ${response.status})`);
        }

        const data = await response.json();
        return (data.signals || []) as Signal[];
    }

    /**
     * Generate scalping signals.
     *
     * Scalping signals are generated SERVER-SIDE by
     * /api/scalping/signals (one shared engine instance against live
     * Binance data) so every visitor sees the same signals. This method
     * only fetches them. If live data is unavailable the API returns an
     * error and no signals are produced - there is no client-side or
     * simulated fallback.
     */
    private static async generateScalpingSignals(config: GenerationConfig): Promise<Signal[]> {
        if (config.market !== 'CRYPTO') {
            console.warn('Scalping auto-generation is only available for CRYPTO (live data source)');
            return [];
        }

        const response = await fetch('/api/scalping/signals?market=CRYPTO');
        if (!response.ok) {
            throw new Error(`Live scalping signals unavailable (status ${response.status})`);
        }

        const data = await response.json();
        return (data.signals || []) as Signal[];
    }

    /**
     * Generate on-chain signals.
     *
     * On-chain signals are generated SERVER-SIDE by /api/on-chain/signals
     * (one shared pass over the live Blockchain.info large-transaction
     * feed and live Binance prices) so every visitor sees the same
     * signals. This method only fetches them. If a live source is
     * unavailable the API returns an error and no signals are produced -
     * there is no client-side or simulated fallback.
     */
    private static async generateOnChainSignals(): Promise<Signal[]> {
        const response = await fetch('/api/on-chain/signals');
        if (!response.ok) {
            throw new Error(`Live on-chain signals unavailable (status ${response.status})`);
        }

        const data = await response.json();
        return (data.signals || []) as Signal[];
    }

    /**
     * Show notification for new signals
     */
    private static showNotification(type: string, count: number): void {
        if (typeof window === 'undefined') return;

        if (Notification.permission === 'granted') {
            try {
                const typeLabel = type.charAt(0).toUpperCase() + type.slice(1);
                new Notification(`🤖 Auto-Generated Signals`, {
                    body: `${count} new ${typeLabel} signals available`,
                    icon: '/favicon.ico',
                    tag: `autogen-${type}`
                });
            } catch (error) {
                console.debug('Notification error:', error);
            }
        }
    }

    /**
     * Check if auto-generation is enabled for type
     */
    static isEnabled(type: 'standard' | 'scalping' | 'onchain'): boolean {
        const prefs = SignalManager.getAutoGenPreferences();
        return prefs[type].enabled;
    }

    /**
     * Get time until next generation (in seconds)
     */
    static timeUntilNext(type: 'standard' | 'scalping' | 'onchain'): number {
        const prefs = SignalManager.getAutoGenPreferences();
        const lastGen = prefs[type].lastGenerated;
        if (lastGen === 0) return 0;

        const elapsed = Date.now() - lastGen;
        const interval = this.INTERVALS[type];
        const remaining = interval - elapsed;

        return Math.max(0, Math.floor(remaining / 1000));
    }

    /**
     * Resume auto-generation from saved preferences
     */
    static resumeFromPreferences(): void {
        const prefs = SignalManager.getAutoGenPreferences();

        (['standard', 'scalping', 'onchain'] as const).forEach(type => {
            if (prefs[type].enabled && this.configs[type]) {
                this.startAutoGeneration(type, this.configs[type]);
            }
        });
    }
}
