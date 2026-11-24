'use client';

import { useState, useEffect, useCallback } from 'react';
import { Navbar } from '@/components/layout/Navbar';
import { SignalList } from '@/components/ui/SignalList';
import { StatsCard } from '@/components/ui/StatsCard';
import { Signal, SignalDirection } from '@/lib/signals/types';
import { SignalDirectionFilter } from '@/components/ui/SignalDirectionFilter';
import { TrendingUp, Target, Activity, Award, RefreshCw } from 'lucide-react';

/**
 * Scalping page (5m candles, 15-60 minute targets).
 *
 * Signals are generated SERVER-SIDE by /api/scalping/signals from live
 * Binance data, so every visitor sees the same signals for the same
 * market state. Futures only, crypto only: there is no spot path and
 * no forex path (forex scalping had no live 5m data source - its
 * prices were simulated). The scan repeats every 60 seconds.
 */
export default function ScalpingPage() {
    const [signals, setSignals] = useState<Signal[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [dataUnavailable, setDataUnavailable] = useState(false);
    const [lastScan, setLastScan] = useState<string | null>(null);
    const [pairsScanned, setPairsScanned] = useState<number | null>(null);
    const [selectedDirections, setSelectedDirections] = useState<SignalDirection[]>([
        SignalDirection.LONG,
        SignalDirection.SHORT
    ]);

    const fetchSignals = useCallback(async () => {
        setIsLoading(true);
        try {
            const response = await fetch('/api/scalping/signals');
            if (!response.ok) {
                setDataUnavailable(true);
                return;
            }
            const data = await response.json();
            setDataUnavailable(false);
            setLastScan(data.generatedAt ?? null);
            setPairsScanned(typeof data.pairsScanned === 'number' ? data.pairsScanned : null);
            const incoming: Signal[] = (data.signals ?? []).map((s: Signal) => ({
                ...s,
                timestamp: new Date(s.timestamp),
                expiresAt: s.expiresAt ? new Date(s.expiresAt) : undefined
            }));
            setSignals(incoming);
        } catch {
            setDataUnavailable(true);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchSignals();
        const interval = setInterval(fetchSignals, 60 * 1000);
        return () => clearInterval(interval);
    }, [fetchSignals]);

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
                {/* Signal Direction Filter */}
                <div className="mb-6">
                    <SignalDirectionFilter
                        selectedDirections={selectedDirections}
                        onDirectionsChange={setSelectedDirections}
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

                {/* Rescan */}
                <div className="flex items-center justify-between mb-6">
                    <p className="text-sm text-muted-foreground">
                        {pairsScanned !== null ? `${pairsScanned} pairs scanned` : ''}
                        {lastScan ? ` • scan at ${new Date(lastScan).toLocaleTimeString()}` : ''}
                    </p>
                    <button
                        onClick={fetchSignals}
                        disabled={isLoading}
                        className="px-4 py-2 rounded-lg font-semibold bg-gradient-primary text-white hover:shadow-lg transition-all disabled:opacity-50 flex items-center gap-2"
                    >
                        <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                        Rescan
                    </button>
                </div>

                {/* Loading or Signals List */}
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
                ) : isLoading && signals.length === 0 ? (
                    <div className="text-center py-12">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
                        <p className="text-muted-foreground">Scanning pairs...</p>
                    </div>
                ) : signals.length === 0 ? (
                    <div className="glass rounded-lg p-12 text-center">
                        <div className="text-xl font-bold mb-2">No scalping setups right now</div>
                        <div className="text-muted-foreground">
                            The scan ran on live data but no pair passed the scalping score.
                            The scan repeats every minute.
                        </div>
                    </div>
                ) : (
                    <SignalList signals={filteredSignals} showCharts />
                )}
            </div>
        </div>
    );
}
