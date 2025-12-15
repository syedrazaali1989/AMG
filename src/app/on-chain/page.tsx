'use client';

import { useEffect, useState, useCallback } from 'react';
import { Navbar } from '@/components/layout/Navbar';
import { SignalList } from '@/components/ui/SignalList';
import { StatsCard } from '@/components/ui/StatsCard';
import { MessageBox, useMessages } from '@/components/ui/MessageBox';
import { Signal, SignalDirection, SignalStatus } from '@/lib/signals/types';
import { SignalDirectionFilter } from '@/components/ui/SignalDirectionFilter';
import { OnChainSignalGenerator } from '@/lib/signals/onChainGenerator';
import { TrendingUp, Target, Activity, Award, Waves } from 'lucide-react';
import { motion } from 'framer-motion';

export default function OnChainPage() {
    const [signals, setSignals] = useState<Signal[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [selectedDirections, setSelectedDirections] = useState<SignalDirection[]>([
        SignalDirection.LONG,
        SignalDirection.SHORT
    ]);
    const { showSuccess, showError, showInfo } = useMessages();

    // Generate signals
    const generateSignals = useCallback(async () => {
        setIsLoading(true);

        try {
            const generatedSignals = await OnChainSignalGenerator.generateOnChainSignals();

            // Smart merge: Keep active signals, add new ones, remove old completed
            setSignals(prevSignals => {
                // Keep active signals from previous
                const activeOldSignals = prevSignals.filter(s =>
                    s.status === SignalStatus.ACTIVE && !s.tp2Hit && !s.tp3Hit
                );

                // Filter out duplicates (same pair + direction)
                const newUniqueSignals = generatedSignals.filter(newSig =>
                    !activeOldSignals.some(oldSig =>
                        oldSig.pair === newSig.pair && oldSig.direction === newSig.direction
                    )
                );

                // Merge: old active + new unique
                return [...activeOldSignals, ...newUniqueSignals];
            });

            setIsLoading(false);

            if (generatedSignals.length > 0) {
                showSuccess(
                    `🐋 Refreshed: ${generatedSignals.length} new signals`,
                    'Active signals preserved'
                );
            } else {
                showInfo('No New Signals', 'Active signals continue...');
            }
        } catch (error) {
            console.error('Error:', error);
            setIsLoading(false);
            showError('Generation Failed', 'Please try again');
        }
    }, []);

    // Auto-refresh every 30 seconds
    useEffect(() => {
        // Initial load
        generateSignals();

        // Set up interval for 30-second refresh
        const interval = setInterval(() => {
            generateSignals();
        }, 30000); // 30 seconds

        return () => clearInterval(interval);
    }, []); // Empty dependency - only run once!

    // Update prices every 10 seconds with REAL Binance data
    const updatePrices = useCallback(async () => {
        if (signals.length === 0) return;

        try {
            // Fetch ALL prices in parallel using Promise.all
            const updatedSignals = await Promise.all(
                signals.map(async (signal) => {
                    try {
                        // Fetch REAL price from Binance API
                        const symbol = signal.pair.replace('/', ''); // BTC/USDT → BTCUSDT
                        const response = await fetch(
                            `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`
                        );

                        let newPrice = signal.currentPrice; // Fallback to current

                        if (response.ok) {
                            const data = await response.json();
                            newPrice = parseFloat(data.price);
                        }

                        // Check TP hits
                        const isLong = signal.direction === SignalDirection.LONG;
                        const tp1Hit = isLong
                            ? newPrice >= signal.takeProfit1!
                            : newPrice <= signal.takeProfit1!;
                        const tp2Hit = isLong
                            ? newPrice >= signal.takeProfit2!
                            : newPrice <= signal.takeProfit2!;
                        const tp3Hit = isLong
                            ? newPrice >= signal.takeProfit3!
                            : newPrice <= signal.takeProfit3!;

                        const profitLoss = isLong
                            ? ((newPrice - signal.entryPrice) / signal.entryPrice) * 100
                            : ((signal.entryPrice - newPrice) / signal.entryPrice) * 100;

                        const updatedSignal = {
                            ...signal,
                            currentPrice: newPrice,
                            tp1Hit: signal.tp1Hit || tp1Hit,
                            tp2Hit: signal.tp2Hit || tp2Hit,
                            tp3Hit: signal.tp3Hit || tp3Hit,
                            profitLossPercentage: profitLoss,
                            status: (tp2Hit || tp3Hit) ? SignalStatus.COMPLETED : signal.status
                        };

                        // Save completed signals
                        if ((tp2Hit || tp3Hit) && signal.status !== SignalStatus.COMPLETED) {
                            const completedSignals = JSON.parse(localStorage.getItem('completedSignals') || '[]');
                            completedSignals.push({
                                ...updatedSignal,
                                completedAt: new Date().toISOString(),
                                tp2HitTime: tp2Hit ? new Date() : signal.tp2HitTime,
                                tp3HitTime: tp3Hit ? new Date() : signal.tp3HitTime
                            });
                            localStorage.setItem('completedSignals', JSON.stringify(completedSignals));

                            showSuccess(
                                `🐋 On-Chain TP Hit: ${signal.pair}`,
                                `Profit: ${profitLoss.toFixed(2)}%`
                            );
                        }

                        return updatedSignal;
                    } catch (error) {
                        console.warn(`Price update failed for ${signal.pair}:`, error);
                        return signal; // Keep unchanged on error
                    }
                })
            );

            // Update state with all new prices at once
            setSignals(updatedSignals);
        } catch (error) {
            console.error('Price update error:', error);
        }
    }, [signals, showSuccess]);

    useEffect(() => {
        if (signals.length === 0) return;

        const interval = setInterval(() => {
            updatePrices();
        }, 10000); // 10 seconds - real Binance prices

        return () => clearInterval(interval);
    }, [signals, showSuccess]); // Only re-run when signals count changes

    // Calculate stats
    const filteredSignals = signals.filter(signal =>
        selectedDirections.includes(signal.direction)
    );

    const stats = {
        totalSignals: filteredSignals.length,
        activeSignals: filteredSignals.filter(s => s.status === 'ACTIVE').length,
        completedSignals: filteredSignals.filter(s => s.tp2Hit || s.tp3Hit).length,
        avgConfidence: filteredSignals.reduce((acc, s) => acc + s.confidence, 0) / (filteredSignals.length || 1)
    };

    return (
        <div className="min-h-screen bg-background">
            <Navbar />

            <div className="container mx-auto px-4 py-8">
                {/* On-Chain Mode Badge */}
                <div className="flex items-center justify-center mb-6">
                    <div className="bg-blue-500/10 border border-blue-500/30 rounded-full px-6 py-3 flex items-center gap-3">
                        <Waves className="w-5 h-5 text-blue-500 animate-pulse" />
                        <span className="text-blue-500 font-bold text-lg">🐋 ON-CHAIN ANALYSIS</span>
                        <span className="text-sm text-muted-foreground">Whale Movements • Technical Indicators</span>
                    </div>
                </div>

                {/* Header */}
                <motion.div
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-center mb-8"
                >
                    <h1 className="text-4xl font-bold mb-4 bg-gradient-primary bg-clip-text text-transparent">
                        On-Chain + Technical Signals
                    </h1>
                    <p className="text-muted-foreground mb-2">
                        High-confidence signals combining whale movements with technical analysis
                    </p>
                    <div className="flex items-center justify-center gap-4 text-sm">
                        <span className="px-3 py-1 rounded-full bg-blue-500/10 text-blue-500">
                            CRYPTO FUTURES Only
                        </span>
                        <span className="px-3 py-1 rounded-full bg-green-500/10 text-green-500">
                            Auto-refresh: 30s
                        </span>
                        <span className="px-3 py-1 rounded-full bg-purple-500/10 text-purple-500">
                            Min Transaction: {'$1M'}
                        </span>
                    </div>
                </motion.div>

                {/* Signal Direction Filter */}
                <div className="mb-6">
                    <SignalDirectionFilter
                        selectedDirections={selectedDirections}
                        onDirectionsChange={setSelectedDirections}
                        signalType="FUTURE"
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
                        title="Avg Confidence"
                        value={`${stats.avgConfidence.toFixed(0)}%`}
                        icon={Target}
                        trend={{ value: stats.avgConfidence, isPositive: stats.avgConfidence >= 75 }}
                    />
                </div>

                {/* Generate Button */}
                <div className="flex justify-center mb-6">
                    <button
                        onClick={generateSignals}
                        disabled={isLoading}
                        className="px-8 py-3 bg-gradient-primary text-white rounded-lg font-bold text-lg hover:shadow-lg transition-all disabled:opacity-50 flex items-center gap-2"
                    >
                        <Waves className="w-5 h-5" />
                        {isLoading ? 'Analyzing...' : 'Refresh Signals'}
                    </button>
                </div>

                {/* Info Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                    <div className="glass rounded-lg p-4">
                        <h3 className="font-semibold mb-2 flex items-center gap-2">
                            <span className="text-2xl">🐋</span>
                            Whale Movements
                        </h3>
                        <p className="text-sm text-muted-foreground">
                            Tracks large transactions ({'>'}$1M) for aggressive 5-12% profit targets
                        </p>
                    </div>
                    <div className="glass rounded-lg p-4">
                        <h3 className="font-semibold mb-2 flex items-center gap-2">
                            <span className="text-2xl">📊</span>
                            Technical Analysis
                        </h3>
                        <p className="text-sm text-muted-foreground">
                            RSI, MACD, and trend analysis for entry/exit timing
                        </p>
                    </div>
                    <div className="glass rounded-lg p-4">
                        <h3 className="font-semibold mb-2 flex items-center gap-2">
                            <span className="text-2xl">💱</span>
                            Exchange Flow
                        </h3>
                        <p className="text-sm text-muted-foreground">
                            Monitors inflow (selling) vs outflow (accumulation)
                        </p>
                    </div>
                </div>

                {/* Loading or Signals List */}
                {isLoading ? (
                    <div className="text-center py-12">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
                        <p className="text-muted-foreground">Analyzing whale movements...</p>
                    </div>
                ) : filteredSignals.length > 0 ? (
                    <SignalList signals={filteredSignals} />
                ) : (
                    <div className="text-center py-12">
                        <Waves className="w-16 h-16 mx-auto mb-4 text-muted-foreground opacity-50" />
                        <h3 className="text-xl font-semibold mb-2">No Signals Yet</h3>
                        <p className="text-muted-foreground">
                            Waiting for significant whale activity...
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
