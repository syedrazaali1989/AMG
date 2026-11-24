'use client';

import { useEffect, useState } from 'react';
import { Navbar } from '@/components/layout/Navbar';
import { SignalCard } from '@/components/ui/SignalCard';
import { Signal } from '@/lib/signals/types';
import { motion } from 'framer-motion';
import { TrendingUp, Trophy, Target, Zap } from 'lucide-react';

export default function ScalpingCompletedPage() {
    const [completedSignals, setCompletedSignals] = useState<(Signal & { completedAt: string; uniqueKey?: string })[]>([]);
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    useEffect(() => {
        if (!mounted) return;

        // Dedupe by ID, backfill display-only TP levels, sort by completion.
        const normalize = (signals: any[]) => {
            const uniqueSignalsMap = new Map<string, any>();
            signals.forEach((signal: any) => {
                uniqueSignalsMap.set(signal.id, signal);
            });
            const uniqueSignals = Array.from(uniqueSignalsMap.values());
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
                }

                const timestamp = signal.completedAt || new Date().toISOString();
                signal.uniqueKey = `scalping-${signal.id}-${index}-${timestamp.replace(/[:.]/g, '')}`;
                return signal;
            });

            // Sort by completion date
            migratedSignals.sort((a: any, b: any) => {
                const dateA = new Date(a.completedAt || 0).getTime();
                const dateB = new Date(b.completedAt || 0).getTime();
                return dateB - dateA;
            });
            return migratedSignals;
        };

        // Load scalping completed signals from localStorage (this browser only)
        let localSignals: any[] = [];
        const saved = localStorage.getItem('completedSignals');
        if (saved) {
            try {
                const allSignals = JSON.parse(saved);
                localSignals = normalize(allSignals.filter((s: any) => s.isScalping === true));
                setCompletedSignals(localSignals);
            } catch (error) {
                console.error('Error loading scalping signals:', error);
                setCompletedSignals([]);
            }
        }

        // Merge the server-side history (every visitor, recorded on the
        // server): server records win on id conflict; local-only entries
        // are kept. The merged list is shown only - it is never written
        // back to localStorage. A failed fetch leaves local entries alone.
        fetch('/api/history')
            .then(res => (res.ok ? res.json() : null))
            .then(data => {
                const serverSignals = data && Array.isArray(data.signals) ? data.signals : [];
                const scalpingServer = serverSignals.filter(
                    (s: any) => s.engine === 'scalping' || s.isScalping === true
                );
                if (scalpingServer.length === 0) return;
                const merged = new Map<string, any>();
                for (const s of localSignals) merged.set(s.id, s);
                for (const s of scalpingServer) merged.set(s.id, s);
                setCompletedSignals(normalize(Array.from(merged.values())));
            })
            .catch(() => undefined);
    }, [mounted]);

    // Calculate statistics
    const profitableSignals = completedSignals.filter(s => (s.profitLossPercentage || 0) > 0);
    const lossSignals = completedSignals.filter(s => (s.profitLossPercentage || 0) < 0);
    const totalProfit = completedSignals.reduce((sum, s) => sum + (s.profitLossPercentage || 0), 0);
    const avgProfit = completedSignals.length > 0 ? totalProfit / completedSignals.length : 0;
    // Honest win rate: full-TP completions over resolved (TP + SL) signals; EXPIRED excluded
    const winCount = completedSignals.filter(s => s.status === 'COMPLETED').length;
    const lossCount = completedSignals.filter(s => s.status === 'STOPPED').length;
    const winRate = (winCount + lossCount) > 0 ? (winCount / (winCount + lossCount)) * 100 : 0;
    const bestTrade = Math.max(...completedSignals.map(s => s.profitLossPercentage || 0), 0);
    const worstTrade = Math.min(...completedSignals.map(s => s.profitLossPercentage || 0), 0);

    // Group by date
    const groupedByDate = completedSignals.reduce((groups: any, signal) => {
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

    if (!mounted) return null;

    return (
        <div className="min-h-screen bg-background pb-20">
            <Navbar />

            <div className="container mx-auto px-4 py-8">
                {/* Statistics */}
                {completedSignals.length > 0 && (
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8"
                    >
                        <div className="glass-card p-4 rounded-xl">
                            <Trophy className="w-6 h-6 text-yellow-500 mb-2" />
                            <p className="text-sm text-muted-foreground">Total Signals</p>
                            <p className="text-2xl font-bold">{completedSignals.length}</p>
                        </div>

                        <div className="glass-card p-4 rounded-xl">
                            <TrendingUp className="w-6 h-6 text-green-500 mb-2" />
                            <p className="text-sm text-muted-foreground">Profitable</p>
                            <p className="text-2xl font-bold text-green-500">
                                {profitableSignals.length} <span className="text-sm">({winRate.toFixed(1)}%)</span>
                            </p>
                        </div>

                        <div className="glass-card p-4 rounded-xl">
                            <Target className="w-6 h-6 text-blue-500 mb-2" />
                            <p className="text-sm text-muted-foreground">Avg Profit</p>
                            <p className={`text-2xl font-bold ${avgProfit >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                {avgProfit >= 0 ? '+' : ''}{avgProfit.toFixed(2)}%
                            </p>
                        </div>

                        <div className="glass-card p-4 rounded-xl">
                            <Zap className="w-6 h-6 text-purple-500 mb-2" />
                            <p className="text-sm text-muted-foreground">Best Trade</p>
                            <p className="text-2xl font-bold text-green-500">+{bestTrade.toFixed(2)}%</p>
                        </div>
                    </motion.div>
                )}

                {/* Signals Display */}
                {completedSignals.length > 0 ? (
                    <div className="space-y-8">
                        {Object.entries(groupedByDate).map(([date, signals]: [string, any]) => (
                            <div key={date}>
                                <h3 className="text-lg font-semibold mb-4 text-primary/70">{date}</h3>
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                    {signals.map((signal: any) => (
                                        <motion.div
                                            key={signal.uniqueKey}
                                            initial={{ opacity: 0, y: 20 }}
                                            animate={{ opacity: 1, y: 0 }}
                                        >
                                            <SignalCard signal={signal} showChart />
                                        </motion.div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-16">
                        <Zap className="w-16 h-16 mx-auto mb-4 text-muted-foreground opacity-50" />
                        <h3 className="text-xl font-semibold mb-2">No Completed Scalping Signals Yet</h3>
                        <p className="text-muted-foreground">
                            Scalping signals that hit their targets will appear here
                        </p>
                    </motion.div>
                )}
            </div>
        </div>
    );
}
