'use client';

import { useState, useEffect, useCallback } from 'react';
import { Navbar } from '@/components/layout/Navbar';
import { StatsCard } from '@/components/ui/StatsCard';
import { MoneyRotationResult, RotationSignal } from '@/lib/signals/moneyRotation';
import { TrendingUp, TrendingDown, Activity, RefreshCw, Repeat, DollarSign } from 'lucide-react';

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
                {/* Header */}
                <div className="flex items-center justify-center mb-6">
                    <div className="bg-blue-500/10 border border-blue-500/30 rounded-full px-6 py-3 flex items-center gap-3">
                        <Repeat className="w-5 h-5 text-blue-400" />
                        <span className="text-blue-300 font-bold text-lg">MONEY ROTATION</span>
                        <span className="text-sm text-muted-foreground">Where the traded money is moving, measured live</span>
                    </div>
                </div>

                <div className="max-w-3xl mx-auto text-center mb-8">
                    <h1 className="text-4xl font-bold mb-4 bg-gradient-primary bg-clip-text text-transparent">
                        Money Rotation
                    </h1>
                    <p className="text-muted-foreground">
                        For every pair in the 54-pair universe, two quantities are computed from live Binance
                        1h candles: (1) its <b>quote-volume share</b> of the universe&apos;s traded USDT volume -
                        last 24h vs the 24h before - and (2) its <b>relative strength vs BTC</b> over 1h / 4h /
                        24h. Rotation score = clamp(50 + 1.5 x share momentum + 2.5 x RS composite, 0, 100),
                        where RS composite = 0.5 x RS24h + 0.3 x RS4h + 0.2 x RS1h. A pair is ROTATING IN when
                        its share momentum is &ge; +5% and it outperforms BTC; ROTATING OUT when share momentum
                        is &le; -5% and it underperforms. Signals are issued only for decisive rotation
                        (IN with score &ge; 55 -&gt; LONG, OUT with score &le; 45 -&gt; SHORT) in pairs holding
                        at least 0.1% of universe volume (below that, share swings are noise), with stops at
                        1.5 x ATR(14, 1h, true range) and a 1.5R / 3R / 5R target ladder. Every number below is
                        the actual computed value - check them against any exchange.
                    </p>
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

                        {/* Rotation signals */}
                        <h2 className="text-2xl font-bold mb-4">Rotation Signals</h2>
                        {data.signals.length === 0 ? (
                            <div className="glass rounded-lg p-8 text-center mb-8">
                                <div className="text-lg font-bold mb-2">No decisive rotation right now</div>
                                <div className="text-muted-foreground">
                                    No pair is rotating strongly enough (IN with score &ge; 55, or OUT with
                                    score &le; 45, in a pair holding &ge; 0.1% of universe volume) to issue
                                    a signal. The table below shows the measured rotation for every pair.
                                </div>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                                {data.signals.map((signal: RotationSignal) => {
                                    const isLong = signal.direction === 'LONG';
                                    const r = signal.rotation;
                                    return (
                                        <div key={signal.id} className={`rounded-lg border p-6 bg-card ${isLong ? 'border-success/40' : 'border-danger/40'}`}>
                                            <div className="flex items-center justify-between mb-3">
                                                <span className="text-xl font-bold">{signal.pair}</span>
                                                <span className={`px-3 py-1 rounded-full text-sm font-bold ${isLong ? 'bg-success/20 text-success' : 'bg-danger/20 text-danger'}`}>
                                                    {signal.direction} • score {r.rotationScore.toFixed(1)}
                                                </span>
                                            </div>
                                            <div className="grid grid-cols-2 gap-2 text-sm mb-3">
                                                <div>Entry: <b>{signal.entryPrice}</b></div>
                                                <div>Stop loss: <b>{signal.stopLoss.toFixed(6)}</b></div>
                                                <div>TP1 (1.5R): <b>{signal.takeProfit1?.toFixed(6)}</b></div>
                                                <div>TP2 (3R): <b>{signal.takeProfit2?.toFixed(6)}</b></div>
                                                <div>Final TP (5R): <b>{signal.takeProfit.toFixed(6)}</b></div>
                                                <div>Expires: <b>{signal.expiresAt ? new Date(signal.expiresAt).toLocaleTimeString() : '-'}</b></div>
                                            </div>
                                            <div className="text-sm text-muted-foreground space-y-1">
                                                <div>Rotation evidence: share {r.sharePrev.toFixed(3)}% → {r.shareNow.toFixed(3)}% (momentum {fmt(r.shareMomentumPct, 1)}%)</div>
                                                <div>RS vs BTC: 1h {fmt(r.rs1h)}pp • 4h {fmt(r.rs4h)}pp • 24h {fmt(r.rs24h)}pp • composite {fmt(r.rsComposite)}pp</div>
                                                <div>24h quote volume: {fmtUsd(r.quoteVolume24h)}</div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

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
