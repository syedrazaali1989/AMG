'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
    createChart,
    ColorType,
    CandlestickSeries,
    LineStyle,
    type IChartApi,
    type IPriceLine,
    type ISeriesApi,
    type LineWidth,
    type UTCTimestamp
} from 'lightweight-charts';
import { formatPrice } from '@/lib/utils';

/**
 * CoinChart - 1H candlestick chart for a coin page.
 *
 * Same approach as SignalChart: candles come from /api/candles
 * (server-side Binance data). When an active signal exists for the
 * pair, its Entry / SL / TP levels are drawn as labelled price lines;
 * otherwise this is a plain price chart.
 *
 * Honesty rule (same as SignalChart): if live candle data cannot be
 * loaded, the chart is replaced by a plain "chart unavailable" note.
 * Candles are never simulated.
 *
 * Candles are re-fetched every 60 seconds and the signal levels are
 * re-drawn whenever the active signal for the pair changes, so the
 * chart stays current while the page is open. Updates are applied to
 * the live chart instance in place - the chart is not rebuilt, and
 * the visible range is not reset, on a refresh tick.
 */

export interface CoinChartLevels {
    entryPrice: number;
    stopLoss: number;
    takeProfit?: number;
    takeProfit1?: number;
    takeProfit2?: number;
    takeProfit3?: number;
}

interface CandlePoint {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
}

interface Level {
    label: string;
    price: number;
    color: string;
    lineWidth: LineWidth;
    lineStyle: LineStyle;
}

interface CoinChartProps {
    /** Display pair, e.g. 'BTC/USDT' */
    pair: string;
    levels?: CoinChartLevels | null;
    height?: number;
}

