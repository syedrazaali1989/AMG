'use client';

import { useEffect, useState, useCallback } from 'react';
import { Navbar } from '@/components/layout/Navbar';
import { SignalList } from '@/components/ui/SignalList';
import { StatsCard } from '@/components/ui/StatsCard';
import { MessageBox, useMessages } from '@/components/ui/MessageBox';
import { ConfidenceFilter, ConfidenceLevel, filterSignalsByConfidence } from '@/components/ui/ConfidenceFilter';
import { SignalDirectionFilter } from '@/components/ui/SignalDirectionFilter';
import { SignalNotifications, SignalNotification } from '@/components/ui/SignalNotifications';
import { Signal, SignalType, MarketType, SignalDirection, SignalStatus } from '@/lib/signals/types';
import { SignalGenerator } from '@/lib/signals/generator';
import { MarketDataManager } from '@/lib/signals/marketData';
import { SignalManager } from '@/lib/services/signalManager';
import { AutoGenerator } from '@/lib/services/autoGenerator';
import { TrendingUp, Target, Activity, Award, Clock } from 'lucide-react';
import { motion } from 'framer-motion';

export default function DashboardPage() {
    const [signals, setSignals] = useState<Signal[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [dataUnavailable, setDataUnavailable] = useState(false);
    const [loadingProgress, setLoadingProgress] = useState(0); // 0-100
    const [loadingStatus, setLoadingStatus] = useState('Initializing...'); // Status message
    const [selectedMarket, setSelectedMarket] = useState<'CRYPTO' | 'FOREX' | null>(null);
    // Futures only: the site serves no spot signals, so there is no
    // type selector. CRYPTO selection sets this to FUTURE directly.
    const [selectedType, setSelectedType] = useState<'FUTURE' | null>(null);
    const [autoGenEnabled, setAutoGenEnabled] = useState(false);

    // Auto-migrate old signals to new SignalManager format
    useEffect(() => {
        try {
            const oldSignals = localStorage.getItem('signals');
            if (oldSignals && oldSignals !== '[]') {
                console.log('🔄 Migrating old standard signals...');
                const parsed = JSON.parse(oldSignals);
                const currentSignals = SignalManager.getActiveSignals('standard');
                if (currentSignals.length === 0 && parsed.length > 0) {
                    SignalManager.setActiveSignals(parsed, 'standard');
                    console.log(`✅ Migrated ${parsed.length} standard signals`);
                    localStorage.removeItem('signals');
                }
            }
        } catch (error) {
            console.error('Migration error:', error);
        }
    }, []);
    const [nextGenTime, setNextGenTime] = useState(() => {
        // Initialize with actual countdown value if auto-gen is enabled
        const prefs = SignalManager.getAutoGenPreferences();
        if(prefs.standard.enabled && prefs.standard.lastGenerated > 0) {
            const timeLeft = AutoGenerator.timeUntilNext('standard');
    console.log(`⏱️ Timer initialized: ${Math.floor(timeLeft / 60)}m ${timeLeft % 60}s`);
    return timeLeft;
}
return 0;
    });
const [selectedDirections, setSelectedDirections] = useState<SignalDirection[]>(() => {
    if (typeof window !== 'undefined') {
        const saved = localStorage.getItem('selectedDirections');
        if (saved) return JSON.parse(saved) as SignalDirection[];
    }
    // Default: LONG/SHORT for FUTURE
    return [SignalDirection.LONG, SignalDirection.SHORT];
});
const [selectedConfidence, setSelectedConfidence] = useState<ConfidenceLevel>(() => {
    if (typeof window !== 'undefined') {
        const saved = localStorage.getItem('selectedConfidence');
        if (saved) return saved as ConfidenceLevel;
    }
    return 'ALL';
});
const [notifications, setNotifications] = useState<SignalNotification[]>([]);
const { messages, dismissMessage, showSuccess, showInfo } = useMessages();

const handleDismissNotification = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
}, []);

