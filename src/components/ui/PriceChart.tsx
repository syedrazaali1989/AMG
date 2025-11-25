'use client';

import { useEffect, useRef } from 'react';
import { createChart, ColorType, IChartApi, ISeriesApi } from 'lightweight-charts';

interface PriceChartProps {
    data: { time: number; open: number; high: number; low: number; close: number }[];
    colors?: {
        backgroundColor?: string;
        lineColor?: string;
        textColor?: string;
        areaTopColor?: string;
        areaBottomColor?: string;
    };
    height?: number;
}

export function PriceChart({ data, colors, height = 300 }: PriceChartProps) {
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);

    useEffect(() => {
        if (!chartContainerRef.current) return;

        const handleResize = () => {
            if (chartRef.current && chartContainerRef.current) {
                chartRef.current.applyOptions({ width: chartContainerRef.current.clientWidth });
            }
        };

        const chart = createChart(chartContainerRef.current, {
            layout: {
                background: { type: ColorType.Solid, color: 'transparent' },
                textColor: colors?.textColor || '#9ca3af',
            },
            grid: {
                vertLines: { color: 'rgba(42, 46, 57, 0.1)' },
                horzLines: { color: 'rgba(42, 46, 57, 0.1)' },
            },
            width: chartContainerRef.current.clientWidth,
            height: height,
            timeScale: {
                timeVisible: true,
                secondsVisible: false,
                borderColor: 'rgba(42, 46, 57, 0.2)',
            },
            rightPriceScale: {
                borderColor: 'rgba(42, 46, 57, 0.2)',
            },
        });

        chartRef.current = chart;

        const newSeries = (chart as any).addCandlestickSeries({
            upColor: '#10b981',
            downColor: '#ef4444',
            borderVisible: false,
            wickUpColor: '#10b981',
            wickDownColor: '#ef4444',
        });

        seriesRef.current = newSeries;
        newSeries.setData(data as any);

        // Fit content
        chart.timeScale().fitContent();

        const resizeObserver = new ResizeObserver(() => handleResize());
        resizeObserver.observe(chartContainerRef.current);

        return () => {
            resizeObserver.disconnect();
            chart.remove();
        };
    }, []);

    // Update data when it changes
    useEffect(() => {
        if (seriesRef.current && data.length > 0) {
            seriesRef.current.setData(data as any);
        }
    }, [data]);

    return (
        <div className="w-full relative">
            <div ref={chartContainerRef} className="w-full" />
        </div>
    );
}
