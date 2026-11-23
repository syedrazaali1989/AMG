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
 * The line system reproduces Waqar Zaka's MONEY FLOW MAP as measured
 * frame-by-frame from his videos (see
 * ~/workspace/wz-research/flowmap-animation-notes.md): edges are a
 * topological chain, not a timed sequence. Sinks (z >= +1.5) receive
 * a gently curved, gradient ribbon from every source (z <= -0.3)
 * below them and from every weaker sink, so money reads as flowing
 * loser -> intermediate gainer -> biggest gainer. Small white dots
 * stream along EVERY edge simultaneously at a slow ambient drift,
 * looping seamlessly; nodes themselves never pulse or flash - they
 * carry a static soft glow in their own colour. The dots are HTML
 * spans driven by one requestAnimationFrame loop (they stay round at
 * any panel aspect ratio, unlike stretched-SVG motion) and rest at
 * fixed points under prefers-reduced-motion.
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

const GREEN = '#22c55e';
const RED = '#ef4444';
const GOLD = '#D4AF37';
const NEUTRAL = '#eab308';

/** Colour of an asset by the sign of its z-score (his node colours). */
function zColor(z: number): string {
    return z >= 0 ? GREEN : RED;
}

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
    // Static soft glow in the node's own colour - his nodes never
    // pulse, breathe or flash; only the dots on the lines move.
    const faceStyle = {
        width: size,
        height: size,
        border: `1px solid ${color}8c`,
        background: `radial-gradient(circle at 50% 36%, ${color}2b 0%, ${color}0d 60%, rgba(2,4,8,0.55) 100%)`,
        boxShadow: `0 10px 24px -12px rgba(0, 0, 0, 0.9), 0 0 20px -2px ${color}59, inset 0 0 16px -6px ${color}59`
    } as CSSProperties;

    return (
        <div
            className="flex flex-col items-center justify-center rounded-full text-center"
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

/** The Fed node face, shared by the desktop map and the mobile grid.
 *  Static gold glow like every other node; the Fed never has edges. */
function FedFace({ fed, size = 92 }: { fed: FlowMapData['fed']; size?: number }) {
    return (
        <div
            className="flex flex-col items-center justify-center rounded-full text-center"
            style={
                {
                    width: size,
                    height: size,
                    border: `1px solid ${GOLD}8c`,
                    background: `radial-gradient(circle at 50% 36%, ${GOLD}2b 0%, ${GOLD}0d 60%, rgba(2,4,8,0.55) 100%)`,
                    boxShadow: `0 10px 24px -12px rgba(0, 0, 0, 0.9), 0 0 20px -2px ${GOLD}4d, inset 0 0 16px -6px ${GOLD}4d`
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

/** One directed money-flow edge, source -> sink. */
interface FlowEdge {
    from: FlowAsset;
    to: FlowAsset;
    key: string;
}

/**
 * The edge rule, exactly as measured from Waqar Zaka's map
 * (flowmap-animation-notes.md §5): the chain is topological, not
 * timed. Sinks are assets with z >= +1.5; sources are assets with
 * z <= -0.3. Every source links to every sink stronger than it, and
 * every weaker sink links onward to every stronger sink - which is
 * what builds the multi-hop chain (Gold -> Bonds -> Stablecoins)
 * when two sinks exist, and leaves only direct edges when there is
 * just one sink. Assets between -0.3 and +1.5 get no edges, the Fed
 * never has any, and with no sinks or no sources there are no edges
 * at all. Only assets placed on the map take part.
 */
const SINK_Z = 1.5;
const SOURCE_Z = -0.3;

function computeFlowEdges(assets: FlowAsset[]): FlowEdge[] {
    const live = assets.filter(
        a => a.status === 'ok' && a.zScore !== null && NODE_POSITIONS[a.id]
    ) as (FlowAsset & { zScore: number })[];
    const sinks = live.filter(a => a.zScore >= SINK_Z);
    const sources = live.filter(a => a.zScore <= SOURCE_Z);
    if (sinks.length === 0 || sources.length === 0) return [];

    const edges: FlowEdge[] = [];
    const push = (from: (typeof live)[number], to: (typeof live)[number]) => {
        if (from.id !== to.id) {
            edges.push({ from, to, key: `${from.id}->${to.id}` });
        }
    };
    for (const source of sources) {
        for (const sink of sinks) {
            if (sink.zScore > source.zScore) push(source, sink);
        }
    }
    for (const weaker of sinks) {
        for (const stronger of sinks) {
            if (stronger.zScore > weaker.zScore) push(weaker, stronger);
        }
    }
    return edges;
}

/**
 * Quadratic control point for an edge: the midpoint pushed sideways
 * (perpendicular to the chord) by ~12% of the chord length, so every
 * ribbon bows gently like his. Shared by the SVG path and the dot
 * motion so the dots ride exactly on the ribbon. Coordinates are in
 * map % space; the SVG's non-scaling viewBox applies the same affine
 * stretch to both, so they stay in register at any panel size.
 */
function edgeControlPoint(p1: { x: number; y: number }, p2: { x: number; y: number }) {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy) || 1;
    const bow = Math.min(len * 0.12, 10);
    return {
        x: (p1.x + p2.x) / 2 + (dy / len) * bow,
        y: (p1.y + p2.y) / 2 - (dx / len) * bow
    };
}

function edgePathD(edge: FlowEdge): string {
    const p1 = NODE_POSITIONS[edge.from.id];
    const p2 = NODE_POSITIONS[edge.to.id];
    const c = edgeControlPoint(p1, p2);
    return `M ${p1.x} ${p1.y} Q ${c.x} ${c.y} ${p2.x} ${p2.y}`;
}

/** Sampled bézier points with cumulative arc lengths, in pixels. */
function sampleEdge(
    edge: FlowEdge,
    width: number,
    height: number
): { points: { x: number; y: number }[]; cum: number[]; total: number } {
    const p1 = NODE_POSITIONS[edge.from.id];
    const p2 = NODE_POSITIONS[edge.to.id];
    const c = edgeControlPoint(p1, p2);
    const toPx = (p: { x: number; y: number }) => ({
        x: (p.x / 100) * width,
        y: (p.y / 100) * height
    });
    const a = toPx(p1);
    const b = toPx(c);
    const d = toPx(p2);
    const STEPS = 120;
    const points: { x: number; y: number }[] = [];
    const cum: number[] = [0];
    for (let i = 0; i <= STEPS; i++) {
        const t = i / STEPS;
        const u = 1 - t;
        const pt = {
            x: u * u * a.x + 2 * u * t * b.x + t * t * d.x,
            y: u * u * a.y + 2 * u * t * b.y + t * t * d.y
        };
        if (i > 0) {
            const prev = points[i - 1];
            cum.push(cum[i - 1] + Math.hypot(pt.x - prev.x, pt.y - prev.y));
        }
        points.push(pt);
    }
    return { points, cum, total: cum[STEPS] };
}

function pointAtArc(
    sampled: { points: { x: number; y: number }[]; cum: number[]; total: number },
    s: number
): { x: number; y: number } {
    const { points, cum, total } = sampled;
    const target = ((s % total) + total) % total;
    let lo = 0;
    let hi = cum.length - 1;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (cum[mid] < target) lo = mid + 1;
        else hi = mid;
    }
    const i = Math.max(1, lo);
    const segLen = cum[i] - cum[i - 1] || 1;
    const f = (target - cum[i - 1]) / segLen;
    return {
        x: points[i - 1].x + (points[i].x - points[i - 1].x) * f,
        y: points[i - 1].y + (points[i].y - points[i - 1].y) * f
    };
}

/**
 * Dot-stream tuning, scaled from his measured values: dots ~55px
 * apart on a ~1100px-wide map, drifting at ~10px/s (his 7-13 px/s at
 * 1920w, with the same spacing-to-speed ratio, so the stream visibly
 * creeps). Dot counts are estimated in a nominal 1000x540 space so
 * server and client render the same spans; placement uses the real
 * measured panel size.
 */
const DOT_SPACING_PX = 55;
const DOT_SPEED_PX_S = 10;

function edgeDotCount(edge: FlowEdge): number {
    const { total } = sampleEdge(edge, 1000, 540);
    return Math.max(2, Math.round(total / DOT_SPACING_PX));
}

/**
 * White dots streaming along EVERY edge at once, source -> sink,
 * looping seamlessly - the only moving elements inside his map.
 * One rAF loop drives all edges; each edge's dots sit at fixed
 * arc-length offsets that advance together, so spacing stays even
 * along the curve. Under prefers-reduced-motion the dots rest at
 * those fixed offsets instead of travelling.
 */
function FlowDots({ edges }: { edges: FlowEdge[] }) {
    const wrapRef = useRef<HTMLDivElement>(null);
    const signature = edges.map(e => e.key).join(',');

    useEffect(() => {
        const wrap = wrapRef.current;
        if (!wrap || edges.length === 0) return;
        const groups = new Map<string, HTMLElement[]>();
        Array.from(wrap.children).forEach(child => {
            const el = child as HTMLElement;
            const key = el.dataset.edge;
            if (!key) return;
            const list = groups.get(key) ?? [];
            list.push(el);
            groups.set(key, list);
        });

        let raf = 0;
        let sampled = new Map<string, ReturnType<typeof sampleEdge>>();
        const measure = () => {
            const w = wrap.clientWidth;
            const h = wrap.clientHeight;
            sampled = new Map(edges.map(e => [e.key, sampleEdge(e, w, h)]));
        };
        measure();

        const placeAll = (advancePx: number) => {
            for (const edge of edges) {
                const s = sampled.get(edge.key);
                const dots = groups.get(edge.key);
                if (!s || !dots || s.total === 0) continue;
                const spacing = s.total / dots.length;
                dots.forEach((dot, i) => {
                    const p = pointAtArc(s, i * spacing + advancePx);
                    dot.style.left = `${p.x}px`;
                    dot.style.top = `${p.y}px`;
                    dot.style.opacity = '0.95';
                });
            }
        };

        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            placeAll(0);
            return;
        }

        const observer = new ResizeObserver(() => {
            measure();
        });
        observer.observe(wrap);

        const start = performance.now();
        const tick = (now: number) => {
            placeAll(((now - start) / 1000) * DOT_SPEED_PX_S);
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => {
            cancelAnimationFrame(raf);
            observer.disconnect();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [signature]);

    if (edges.length === 0) return null;

    return (
        <div
            ref={wrapRef}
            className="pointer-events-none absolute inset-0 z-[5]"
            aria-hidden="true"
        >
            {edges.map(edge => {
                const count = edgeDotCount(edge);
                return Array.from({ length: count }).map((_, i) => (
                    <span
                        key={`${edge.key}-${i}`}
                        data-edge={edge.key}
                        className="flowmap-dot"
                        style={{ opacity: 0 }}
                    />
                ));
            })}
        </div>
    );
}

/**
 * SVG underlay: the flow ribbons. Each edge is a gently curved
 * quadratic bézier drawn twice - a wide, faint glow underlay and a
 * ~3px core - stroked with a linear gradient from the source node's
 * colour to the destination node's colour, at low opacity so the
 * crossings stay readable.
 */
function MapEdges({ edges }: { edges: FlowEdge[] }) {
    return (
        <svg
            className="pointer-events-none absolute inset-0 h-full w-full"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
        >
            <defs>
                {edges.map(edge => {
                    const p1 = NODE_POSITIONS[edge.from.id];
                    const p2 = NODE_POSITIONS[edge.to.id];
                    return (
                        <linearGradient
                            key={edge.key}
                            id={`flow-grad-${edge.from.id}-${edge.to.id}`}
                            gradientUnits="userSpaceOnUse"
                            x1={p1.x}
                            y1={p1.y}
                            x2={p2.x}
                            y2={p2.y}
                        >
                            <stop offset="0%" stopColor={zColor(edge.from.zScore ?? 0)} />
                            <stop offset="100%" stopColor={zColor(edge.to.zScore ?? 0)} />
                        </linearGradient>
                    );
                })}
            </defs>
            {edges.map(edge => {
                const grad = `url(#flow-grad-${edge.from.id}-${edge.to.id})`;
                const d = edgePathD(edge);
                return (
                    <g key={edge.key}>
                        <path
                            d={d}
                            fill="none"
                            stroke={grad}
                            strokeOpacity="0.12"
                            strokeWidth="8"
                            vectorEffect="non-scaling-stroke"
                        />
                        <path
                            d={d}
                            fill="none"
                            stroke={grad}
                            strokeOpacity="0.5"
                            strokeWidth="3"
                            vectorEffect="non-scaling-stroke"
                            className="flowmap-edge"
                        />
                    </g>
                );
            })}
        </svg>
    );
}

/**
 * Mobile fallback (<481px): the same nodes in a tidy two-column
 * grid, with the desktop map's edges listed under it as compact text
 * arrows (strongest flow first, at most 4) - no particles here.
 */
function MobileNodeGrid({ data, edges }: { data: FlowMapData; edges: FlowEdge[] }) {
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

    const topFlows = [...edges]
        .sort((a, b) => (b.to.zScore ?? 0) - (b.from.zScore ?? 0) - ((a.to.zScore ?? 0) - (a.from.zScore ?? 0)))
        .slice(0, 4);

    return (
        <div className="p-4">
            <div className="grid grid-cols-2 gap-4">
                <Column title="Risk" assets={byGroup('risk')} />
                <Column title="Safety" assets={byGroup('safety')} />
            </div>
            <div className="mt-5 flex justify-center">
                <FedFace fed={data.fed} />
            </div>
            {topFlows.length > 0 && (
                <div className="mt-5 space-y-1.5 text-center font-mono text-[11px] text-white/70">
                    {topFlows.map(edge => (
                        <p key={edge.key}>
                            <span style={{ color: zColor(edge.from.zScore ?? 0) }}>
                                {edge.from.name}
                            </span>
                            {' → '}
                            <span style={{ color: zColor(edge.to.zScore ?? 0) }}>
                                {edge.to.name}
                            </span>
                        </p>
                    ))}
                </div>
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
    const edges = computeFlowEdges(data.assets);

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
                @keyframes flowmap-fadein {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                .flowmap-value {
                    animation: flowmap-fadein 0.6s ease both;
                }
                /* His dots: small plain white circles riding the ribbons.
                   Positioned by the rAF loop in FlowDots; no CSS motion,
                   so prefers-reduced-motion only needs the loop stopped
                   (handled there) plus the ticker/fades below. */
                .flowmap-dot {
                    position: absolute;
                    width: 5px;
                    height: 5px;
                    border-radius: 9999px;
                    background: #ffffff;
                    box-shadow: 0 0 6px 1px rgba(255, 255, 255, 0.75);
                    transform: translate(-50%, -50%);
                    will-change: left, top;
                }
                @media (prefers-reduced-motion: reduce) {
                    .flowmap-ticker, .flowmap-value {
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
                        <MapEdges edges={edges} />
                        <FlowDots edges={edges} />
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
                        <MobileNodeGrid data={data} edges={edges} />
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
