'use client';

import { useState, useEffect, useCallback } from 'react';
import { Navbar } from '@/components/layout/Navbar';
import { SignalList } from '@/components/ui/SignalList';
import { StatsCard } from '@/components/ui/StatsCard';
import { Signal, SignalStatus } from '@/lib/signals/types';
import { SignalManager } from '@/lib/services/signalManager';
import { SignalCatchup } from '@/lib/services/signalCatchup';
import { SignalGenerator } from '@/lib/signals/generator';
import { fetchBinancePrice } from '@/lib/utils/binancePrices';
import { ScalpingV2Funnel } from '@/lib/signals/scalpingV2';
import { TrendingUp, Activity, Award, Crosshair, RefreshCw } from 'lucide-react';

interface CompletedRecord {
    id: string;
    pair: string;
    direction: string;
    status: string;
    entryPrice: number;
    exitPrice?: number;
    profitLossPercentage?: number;
    tp1Hit?: boolean;
    tp2Hit?: boolean;
    tp3Hit?: boolean;
    completedAt?: string;
    isScalpingV2?: boolean;
}

export default function ScalpingV2Page() {
    const [signals, setSignals] = useState<Signal[]>([]);
    const [history, setHistory] = useState<CompletedRecord[]>([]);
    const [funnel, setFunnel] = useState<ScalpingV2Funnel | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [dataUnavailable, setDataUnavailable] = useState(false);
    const [lastScan, setLastScan] = useState<string | null>(null);

    const loadStored = useCallback(() => {
        setSignals(SignalManager.getActiveSignals('scalpingv2'));
        const completed = SignalManager.getCompletedSignals() as CompletedRecord[];
        setHistory(completed.filter(c => c.isScalpingV2).slice(-50).reverse());
    }, []);

    // Fetch fresh server-side signals and merge them into the local store.
    // One open signal per pair: a pair that already has an active V2
    // signal is not duplicated.
    const fetchSignals = useCallback(async () => {
        setIsLoading(true);
        try {
            const response = await fetch('/api/scalping-v2/signals');
            if (!response.ok) {
                setDataUnavailable(true);
                return;
            }
            const data = await response.json();
            setDataUnavailable(false);
            setFunnel(data.funnel ?? null);
            setLastScan(data.generatedAt ?? null);

            const incoming: Signal[] = (data.signals ?? []).map((s: Signal) => ({
                ...s,
                timestamp: new Date(s.timestamp),
                expiresAt: s.expiresAt ? new Date(s.expiresAt) : undefined
            }));
            const active = SignalManager.getActiveSignals('scalpingv2');
            const activePairs = new Set(active.map(s => s.pair));
            const activeIds = new Set(active.map(s => s.id));
            const fresh = incoming.filter(s => !activePairs.has(s.pair) && !activeIds.has(s.id));
            if (fresh.length > 0) {
                SignalManager.addSignals(fresh, 'scalpingv2');
            }
            loadStored();
        } catch {
            setDataUnavailable(true);
        } finally {
            setIsLoading(false);
        }
    }, [loadStored]);

    // Poll live prices for open V2 signals and apply the shared honest
    // outcome rules (full final TP = COMPLETED, SL = STOPPED, expiry =
    // EXPIRED; TP1/TP2 are milestones only).
    const pollPrices = useCallback(async () => {
        const active = SignalManager.getActiveSignals('scalpingv2');
        for (const signal of active) {
            try {
                const price = await fetchBinancePrice(signal.pair);
                if (!price) continue;
                const updated = SignalGenerator.updateSignal(signal, price);
                if (updated.status !== SignalStatus.ACTIVE) {
                    SignalManager.updateSignal(updated, 'scalpingv2');
                    SignalManager.completeSignal(signal.id, 'scalpingv2');
                } else {
                    SignalManager.updateSignal(updated, 'scalpingv2');
                }
            } catch {
                // Keep last known state on a failed price fetch
            }
        }
        loadStored();
    }, [loadStored]);

    useEffect(() => {
        SignalCatchup.catchupAllSignals()
            .catch(() => { /* catch-up is best-effort */ })
            .finally(() => loadStored());
        fetchSignals();
        const scanInterval = setInterval(fetchSignals, 60 * 1000);
        const priceInterval = setInterval(pollPrices, 30 * 1000);
        return () => {
            clearInterval(scanInterval);
            clearInterval(priceInterval);
        };
    }, [fetchSignals, pollPrices, loadStored]);

    const wins = history.filter(h => h.status === 'COMPLETED').length;
    const losses = history.filter(h => h.status === 'STOPPED').length;
    const winRate = wins + losses > 0 ? (wins / (wins + losses)) * 100 : 0;

    const stats = {
        active: signals.length,
        issuedThisScan: funnel?.issued ?? 0,
        completed: history.length,
        winRate
    };

    return (
        <div className="min-h-screen bg-background">
            <Navbar />
            <div className="container mx-auto px-4 py-8">
                {/* Header */}
                <div className="flex items-center justify-center mb-6">
                    <div className="bg-purple-500/10 border border-purple-500/30 rounded-full px-6 py-3 flex items-center gap-3">
                        <Crosshair className="w-5 h-5 text-purple-400" />
                        <span className="text-purple-300 font-bold text-lg">SCALPING V2</span>
                        <span className="text-sm text-muted-foreground">ICT • Smart Money Concepts • 5m bias / 1m entry</span>
                    </div>
                </div>

                <div className="max-w-3xl mx-auto text-center mb-8">
                    <h1 className="text-4xl font-bold mb-4 bg-gradient-primary bg-clip-text text-transparent">
                        ICT Scalping Signals
                    </h1>
                    <p className="text-muted-foreground">
                        Generated server-side from live Binance candles (54-pair scan, refreshed every minute) -
                        the same signals for every visitor. A signal is issued only at grade A+ (score &ge; 75)
                        or ELITE (score &ge; 88). Targets are a real R ladder: TP1 = 1.5R, TP2 = 3R, final
                        TP3 = 5R (or the swing extreme). TP1/TP2 touches are milestones only - a trade counts
                        as completed only when the final target is reached before the stop loss; setups
                        expire after 4 hours. If live data is unavailable, no signals are shown - signals
                        are never generated from simulated candles. Each signal card shows its 1H price chart
                        with the entry, stop loss and TP1–TP3 levels marked on it.
                    </p>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                    <StatsCard title="Active Signals" value={stats.active} icon={Activity} />
                    <StatsCard title="Issued This Scan" value={stats.issuedThisScan} icon={TrendingUp} />
                    <StatsCard title="Closed (This Browser)" value={stats.completed} icon={Award} />
                    <StatsCard
                        title="Win Rate (Full TP)"
                        value={`${stats.winRate.toFixed(1)}%`}
                        icon={Crosshair}
                        trend={{ value: stats.winRate, isPositive: stats.winRate >= 50 }}
                    />
                </div>

                {/* Scan funnel */}
                {funnel && (
                    <div className="glass rounded-lg p-6 mb-8">
                        <div className="flex items-center justify-between mb-3">
                            <h2 className="text-lg font-bold">Last Scan Funnel</h2>
                            <button
                                onClick={fetchSignals}
                                disabled={isLoading}
                                className="px-4 py-2 rounded-lg font-semibold bg-gradient-primary text-white hover:shadow-lg transition-all disabled:opacity-50 flex items-center gap-2"
                            >
                                <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                                Rescan
                            </button>
                        </div>
                        <p className="text-sm text-muted-foreground mb-3">
                            {funnel.pairsRequested} pairs requested • {funnel.pairsLoaded} loaded with fresh candles •{' '}
                            {funnel.pairsStale} rejected as stale • {funnel.pairsFailed} failed to load
                            {lastScan ? ` • scan at ${new Date(lastScan).toLocaleTimeString()}` : ''}
                        </p>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                            <div>Ranging market: <b>{funnel.ranging}</b></div>
                            <div>No daily bias: <b>{funnel.noBias}</b></div>
                            <div>No fresh 1m break: <b>{funnel.noLtfBreak}</b></div>
                            <div>Wrong premium/discount zone: <b>{funnel.wrongZone}</b></div>
                            <div>Confluences &lt; 2: <b>{funnel.confluence}</b></div>
                            <div>Scored below A+: <b>{funnel.belowGrade}</b></div>
                            <div>Issued: <b>{funnel.issued}</b></div>
                        </div>
                        {funnel.topScores.length > 0 && (
                            <p className="text-sm text-muted-foreground mt-3">
                                Top scores this scan:{' '}
                                {funnel.topScores.map(t => `${t.pair} ${t.score} (${t.grade})`).join(' • ')}
                            </p>
                        )}
                    </div>
                )}

                {/* Signals */}
                {dataUnavailable ? (
                    <div className="glass rounded-lg p-12 text-center mb-8">
                        <div className="space-y-4">
                            <div className="text-2xl font-bold text-danger">Live Data Unavailable</div>
                            <div className="text-muted-foreground">
                                Live market data could not be loaded, so no signals are shown.
                                Signals are never generated from simulated prices - please try again shortly.
                            </div>
                        </div>
                    </div>
                ) : isLoading && signals.length === 0 ? (
                    <div className="text-center py-12">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-400 mx-auto mb-4"></div>
                        <p className="text-muted-foreground">Scanning 54 pairs...</p>
                    </div>
                ) : signals.length === 0 ? (
                    <div className="glass rounded-lg p-12 text-center mb-8">
                        <div className="text-xl font-bold mb-2">No A+ / ELITE setups right now</div>
                        <div className="text-muted-foreground">
                            The scan ran on live data (see the funnel above) but no pair passed every gate
                            at grade A+ or higher. The scan repeats every minute.
                        </div>
                    </div>
                ) : (
                    <div className="mb-8">
                        <SignalList signals={signals} showCharts />
                    </div>
                )}

                {/* History (this browser) */}
                {history.length > 0 && (
                    <div className="glass rounded-lg p-6">
                        <h2 className="text-lg font-bold mb-4">Closed Signals (this browser)</h2>
                        <p className="text-sm text-muted-foreground mb-4">
                            Completed = final target (TP3) reached before the stop loss. TP1/TP2 are shown as
                            milestones only and never complete a trade. Expired setups closed at the last price
                            after 4 hours and are excluded from the win rate.
                        </p>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="text-left text-muted-foreground border-b border-border">
                                        <th className="py-2 pr-4">Pair</th>
                                        <th className="py-2 pr-4">Direction</th>
                                        <th className="py-2 pr-4">Result</th>
                                        <th className="py-2 pr-4">Entry</th>
                                        <th className="py-2 pr-4">Exit</th>
                                        <th className="py-2 pr-4">Realised P/L</th>
                                        <th className="py-2">Milestones</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {history.map(h => (
                                        <tr key={h.id} className="border-b border-border/50">
                                            <td className="py-2 pr-4 font-semibold">{h.pair}</td>
                                            <td className="py-2 pr-4">{h.direction}</td>
                                            <td className="py-2 pr-4">
                                                <span className={
                                                    h.status === 'COMPLETED' ? 'text-success'
                                                        : h.status === 'STOPPED' ? 'text-danger'
                                                            : 'text-muted-foreground'
                                                }>
                                                    {h.status}
                                                </span>
                                            </td>
                                            <td className="py-2 pr-4">{h.entryPrice}</td>
                                            <td className="py-2 pr-4">{h.exitPrice ?? '-'}</td>
                                            <td className="py-2 pr-4">
                                                {h.profitLossPercentage !== undefined
                                                    ? `${h.profitLossPercentage >= 0 ? '+' : ''}${h.profitLossPercentage.toFixed(2)}%`
                                                    : '-'}
                                            </td>
                                            <td className="py-2">
                                                {[h.tp1Hit ? 'TP1' : null, h.tp2Hit ? 'TP2' : null, h.tp3Hit ? 'TP3' : null]
                                                    .filter(Boolean).join(', ') || '-'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
