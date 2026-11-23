'use client';

import { useEffect, useState } from 'react';
import type { FlowAsset, FlowMapData } from '@/lib/signals/flowMap';

/**
 * FlowMapClient - the Money Flow Map display, styled as a node map:
 * risk assets clustered on the left of one dark panel, safety assets
 * on the right, the Fed as a distinct gold node, a right-hand panel
 * with the risk meter / VIX / DXY / Fed countdown / "what the flow
 * says", a plain-language summary panel under the map (English, then
 * Roman Urdu - wording the user explicitly ordered for first-time
 * readers), and a scrolling ticker along the bottom. All data comes
 * from /api/flow-map (public sources only); an asset whose source
 * fails shows as a greyed "unavailable" node - nothing is ever
 * simulated.
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

// ---------------------------------------------------------------------------
// Node map geometry (desktop). Positions are % of the map panel:
// risk assets left/centre, safety assets right, the Fed bottom-centre.
// VIX is not a node - it is a gauge and lives in the side panel.
// ---------------------------------------------------------------------------

const NODE_POSITIONS: Record<string, { x: number; y: number }> = {
    spx: { x: 13, y: 24 },
    nasdaq: { x: 29, y: 13 },
    btc: { x: 23, y: 47 },
    eth: { x: 41, y: 35 },
    crude: { x: 11, y: 69 },
    silver: { x: 33, y: 72 },
    gold: { x: 71, y: 19 },
    bonds: { x: 87, y: 37 },
    dollar: { x: 67, y: 50 },
    stablecoins: { x: 84, y: 72 }
};

const FED_POSITION = { x: 52, y: 86 };

/** Faint network links inside each cluster. */
const NODE_LINKS: [string, string][] = [
    ['spx', 'nasdaq'],
    ['nasdaq', 'eth'],
    ['eth', 'btc'],
    ['btc', 'crude'],
    ['btc', 'silver'],
    ['eth', 'silver'],
    ['gold', 'bonds'],
    ['bonds', 'stablecoins'],
    ['gold', 'dollar'],
    ['dollar', 'stablecoins']
];

const GREEN = '#22c55e';
const RED = '#ef4444';
const GOLD = '#D4AF37';

function directionColor(asset: FlowAsset): string {
    const change = asset.changePct ?? asset.zScore ?? 0;
    return change >= 0 ? GREEN : RED;
}

/** Node diameter grows with |z-score|: 86px up to ~122px at 4σ+. */
function nodeSize(asset: FlowAsset): number {
    if (asset.status !== 'ok' || asset.zScore === null) return 86;
    return 86 + Math.min(Math.abs(asset.zScore), 4) * 9;
}

function NodeFace({ asset, size }: { asset: FlowAsset; size: number }) {
    if (asset.status !== 'ok' || asset.zScore === null || asset.changePct === null) {
        return (
            <div
                className="flex flex-col items-center justify-center rounded-full border border-dashed border-white/20 bg-white/[0.02] text-center"
                style={{ width: size, height: size }}
            >
                <span className="px-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {asset.name}
                </span>
                <span className="mt-0.5 text-[9px] uppercase tracking-wider text-muted-foreground/70">
                    unavailable
                </span>
            </div>
        );
    }

    const color = directionColor(asset);
    return (
        <div
            className="flex flex-col items-center justify-center rounded-full text-center"
            style={{
                width: size,
                height: size,
                border: `1.5px solid ${color}`,
                background: `radial-gradient(circle at 50% 38%, ${color}30 0%, ${color}0d 62%, rgba(0,0,0,0.25) 100%)`,
                boxShadow: `0 0 ${18 + Math.min(Math.abs(asset.zScore), 4) * 7}px ${color}45, inset 0 0 18px ${color}26`
            }}
        >
            <span className="px-1 text-[9px] font-semibold uppercase leading-tight tracking-wider text-white/75">
                {asset.name}
            </span>
            <span className="font-mono text-[17px] font-bold leading-tight" style={{ color }}>
                {formatZ(asset.zScore)}
            </span>
            <span className="font-mono text-[11px] leading-tight" style={{ color }}>
                {formatSignedPct(asset.changePct)}
            </span>
        </div>
    );
}