export function CoinChart({ pair, levels: signalLevels, height = 380 }: CoinChartProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
    const priceLinesRef = useRef<IPriceLine[]>([]);
    const fittedRef = useRef(false);
    const [candles, setCandles] = useState<CandlePoint[] | null>(null);
    const [failed, setFailed] = useState(false);

    // The unavailable note replaces the chart only when no candle data
    // has ever loaded; a failed refresh tick keeps the chart on screen.
    const showUnavailable = failed && !candles;

    const levels = useMemo<Level[]>(() => {
        if (!signalLevels) return [];
        const list: Level[] = [];
        const add = (label: string, price: number | undefined, color: string, lineWidth: LineWidth, lineStyle: LineStyle) => {
            if (price !== undefined && Number.isFinite(price) && price > 0) {
                list.push({ label, price, color, lineWidth, lineStyle });
            }
        };
        add('Entry', signalLevels.entryPrice, '#93c5fd', 2, LineStyle.Solid);
        add('SL', signalLevels.stopLoss, '#ef4444', 2, LineStyle.Dashed);
        if (signalLevels.takeProfit1 && signalLevels.takeProfit2 && signalLevels.takeProfit3) {
            add('TP1', signalLevels.takeProfit1, '#86efac', 1, LineStyle.Dashed);
            add('TP2', signalLevels.takeProfit2, '#4ade80', 1, LineStyle.Dashed);
            add('TP3', signalLevels.takeProfit3, '#22c55e', 1, LineStyle.Dashed);
        } else {
            add('TP', signalLevels.takeProfit, '#4ade80', 1, LineStyle.Dashed);
        }
        return list;
    }, [signalLevels]);

    useEffect(() => {
        let cancelled = false;
        let hasData = false;
        setCandles(null);
        setFailed(false);

        const loadCandles = () => {
            fetch(`/api/candles?pair=${encodeURIComponent(pair)}&interval=1h&limit=100`)
                .then(res => {
                    if (!res.ok) throw new Error(`Candles request failed: ${res.status}`);
                    return res.json();
                })
                .then(data => {
                    if (cancelled) return;
                    if (Array.isArray(data.candles) && data.candles.length > 0) {
                        hasData = true;
                        setCandles(data.candles);
                        setFailed(false);
                    } else if (!hasData) {
                        setFailed(true);
                    }
                })
                .catch(() => {
                    if (!cancelled && !hasData) setFailed(true);
                });
        };

        loadCandles();
        const interval = setInterval(loadCandles, 60_000);
        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, [pair]);

    // Create the chart instance once (and again only if the
    // unavailable note replaced it). Data and price lines are applied
    // in place by the effects below.
    useEffect(() => {
        if (showUnavailable || !containerRef.current) return;

        const chart = createChart(containerRef.current, {
            layout: {
                background: { type: ColorType.Solid, color: 'transparent' },
                textColor: '#9ca3af'
            },
            grid: {
                vertLines: { color: 'rgba(42, 46, 57, 0.1)' },
                horzLines: { color: 'rgba(42, 46, 57, 0.1)' }
            },
            width: containerRef.current.clientWidth,
            height,
            timeScale: {
                timeVisible: true,
                secondsVisible: false,
                borderColor: 'rgba(42, 46, 57, 0.2)'
            },
            rightPriceScale: {
                borderColor: 'rgba(42, 46, 57, 0.2)'
            }
        });
        chartRef.current = chart;

        seriesRef.current = chart.addSeries(CandlestickSeries, {
            upColor: '#10b981',
            downColor: '#ef4444',
            borderVisible: false,
            wickUpColor: '#10b981',
            wickDownColor: '#ef4444'
        });

        const resizeObserver = new ResizeObserver(() => {
            if (containerRef.current) {
                chart.applyOptions({ width: containerRef.current.clientWidth });
            }
        });
        resizeObserver.observe(containerRef.current);

        return () => {
            resizeObserver.disconnect();
            chart.remove();
            chartRef.current = null;
            seriesRef.current = null;
            priceLinesRef.current = [];
            fittedRef.current = false;
        };
    }, [height, showUnavailable]);

    // Apply candle data in place; fit the view only on first load so
    // refresh ticks do not reset the reader's zoom or scroll.
    useEffect(() => {
        const series = seriesRef.current;
        if (!series || !candles) return;
        series.setData(candles.map(c => ({
            time: c.time as UTCTimestamp,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close
        })));
        if (!fittedRef.current) {
            chartRef.current?.timeScale().fitContent();
            fittedRef.current = true;
        }
    }, [candles, showUnavailable]);

    // Keep the Entry / SL / TP price lines in sync with the levels
    // prop: when the active signal for the pair appears, changes or
    // disappears, the old lines are removed and the new ones drawn.
    useEffect(() => {
        const series = seriesRef.current;
        if (!series) return;
        for (const line of priceLinesRef.current) {
            series.removePriceLine(line);
        }
        priceLinesRef.current = levels.map(level => series.createPriceLine({
            price: level.price,
            color: level.color,
            lineWidth: level.lineWidth,
            lineStyle: level.lineStyle,
            axisLabelVisible: true,
            title: `${level.label} ${formatPrice(level.price)}`
        }));
    }, [levels, showUnavailable]);

    if (showUnavailable) {
        return (
            <div className="glass-dark rounded-lg p-3 text-center">
                <div className="text-xs font-semibold text-muted-foreground">Chart unavailable</div>
                <div className="text-[11px] text-muted-foreground mt-1">
                    Live candle data could not be loaded for {pair}.
                </div>
            </div>
        );
    }

    return (
        <div>
            <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                    Price Chart · 1H · Binance
                </span>
                {levels.length > 0 && (
                    <span className="text-[11px] text-muted-foreground">Active signal levels marked</span>
                )}
            </div>
            <div className="relative">
                <div ref={containerRef} className="w-full" style={{ minHeight: height }} />
                {!candles && (
                    <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-xs text-muted-foreground">Loading chart…</span>
                    </div>
                )}
            </div>
            {candles && levels.length > 0 && (
                <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
                    {levels.map(level => (
                        <span key={level.label} className="flex items-center gap-1.5 text-[11px]">
                            <span
                                className="inline-block w-2.5 h-[3px] rounded-full"
                                style={{ backgroundColor: level.color }}
                            />
                            <span className="text-muted-foreground">{level.label}</span>
                            <span className="font-semibold font-mono">{formatPrice(level.price)}</span>
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}