// Save selected directions to localStorage
useEffect(() => {
    localStorage.setItem('selectedDirections', JSON.stringify(selectedDirections));
}, [selectedDirections]);

// Save selected confidence to localStorage
useEffect(() => {
    localStorage.setItem('selectedConfidence', selectedConfidence);
}, [selectedConfidence]);

// Load signals from SignalManager on mount and refresh every second
useEffect(() => {
    const loadSignals = () => {
        const activeSignals = SignalManager.getActiveSignals('standard');
        setSignals(activeSignals);
    };

    loadSignals();
    const interval = setInterval(loadSignals, 1000);
    return () => clearInterval(interval);
}, []);

// Auto-adjust selected directions when signal type changes
// (Futures only: LONG and SHORT.)
useEffect(() => {
    setSelectedDirections([SignalDirection.LONG, SignalDirection.SHORT]);
}, [selectedType]);

// Check auto-generation status
useEffect(() => {
    const prefs = SignalManager.getAutoGenPreferences();
    setAutoGenEnabled(prefs.standard.enabled);
}, []);

// Update next generation countdown
useEffect(() => {
    if (!autoGenEnabled) return;

    const interval = setInterval(() => {
        const timeLeft = AutoGenerator.timeUntilNext('standard');
        setNextGenTime(timeLeft);
    }, 1000);

    return () => clearInterval(interval);
}, [autoGenEnabled]);

// AUTO-START: When market and type are selected, ALWAYS start auto-generation
useEffect(() => {
    if (!selectedMarket || !selectedType) return;

    console.log('🚀 Starting automatic signal generation...');

    // ALWAYS start auto-generation (generates signals immediately + schedules future ones)
    AutoGenerator.startAutoGeneration('standard', {
        market: selectedMarket,
        signalType: selectedType,
        enabled: true
    });
    setAutoGenEnabled(true);

}, [selectedMarket, selectedType]); // Run when market/type changes

// Apply confidence and direction filters
const confidenceFilteredSignals = filterSignalsByConfidence(signals, selectedConfidence);
const filteredSignals = confidenceFilteredSignals.filter(signal =>
    selectedDirections.includes(signal.direction)
);

// Only auto-adjust directions when type changes, don't auto-load signals
// Signals will only load when user explicitly selects the trading type