function MapNode({ asset }: { asset: FlowAsset }) {
    const pos = NODE_POSITIONS[asset.id];
    if (!pos) return null;
    const size = nodeSize(asset);
    const zIndex = asset.status === 'ok' && asset.zScore !== null ? 10 + Math.round(Math.abs(asset.zScore)) : 10;
    return (
        <div
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${pos.x}%`, top: `${pos.y}%`, zIndex }}
            title={`${asset.name} · ${formatPrice(asset)} · ${asset.source}`}
        >
            <NodeFace asset={asset} size={size} />
        </div>
    );
}

function FedNode({ fed }: { fed: FlowMapData['fed'] }) {
    return (
        <div
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${FED_POSITION.x}%`, top: `${FED_POSITION.y}%`, zIndex: 12 }}
        >
            <div
                className="flex flex-col items-center justify-center rounded-full text-center"
                style={{
                    width: 92,
                    height: 92,
                    border: `1.5px solid ${GOLD}`,
                    background: `radial-gradient(circle at 50% 38%, ${GOLD}2e 0%, ${GOLD}0d 62%, rgba(0,0,0,0.25) 100%)`,
                    boxShadow: `0 0 24px ${GOLD}40, inset 0 0 18px ${GOLD}26`
                }}
            >
                <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: GOLD }}>
                    The Fed
                </span>
                <span className="mt-0.5 px-1 text-[9px] leading-tight text-white/70">
                    {fed ? fed.label.replace(/^\w{3}, /, '') : 'unavailable'}
                </span>
            </div>
        </div>
    );
}

/** SVG underlay: faint cluster links + the main outflow → inflow flow line. */
function MapLinks({ data }: { data: FlowMapData }) {
    const byId = new Map(data.assets.map(a => [a.id, a]));
    const pos = (id: string) => NODE_POSITIONS[id];

    let flowPath: string | null = null;
    if (data.flowSummary) {
        const out = data.assets.find(a => a.name === data.flowSummary?.outflowName);
        const into = data.assets.find(a => a.name === data.flowSummary?.inflowName);
        if (out && into && pos(out.id) && pos(into.id) && out.id !== into.id) {
            const p1 = pos(out.id);
            const p2 = pos(into.id);
            const mx = (p1.x + p2.x) / 2;
            const my = Math.min(p1.y, p2.y) - 10;
            flowPath = `M ${p1.x} ${p1.y} Q ${mx} ${my} ${p2.x} ${p2.y}`;
        }
    }

    return (
        <svg
            className="pointer-events-none absolute inset-0 h-full w-full"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
        >
            <defs>
                <marker
                    id="flow-arrow"
                    viewBox="0 0 10 10"
                    refX="8"
                    refY="5"
                    markerWidth="5"
                    markerHeight="5"
                    orient="auto-start-reverse"
                >
                    <path d="M 0 0 L 10 5 L 0 10 z" fill={GOLD} fillOpacity="0.7" />
                </marker>
            </defs>
            {NODE_LINKS.map(([a, b]) => {
                const pa = pos(a);
                const pb = pos(b);
                if (!pa || !pb || byId.get(a)?.status !== 'ok' || byId.get(b)?.status !== 'ok') {
                    return null;
                }
                return (
                    <line
                        key={`${a}-${b}`}
                        x1={pa.x}
                        y1={pa.y}
                        x2={pb.x}
                        y2={pb.y}
                        stroke="#ffffff"
                        strokeOpacity="0.06"
                        strokeWidth="1"
                        vectorEffect="non-scaling-stroke"
                    />
                );
            })}
            {flowPath && (
                <path
                    d={flowPath}
                    fill="none"
                    stroke={GOLD}
                    strokeOpacity="0.55"
                    strokeWidth="1.5"
                    strokeDasharray="5 4"
                    vectorEffect="non-scaling-stroke"
                    markerEnd="url(#flow-arrow)"
                    className="flowmap-dash"
                />
            )}
        </svg>
    );
}

