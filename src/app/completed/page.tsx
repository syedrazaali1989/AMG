'use client';

import { useEffect, useState } from 'react';
import { Navbar } from '@/components/layout/Navbar';
import { SignalCard } from '@/components/ui/SignalCard';
import { Signal } from '@/lib/signals/types';
import { motion } from 'framer-motion';
import { TrendingUp, Trophy, Target } from 'lucide-react';

export default function CompletedSignalsPage() {
    const [completedSignals, setCompletedSignals] = useState<(Signal & { completedAt: string; uniqueKey?: string })[]>([]);
    const [mounted, setMounted] = useState(false);
    const [activeFilter, setActiveFilter] = useState<'all' | 'standard' | 'scalping' | 'onchain'>('all');

    useEffect(() => {
        setMounted(true);
    }, []);

    useEffect(() => {
        if (!mounted) return;

        // Load completed signals from localStorage
        const saved = localStorage.getItem('completedSignals');
        if (saved) {
            try {
                const signals = JSON.parse(saved);

                // Deduplicate signals by ID using Map
                const uniqueSignalsMap = new Map<string, any>();
                signals.forEach((signal: any) => {
                    uniqueSignalsMap.set(signal.id, signal);
                });

                // Convert Map back to array
                const uniqueSignals = Array.from(uniqueSignalsMap.values());

                // Migrate and add unique keys
                const migratedSignals = uniqueSignals.map((signal: any, index: number) => {
                    // Migrate partial TPs if missing
                    if (!signal.takeProfit1 || !signal.takeProfit2 || !signal.takeProfit3) {
                        const isBuyOrLong = signal.direction === 'BUY' || signal.direction === 'LONG';
                        if (isBuyOrLong) {
                            const tpDistance = signal.takeProfit - signal.entryPrice;
                            signal.takeProfit1 = signal.entryPrice + (tpDistance * 0.30);
                            signal.takeProfit2 = signal.entryPrice + (tpDistance * 0.60);
                            signal.takeProfit3 = signal.takeProfit;
                        } else {
                            const tpDistance = signal.entryPrice - signal.takeProfit;
                            signal.takeProfit1 = signal.entryPrice - (tpDistance * 0.30);
                            signal.takeProfit2 = signal.entryPrice - (tpDistance * 0.60);
                            signal.takeProfit3 = signal.takeProfit;
                        }
                        signal.tp1Hit = true;
                        signal.tp2Hit = true;
                        signal.tp3Hit = true;
                    }

                    // Migrate missing TP1 hit time (if TP1 was hit but no time recorded)
                    if (signal.tp1Hit && !signal.tp1HitTime) {
                        // Estimate TP1 time based on completion time or TP2 time
                        if (signal.tp2HitTime) {
                            // TP1 was hit before TP2, estimate ~30 seconds earlier
                            const tp2Time = new Date(signal.tp2HitTime);
                            signal.tp1HitTime = new Date(tp2Time.getTime() - 30000); // 30 seconds before TP2
                        } else if (signal.completedAt) {
                            // Estimate TP1 as ~1 minute before completion
                            const completedTime = new Date(signal.completedAt);
                            signal.tp1HitTime = new Date(completedTime.getTime() - 60000); // 1 minute before completion
                        }
                    }

                    // Generate unique key (deterministic to avoid hydration mismatch)
                    const timestamp = signal.completedAt || new Date().toISOString();
                    signal.uniqueKey = `signal-${signal.id}-${index}-${timestamp.replace(/[:.]/g, '')}`;

                    return signal;
                });

                // Sort by completion date
                migratedSignals.sort((a: any, b: any) => {
                    const dateA = new Date(a.completedAt || 0).getTime();
                    const dateB = new Date(b.completedAt || 0).getTime();
                    return dateB - dateA;
                });

                setCompletedSignals(migratedSignals);
                localStorage.setItem('completedSignals', JSON.stringify(migratedSignals));
            } catch (error) {
                console.error('Error loading completed signals:', error);
                setCompletedSignals([]);
            }
        }
    }, [mounted]);

    // Filter signals based on active filter
    const filteredSignals = activeFilter === 'scalping'
        ? completedSignals.filter((s: any) => s.isScalping === true)
        : activeFilter === 'onchain'
            ? completedSignals.filter((s: any) => s.id.startsWith('ONCHAIN') || s.id.startsWith('CORR'))
            : activeFilter === 'standard'
                ? completedSignals.filter((s: any) =>
                    s.isScalping !== true &&
                    !s.id.startsWith('ONCHAIN') &&
                    !s.id.startsWith('CORR')
                )
                : completedSignals;

    // Separate signals by type for 'All' filter
    const standardSignals = filteredSignals.filter((s: any) =>
        s.isScalping !== true &&
        !s.id.startsWith('ONCHAIN') &&
        !s.id.startsWith('CORR')
    );
    const scalpingSignals = filteredSignals.filter((s: any) => s.isScalping === true);
    const onchainSignals = filteredSignals.filter((s: any) =>
        s.id.startsWith('ONCHAIN') || s.id.startsWith('CORR')
    );

    // Group signals by date for each type
    const groupByDate = (signals: any[]) => {
        return signals.reduce((groups: any, signal) => {
            const date = new Date(signal.completedAt).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });
            if (!groups[date]) {
                groups[date] = [];
            }
            groups[date].push(signal);
            return groups;
        }, {});
    };

    const standardGroupedByDate = groupByDate(standardSignals);
    const scalpingGroupedByDate = groupByDate(scalpingSignals);
    const onchainGroupedByDate = groupByDate(onchainSignals);

    // Calculate stats for filtered signals
    const profitableSignals = filteredSignals.filter(s => (s.profitLossPercentage || 0) > 0);
    const totalProfit = filteredSignals.reduce((sum, s) => sum + (s.profitLossPercentage || 0), 0);
    const avgProfit = filteredSignals.length > 0 ? totalProfit / filteredSignals.length : 0;
    const winRate = filteredSignals.length > 0 ? (profitableSignals.length / filteredSignals.length) * 100 : 0;

    if (!mounted) {
        return null; // Prevent hydration mismatch
    }

    return (
        <div className="min-h-screen bg-background">
            <Navbar />

            <div className="container mx-auto px-4 py-8">
                <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-3 rounded-xl bg-gradient-primary">
                            <Trophy className="w-8 h-8 text-white" />
                        </div>
                        <div>
                            <h1 className="text-4xl font-bold text-gradient">Completed Signals</h1>
                            <p className="text-muted-foreground">Signals that hit Take Profit targets</p>
                        </div>
                    </div>
                </motion.div>

                {/* Stats Cards */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
                    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="glass rounded-lg p-4">
                        <div className="flex items-center gap-2 mb-2">
                            <Target className="w-4 h-4 text-primary" />
                            <span className="text-sm text-muted-foreground">Total Completed</span>
                        </div>
                        <div className="text-2xl font-bold">{filteredSignals.length}</div>
                    </motion.div>

                    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="glass rounded-lg p-4">
                        <div className="flex items-center gap-2 mb-2">
                            <TrendingUp className="w-4 h-4 text-success" />
                            <span className="text-sm text-muted-foreground">Profitable</span>
                        </div>
                        <div className="text-2xl font-bold text-success">{profitableSignals.length}</div>
                    </motion.div>

                    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="glass rounded-lg p-4">
                        <div className="flex items-center gap-2 mb-2">
                            <Trophy className="w-4 h-4 text-primary" />
                            <span className="text-sm text-muted-foreground">Win Rate</span>
                        </div>
                        <div className="text-2xl font-bold">{winRate.toFixed(1)}%</div>
                    </motion.div>

                    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="glass rounded-lg p-4">
                        <div className="flex items-center gap-2 mb-2">
                            <TrendingUp className="w-4 h-4 text-primary" />
                            <span className="text-sm text-muted-foreground">Total Profit</span>
                        </div>
                        <div className={`text-2xl font-bold ${totalProfit > 0 ? 'text-success' : 'text-danger'}`}>
                            {totalProfit > 0 ? '+' : ''}{totalProfit.toFixed(2)}%
                        </div>
                    </motion.div>
                </div>

                {/* Filter Buttons */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.5 }}
                    className="flex flex-wrap gap-3 mb-8"
                >
                    {/* All Button */}
                    <button
                        onClick={() => setActiveFilter('all')}
                        className={`px-6 py-3 rounded-lg font-semibold transition-all ${activeFilter === 'all'
                            ? 'bg-primary text-primary-foreground shadow-lg scale-105'
                            : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                            }`}
                    >
                        <Trophy className="w-4 h-4 inline mr-2" />
                        All
                    </button>

                    {/* Standard Button */}
                    <button
                        onClick={() => setActiveFilter('standard')}
                        className={`px-6 py-3 rounded-lg font-semibold transition-all ${activeFilter === 'standard'
                            ? 'bg-blue-500 text-white shadow-lg scale-105'
                            : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                            }`}
                    >
                        <TrendingUp className="w-4 h-4 inline mr-2" />
                        Standard
                    </button>

                    {/* Scalping Button */}
                    <button
                        onClick={() => setActiveFilter('scalping')}
                        className={`px-6 py-3 rounded-lg font-semibold transition-all ${activeFilter === 'scalping'
                            ? 'bg-green-500 text-white shadow-lg scale-105'
                            : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                            }`}
                    >
                        <Target className="w-4 h-4 inline mr-2" />
                        Scalping
                    </button>

                    {/* On-Chain Button */}
                    <button
                        onClick={() => setActiveFilter('onchain')}
                        className={`px-6 py-3 rounded-lg font-semibold transition-all ${activeFilter === 'onchain'
                            ? 'bg-orange-500 text-white shadow-lg scale-105'
                            : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                            }`}
                    >
                        <TrendingUp className="w-4 h-4 inline mr-2" />
                        On-Chain
                    </button>
                </motion.div>

                {/* Signals Sections */}
                {/* Signals Display */}
                {filteredSignals.length > 0 ? (
                    activeFilter === 'all' ? (
                        // For 'All' filter: Show all signals mixed by date without section headings
                        <div className="space-y-8">
                            {Object.entries(groupByDate(filteredSignals)).map(([date, signals]: [string, any]) => (
                                <div key={`all-${date}`}>
                                    <h3 className="text-lg font-semibold mb-4 text-primary/70">{date}</h3>
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                        {signals.map((signal: any) => (
                                            <motion.div
                                                key={signal.uniqueKey}
                                                initial={{ opacity: 0, y: 20 }}
                                                animate={{ opacity: 1, y: 0 }}
                                            >
                                                <SignalCard signal={signal} />
                                            </motion.div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        // For specific filters: Show with section headings
                        <div className="space-y-12">
                            {/* Standard Signals Section */}
                            {activeFilter === 'standard' && standardSignals.length > 0 && (
                                <div>
                                    <div className="flex items-center gap-3 mb-6">
                                        <div className="p-2 rounded-lg bg-blue-500/10 border border-blue-500/30">
                                            <TrendingUp className="w-6 h-6 text-blue-500" />
                                        </div>
                                        <div>
                                            <h2 className="text-2xl font-bold text-blue-500">Standard Signals</h2>
                                            <p className="text-sm text-muted-foreground">Medium-term trading signals</p>
                                        </div>
                                    </div>
                                    <div className="space-y-8">
                                        {Object.entries(standardGroupedByDate).map(([date, signals]: [string, any]) => (
                                            <div key={`standard-${date}`}>
                                                <h3 className="text-lg font-semibold mb-4 text-blue-500/70">{date}</h3>
                                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                                    {signals.map((signal: any) => (
                                                        <motion.div
                                                            key={signal.uniqueKey}
                                                            initial={{ opacity: 0, y: 20 }}
                                                            animate={{ opacity: 1, y: 0 }}
                                                        >
                                                            <SignalCard signal={signal} />
                                                        </motion.div>
                                                    ))}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Scalping Signals Section */}
                            {activeFilter === 'scalping' && scalpingSignals.length > 0 && (
                                <div>
                                    <div className="flex items-center gap-3 mb-6">
                                        <div className="p-2 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
                                            <span className="text-2xl">⚡</span>
                                        </div>
                                        <div>
                                            <h2 className="text-2xl font-bold text-yellow-500">Scalping Signals</h2>
                                            <p className="text-sm text-muted-foreground">Quick profit targets (1-3%)</p>
                                        </div>
                                    </div>
                                    <div className="space-y-8">
                                        {Object.entries(scalpingGroupedByDate).map(([date, signals]: [string, any]) => (
                                            <div key={`scalping-${date}`}>
                                                <h3 className="text-lg font-semibold mb-4 text-yellow-500/70">{date}</h3>
                                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                                    {signals.map((signal: any) => (
                                                        <motion.div
                                                            key={signal.uniqueKey}
                                                            initial={{ opacity: 0, y: 20 }}
                                                            animate={{ opacity: 1, y: 0 }}
                                                        >
                                                            <SignalCard signal={signal} />
                                                        </motion.div>
                                                    ))}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* On-Chain Signals Section */}
                            {activeFilter === 'onchain' && onchainSignals.length > 0 && (
                                <div>
                                    <div className="flex items-center gap-3 mb-6">
                                        <div className="p-2 rounded-lg bg-orange-500/10 border border-orange-500/30">
                                            <Trophy className="w-6 h-6 text-orange-500" />
                                        </div>
                                        <div>
                                            <h2 className="text-2xl font-bold text-orange-500">On-Chain Signals</h2>
                                            <p className="text-sm text-muted-foreground">Whale movement signals</p>
                                        </div>
                                    </div>
                                    <div className="space-y-8">
                                        {Object.entries(onchainGroupedByDate).map(([date, signals]: [string, any]) => (
                                            <div key={`onchain-${date}`}>
                                                <h3 className="text-lg font-semibold mb-4 text-orange-500/70">{date}</h3>
                                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                                    {signals.map((signal: any) => (
                                                        <motion.div
                                                            key={signal.uniqueKey}
                                                            initial={{ opacity: 0, y: 20 }}
                                                            animate={{ opacity: 1, y: 0 }}
                                                        >
                                                            <SignalCard signal={signal} />
                                                        </motion.div>
                                                    ))}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )
                ) : (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-16">
                        <Trophy className="w-16 h-16 mx-auto mb-4 text-muted-foreground opacity-50" />
                        <h3 className="text-xl font-semibold mb-2">No Completed Signals Yet</h3>
                        <p className="text-muted-foreground">
                            Signals that hit their Take Profit targets will appear here
                        </p>
                    </motion.div>
                )}
            </div>
        </div>
    );
}
