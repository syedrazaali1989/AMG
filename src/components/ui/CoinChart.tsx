'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
    createChart,
    ColorType,
    CandlestickSeries,
    LineStyle,
    type IChartApi,
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
    const [candles, setCandles] = useState<CandlePoint[] | null>(null);
    const [failed, setFailed] = useState(false);

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
        setCandles(null);
        setFailed(false);
        fetch(`/api/candles?pair=${encodeURIComponent(pair)}&interval=1h&limit=100`)
            .then(res => {
                if (!res.ok) throw new Error(`Candles request failed: ${res.status}`);
                return res.json();
            })
            .then(data => {
                if (cancelled) return;
                if (Array.isArray(data.candles) && data.candles.length > 0) {
                    setCandles(data.candles);
                } else {
                    setFailed(true);
                }
            })
            .catch(() => {
                if (!cancelled) setFailed(true);
            });
        return () => {
            cancelled = true;
        };
    }, [pair]);

    useEffect(() => {
        if (!candles || !containerRef.current) return;

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

        const series = chart.addSeries(CandlestickSeries, {
            upColor: '#10b981',
            downColor: '#ef4444',
            borderVisible: false,
            wickUpColor: '#10b981',
            wickDownColor: '#ef4444'
        });

        series.setData(candles.map(c => ({
            time: c.time as UTCTimestamp,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close
        })));

        for (const level of levels) {
            series.createPriceLine({
                price: level.price,
                color: level.color,
                lineWidth: level.lineWidth,
                lineStyle: level.lineStyle,
                axisLabelVisible: true,
                title: `${level.label} ${formatPrice(level.price)}`
            });
        }

        chart.timeScale().fitContent();

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
        };
    }, [candles, levels, height]);

    if (failed) {
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