/** Mobile fallback (<481px): the same nodes in a tidy two-column grid. */
function MobileNodeGrid({ data }: { data: FlowMapData }) {
    const byGroup = (group: FlowAsset['group']) => data.assets.filter(a => a.group === group);
    const Column = ({ title, assets }: { title: string; assets: FlowAsset[] }) => (
        <div>
            <p className="mb-2 text-center text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                {title}
            </p>
            <div className="flex flex-col items-center gap-3">
                {assets.map(asset => (
                    <NodeFace key={asset.id} asset={asset} size={92} />
                ))}
            </div>
        </div>
    );

    return (
        <div className="p-3">
            <div className="grid grid-cols-2 gap-3">
                <Column title="Risk" assets={byGroup('risk')} />
                <Column title="Safety" assets={byGroup('safety')} />
            </div>
            <div className="mt-4 flex justify-center">
                <div
                    className="flex flex-col items-center justify-center rounded-full text-center"
                    style={{
                        width: 92,
                        height: 92,
                        border: `1.5px solid ${GOLD}`,
                        background: `radial-gradient(circle at 50% 38%, ${GOLD}2e 0%, ${GOLD}0d 62%, rgba(0,0,0,0.25) 100%)`
                    }}
                >
                    <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: GOLD }}>
                        The Fed
                    </span>
                    <span className="mt-0.5 px-1 text-[9px] leading-tight text-white/70">
                        {data.fed ? data.fed.label.replace(/^\w{3}, /, '') : 'unavailable'}
                    </span>
                </div>
            </div>
            {data.flowSummary && (
                <p className="mt-4 text-center font-mono text-[11px] text-white/70">
                    <span style={{ color: RED }}>{data.flowSummary.outflowName}</span>
                    {' → '}
                    <span style={{ color: GREEN }}>{data.flowSummary.inflowName}</span>
                </p>
            )}
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
        <div>
            <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                Next Fed rate decision
            </p>
            <p className="mt-1.5 text-sm font-semibold">{label}</p>
            <p className="mt-0.5 font-mono text-[22px] leading-tight" style={{ color: GOLD }}>
                {days}d {pad(hours)}h {pad(minutes)}m {pad(seconds)}s
            </p>
            <p className="text-[10px] text-muted-foreground">2:00 PM New York</p>
        </div>
    );
}

function MiniStat({ asset, amber }: { asset: FlowAsset | undefined; amber?: boolean }) {
    return (
        <div className="rounded-lg bg-white/[0.03] px-3 py-2.5">
            <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                {asset?.name ?? '—'}
            </p>
            {asset && asset.status === 'ok' && asset.price !== null ? (
                <p className="mt-0.5 font-mono text-base leading-tight">
                    <span className={amber ? 'text-amber-500' : undefined}>{formatPrice(asset)}</span>{' '}
                    <span
                        className={`text-xs ${(asset.changePct ?? 0) >= 0 ? 'text-green-500' : 'text-red-500'}`}
                    >
                        {asset.changePct !== null ? formatSignedPct(asset.changePct) : ''}
                    </span>
                </p>
            ) : (
                <p className="mt-0.5 text-sm text-muted-foreground">unavailable</p>
            )}
        </div>
    );
}

