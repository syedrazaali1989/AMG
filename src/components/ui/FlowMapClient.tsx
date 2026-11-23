'use client';

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { FlowAsset, FlowMapData } from '@/lib/signals/flowMap';

/**
 * FlowMapClient - the Money Flow Map display, styled as a living node
 * map: risk assets clustered on the left of one dark panel, safety
 * assets on the right, the Fed as a distinct gold node, a right-hand
 * panel with the risk meter / VIX / DXY / Fed countdown / "what the
 * flow says", a plain-language summary panel under the map (English,
 * then Roman Urdu - wording the user explicitly ordered for
 * first-time readers), and a scrolling ticker along the bottom.
 *
 * The map breathes: every live node carries a soft pulsing glow ring
 * whose speed and strength scale with its |z-score|, the cluster
 * links drift faintly, and gold particles travel the main
 * outflow -> inflow path so the money movement is visible, not just
 * implied. All motion is CSS keyframes plus one small
 * requestAnimationFrame loop for the particles (HTML dots stay round
 * at any panel aspect ratio, unlike stretched-SVG motion), and every
 * heavy animation is disabled under prefers-reduced-motion.
 *
 * All data comes from /api/flow-map (public sources only); an asset
 * whose source fails shows as a greyed "unavailable" node - nothing
 * is ever simulated. The page server-renders the first snapshot;
 * this component then re-fetches /api/flow-map every 5 minutes and
 * swaps the data in silently (a failed tick keeps the snapshot
 * already on screen, the same pattern as the coin pages). Values
 * cross-fade on refresh via keyed spans, so updates never jump the
 * layout. The Fed countdown ticks locally every second from the
 * scheduled decision instant the API returns.
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
const NEUTRAL = '#eab308';

/** Shared panel-label typography: one hierarchy everywhere. */
const LABEL_CLASS =
    'text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground';

function directionColor(asset: FlowAsset): string {
    const change = asset.changePct ?? asset.zScore ?? 0;
    return change >= 0 ? GREEN : RED;
}

/** Node diameter grows with |z-score|: 86px up to ~122px at 4σ+. */
function nodeSize(asset: FlowAsset): number {
    if (asset.status !== 'ok' || asset.zScore === null) return 86;
    return 86 + Math.min(Math.abs(asset.zScore), 4) * 9;
}

/**
 * Breathing cadence for a node, scaled by |z-score|: calm nodes pulse
 * slowly and faintly (3.6s), extreme nodes visibly faster (1.7s) with
 * a second, phase-shifted ring once |z| reaches 1.5.
 */
function pulseParams(z: number | null): { duration: number; rings: number; ringOpacity: number } {
    const mag = Math.min(Math.abs(z ?? 0), 4);
    const strength = mag / 4;
    return {
        duration: 3.6 - strength * 1.9,
        rings: mag >= 1.5 ? 2 : 1,
        ringOpacity: 0.18 + strength * 0.45
    };
}