// Define updateSignalPrices function BEFORE useEffect that uses it
const updateSignalPrices = useCallback(async () => {
    try {
        // Use functional form to get current signals without adding to dependencies
        setSignals(currentSignals => {
            const cryptoSignals = currentSignals.filter(s => s.marketType === MarketType.CRYPTO);

            if (cryptoSignals.length === 0) {
                return currentSignals; // No crypto signals, no update needed
            }

            // Fetch prices asynchronously and update
            (async () => {
                try {
                    // Use backend proxy instead of direct Binance API (no CORS!)
                    const response = await fetch('/api/binance/prices');

                    if (!response.ok) {
                        console.error('Failed to fetch prices from proxy');
                        return;
                    }

                    const data = await response.json();
                    const binancePrices = new Map<string, number>();

                    // Convert prices object to Map
                    for (const [symbol, price] of Object.entries(data.prices)) {
                        binancePrices.set(symbol, price as number);
                    }

                    // Get MEXC prices (fallback)
                    const mexcResult = await Promise.allSettled([
                        MarketDataManager.getAllMexcPrices()
                    ]);
                    const mexcPrices = mexcResult[0].status === 'fulfilled' ? mexcResult[0].value : new Map<string, number>();

                    // Update signals with new prices
                    setSignals(prevSignals => {
                        const updatedSignalsPromises = prevSignals.map(async signal => {
                            let newPrice = signal.currentPrice;
                            let mexcPrice = signal.mexcPrice;
                            let currentRsi = signal.rsi;

                            if (signal.marketType === MarketType.CRYPTO) {
                                const binanceSymbol = signal.pair.replace('/', '');
                                const realPrice = binancePrices.get(binanceSymbol);
                                const realMexcPrice = mexcPrices.get(binanceSymbol);
                                if (realPrice) newPrice = realPrice;
                                if (realMexcPrice) mexcPrice = realMexcPrice;

                                try {
                                    const recentData = await MarketDataManager.generateMarketData(
                                        signal.pair,
                                        signal.marketType,
                                        30
                                    );
                                    const freshRsi = SignalGenerator.calculateCurrentRSI(recentData.prices);
                                    if (freshRsi) currentRsi = freshRsi;
                                } catch (error) {
                                    console.error(`Failed to fetch RSI for ${signal.pair}:`, error);
                                }
                            } else {
                                // No live price source is fabricated here: forex
                                // signals keep their last known price.
                                newPrice = signal.currentPrice;
                            }

                            const updatedSignal = SignalGenerator.updateSignal(signal, newPrice);

                            // Any close (full TP, stop loss, or expiry) moves the
                            // signal to the record with its realised P/L.
                            if (updatedSignal.status !== 'ACTIVE' && signal.status === 'ACTIVE') {
                                const completedSignals = JSON.parse(localStorage.getItem('completedSignals') || '[]');
                                completedSignals.push({
                                    ...updatedSignal,
                                    completedAt: new Date().toISOString()
                                });
                                localStorage.setItem('completedSignals', JSON.stringify(completedSignals));

                                if (updatedSignal.status === 'COMPLETED') {
                                    showSuccess(
                                        `🎯 Full TP Hit: ${signal.pair}`,
                                        `Profit: ${updatedSignal.profitLossPercentage?.toFixed(2)}%`
                                    );
                                } else {
                                    showInfo(
                                        `${signal.pair} closed (${updatedSignal.status})`,
                                        `Result: ${updatedSignal.profitLossPercentage?.toFixed(2)}%`
                                    );
                                }
                            }

                            return { ...updatedSignal, mexcPrice, currentRsi };
                        });

                        Promise.all(updatedSignalsPromises).then(updatedSignals => {
                            setSignals(updatedSignals);
                        });

                        return prevSignals; // Return current until async completes
                    });
                } catch (error) {
                    console.error('Price update error:', error);
                }
            })();

            return currentSignals; // Return current signals immediately
        });
    } catch (error) {
        console.error('Price update error:', error);
    }
}, [showSuccess]); // Only showSuccess in dependencies, NOT signals

// Price update interval - runs every 2 seconds
useEffect(() => {
    if (signals.length === 0) return;

    console.log('🔄 Starting price updates every 2 seconds...');

    // Update prices every 2 seconds using backend proxy
    const interval = setInterval(() => {
        console.log('📊 Updating prices...');
        updateSignalPrices();
    }, 2000); // 2 seconds

    return () => {
        console.log('🛑 Stopping price updates');
        clearInterval(interval);
    };
}, [signals.length, updateSignalPrices]);

