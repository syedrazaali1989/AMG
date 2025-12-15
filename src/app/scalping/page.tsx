'use client';

import { useEffect, useState, useCallback } from 'react';
import { Navbar } from '@/components/layout/Navbar';
import { SignalList } from '@/components/ui/SignalList';
import { StatsCard } from '@/components/ui/StatsCard';
import { MessageBox, useMessages } from '@/components/ui/MessageBox';
import { Signal, SignalType, MarketType, SignalDirection, SignalStatus } from '@/lib/signals/types';
import { SignalDirectionFilter } from '@/components/ui/SignalDirectionFilter';
import { ScalpingSignalGenerator } from '@/lib/signals/scalpingGenerator';
import { MarketDataManager } from '@/lib/signals/marketData';
import { TrendingUp, Target, Activity, Award, Zap } from 'lucide-react';
import { motion } from 'framer-motion';

export default function ScalpingPage() {
    const [signals, setSignals] = useState<Signal[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [selectedMarket, setSelectedMarket] = useState<'CRYPTO' | 'FOREX' | null>(null);
    const [selectedType, setSelectedType] = useState<'SPOT' | 'FUTURE' | null>(null);
    const [selectedDirections, setSelectedDirections] = useState<SignalDirection[]>(() => {
        // FUTURES: LONG + SHORT, SPOT: BUY only
        return [SignalDirection.LONG, SignalDirection.SHORT, SignalDirection.BUY];
    });
    const { showSuccess, showError, showInfo } = useMessages();

    // Update prices every 1 second (faster for scalping)
    const updateScalpingPrices = useCallback(async () => {
        if (signals.length === 0) return;

        setSignals(prevSignals => {
            return prevSignals.map(signal => {
                // Simulate 5-min price movement (faster changes)
                const change = (Math.random() - 0.5) * 0.002; // 0.2% max movement per second
                const newPrice = signal.currentPrice * (1 + change);

                // Check TP hits
                const isLong = signal.direction === SignalDirection.LONG || signal.direction === SignalDirection.BUY;
                const tp1Hit = isLong
                    ? newPrice >= signal.takeProfit1!
                    : newPrice <= signal.takeProfit1!;
                const tp2Hit = isLong
                    ? newPrice >= signal.takeProfit2!
                    : newPrice <= signal.takeProfit2!;
                const tp3Hit = isLong
                    ? newPrice >= signal.takeProfit3!
                    : newPrice <= signal.takeProfit3!;

                // Calculate live RSI based on price change
                const oldRsi = signal.currentRsi || signal.rsi || 50;
                let newRsi = oldRsi;

                // Adjust RSI: price up = RSI up, price down = RSI down
                if (change > 0) {
                    newRsi = Math.min(oldRsi + Math.abs(change) * 500, 100);
                } else {
                    newRsi = Math.max(oldRsi - Math.abs(change) * 500, 0);
                }

                // Add small random fluctuation
                newRsi = Math.max(0, Math.min(100, newRsi + (Math.random() - 0.5) * 2));

                const profitLoss = isLong
                    ? ((newPrice - signal.entryPrice) / signal.entryPrice) * 100
                    : ((signal.entryPrice - newPrice) / signal.entryPrice) * 100;

                // Track TP hit times
                const now = new Date();
                const tp1HitTime = tp1Hit && !signal.tp1Hit ? now : signal.tp1HitTime;
                const tp2HitTime = tp2Hit && !signal.tp2Hit ? now : signal.tp2HitTime;
                const tp3HitTime = tp3Hit && !signal.tp3Hit ? now : signal.tp3HitTime;

                const updatedSignal = {
                    ...signal,
                    currentPrice: newPrice,
                    currentRsi: Math.round(newRsi),
                    tp1Hit: signal.tp1Hit || tp1Hit,
                    tp2Hit: signal.tp2Hit || tp2Hit,
                    tp3Hit: signal.tp3Hit || tp3Hit,
                    tp1HitTime,
                    tp2HitTime,
                    tp3HitTime,
                    profitLossPercentage: profitLoss,
                    status: (tp2Hit || tp3Hit) ? SignalStatus.COMPLETED : signal.status
                };

                // Save to completed signals when TP2/TP3 hits
                if ((tp2Hit || tp3Hit) && signal.status !== SignalStatus.COMPLETED) {
                    const completedSignals = JSON.parse(localStorage.getItem('completedSignals') || '[]');
                    completedSignals.push({
                        ...updatedSignal,
                        completedAt: new Date().toISOString(),
                        isScalping: true // Mark as scalping signal
                    });
                    localStorage.setItem('completedSignals', JSON.stringify(completedSignals));

                    showSuccess(
                        `⚡ Scalping TP Hit: ${signal.pair}`,
                        `Profit: ${profitLoss.toFixed(2)}%`
                    );
                }

                return updatedSignal;
            });
        });
    }, [signals.length, showSuccess]);

    useEffect(() => {
        if (signals.length === 0) return;

        const interval = setInterval(() => {
            updateScalpingPrices();
        }, 1000); // 1 second updates!

        return () => clearInterval(interval);
    }, [signals.length, updateScalpingPrices]);

    const generateScalpingSignals = async () => {
        if (!selectedMarket || !selectedType) return;

        setIsLoading(true);

        try {
            const allPairs = MarketDataManager.getAllPairs();
            const filteredPairs = allPairs
                .filter(({ marketType }) =>
                    selectedMarket === 'CRYPTO' ? marketType === MarketType.CRYPTO : marketType === MarketType.FOREX
                )
                .sort(() => Math.random() - 0.5) // Shuffle for random selection
                .slice(0, 30); // Random 30 pairs each time

            const signalTypeEnum = selectedType === 'SPOT' ? SignalType.SPOT : SignalType.FUTURE;
            const generatedSignals = await ScalpingSignalGenerator.generateScalpingSignals(
                filteredPairs,
                signalTypeEnum
            );

            setSignals(generatedSignals);
            setIsLoading(false);

            if (generatedSignals.length > 0) {
                showSuccess(
                    `⚡ ${generatedSignals.length} Scalping Signals`,
                    'Quick profits in 15-60 minutes!'
                );
            }
        } catch (error) {
            console.error('Error:', error);
            setIsLoading(false);
            showError('Generation Failed', 'Please try again');
        }
    };

    // Calculate stats
    const filteredSignals = signals.filter(signal =>
        selectedDirections.includes(signal.direction)
    );

    const stats = {
        totalSignals: filteredSignals.length,
        activeSignals: filteredSignals.filter(s => s.status === 'ACTIVE').length,
        completedSignals: filteredSignals.filter(s => s.tp2Hit || s.tp3Hit).length,
        avgProfit: filteredSignals.reduce((acc, s) => acc + (s.profitLossPercentage || 0), 0) / (filteredSignals.length || 1)
    };

    return (
        <div className="min-h-screen bg-background">
            <Navbar />

            <div className="container mx-auto px-4 py-8">
                {/* Scalping Mode Badge */}
                <div className="flex items-center justify-center mb-6">
                    <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-full px-6 py-3 flex items-center gap-3">
                        <Zap className="w-5 h-5 text-yellow-500 animate-pulse" />
                        <span className="text-yellow-500 font-bold text-lg">⚡ SCALPING MODE ⚡</span>
                        <span className="text-sm text-muted-foreground">5-min candles • 1-3% targets</span>
                    </div>
                </div>

                {/* Market Selection */}
                {!selectedMarket && (
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="max-w-2xl mx-auto text-center mb-12"
                    >
                        <h1 className="text-4xl font-bold mb-4 bg-gradient-primary bg-clip-text text-transparent">
                            Quick Scalping Signals
                        </h1>
                        <p className="text-muted-foreground mb-8">
                            Fast trading • 15-60 minute targets • 1-3% profits
                        </p>

                        <div className="grid grid-cols-2 gap-6">
                            <button
                                onClick={() => {
                                    setSelectedMarket('CRYPTO');
                                    showInfo('CRYPTO Selected', 'Choose trading type');
                                }}
                                className="p-8 rounded-xl bg-card border border-border hover:border-blue-500 transition-all"
                            >
                                <div className="text-3xl mb-3">₿</div>
                                <h3 className="text-xl font-bold">Cryptocurrency</h3>
                            </button>

                            <button
                                onClick={() => {
                                    setSelectedMarket('FOREX');
                                    showInfo('FOREX Selected', 'Choose trading type');
                                }}
                                className="p-8 rounded-xl bg-card border border-border hover:border-green-500 transition-all"
                            >
                                <div className="text-3xl mb-3">💱</div>
                                <h3 className="text-xl font-bold">Forex / Gold</h3>
                            </button>
                        </div>
                    </motion.div>
                )}

                {/* Type Selection */}
                {selectedMarket && !selectedType && (
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="max-w-2xl mx-auto text-center"
                    >
                        <h2 className="text-2xl font-bold mb-6">
                            {selectedMarket} Scalping
                        </h2>

                        <div className="grid grid-cols-2 gap-6 mb-6">
                            <button
                                onClick={() => {
                                    setSelectedType('SPOT');
                                    setTimeout(generateScalpingSignals, 100);
                                }}
                                className="px-6 py-3 rounded-lg font-bold bg-gradient-primary text-white"
                            >
                                Spot Trading
                            </button>
                            <button
                                onClick={() => {
                                    setSelectedType('FUTURE');
                                    setTimeout(generateScalpingSignals, 100);
                                }}
                                className="px-6 py-3 rounded-lg font-bold bg-gradient-primary text-white"
                            >
                                Futures
                            </button>
                        </div>
                    </motion.div>
                )}

                {/* Signals Display */}
                {selectedMarket && selectedType && (
                    <>
                        {/* Signal Direction Filter */}
                        <div className="mb-6">
                            <SignalDirectionFilter
                                selectedDirections={selectedDirections}
                                onDirectionsChange={setSelectedDirections}
                                signalType={selectedType}
                            />
                        </div>

                        {/* Stats */}
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                            <StatsCard title="Total Signals" value={stats.totalSignals} icon={TrendingUp} />
                            <StatsCard title="Active Signals" value={stats.activeSignals} icon={Activity} />
                            <StatsCard
                                title="Completed"
                                value={stats.completedSignals}
                                icon={Award}
                                trend={{ value: (stats.completedSignals / (stats.totalSignals || 1)) * 100, isPositive: true }}
                            />
                            <StatsCard
                                title="Avg Profit"
                                value={`${stats.avgProfit.toFixed(2)}%`}
                                icon={Target}
                                trend={{ value: stats.avgProfit, isPositive: stats.avgProfit > 0 }}
                            />
                        </div>

                        {/* Generate New Signals Button */}
                        <div className="flex justify-center mb-6">
                            <button
                                onClick={generateScalpingSignals}
                                disabled={isLoading}
                                className="px-8 py-3 bg-gradient-primary text-white rounded-lg font-bold text-lg hover:shadow-lg transition-all disabled:opacity-50 flex items-center gap-2"
                            >
                                <Zap className="w-5 h-5" />
                                {isLoading ? 'Generating...' : 'Generate New Signals'}
                            </button>
                        </div>

                        {/* Loading or Signals List */}
                        {isLoading ? (
                            <div className="text-center py-12">
                                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
                                <p className="text-muted-foreground">Generating scalping signals...</p>
                            </div>
                        ) : (
                            <SignalList signals={filteredSignals} />
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
