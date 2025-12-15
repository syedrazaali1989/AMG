'use client';

import { useEffect, useState } from 'react';
import { Navbar } from '@/components/layout/Navbar';
import { SignalCard } from '@/components/ui/SignalCard';
import { Signal } from '@/lib/signals/types';
import { motion } from 'framer-motion';
import { TrendingUp, Trophy, Target, Waves, Bitcoin } from 'lucide-react';

export default function OnChainCompletedPage() {
    const [completedSignals, setCompletedSignals] = useState<(Signal & { completedAt: string; uniqueKey?: string })[]>([]);
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    useEffect(() => {
        if (!mounted) return;

        // Load on-chain completed signals from localStorage
        const saved = localStorage.getItem('completedSignals');
        if (saved) {
            try {
                const allSignals = JSON.parse(saved);

                // Filter ONLY on-chain signals (BTC + correlated)
                const onChainSignals = allSignals.filter((s: any) =>
                    s.id.startsWith('ONCHAIN') || s.id.startsWith('CORR')
                );

                // Deduplicate by ID
                const uniqueSignalsMap = new Map<string, any>();
                onChainSignals.forEach((signal: any) => {
                    uniqueSignalsMap.set(signal.id, signal);
                });

                const uniqueSignals = Array.from(uniqueSignalsMap.values());

                // Add unique keys and migrate TPs
                const migratedSignals = uniqueSignals.map((signal: any, index: number) => {
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

                    const timestamp = signal.completedAt || new Date().toISOString();
                    signal.uniqueKey = `onchain-${signal.id}-${index}-${timestamp.replace(/[:.]/g, '')}`;
                    return signal;
                });

                // Sort by completion date
                migratedSignals.sort((a: any, b: any) => {
                    const dateA = new Date(a.completedAt || 0).getTime();
                    const dateB = new Date(b.completedAt || 0).getTime();
                    return dateB - dateA;
                });

                setCompletedSignals(migratedSignals);
            } catch (error) {
                console.error('Error loading on-chain signals:', error);
                setCompletedSignals([]);
            }
        }
    }, [mounted]);

    // Separate BTC and altcoin signals
    const btcSignals = completedSignals.filter(s => s.pair === 'BTC/USDT');
    const altcoinSignals = completedSignals.filter(s => s.pair !== 'BTC/USDT');

    // Calculate statistics
    const profitableSignals = completedSignals.filter(s => (s.profitLossPercentage || 0) > 0);
    const totalProfit = completedSignals.reduce((sum, s) => sum + (s.profitLossPercentage || 0), 0);
    const avgProfit = completedSignals.length > 0 ? totalProfit / completedSignals.length : 0;
    const winRate = completedSignals.length > 0 ? (profitableSignals.length / completedSignals.length) * 100 : 0;

    // BTC vs Altcoin stats
    const btcProfitable = btcSignals.filter(s => (s.profitLossPercentage || 0) > 0);
    const btcWinRate = btcSignals.length > 0 ? (btcProfitable.length / btcSignals.length) * 100 : 0;
    const altcoinProfitable = altcoinSignals.filter(s => (s.profitLossPercentage || 0) > 0);
    const altcoinWinRate = altcoinSignals.length > 0 ? (altcoinProfitable.length / altcoinSignals.length) * 100 : 0;

    const bestTrade = Math.max(...completedSignals.map(s => s.profitLossPercentage || 0), 0);

    // Group by coin
    const groupedByCoin = completedSignals.reduce((groups: any, signal) => {
        const coin = signal.pair.split('/')[0];
        if (!groups[coin]) {
            groups[coin] = [];
        }
        groups[coin].push(signal);
        return groups;
    }, {});

    if (!mounted) return null;

    return (
        <div className="min-h-screen bg-background pb-20">
            <Navbar />

            <div className="container mx-auto px-4 py-8">
                {/* Header */}
                <motion.div
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mb-8"
                >
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-3 rounded-lg bg-orange-500/10 border border-orange-500/30">
                            <Waves className="w-8 h-8 text-orange-500" />
                        </div>
                        <div>
                            <h1 className="text-4xl font-bold text-gradient">On-Chain Completed Signals</h1>
                            <p className="text-muted-foreground">Whale-backed trading results</p>
                        </div>
                    </div>
                </motion.div>

                {/* Statistics */}
                {completedSignals.length > 0 && (
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8"
                    >
                        <div className="glass-card p-4 rounded-xl">
                            <Trophy className="w-6 h-6 text-yellow-500 mb-2" />
                            <p className="text-sm text-muted-foreground">Total Signals</p>
                            <p className="text-2xl font-bold">{completedSignals.length}</p>
                        </div>

                        <div className="glass-card p-4 rounded-xl">
                            <TrendingUp className="w-6 h-6 text-green-500 mb-2" />
                            <p className="text-sm text-muted-foreground">Win Rate</p>
                            <p className="text-2xl font-bold text-green-500">{winRate.toFixed(1)}%</p>
                        </div>

                        <div className="glass-card p-4 rounded-xl">
                            <Target className="w-6 h-6 text-blue-500 mb-2" />
                            <p className="text-sm text-muted-foreground">Avg Profit</p>
                            <p className={`text-2xl font-bold ${avgProfit >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                {avgProfit >= 0 ? '+' : ''}{avgProfit.toFixed(2)}%
                            </p>
                        </div>

                        <div className="glass-card p-4 rounded-xl">
                            <Bitcoin className="w-6 h-6 text-orange-500 mb-2" />
                            <p className="text-sm text-muted-foreground">BTC Win Rate</p>
                            <p className="text-2xl font-bold text-orange-500">{btcWinRate.toFixed(1)}%</p>
                        </div>

                        <div className="glass-card p-4 rounded-xl">
                            <Waves className="w-6 h-6 text-purple-500 mb-2" />
                            <p className="text-sm text-muted-foreground">Altcoin Win Rate</p>
                            <p className="text-2xl font-bold text-purple-500">{altcoinWinRate.toFixed(1)}%</p>
                        </div>
                    </motion.div>
                )}

                {/* Signals Display - Grouped by Coin */}
                {completedSignals.length > 0 ? (
                    <div className="space-y-8">
                        {Object.entries(groupedByCoin).map(([coin, signals]: [string, any]) => (
                            <div key={coin}>
                                <div className="flex items-center gap-2 mb-4">
                                    {coin === 'BTC' ? (
                                        <Bitcoin className="w-6 h-6 text-orange-500" />
                                    ) : (
                                        <Waves className="w-6 h-6 text-primary" />
                                    )}
                                    <h3 className="text-lg font-semibold text-primary/70">
                                        {coin}/USDT ({signals.length} signals)
                                    </h3>
                                </div>
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
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-16">
                        <Waves className="w-16 h-16 mx-auto mb-4 text-muted-foreground opacity-50" />
                        <h3 className="text-xl font-semibold mb-2">No Completed On-Chain Signals Yet</h3>
                        <p className="text-muted-foreground">
                            Whale-backed signals that hit their targets will appear here
                        </p>
                    </motion.div>
                )}
            </div>
        </div>
    );
}