const generateSignals = async () => {
    // Don't generate if no market or type selected
    if (!selectedMarket || !selectedType) {
        return;
    }

    setIsLoading(true);
    setDataUnavailable(false);
    setLoadingProgress(0);
    setLoadingStatus('Preparing market analysis...');
    // Clear existing signals to prevent TP carry-over
    setSignals([]);
    setNotifications([]);

    try {
        setLoadingProgress(25);
        setLoadingStatus('Fetching live signals from server...');

        // Signals are generated server-side (/api/signals) from live Binance
        // data so every visitor sees the same signals. If live data cannot
        // be loaded, NO signals are shown - never simulated ones.
        const response = await fetch(`/api/signals?market=${selectedMarket}`);

        if (!response.ok) {
            throw new Error(`Signals request failed: ${response.status}`);
        }

        const data = await response.json();
        const generatedSignals = (data.signals || []) as Signal[];

        setLoadingProgress(100);
        setLoadingStatus('Complete!');
        setIsLoading(false);

        // Store via SignalManager so the periodic loader keeps displaying them
        SignalManager.setActiveSignals(generatedSignals, 'standard');
        setSignals(generatedSignals);

        if (generatedSignals.length > 0) {
            showSuccess(
                `${generatedSignals.length} ${selectedMarket} ${selectedType} Signals`,
                'Generated server-side from live prices'
            );

            // Add notifications for new signals (limit to top 3 to avoid clutter)
            const newNotifications = generatedSignals.slice(0, 3).map(signal => ({
                id: Math.random().toString(36).substring(7),
                signal,
                timestamp: Date.now()
            }));

            setNotifications(newNotifications);
        }
    } catch (error) {
        console.error('Error:', error);
        // Live data unavailable: show an explicit empty state, not fake signals
        setSignals([]);
        setDataUnavailable(true);
        setLoadingStatus('Live data unavailable');
        setIsLoading(false);
    }
};


// Filter signals by selected type for accurate stats (futures only)
const signalsForStats = selectedType ? signals.filter(signal =>
    signal.signalType === SignalType.FUTURE
) : [];

// Apply direction filter to stats as well (so Total Signals reflects filter)
const stats = SignalGenerator.calculateAccuracy(filteredSignals);