function NodeFace({ asset, size }: { asset: FlowAsset; size: number }) {
    if (asset.status !== 'ok' || asset.zScore === null || asset.changePct === null) {
        return (
            <div
                className="flex flex-col items-center justify-center rounded-full border border-dashed border-white/15 bg-white/[0.02] text-center"
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
    const { duration, rings, ringOpacity } = pulseParams(asset.zScore);
    const faceStyle = {
        width: size,
        height: size,
        border: `1px solid ${color}8c`,
        background: `radial-gradient(circle at 50% 36%, ${color}2b 0%, ${color}0d 60%, rgba(2,4,8,0.55) 100%)`,
        '--fm-glow': `${color}59`,
        '--fm-dur': `${duration}s`
    } as CSSProperties;

    return (
        <div className="relative" style={{ width: size, height: size }}>
            {Array.from({ length: rings }).map((_, i) => (
                <span
                    key={i}
                    aria-hidden="true"
                    className="flowmap-ring pointer-events-none absolute inset-0 rounded-full"
                    style={
                        {
                            border: `1.5px solid ${color}`,
                            '--fm-dur': `${duration}s`,
                            '--fm-ring-o': ringOpacity,
                            animationDelay: `${(duration / rings) * i}s`
                        } as CSSProperties
                    }
                />
            ))}
            <div
                className="flowmap-node flex h-full w-full flex-col items-center justify-center rounded-full text-center"
                style={faceStyle}
            >
                <span className="px-1 text-[9px] font-semibold uppercase leading-tight tracking-[0.14em] text-white/70">
                    {asset.name}
                </span>
                <div
                    key={`${asset.zScore}|${asset.changePct}|${asset.price}`}
                    className="flowmap-value flex flex-col items-center"
                >
                    <span className="font-mono text-[17px] font-bold leading-tight" style={{ color }}>
                        {formatZ(asset.zScore)}
                    </span>
                    <span className="font-mono text-[11px] leading-tight" style={{ color }}>
                        {formatSignedPct(asset.changePct)}
                    </span>
                    <span className="mt-0.5 font-mono text-[9px] leading-tight text-white/45">
                        {formatPrice(asset)}
                    </span>
                </div>
            </div>
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

/** The Fed node face, shared by the desktop map and the mobile grid. */
function FedFace({ fed, size = 92 }: { fed: FlowMapData['fed']; size?: number }) {
    return (
        <div className="relative" style={{ width: size, height: size }}>
            <span
                aria-hidden="true"
                className="flowmap-ring pointer-events-none absolute inset-0 rounded-full"
                style={
                    {
                        border: `1.5px solid ${GOLD}`,
                        '--fm-dur': '3.8s',
                        '--fm-ring-o': 0.28
                    } as CSSProperties
                }
            />
            <div
                className="flowmap-node flex h-full w-full flex-col items-center justify-center rounded-full text-center"
                style={
                    {
                        border: `1px solid ${GOLD}8c`,
                        background: `radial-gradient(circle at 50% 36%, ${GOLD}2b 0%, ${GOLD}0d 60%, rgba(2,4,8,0.55) 100%)`,
                        '--fm-glow': `${GOLD}4d`,
                        '--fm-dur': '3.8s'
                    } as CSSProperties
                }
            >
                <span
                    className="text-[10px] font-bold uppercase tracking-[0.18em]"
                    style={{ color: GOLD }}
                >
                    The Fed
                </span>
                <span className="mt-0.5 px-1 text-[9px] leading-tight text-white/70">
                    {fed ? fed.label.replace(/^\w{3}, /, '') : 'unavailable'}
                </span>
            </div>
        </div>
    );
}

function FedNode({ fed }: { fed: FlowMapData['fed'] }) {
    return (
        <div
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${FED_POSITION.x}%`, top: `${FED_POSITION.y}%`, zIndex: 12 }}
        >
            <FedFace fed={fed} />
        </div>
    );
}

/** The main money path endpoints, resolved from the API flow summary. */
function flowEndpoints(data: FlowMapData): { from: FlowAsset; to: FlowAsset } | null {
    if (!data.flowSummary) return null;
    const out = data.assets.find(a => a.name === data.flowSummary?.outflowName);
    const into = data.assets.find(a => a.name === data.flowSummary?.inflowName);
    if (!out || !into || out.id === into.id) return null;
    if (!NODE_POSITIONS[out.id] || !NODE_POSITIONS[into.id]) return null;
    return { from: out, to: into };
}

/** Quadratic control point for the flow curve - shared by the SVG path
 *  and the particle motion so the dots ride exactly on the line. */
function flowControlPoint(p1: { x: number; y: number }, p2: { x: number; y: number }) {
    return { x: (p1.x + p2.x) / 2, y: Math.min(p1.y, p2.y) - 10 };
}

/**
 * Gold particles travelling the outflow -> inflow curve. HTML dots
 * driven by one rAF loop: unlike SVG animateMotion inside the
 * aspect-stretched underlay, they stay perfectly round at any panel
 * size. Under prefers-reduced-motion they rest at fixed points along
 * the path instead of travelling.
 */
function FlowParticles({ from, to }: { from: FlowAsset; to: FlowAsset }) {
    const wrapRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const wrap = wrapRef.current;
        const p1 = NODE_POSITIONS[from.id];
        const p2 = NODE_POSITIONS[to.id];
        if (!wrap || !p1 || !p2) return;
        const dots = Array.from(wrap.children) as HTMLElement[];
        const ctrl = flowControlPoint(p1, p2);
        const pointAt = (t: number) => {
            const u = 1 - t;
            return {
                x: u * u * p1.x + 2 * u * t * ctrl.x + t * t * p2.x,
                y: u * u * p1.y + 2 * u * t * ctrl.y + t * t * p2.y
            };
        };
        const place = (t: number, dot: HTMLElement) => {
            const p = pointAt(t);
            dot.style.left = `${p.x}%`;
            dot.style.top = `${p.y}%`;
            dot.style.opacity = `${Math.sin(Math.PI * t) * 0.95}`;
        };

        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            [0.3, 0.55, 0.8].forEach((t, i) => dots[i] && place(t, dots[i]));
            return;
        }

        let raf = 0;
        const DURATION = 3600;
        const start = performance.now();
        const tick = (now: number) => {
            const base = ((now - start) % DURATION) / DURATION;
            dots.forEach((dot, i) => place((base + i / dots.length) % 1, dot));
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [from.id, to.id]);

    return (
        <div
            ref={wrapRef}
            className="pointer-events-none absolute inset-0 z-[5]"
            aria-hidden="true"
        >
            {[0, 1, 2].map(i => (
                <span key={i} className="flowmap-particle" style={{ opacity: 0 }} />
            ))}
        </div>
    );
}

/** SVG underlay: faint drifting cluster links + the main flow line. */
function MapLinks({
    flow,
    assets
}: {
    flow: { from: FlowAsset; to: FlowAsset } | null;
    assets: FlowAsset[];
}) {
    const okIds = new Set(assets.filter(a => a.status === 'ok').map(a => a.id));
    let flowPath: string | null = null;
    if (flow) {
        const p1 = NODE_POSITIONS[flow.from.id];
        const p2 = NODE_POSITIONS[flow.to.id];
        const c = flowControlPoint(p1, p2);
        flowPath = `M ${p1.x} ${p1.y} Q ${c.x} ${c.y} ${p2.x} ${p2.y}`;
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
                const pa = NODE_POSITIONS[a];
                const pb = NODE_POSITIONS[b];
                if (!pa || !pb || !okIds.has(a) || !okIds.has(b)) return null;
                return (
                    <line
                        key={`${a}-${b}`}
                        x1={pa.x}
                        y1={pa.y}
                        x2={pb.x}
                        y2={pb.y}
                        stroke="#ffffff"
                        strokeOpacity="0.07"
                        strokeWidth="1"
                        strokeDasharray="2.5 4.5"
                        vectorEffect="non-scaling-stroke"
                        className="flowmap-link"
                    />
                );
            })}
            {flowPath && (
                <>
                    <path
                        d={flowPath}
                        fill="none"
                        stroke={GOLD}
                        strokeOpacity="0.1"
                        strokeWidth="5"
                        vectorEffect="non-scaling-stroke"
                    />
                    <path
                        id="flowmap-flow-path"
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
                </>
            )}
        </svg>
    );
}

/** Mobile fallback (<481px): the same nodes in a tidy two-column grid. */
function MobileNodeGrid({ data }: { data: FlowMapData }) {
    const byGroup = (group: FlowAsset['group']) => data.assets.filter(a => a.group === group);
    const Column = ({ title, assets }: { title: string; assets: FlowAsset[] }) => (
        <div>
            <p className={`mb-3 text-center ${LABEL_CLASS}`}>{title}</p>
            <div className="flex flex-col items-center gap-4">
                {assets.map(asset => (
                    <NodeFace key={asset.id} asset={asset} size={92} />
                ))}
            </div>
        </div>
    );

    return (
        <div className="p-4">
            <div className="grid grid-cols-2 gap-4">
                <Column title="Risk" assets={byGroup('risk')} />
                <Column title="Safety" assets={byGroup('safety')} />
            </div>
            <div className="mt-5 flex justify-center">
                <FedFace fed={data.fed} />
            </div>
            {data.flowSummary && (
                <p className="mt-5 text-center font-mono text-[11px] text-white/70">
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
            <p className={LABEL_CLASS}>Next Fed rate decision</p>
            <p className="mt-2 text-sm font-semibold">{label}</p>
            <p className="mt-1 font-mono text-[22px] leading-tight" style={{ color: GOLD }}>
                {days}d {pad(hours)}h {pad(minutes)}m {pad(seconds)}s
            </p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">2:00 PM New York</p>
        </div>
    );
}

function MiniStat({ asset, amber }: { asset: FlowAsset | undefined; amber?: boolean }) {
    return (
        <div className="glass rounded-xl px-3.5 py-3 shadow-[0_16px_36px_-24px_rgba(0,0,0,0.9)]">
            <p className={LABEL_CLASS}>{asset?.name ?? '—'}</p>
            {asset && asset.status === 'ok' && asset.price !== null ? (
                <p
                    key={`${asset.price}|${asset.changePct}`}
                    className="flowmap-value mt-1 font-mono text-base leading-tight"
                >
                    <span className={amber ? 'text-amber-500' : undefined}>{formatPrice(asset)}</span>{' '}
                    <span
                        className={`text-xs ${(asset.changePct ?? 0) >= 0 ? 'text-green-500' : 'text-red-500'}`}
                    >
                        {asset.changePct !== null ? formatSignedPct(asset.changePct) : ''}
                    </span>
                </p>
            ) : (
                <p className="mt-1 text-sm text-muted-foreground">unavailable</p>
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
        <div
            className="glass flowmap-ticker-wrap relative mt-5 overflow-hidden rounded-xl py-2.5 shadow-[0_16px_36px_-24px_rgba(0,0,0,0.9)]"
            aria-hidden="true"
        >
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
            <div className="glass rounded-2xl p-6 text-center">
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
    const meterHex =
        meter?.label === 'RISK-OFF' ? RED : meter?.label === 'RISK-ON' ? GREEN : NEUTRAL;
    const meterColor =
        meter?.label === 'RISK-OFF'
            ? 'text-red-500'
            : meter?.label === 'RISK-ON'
              ? 'text-green-500'
              : 'text-yellow-500';
    const vix = data.assets.find(a => a.id === 'vix');
    const dollar = data.assets.find(a => a.id === 'dollar');
    const mapAssets = data.assets.filter(a => NODE_POSITIONS[a.id]);
    const flow = flowEndpoints(data);

    const panelShadow = 'shadow-[0_20px_45px_-24px_rgba(0,0,0,0.9)]';

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
                .flowmap-ticker-wrap:hover .flowmap-ticker {
                    animation-play-state: paused;
                }
                @keyframes flowmap-dashmove {
                    to { stroke-dashoffset: -18; }
                }
                .flowmap-dash {
                    animation: flowmap-dashmove 1.6s linear infinite;
                }
                @keyframes flowmap-linkdrift {
                    to { stroke-dashoffset: -14; }
                }
                .flowmap-link {
                    animation: flowmap-linkdrift 5s linear infinite;
                }
                @keyframes flowmap-ring {
                    0% { transform: scale(1); opacity: var(--fm-ring-o, 0.4); }
                    100% { transform: scale(1.5); opacity: 0; }
                }
                .flowmap-ring {
                    animation: flowmap-ring var(--fm-dur, 3s) cubic-bezier(0.2, 0.6, 0.35, 1) infinite;
                    will-change: transform, opacity;
                }
                @keyframes flowmap-breathe {
                    0%, 100% {
                        box-shadow: 0 10px 24px -12px rgba(0, 0, 0, 0.9),
                            0 0 12px -2px var(--fm-glow), inset 0 0 16px -6px var(--fm-glow);
                    }
                    50% {
                        box-shadow: 0 10px 24px -12px rgba(0, 0, 0, 0.9),
                            0 0 30px 0 var(--fm-glow), inset 0 0 22px -4px var(--fm-glow);
                    }
                }
                .flowmap-node {
                    animation: flowmap-breathe var(--fm-dur, 3s) ease-in-out infinite;
                }
                @keyframes flowmap-fadein {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                .flowmap-value {
                    animation: flowmap-fadein 0.6s ease both;
                }
                .flowmap-particle {
                    position: absolute;
                    width: 7px;
                    height: 7px;
                    border-radius: 9999px;
                    background: radial-gradient(circle, #f3d27a 0%, ${GOLD} 55%, rgba(212, 175, 55, 0) 100%);
                    box-shadow: 0 0 10px 2px rgba(212, 175, 55, 0.55);
                    transform: translate(-50%, -50%);
                    will-change: left, top, opacity;
                }
                @media (prefers-reduced-motion: reduce) {
                    .flowmap-ticker, .flowmap-dash, .flowmap-link,
                    .flowmap-ring, .flowmap-node, .flowmap-value {
                        animation: none !important;
                    }
                }
            `}</style>

            <div className="grid gap-5 lg:grid-cols-3">
                {/* Node map */}
                <div
                    className={`glass relative overflow-hidden rounded-2xl ${panelShadow} lg:col-span-2`}
                >
                    <div className="flex items-baseline justify-between gap-2 border-b border-white/[0.06] px-5 py-3.5">
                        <span
                            className="text-xs font-bold uppercase tracking-[0.24em]"
                            style={{ color: GOLD }}
                        >
                            Money Flow Map
                        </span>
                        <span className="text-right text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
                            Where the world&rsquo;s money is moving
                        </span>
                    </div>

                    {/* Desktop / tablet: absolute node layout */}
                    <div
                        className="relative hidden h-[540px] min-[481px]:block"
                        style={{
                            background:
                                'radial-gradient(ellipse at 28% 18%, rgba(255,255,255,0.03), transparent 55%), radial-gradient(ellipse at 76% 82%, rgba(212,175,55,0.045), transparent 52%)'
                        }}
                    >
                        <MapLinks flow={flow} assets={data.assets} />
                        {flow && <FlowParticles from={flow.from} to={flow.to} />}
                        {mapAssets.map(asset => (
                            <MapNode key={asset.id} asset={asset} />
                        ))}
                        <FedNode fed={data.fed} />
                        <span className="absolute left-4 top-3 text-[9px] font-semibold uppercase tracking-[0.2em] text-white/35">
                            Risk
                        </span>
                        <span className="absolute right-4 top-3 text-[9px] font-semibold uppercase tracking-[0.2em] text-white/35">
                            Safety
                        </span>
                    </div>

                    {/* Narrow screens: two-column node grid */}
                    <div className="min-[481px]:hidden">
                        <MobileNodeGrid data={data} />
                    </div>
                </div>

                {/* Side panel */}
                <div className="flex flex-col gap-5">
                    {meter && (
                        <div className={`glass rounded-2xl p-5 ${panelShadow}`}>
                            <p className={LABEL_CLASS}>Risk-On / Risk-Off Meter</p>
                            <p
                                key={meter.score}
                                className={`flowmap-value mt-2 font-mono text-5xl font-bold leading-none transition-colors duration-700 ${meterColor}`}
                            >
                                {meter.score > 0 ? '+' : ''}
                                {meter.score}
                            </p>
                            <p
                                className={`mt-1.5 text-sm font-bold tracking-[0.18em] transition-colors duration-700 ${meterColor}`}
                            >
                                {meter.label}
                            </p>
                            <div className="relative mt-4 h-2 overflow-hidden rounded-full bg-white/[0.07]">
                                <div
                                    className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out"
                                    style={{ width: `${meterPct}%`, background: meterHex }}
                                />
                            </div>
                            <div className="mt-1.5 flex justify-between text-[10px] text-muted-foreground">
                                <span>−100 RISK-OFF</span>
                                <span>+100 RISK-ON</span>
                            </div>
                            <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
                                Speculative read — computed from public market data.
                            </p>
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-5">
                        <MiniStat asset={vix} amber />
                        <MiniStat asset={dollar} />
                    </div>

                    {data.fed && (
                        <div className={`glass rounded-2xl p-5 ${panelShadow}`}>
                            <FedCountdown date={data.fed.date} label={data.fed.label} />
                        </div>
                    )}

                    {data.flowSummary && (
                        <div className={`glass rounded-2xl p-5 ${panelShadow}`}>
                            <p className={LABEL_CLASS}>What the flow says</p>
                            <div
                                key={`${data.flowSummary.outflowName}|${data.flowSummary.inflowName}|${data.flowSummary.outflowZ}|${data.flowSummary.inflowZ}`}
                                className="flowmap-value"
                            >
                                <p className="mt-2.5 text-sm">
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
                        </div>
                    )}
                </div>
            </div>

            {data.summary && (
                <div className={`glass mt-5 rounded-2xl p-5 ${panelShadow}`}>
                    <p className={LABEL_CLASS}>Summary</p>
                    <div key={data.summary.en} className="flowmap-value">
                        <p className="mt-2.5 text-sm leading-relaxed">{data.summary.en}</p>
                        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
                            {data.summary.ur}
                        </p>
                    </div>
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
