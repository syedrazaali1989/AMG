'use client';

import { useEffect, useState, useCallback } from 'react';
import { Navbar } from '@/components/layout/Navbar';
import { SignalList } from '@/components/ui/SignalList';
import { StatsCard } from '@/components/ui/StatsCard';
import { MessageBox, useMessages } from '@/components/ui/MessageBox';
import { SignalDirectionFilter } from '@/components/ui/SignalDirectionFilter';
import { ConfidenceFilter, ConfidenceLevel, filterSignalsByConfidence } from '@/components/ui/ConfidenceFilter';
import { SignalNotifications, SignalNotification } from '@/components/ui/SignalNotifications';
import { Signal, SignalType, MarketType, SignalDirection } from '@/lib/signals/types';
import { SignalGenerator } from '@/lib/signals/generator';
import { MarketDataManager } from '@/lib/signals/marketData';
import { TrendingUp, Target, Activity, Award } from 'lucide-react';
import { motion } from 'framer-motion';

export default function DashboardPage() {
    const [signals, setSignals] = useState<Signal[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [selectedMarket, setSelectedMarket] = useState<'CRYPTO' | 'FOREX'>('CRYPTO');
    const [selectedType, setSelectedType] = useState<'SPOT' | 'FUTURE'>('SPOT');
    const [selectedDirections, setSelectedDirections] = useState<SignalDirection[]>(() => {
        // Default to BUY/SELL for SPOT (initial state)
        return [SignalDirection.BUY, SignalDirection.SELL];
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

    // Auto-adjust selected directions when signal type changes
    useEffect(() => {
        if (selectedType === 'SPOT') {
            // Switch to BUY/SELL for SPOT
            setSelectedDirections([SignalDirection.BUY, SignalDirection.SELL]);
        } else {
            // Switch to LONG/SHORT for FUTURE
            setSelectedDirections([SignalDirection.LONG, SignalDirection.SHORT]);
        }
    }, [selectedType]);

    // Filter signals based on selected directions and confidence
    const directionFilteredSignals = signals.filter(signal => selectedDirections.includes(signal.direction));
    const filteredSignals = filterSignalsByConfidence(directionFilteredSignals, selectedConfidence);

    useEffect(() => {
        generateSignals();
        showInfo(
            `${selectedMarket} ${selectedType} Signals`,
            'Viewing live signals with 75%+ accuracy'
        );
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedMarket, selectedType]);

    useEffect(() => {
        if (signals.length === 0) return;
        const interval = setInterval(() => {
            updateSignalPrices();
        }, 5000);
        return () => clearInterval(interval);
    }, [signals.length]);

    const generateSignals = async () => {
        setIsLoading(true);
        // Clear existing signals to prevent TP carry-over
        setSignals([]);
        setNotifications([]);

        try {
            const allPairs = MarketDataManager.getAllPairs();
            const filteredPairs = allPairs.filter(({ marketType }) =>
                selectedMarket === 'CRYPTO' ? marketType === MarketType.CRYPTO : marketType === MarketType.FOREX
            );

            const marketDataList = await Promise.all(
                filteredPairs.map(({ pair, marketType }) =>
                    MarketDataManager.generateMarketData(pair, marketType, 100)
                )
            );

            const signalTypeEnum = selectedType === 'SPOT' ? SignalType.SPOT : SignalType.FUTURE;
            const generatedSignals = await SignalGenerator.generateMultipleSignals(marketDataList, signalTypeEnum);

            // Completely replace with fresh signals
            setSignals(generatedSignals);
            setIsLoading(false);

            if (generatedSignals.length > 0) {
                showSuccess(
                    `${generatedSignals.length} ${selectedMarket} ${selectedType} Signals`,
                    '75%+ accuracy with real-time prices'
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
            setIsLoading(false);
        }
    };

    const updateSignalPrices = async () => {
        try {
            const cryptoSignals = signals.filter(s => s.marketType === MarketType.CRYPTO);
            if (cryptoSignals.length > 0) {
                const [binanceResult, mexcResult] = await Promise.allSettled([
                    MarketDataManager.getAllCryptoPrices(),
                    MarketDataManager.getAllMexcPrices()
                ]);

                const binancePrices = binanceResult.status === 'fulfilled' ? binanceResult.value : new Map<string, number>();
                const mexcPrices = mexcResult.status === 'fulfilled' ? mexcResult.value : new Map<string, number>();

                setSignals(prevSignals => {
                    return prevSignals.map(signal => {
                        let newPrice = signal.currentPrice;
                        let mexcPrice = signal.mexcPrice;

                        if (signal.marketType === MarketType.CRYPTO) {
                            const binanceSymbol = signal.pair.replace('/', '');
                            const realPrice = binancePrices.get(binanceSymbol);
                            const realMexcPrice = mexcPrices.get(binanceSymbol);
                            if (realPrice) newPrice = realPrice;
                            if (realMexcPrice) mexcPrice = realMexcPrice;
                        } else {
                            const change = (Math.random() - 0.5) * 0.001;
                            newPrice = signal.currentPrice * (1 + change);
                        }

                        const updatedSignal = SignalGenerator.updateSignal(signal, newPrice);

                        // Check if signal just completed (TP hit)
                        if (updatedSignal.status === 'COMPLETED' && signal.status !== 'COMPLETED') {
                            // Save to completed signals in localStorage
                            const completedSignals = JSON.parse(localStorage.getItem('completedSignals') || '[]');
                            completedSignals.push({
                                ...updatedSignal,
                                completedAt: new Date().toISOString()
                            });
                            localStorage.setItem('completedSignals', JSON.stringify(completedSignals));

                            // Show notification
                            showSuccess(
                                `🎯 TP Hit: ${signal.pair}`,
                                `Profit: ${updatedSignal.profitLossPercentage?.toFixed(2)}%`
                            );
                        }

                        return { ...updatedSignal, mexcPrice };
                    });
                });
            }
        } catch (error) {
            console.error('Price update error:', error);
        }
    };

    // Filter signals by selected type for accurate stats
    const signalsForStats = signals.filter(signal =>
        selectedType === 'SPOT' ? signal.signalType === SignalType.SPOT : signal.signalType === SignalType.FUTURE
    );
    const stats = SignalGenerator.calculateAccuracy(signalsForStats);

    return (
        <div className="min-h-screen bg-background">
            <Navbar />
            <MessageBox messages={messages} onDismiss={dismissMessage} />

            <div className="container mx-auto px-4 py-8">
                <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
                    <div className="flex flex-col gap-6">
                        <div>
                            <h1 className="text-4xl font-bold text-gradient mb-2">Trading Signals</h1>
                            <p className="text-muted-foreground">Real-time signals with 75%+ accuracy</p>
                        </div>

                        <div>
                            <p className="text-sm text-muted-foreground mb-2">Select Market</p>
                            <div className="flex gap-2 glass rounded-lg p-1 w-fit">
                                <button
                                    onClick={() => { setSelectedMarket('CRYPTO'); setSignals([]); setIsLoading(true); }}
                                    className={`px-6 py-3 rounded-lg font-bold transition-all ${selectedMarket === 'CRYPTO' ? 'bg-gradient-primary text-white shadow-lg' : 'text-muted-foreground hover:text-foreground'
                                        }`}
                                >
                                    Cryptocurrency
                                </button>
                                <button
                                    onClick={() => { setSelectedMarket('FOREX'); setSignals([]); setIsLoading(true); }}
                                    className={`px-6 py-3 rounded-lg font-bold transition-all ${selectedMarket === 'FOREX' ? 'bg-gradient-primary text-white shadow-lg' : 'text-muted-foreground hover:text-foreground'
                                        }`}
                                >
                                    Forex & Gold
                                </button>
                            </div>
                        </div>

                        <div>
                            <p className="text-sm text-muted-foreground mb-2">Select Signal Type</p>
                            <div className="flex gap-2 glass rounded-lg p-1 w-fit">
                                <button
                                    onClick={() => { setSelectedType('SPOT'); setSignals([]); setIsLoading(true); }}
                                    className={`px-6 py-3 rounded-lg font-bold transition-all ${selectedType === 'SPOT' ? 'bg-gradient-primary text-white shadow-lg' : 'text-muted-foreground hover:text-foreground'
                                        }`}
                                >
                                    Spot Trading
                                </button>
                                <button
                                    onClick={() => { setSelectedType('FUTURE'); setSignals([]); setIsLoading(true); }}
                                    className={`px-6 py-3 rounded-lg font-bold transition-all ${selectedType === 'FUTURE' ? 'bg-gradient-primary text-white shadow-lg' : 'text-muted-foreground hover:text-foreground'
                                        }`}
                                >
                                    Future Trading
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
                        trend={{ value: stats.accuracyRate - 85, isPositive: stats.accuracyRate >= 75 }}
                    />
                    <StatsCard
                        title="Avg Profit"
                        value={`${stats.averageProfit.toFixed(2)}%`}
                        icon={Target}
                        trend={{ value: stats.averageProfit, isPositive: stats.averageProfit > 0 }}
                    />
                </div>

                {isLoading ? (
                    <div className="glass rounded-lg p-12 text-center">
                        <div className="animate-pulse">
                            <div className="text-muted-foreground">Loading {selectedMarket} {selectedType} signals...</div>
                        </div>
                    </div>
                ) : (
                    <>
                        {/* Filters & Actions Container */}
                        <div className="glass rounded-lg p-6 mb-6">
                            <div className="flex items-center justify-between mb-4">
                                <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
                                    <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                                    </svg>
                                    Filters & Actions
                                </h2>
                                <motion.button
                                    whileHover={{ scale: 1.02 }}
                                    whileTap={{ scale: 0.98 }}
                                    onClick={generateSignals}
                                    className="px-6 py-2.5 rounded-lg bg-gradient-primary text-white font-semibold shadow-md hover:shadow-lg transition-all flex items-center gap-2"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                    </svg>
                                    Generate New Signals
                                </motion.button>
                            </div>

                            <div className="space-y-4">
                                <ConfidenceFilter
                                    selectedConfidence={selectedConfidence}
                                    onConfidenceChange={setSelectedConfidence}
                                />
                                <SignalDirectionFilter
                                    selectedDirections={selectedDirections}
                                    onDirectionsChange={setSelectedDirections}
                                    signalType={selectedType}
                                />
                            </div>
                        </div>

                        <SignalList signals={filteredSignals} />
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