return (
    <div className="min-h-screen bg-background">
        <Navbar />
        <MessageBox messages={messages} onDismiss={dismissMessage} />

        <div className="container mx-auto px-4 py-8">
            <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
                <div className="flex flex-col gap-6">
                    {/* Step 1: Select Market Type */}
                    <div>
                        <p className="text-sm text-muted-foreground mb-2">Step 1: Market</p>
                        <div className="glass rounded-lg p-1 w-fit">
                            <button
                                onClick={() => {
                                    setSelectedMarket('CRYPTO');
                                    setSelectedType('FUTURE');
                                    setSignals([]);
                                    setIsLoading(false);
                                }}
                                className="px-6 py-3 rounded-lg font-bold bg-gradient-primary text-white shadow-lg"
                            >
                                Cryptocurrency (Real-time Prices)
                            </button>
                        </div>
                    </div>
                </div>
            </motion.div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                <StatsCard title="Total Signals" value={stats.totalSignals} icon={TrendingUp} />
                <StatsCard title="Active Signals" value={stats.activeSignals} icon={Activity} />
                <StatsCard
                    title="Accuracy Rate"
                    value={`${stats.accuracyRate.toFixed(1)}%`}
                    icon={Award}
                    
                />
                <StatsCard
                    title="Avg Profit"
                    value={`${stats.averageProfit.toFixed(2)}%`}
                    icon={Target}
                    trend={{ value: stats.averageProfit, isPositive: stats.averageProfit > 0 }}
                />
            </div>

            {/* Show placeholder if no market selected */}
            {!selectedMarket ? (
                <div className="glass rounded-lg p-12 text-center">
                    <div className="space-y-4">
                        <div className="text-2xl font-bold text-gradient">Welcome to AMG Trading</div>
                        <div className="text-muted-foreground">Please select a market to get started</div>
                    </div>
                </div>
            ) : isLoading ? (
                <div className="glass rounded-lg p-12 text-center">
                    <div className="space-y-4">
                        <div className="text-muted-foreground font-medium">{loadingStatus}</div>

                        {/* Progress Bar */}
                        <div className="w-full max-w-md mx-auto bg-muted/30 rounded-full h-2 overflow-hidden">
                            <motion.div
                                initial={{ width: 0 }}
                                animate={{ width: `${loadingProgress}%` }}
                                transition={{ duration: 0.3 }}
                                className="h-full bg-gradient-primary"
                            />
                        </div>

                        <div className="text-sm text-muted-foreground">
                            {loadingProgress}% complete
                        </div>
                    </div>
                </div>
            ) : (
                <>
                    {/* Auto-Generation Toggle */}
                    <div className="glass rounded-lg p-4 mb-6">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <Clock className="w-5 h-5 text-blue-500" />
                                <div>
                                    <h3 className="font-semibold">Auto-Generate Signals</h3>
                                    <p className="text-sm text-muted-foreground">
                                        {autoGenEnabled
                                            ? `Next generation in ${Math.floor(nextGenTime / 60)}m ${nextGenTime % 60}s`
                                            : 'Generate signals every 30 minutes automatically'
                                        }
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={() => {
                                    if (!selectedMarket || !selectedType) {
                                        return;
                                    }

                                    if (autoGenEnabled) {
                                        AutoGenerator.stopAutoGeneration('standard');
                                        setAutoGenEnabled(false);
                                        showInfo('Auto-Gen Stopped', 'Stopped automatic generation');
                                    } else {
                                        AutoGenerator.startAutoGeneration('standard', {
                                            market: selectedMarket,
                                            signalType: selectedType,
                                            enabled: true
                                        });
                                        setAutoGenEnabled(true);
                                        showSuccess('Auto-Gen Started', 'Signals will generate every 30 mins');
                                    }
                                }}
                                disabled={!selectedMarket || !selectedType}
                                className={`px-4 py-2 rounded-lg font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed ${autoGenEnabled
                                    ? 'bg-red-500/20 text-red-500 hover:bg-red-500/30'
                                    : 'bg-green-500/20 text-green-500 hover:bg-green-500/30'
                                    }`}
                            >
                                {autoGenEnabled ? 'Stop Auto-Gen' : 'Enable Auto-Gen'}
                            </button>
                        </div>
                    </div>

                    {/* Filters & Actions Container */}
                    <div className="glass rounded-lg p-6 mb-6">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
                                <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                                </svg>
                                Filters & Actions
                            </h2>
                            <div className="flex flex-col items-end gap-1">
                                <motion.button
                                    whileHover={!autoGenEnabled ? { scale: 1.02 } : {}}
                                    whileTap={!autoGenEnabled ? { scale: 0.98 } : {}}
                                    onClick={generateSignals}
                                    disabled={autoGenEnabled}
                                    className={`px-6 py-2.5 rounded-lg font-semibold shadow-md transition-all flex items-center gap-2 ${autoGenEnabled
                                        ? 'bg-muted text-muted-foreground cursor-not-allowed opacity-50'
                                        : 'bg-gradient-primary text-white hover:shadow-lg'
                                        }`}
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                    </svg>
                                    Generate New Signals
                                </motion.button>
                                {autoGenEnabled && (
                                    <span className="text-xs text-muted-foreground">
                                        Turn off auto-generation to use manual button
                                    </span>
                                )}
                            </div>
                        </div>

                        <div className="space-y-4">
                            <ConfidenceFilter
                                selectedConfidence={selectedConfidence}
                                onConfidenceChange={setSelectedConfidence}
                            />
                            {selectedType && (
                                <SignalDirectionFilter
                                    selectedDirections={selectedDirections}
                                    onDirectionsChange={setSelectedDirections}
                                />
                            )}
                        </div>
                    </div>

                    {dataUnavailable ? (
                        <div className="glass rounded-lg p-12 text-center">
                            <div className="space-y-4">
                                <div className="text-2xl font-bold text-danger">Live Data Unavailable</div>
                                <div className="text-muted-foreground">
                                    Live market data could not be loaded, so no signals are shown.
                                    Signals are never generated from simulated prices - please try again shortly.
                                </div>
                            </div>
                        </div>
                    ) : (
                        <SignalList signals={filteredSignals} showCharts />
                    )}
                </>
            )}
        </div>

        {/* Floating Notifications */}
        <SignalNotifications
            notifications={notifications}
            onDismiss={handleDismissNotification}
        />
    </div>
);
}