function Ticker({ assets }: { assets: FlowAsset[] }) {
    const items = assets.map(asset => (
        <span key={asset.id} className="mx-5 inline-flex items-baseline gap-2 whitespace-nowrap">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-white/70">
                {asset.name}
            </span>
            {asset.status === 'ok' && asset.changePct !== null ? (
                <>
                    <span
                        className="font-mono text-[11px]"
                        style={{ color: asset.changePct >= 0 ? GREEN : RED }}
                    >
                        {formatSignedPct(asset.changePct)}
                    </span>
                    {asset.zScore !== null && (
                        <span className="font-mono text-[11px] text-white/45">{formatZ(asset.zScore)}</span>
                    )}
                </>
            ) : (
                <span className="font-mono text-[11px] text-white/35">unavailable</span>
            )}
        </span>
    ));

    return (
        <div className="glass relative mt-4 overflow-hidden rounded-lg py-2" aria-hidden="true">
            <div className="flowmap-ticker flex w-max">
                <div className="flex items-center">{items}</div>
                <div className="flex items-center">{items}</div>
            </div>
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
    const vix = data.assets.find(a => a.id === 'vix');
    const dollar = data.assets.find(a => a.id === 'dollar');
    const mapAssets = data.assets.filter(a => NODE_POSITIONS[a.id]);

    return (
        <div>
            <style>{`
                @keyframes flowmap-scroll {
                    from { transform: translateX(0); }
                    to { transform: translateX(-50%); }
                }
                .flowmap-ticker {
                    animation: flowmap-scroll 45s linear infinite;
                }
                @keyframes flowmap-dashmove {
                    to { stroke-dashoffset: -18; }
                }
                .flowmap-dash {
                    animation: flowmap-dashmove 1.6s linear infinite;
                }
            `}</style>

            <div className="grid gap-4 lg:grid-cols-3">
                {/* Node map */}
                <div className="glass relative overflow-hidden rounded-xl lg:col-span-2">
                    <div className="flex items-baseline justify-between gap-2 border-b border-white/5 px-4 py-3">
                        <span
                            className="text-xs font-bold uppercase tracking-[0.2em]"
                            style={{ color: GOLD }}
                        >
                            Money Flow Map
                        </span>
                        <span className="text-right text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
                            Where the world&rsquo;s money is moving
                        </span>
                    </div>

                    {/* Desktop / tablet: absolute node layout */}
                    <div className="relative hidden h-[540px] min-[481px]:block">
                        <MapLinks data={data} />
                        {mapAssets.map(asset => (
                            <MapNode key={asset.id} asset={asset} />
                        ))}
                        <FedNode fed={data.fed} />
                        <span className="absolute left-4 top-3 text-[9px] uppercase tracking-[0.18em] text-white/30">
                            Risk
                        </span>
                        <span className="absolute right-4 top-3 text-[9px] uppercase tracking-[0.18em] text-white/30">
                            Safety
                        </span>
                    </div>

                    {/* Narrow screens: two-column node grid */}
                    <div className="min-[481px]:hidden">
                        <MobileNodeGrid data={data} />
                    </div>
                </div>

                {/* Side panel */}
                <div className="flex flex-col gap-4">
                    {meter && (
                        <div className="glass rounded-xl p-4">
                            <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                                Risk-On / Risk-Off Meter
                            </p>
                            <p className={`mt-1 font-mono text-5xl font-bold leading-none ${meterColor}`}>
                                {meter.score > 0 ? '+' : ''}
                                {meter.score}
                            </p>
                            <p className={`mt-1 text-sm font-bold tracking-widest ${meterColor}`}>
                                {meter.label}
                            </p>
                            <div className="relative mt-3 h-2.5 rounded bg-gradient-to-r from-red-500 via-yellow-500 to-green-500">
                                <div
                                    className="absolute -top-1 h-[18px] w-1.5 -translate-x-1/2 rounded bg-white shadow"
                                    style={{ left: `${meterPct}%` }}
                                />
                            </div>
                            <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
                                <span>−100 RISK-OFF</span>
                                <span>+100 RISK-ON</span>
                            </div>
                            <p className="mt-3 text-[11px] text-muted-foreground">
                                Speculative read — computed from public market data.
                            </p>
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-4">
                        <MiniStat asset={vix} amber />
                        <MiniStat asset={dollar} />
                    </div>

                    {data.fed && (
                        <div className="glass rounded-xl p-4">
                            <FedCountdown date={data.fed.date} label={data.fed.label} />
                        </div>
                    )}

                    {data.flowSummary && (
                        <div className="glass rounded-xl p-4">
                            <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                                What the flow says
                            </p>
                            <p className="mt-2 text-sm">
                                Strongest flow:{' '}
                                <span className="font-semibold text-red-500">
                                    {data.flowSummary.outflowName}
                                </span>
                                {' → '}
                                <span className="font-semibold text-green-500">
                                    {data.flowSummary.inflowName}
                                </span>
                            </p>
                            <p className="mt-1.5 text-sm">
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
                </div>
            </div>

            {data.summary && (
                <div className="glass mt-4 rounded-xl p-4">
                    <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                        Summary
                    </p>
                    <p className="mt-2 text-sm leading-relaxed">{data.summary.en}</p>
                    <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
                        {data.summary.ur}
                    </p>
                </div>
            )}

            <Ticker assets={data.assets} />

            <p className="mt-3 text-xs text-muted-foreground">
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
