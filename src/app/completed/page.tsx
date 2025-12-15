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

    // Separate scalping and regular signals from filtered
    const scalpingSignals = filteredSignals.filter((s: any) => s.isScalping === true);
    const regularSignals = filteredSignals.filter((s: any) => s.isScalping !== true);

    // Calculate stats for filtered signals
    const profitableSignals = filteredSignals.filter(s => (s.profitLossPercentage || 0) > 0);
    const totalProfit = filteredSignals.reduce((sum, s) => sum + (s.profitLossPercentage || 0), 0);
    const avgProfit = filteredSignals.length > 0 ? totalProfit / filteredSignals.length : 0;
    const winRate = filteredSignals.length > 0 ? (profitableSignals.length / filteredSignals.length) * 100 : 0;

    // Group scalping signals by date
    const scalpingGroupedByDate = scalpingSignals.reduce((groups: any, signal) => {
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

    // Group regular signals by date
    const regularGroupedByDate = regularSignals.reduce((groups: any, signal) => {
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
                            <span className="text-sm text-muted-foreground">Avg Profit</span>
                        </div>
                        <div className={`text-2xl font-bold ${avgProfit > 0 ? 'text-success' : 'text-danger'}`}>
                            {avgProfit > 0 ? '+' : ''}{avgProfit.toFixed(2)}%
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
                    <div className="space-y-12">
                        {/* Scalping Signals Section */}
                        {scalpingSignals.length > 0 && (
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

                        {/* Regular Signals Section */}
                        {regularSignals.length > 0 && (
                            <div>
                                <div className="flex items-center gap-3 mb-6">
                                    <div className="p-2 rounded-lg bg-primary/10 border border-primary/30">
                                        <Trophy className="w-6 h-6 text-primary" />
                                    </div>
                                    <div>
                                        <h2 className="text-2xl font-bold text-gradient">Regular Signals</h2>
                                        <p className="text-sm text-muted-foreground">Standard trading signals</p>
                                    </div>
                                </div>
                                <div className="space-y-8">
                                    {Object.entries(regularGroupedByDate).map(([date, signals]: [string, any]) => (
                                        <div key={`regular-${date}`}>
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
                            </div>
                        )}
                    </div>
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
