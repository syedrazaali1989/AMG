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
import { TrendingUp, Activity, Award, Coins, RefreshCw } from 'lucide-react';

// The gold engine prices on PAXG/USDT (Binance spot). Signal cards show
// the display pair 'XAU/USD (PAXG)'; live prices for monitoring are
// always fetched for the real instrument pair.
const GOLD_DATA_PAIR = 'PAXG/USDT';

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
    isGold?: boolean;
}

export default function GoldPage() {
    const [signals, setSignals] = useState<Signal[]>([]);
    const [history, setHistory] = useState<CompletedRecord[]>([]);
    const [livePrice, setLivePrice] = useState<number | null>(null);
    const [issuedThisScan, setIssuedThisScan] = useState(0);
    const [isLoading, setIsLoading] = useState(false);
    const [dataUnavailable, setDataUnavailable] = useState(false);
    const [lastScan, setLastScan] = useState<string | null>(null);

    const loadStored = useCallback(() => {
        setSignals(SignalManager.getActiveSignals('gold'));
        const completed = SignalManager.getCompletedSignals() as CompletedRecord[];
        setHistory(completed.filter(c => c.isGold).slice(-50).reverse());
    }, []);

    // Fetch the fresh server-side evaluation and merge it into the
    // local store. One open gold signal at a time: a signal that is
    // already active (same pair / same bar) is not duplicated.
    const fetchSignals = useCallback(async () => {
        setIsLoading(true);
        try {
            const response = await fetch('/api/gold/signals');
            if (!response.ok) {
                setDataUnavailable(true);
                return;
            }
            const data = await response.json();
            setDataUnavailable(false);
            setIssuedThisScan(data.issued ? 1 : 0);
            if (typeof data.price === 'number') setLivePrice(data.price);
            setLastScan(data.generatedAt ?? null);

            const incoming: Signal[] = (data.signals ?? []).map((s: Signal) => ({
                ...s,
                timestamp: new Date(s.timestamp),
                expiresAt: s.expiresAt ? new Date(s.expiresAt) : undefined
            }));
            const active = SignalManager.getActiveSignals('gold');
            const activePairs = new Set(active.map(s => s.pair));
            const activeIds = new Set(active.map(s => s.id));
            const fresh = incoming.filter(s => !activePairs.has(s.pair) && !activeIds.has(s.id));
            if (fresh.length > 0) {
                SignalManager.addSignals(fresh, 'gold');
            }
            loadStored();
        } catch {
            setDataUnavailable(true);
        } finally {
            setIsLoading(false);
        }
    }, [loadStored]);

    // Poll the live PAXG price for the open gold signal and apply the
    // shared honest outcome rules (full final TP = COMPLETED, SL =
    // STOPPED, expiry = EXPIRED; TP1/TP2/TP3 are milestones only).
    const pollPrices = useCallback(async () => {
        const active = SignalManager.getActiveSignals('gold');
        for (const signal of active) {
            try {
                const price = await fetchBinancePrice(GOLD_DATA_PAIR);
                if (!price) continue;
                setLivePrice(price);
                const updated = SignalGenerator.updateSignal(signal, price);
                if (updated.status !== SignalStatus.ACTIVE) {
                    SignalManager.updateSignal(updated, 'gold');
                    SignalManager.completeSignal(signal.id, 'gold');
                } else {
                    SignalManager.updateSignal(updated, 'gold');
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
        issuedThisScan,
        completed: history.length,
        winRate
    };

    return (
        <div className="min-h-screen bg-background">
            <Navbar />
            <div className="container mx-auto px-4 py-8">
                {/* Stats */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                    <StatsCard title="Active Signals" value={stats.active} icon={Activity} />
                    <StatsCard title="Issued This Scan" value={stats.issuedThisScan} icon={TrendingUp} />
                    <StatsCard title="Closed (This Browser)" value={stats.completed} icon={Award} />
                    <StatsCard
                        title="Win Rate (Full TP)"
                        value={`${stats.winRate.toFixed(1)}%`}
                        icon={Coins}
                        trend={{ value: stats.winRate, isPositive: stats.winRate >= 50 }}
                    />
                </div>

                {/* Last scan */}
                <div className="glass rounded-lg p-6 mb-8">
                    <div className="flex items-center justify-between mb-3">
                        <h2 className="text-lg font-bold">Last Scan</h2>
                        <button
                            onClick={fetchSignals}
                            disabled={isLoading}
                            className="px-4 py-2 rounded-lg font-semibold bg-gradient-primary text-white hover:shadow-lg transition-all disabled:opacity-50 flex items-center gap-2"
                        >
                            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                            Rescan
                        </button>
                    </div>
                    <p className="text-sm text-muted-foreground">
                        Instrument: <b>PAXG/USDT</b> (tokenised gold, Binance spot)
                        {livePrice !== null ? <> • live price <b>${livePrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b></> : ''}
                        {lastScan ? <> • scan at {new Date(lastScan).toLocaleTimeString()}</> : ''}
                        <> • engine decision this scan: <b>{issuedThisScan > 0 ? 'signal issued' : 'no signal'}</b></>
                    </p>
                </div>

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
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-yellow-400 mx-auto mb-4"></div>
                        <p className="text-muted-foreground">Evaluating gold...</p>
                    </div>
                ) : signals.length === 0 ? (
                    <div className="glass rounded-lg p-12 text-center mb-8">
                        <div className="text-xl font-bold mb-2">No gold signal right now</div>
                        <div className="text-muted-foreground">
                            The engine ran on live data (see the scan above) but the current setup does not
                            pass its score and trend filters, or the market is outside its London / New York
                            trading hours (07:00–21:00 UTC). The scan repeats every minute.
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
                            Completed = full take profit reached before the stop loss. TP1/TP2/TP3 are shown as
                            milestones only and never complete a trade. Expired setups closed at the last price
                            after 72 hours and are excluded from the win rate.
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
