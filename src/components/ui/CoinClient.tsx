'use client';

import { useEffect, useMemo, useState } from 'react';
import { CoinChart, type CoinChartLevels } from './CoinChart';
import { SignalList } from './SignalList';
import { Signal } from '@/lib/signals/types';
import { SignalManager } from '@/lib/services/signalManager';
import { formatPrice, formatPercentage } from '@/lib/utils';

/**
 * CoinClient - the interactive sections of a coin page.
 *
 * - Chart (CoinChart) with the first active signal's levels drawn when
 *   an active standard or Scalping V2 signal exists for this pair.
 * - Active signals for the pair, from the same server payloads the
 *   dashboard and Scalping V2 pages use (/api/signals,
 *   /api/scalping-v2/signals), rendered with the shared SignalList
 *   (charts off - the page chart above already shows the levels).
 * - This visitor's completed signals for the pair, from the same
 *   browser-local history store the /completed pages read. There is no
 *   server-side history; nothing is fabricated.
 *
 * Every section has an honest empty state.
 */

interface CompletedRecord {
    id: string;
    pair: string;
    direction: string;
    status: string;
    entryPrice: number;
    exitPrice?: number;
    profitLossPercentage?: number;
    completedAt?: string;
    timestamp?: string;
}

interface CoinClientProps {
    /** Display pair, e.g. 'BTC/USDT' */
    pair: string;
}

export function CoinClient({ pair }: CoinClientProps) {
    const [signals, setSignals] = useState<Signal[]>([]);
    const [signalsLoaded, setSignalsLoaded] = useState(false);
    const [signalsFailed, setSignalsFailed] = useState(false);
    const [history, setHistory] = useState<CompletedRecord[]>([]);

    useEffect(() => {
        let cancelled = false;
        const encoded = encodeURIComponent(pair);

        Promise.allSettled([
            fetch(`/api/signals?market=CRYPTO&pairs=${encoded}`).then(r => {
                if (!r.ok) throw new Error(`signals ${r.status}`);
                return r.json();
            }),
            fetch(`/api/scalping-v2/signals?pairs=${encoded}`).then(r => {
                if (!r.ok) throw new Error(`scalping-v2 ${r.status}`);
                return r.json();
            })
        ]).then(results => {
            if (cancelled) return;
            const merged: Signal[] = [];
            let anyOk = false;
            for (const result of results) {
                if (result.status === 'fulfilled' && Array.isArray(result.value?.signals)) {
                    anyOk = true;
                    merged.push(...result.value.signals);
                }
            }
            setSignals(merged.filter(s => s.pair === pair && s.status === 'ACTIVE'));
            setSignalsFailed(!anyOk);
            setSignalsLoaded(true);
        });

        const completed = SignalManager.getCompletedSignals() as CompletedRecord[];
        setHistory(completed.filter(c => c.pair === pair).slice(-20).reverse());

        return () => {
            cancelled = true;
        };
    }, [pair]);

    const levels = useMemo<CoinChartLevels | null>(() => {
        const first = signals[0];
        if (!first) return null;
        return {
            entryPrice: first.entryPrice,
            stopLoss: first.stopLoss,
            takeProfit: first.takeProfit,
            takeProfit1: first.takeProfit1,
            takeProfit2: first.takeProfit2,
            takeProfit3: first.takeProfit3
        };
    }, [signals]);

    return (
        <div>
            {/* Chart */}
            <div className="glass rounded-lg p-4 md:p-6 mb-8">
                <CoinChart pair={pair} levels={levels} />
            </div>

            {/* Active signals for this pair */}
            <h2 className="text-xl font-bold mb-4">Active Signals · {pair}</h2>
            {!signalsLoaded ? (
                <div className="glass rounded-lg p-6 text-center text-sm text-muted-foreground mb-8">
                    Checking for active signals…
                </div>
            ) : signalsFailed ? (
                <div className="glass rounded-lg p-6 text-center text-sm text-muted-foreground mb-8">
                    Live signal data is unavailable right now. No signals are shown rather than stale ones.
                </div>
            ) : signals.length > 0 ? (
                <div className="mb-8">
                    <SignalList signals={signals} showCharts={false} />
                </div>
            ) : (
                <div className="glass rounded-lg p-6 text-center text-sm text-muted-foreground mb-8">
                    No active signal for {pair} right now. The engines issue a signal only when a
                    setup passes every filter.
                </div>
            )}

            {/* This visitor's completed signals for this pair */}
            <h2 className="text-xl font-bold mb-4">Your Completed Signals · {pair}</h2>
            {history.length === 0 ? (
                <div className="glass rounded-lg p-6 text-center text-sm text-muted-foreground">
                    No completed {pair} signals in this browser yet. Closed signals you have
                    tracked on this device will appear here.
                </div>
            ) : (
                <div className="glass rounded-lg overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-border text-left text-muted-foreground">
                                <th className="px-4 py-3 font-medium">Closed</th>
                                <th className="px-4 py-3 font-medium">Direction</th>
                                <th className="px-4 py-3 font-medium">Result</th>
                                <th className="px-4 py-3 font-medium">Entry</th>
                                <th className="px-4 py-3 font-medium">Exit</th>
                                <th className="px-4 py-3 font-medium">P/L</th>
                            </tr>
                        </thead>
                        <tbody>
                            {history.map(record => (
                                <tr key={record.id} className="border-b border-border/50 last:border-0">
                                    <td className="px-4 py-3 whitespace-nowrap">
                                        {record.completedAt || record.timestamp
                                            ? new Date(record.completedAt ?? record.timestamp ?? '').toLocaleString()
                                            : '-'}
                                    </td>
                                    <td className="px-4 py-3">{record.direction}</td>
                                    <td className="px-4 py-3">{record.status}</td>
                                    <td className="px-4 py-3 font-mono">{formatPrice(record.entryPrice)}</td>
                                    <td className="px-4 py-3 font-mono">
                                        {record.exitPrice !== undefined ? formatPrice(record.exitPrice) : '-'}
                                    </td>
                                    <td
                                        className={`px-4 py-3 font-mono ${
                                            (record.profitLossPercentage ?? 0) >= 0
                                                ? 'text-green-500'
                                                : 'text-red-500'
                                        }`}
                                    >
                                        {record.profitLossPercentage !== undefined
                                            ? formatPercentage(record.profitLossPercentage)
                                            : '-'}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
