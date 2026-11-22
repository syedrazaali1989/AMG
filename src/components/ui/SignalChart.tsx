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
import { Signal } from '@/lib/signals/types';
import { formatPrice } from '@/lib/utils';

/**
 * SignalChart - candlestick chart for one signal card (dashboard).
 *
 * Fetches recent 1H candles for the signal's pair from /api/candles
 * (server-side Binance data) and draws the signal's own levels as
 * labelled price lines on the chart: Entry, Stop Loss, TP1, TP2, TP3.
 *
 * Honesty rule: if live candle data cannot be loaded, the chart is
 * replaced by a plain "chart unavailable" note. No candles or prices
 * are ever simulated - the signal numbers in the card remain the
 * source of truth.
 */

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

interface SignalChartProps {
    signal: Signal;
    height?: number;
}

export function SignalChart({ signal, height = 260 }: SignalChartProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const [candles, setCandles] = useState<CandlePoint[] | null>(null);
    const [failed, setFailed] = useState(false);

    // The signal's own levels, straight from the /api/signals payload.
    const levels = useMemo<Level[]>(() => {
        const list: Level[] = [];
        const add = (label: string, price: number | undefined, color: string, lineWidth: LineWidth, lineStyle: LineStyle) => {
            if (price !== undefined && Number.isFinite(price) && price > 0) {
                list.push({ label, price, color, lineWidth, lineStyle });
            }
        };
        add('Entry', signal.entryPrice, '#93c5fd', 2, LineStyle.Solid);
        add('SL', signal.stopLoss, '#ef4444', 2, LineStyle.Dashed);
        if (signal.takeProfit1 && signal.takeProfit2 && signal.takeProfit3) {
            add('TP1', signal.takeProfit1, '#86efac', 1, LineStyle.Dashed);
            add('TP2', signal.takeProfit2, '#4ade80', 1, LineStyle.Dashed);
            add('TP3', signal.takeProfit3, '#22c55e', 1, LineStyle.Dashed);
        } else {
            add('TP', signal.takeProfit, '#4ade80', 1, LineStyle.Dashed);
        }
        return list;
    }, [signal.entryPrice, signal.stopLoss, signal.takeProfit, signal.takeProfit1, signal.takeProfit2, signal.takeProfit3]);

    // Fetch real candles for this pair (server-side route, 60s cache).
    useEffect(() => {
        let cancelled = false;
        setCandles(null);
        setFailed(false);
        fetch(`/api/candles?pair=${encodeURIComponent(signal.pair)}&interval=1h&limit=100`)
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
    }, [signal.pair]);

    // Build the chart once candles are in; draw candles + price lines.
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

        // Labelled price lines: label + price in the line title, and the
        // price itself on the right axis (axisLabelVisible).
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
                    Live candle data could not be loaded for {signal.pair}. The entry, stop loss and
                    take profit levels for this signal are listed in the card below.
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
                <span className="text-[11px] text-muted-foreground">Entry / SL / TP levels marked</span>
            </div>
            <div className="relative">
                <div ref={containerRef} className="w-full" style={{ minHeight: height }} />
                {!candles && (
                    <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-xs text-muted-foreground">Loading chart…</span>
                    </div>
                )}
            </div>
            {candles && (
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
