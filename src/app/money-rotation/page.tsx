'use client';

import { useState, useEffect, useCallback } from 'react';
import { Navbar } from '@/components/layout/Navbar';
import { StatsCard } from '@/components/ui/StatsCard';
import { MoneyRotationResult } from '@/lib/signals/moneyRotation';
import { TrendingUp, TrendingDown, Activity, RefreshCw, DollarSign } from 'lucide-react';

type ApiPayload = MoneyRotationResult & { cached: boolean };

function fmt(n: number, digits = 2): string {
    return `${n >= 0 ? '+' : ''}${n.toFixed(digits)}`;
}

function fmtUsd(n: number): string {
    if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
    if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
    return `$${n.toFixed(0)}`;
}

export default function MoneyRotationPage() {
    const [data, setData] = useState<ApiPayload | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [dataUnavailable, setDataUnavailable] = useState(false);

    const load = useCallback(async () => {
        setIsLoading(true);
        try {
            const response = await fetch('/api/money-rotation');
            if (!response.ok) {
                setDataUnavailable(true);
                return;
            }
            const json = await response.json();
            setData(json);
            setDataUnavailable(false);
        } catch {
            setDataUnavailable(true);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
        const interval = setInterval(load, 60 * 1000);
        return () => clearInterval(interval);
    }, [load]);

    const inCount = data?.rows.filter(r => r.classification === 'IN').length ?? 0;
    const outCount = data?.rows.filter(r => r.classification === 'OUT').length ?? 0;

    return (
        <div className="min-h-screen bg-background">
            <Navbar />
            <div className="container mx-auto px-4 py-8">
                {/* Signals disabled notice */}
                <div className="max-w-3xl mx-auto mb-8">
                    <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-6 py-4 text-center">
                        <p className="text-yellow-200 font-semibold mb-1">Trade signals from this table are disabled</p>
                        <p className="text-sm text-muted-foreground">
                            Trade signals from this table were backtested on 90 days of market data and did not
                            perform, so they are disabled. This table is market information only, not trading advice.
                        </p>
                    </div>
                </div>

                {dataUnavailable ? (
                    <div className="glass rounded-lg p-12 text-center">
                        <div className="space-y-4">
                            <div className="text-2xl font-bold text-danger">Live Data Unavailable</div>
                            <div className="text-muted-foreground">
                                Live market data could not be loaded, so no rotation table is shown.
                                Rotation is never computed from simulated data - please try again shortly.
                            </div>
                        </div>
                    </div>
                ) : !data ? (
                    <div className="text-center py-12">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-400 mx-auto mb-4"></div>
                        <p className="text-muted-foreground">Computing rotation across 54 pairs...</p>
                    </div>
                ) : (
                    <>
                        {/* Stats */}
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                            <StatsCard title="Pairs Measured" value={`${data.totals.pairsLoaded}/${data.totals.pairsRequested}`} icon={Activity} />
                            <StatsCard title="Universe Volume (24h)" value={fmtUsd(data.totals.totalQuoteVolume24h)} icon={DollarSign} />
                            <StatsCard title="Rotating In" value={inCount} icon={TrendingUp} />
                            <StatsCard title="Rotating Out" value={outCount} icon={TrendingDown} />
                        </div>

                        <div className="flex items-center justify-between mb-4">
                            <p className="text-sm text-muted-foreground">
                                BTC benchmark: 1h {fmt(data.btc.change1hPct)}% • 4h {fmt(data.btc.change4hPct)}% • 24h {fmt(data.btc.change24hPct)}%
                                {data.totals.pairsExcluded > 0 ? ` • ${data.totals.pairsExcluded} pairs excluded (data unavailable or stale)` : ''}
                                {` • updated ${new Date(data.generatedAt).toLocaleTimeString()}`}
                            </p>
                            <button
                                onClick={load}
                                disabled={isLoading}
                                className="px-4 py-2 rounded-lg font-semibold bg-gradient-primary text-white hover:shadow-lg transition-all disabled:opacity-50 flex items-center gap-2"
                            >
                                <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                                Refresh
                            </button>
                        </div>

                        {/* Rotation table */}
                        <h2 className="text-2xl font-bold mb-4">Rotation Table</h2>
                        <div className="glass rounded-lg p-6 overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="text-left text-muted-foreground border-b border-border">
                                        <th className="py-2 pr-4">Pair</th>
                                        <th className="py-2 pr-4">Price</th>
                                        <th className="py-2 pr-4">Share prev 24h</th>
                                        <th className="py-2 pr-4">Share last 24h</th>
                                        <th className="py-2 pr-4">Share momentum</th>
                                        <th className="py-2 pr-4">RS 1h</th>
                                        <th className="py-2 pr-4">RS 4h</th>
                                        <th className="py-2 pr-4">RS 24h</th>
                                        <th className="py-2 pr-4">Score</th>
                                        <th className="py-2">Rotation</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data.rows.map(row => (
                                        <tr key={row.pair} className="border-b border-border/50">
                                            <td className="py-2 pr-4 font-semibold">{row.pair}</td>
                                            <td className="py-2 pr-4">{row.price}</td>
                                            <td className="py-2 pr-4">{row.sharePrev.toFixed(3)}%</td>
                                            <td className="py-2 pr-4">{row.shareNow.toFixed(3)}%</td>
                                            <td className="py-2 pr-4">{fmt(row.shareMomentumPct, 1)}%</td>
                                            <td className="py-2 pr-4">{fmt(row.rs1h)}pp</td>
                                            <td className="py-2 pr-4">{fmt(row.rs4h)}pp</td>
                                            <td className="py-2 pr-4">{fmt(row.rs24h)}pp</td>
                                            <td className="py-2 pr-4 font-bold">{row.rotationScore.toFixed(1)}</td>
                                            <td className="py-2">
                                                <span className={
                                                    row.classification === 'IN' ? 'text-success font-bold'
                                                        : row.classification === 'OUT' ? 'text-danger font-bold'
                                                            : 'text-muted-foreground'
                                                }>
                                                    {row.classification === 'IN' ? 'ROTATING IN' : row.classification === 'OUT' ? 'ROTATING OUT' : 'NEUTRAL'}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
