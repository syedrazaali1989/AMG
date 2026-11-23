'use client';

import { useEffect, useState } from 'react';
import type { FlowAsset, FlowMapData } from '@/lib/signals/flowMap';

/**
 * FlowMapClient - the Money Flow Map display.
 *
 * The page server-renders the first snapshot; this component then
 * re-fetches /api/flow-map every 5 minutes and swaps the data in
 * silently (a failed tick keeps the snapshot already on screen, the
 * same pattern as the coin pages). The Fed countdown ticks locally
 * every second from the scheduled decision instant the API returns.
 *
 * Formatters are kept local so the server data layer (and its engine
 * imports) is not pulled into the client bundle - same approach as
 * CoinLivePrice.
 */

function formatPrice(asset: FlowAsset): string {
    if (asset.price === null) return '-';
    if (asset.id === 'stablecoins') {
        return `$${(asset.price / 1e9).toFixed(1)}B`;
    }
    const price = asset.price;
    if (price >= 1000) {
        return `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    if (price >= 1) return `$${price.toFixed(2)}`;
    if (price >= 0.01) return `$${price.toFixed(4)}`;
    return `$${price.toFixed(8)}`;
}

function formatZ(z: number): string {
    const sign = z > 0 ? '+' : z < 0 ? '−' : '';
    return `${sign}${Math.abs(z).toFixed(1)}σ`;
}

function formatSignedPct(value: number): string {
    const sign = value > 0 ? '+' : value < 0 ? '−' : '';
    return `${sign}${Math.abs(value).toFixed(2)}%`;
}

/** Horizontal bar centred on zero; the fill spans up to ±5σ. */
function ZBar({ z, amber }: { z: number; amber?: boolean }) {
    const capped = Math.max(-5, Math.min(5, z));
    const widthPct = (Math.abs(capped) / 5) * 50;
    const leftPct = capped >= 0 ? 50 : 50 - widthPct;
    const color = amber ? 'bg-amber-500' : capped >= 0 ? 'bg-green-500' : 'bg-red-500';
    return (
        <div className="relative h-2 rounded bg-muted/60 overflow-hidden">
            <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
            <div
                className={`absolute inset-y-0 ${color}`}
                style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
            />
        </div>
    );
}

function AssetCard({ asset }: { asset: FlowAsset }) {
    if (asset.status === 'unavailable') {
        return (
            <div className="glass rounded-lg p-4">
                <div className="flex items-baseline justify-between gap-2">
                    <span className="font-semibold">{asset.name}</span>
                    <span className="text-xs text-muted-foreground">{asset.source}</span>
                </div>
                <p className="mt-3 text-sm text-muted-foreground">Data unavailable</p>
            </div>
        );
    }

    const z = asset.zScore as number;
    const change = asset.changePct as number;
    const isVix = asset.id === 'vix';

    return (
        <div className="glass rounded-lg p-4">
            <div className="flex items-baseline justify-between gap-2">
                <span className="font-semibold">{asset.name}</span>
                <span className="text-xs text-muted-foreground">{asset.source}</span>
            </div>
            <p className="mt-2 font-mono text-xl">{formatPrice(asset)}</p>
            {asset.id === 'stablecoins' && (
                <p className="text-xs text-muted-foreground">total circulating supply</p>
            )}
            <p className="mt-1 font-mono text-sm">
                <span className={change >= 0 ? 'text-green-500' : 'text-red-500'}>
                    {formatSignedPct(change)}
                </span>{' '}
                <span className="text-xs text-muted-foreground">{asset.changeLabel}</span>
            </p>
            <div className="mt-3">
                <div className="mb-1 flex items-baseline justify-between">
                    <span className="text-xs text-muted-foreground">z-score</span>
                    <span
                        className={`font-mono text-sm ${
                            isVix ? 'text-amber-500' : z >= 0 ? 'text-green-500' : 'text-red-500'
                        }`}
                    >
                        {formatZ(z)}
                    </span>
                </div>
                <ZBar z={z} amber={isVix} />
            </div>
        </div>
    );
}

function FedCountdown({ date, label }: { date: string; label: string }) {
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        const interval = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(interval);
    }, []);

    const diffMs = Math.max(0, new Date(date).getTime() - now);
    const days = Math.floor(diffMs / 86_400_000);
    const hours = Math.floor((diffMs % 86_400_000) / 3_600_000);
    const minutes = Math.floor((diffMs % 3_600_000) / 60_000);
    const seconds = Math.floor((diffMs % 60_000) / 1000);
    const pad = (n: number) => String(n).padStart(2, '0');

    return (
        <div className="glass rounded-lg p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Next Fed rate decision
            </p>
            <p className="mt-2 font-semibold">{label}</p>
            <p className="mt-1 font-mono text-2xl text-[#D4AF37]">
                {days}d {pad(hours)}h {pad(minutes)}m {pad(seconds)}s
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
                Scheduled FOMC announcement, 2:00 PM New York
            </p>
        </div>
    );
}

export function FlowMapClient({ initialData }: { initialData: FlowMapData }) {
    const [data, setData] = useState(initialData);

    useEffect(() => {
        let cancelled = false;

        const load = () => {
            fetch('/api/flow-map')
                .then(r => {
                    if (!r.ok) throw new Error(`flow-map ${r.status}`);
                    return r.json();
                })
                .then((next: FlowMapData) => {
                    if (!cancelled) setData(next);
                })
                .catch(() => {
                    // Silent: keep the snapshot already on screen.
                });
        };

        const interval = setInterval(load, 300_000);
        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, []);

    const allUnavailable = data.assets.every(a => a.status === 'unavailable');

    if (allUnavailable) {
        return (
            <div className="glass rounded-lg p-6 text-center">
                <div className="font-semibold mb-1">Live data unavailable</div>
                <p className="text-sm text-muted-foreground">
                    Market data could not be reached just now, so nothing is shown. Nothing on
                    this page is ever simulated.
                </p>
            </div>
        );
    }

    const meter = data.riskMeter;
    const meterPct = meter ? (meter.score + 100) / 2 : 50;
    const meterColor =
        meter?.label === 'RISK-OFF'
            ? 'text-red-500'
            : meter?.label === 'RISK-ON'
              ? 'text-green-500'
              : 'text-yellow-500';

    return (
        <div>
            <div className="grid gap-4 lg:grid-cols-3">
                {meter && (
                    <div className="glass rounded-lg p-4 lg:col-span-2">
                        <div className="flex items-baseline justify-between gap-2">
                            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                Risk-On / Risk-Off Meter
                            </p>
                            <p className={`font-mono text-2xl font-bold ${meterColor}`}>
                                {meter.score > 0 ? '+' : ''}
                                {meter.score}{' '}
                                <span className="text-base font-semibold">{meter.label}</span>
                            </p>
                        </div>
                        <div className="relative mt-4 h-3 rounded bg-gradient-to-r from-red-500 via-yellow-500 to-green-500">
                            <div
                                className="absolute -top-1 h-5 w-1.5 -translate-x-1/2 rounded bg-white shadow"
                                style={{ left: `${meterPct}%` }}
                            />
                        </div>
                        <div className="mt-1 flex justify-between text-xs text-muted-foreground">
                            <span>−100 RISK-OFF</span>
                            <span>+100 RISK-ON</span>
                        </div>
                        <p className="mt-3 text-xs text-muted-foreground">
                            Speculative read — computed from public market data.
                        </p>
                    </div>
                )}
                {data.fed && <FedCountdown date={data.fed.date} label={data.fed.label} />}
            </div>

            {data.flowSummary && (
                <div className="glass mt-4 rounded-lg p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        What the flow says
                    </p>
                    <p className="mt-2 text-sm">
                        Biggest inflow:{' '}
                        <span className="font-semibold text-green-500">
                            {data.flowSummary.inflowName} ({formatZ(data.flowSummary.inflowZ)})
                        </span>
                    </p>
                    <p className="mt-1 text-sm">
                        Biggest outflow:{' '}
                        <span className="font-semibold text-red-500">
                            {data.flowSummary.outflowName} ({formatZ(data.flowSummary.outflowZ)})
                        </span>
                    </p>
                </div>
            )}

            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {data.assets.map(asset => (
                    <AssetCard key={asset.id} asset={asset} />
                ))}
            </div>

            <p className="mt-4 text-xs text-muted-foreground">
                Updated{' '}
                {new Date(data.updatedAt).toLocaleTimeString('en-GB', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                })}{' '}
                · refreshes every 5 minutes
            </p>
        </div>
    );
}
