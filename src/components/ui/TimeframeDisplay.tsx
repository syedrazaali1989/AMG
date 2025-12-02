// Multi-Timeframe Alignment Display
// Shows trend alignment across different timeframes

'use client';

import { TimeframeAlignment } from '@/lib/signals/types';
import { TrendingUp, TrendingDown, Minus, AlertTriangle } from 'lucide-react';

interface TimeframeDisplayProps {
    alignment?: TimeframeAlignment;
}

export function TimeframeDisplay({ alignment }: TimeframeDisplayProps) {
    if (!alignment) return null;

    const { timeframeData, dominantTrend, aligned, strength, divergences } = alignment;

    return (
        <div className="mt-4 p-4 glass rounded-lg border border-border/50">
            <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                <svg className="w-4 h-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Multi-Timeframe Analysis
                {aligned && (
                    <span className="ml-auto text-xs font-semibold px-2 py-1 rounded bg-green-500/20 text-green-500">
                        ✓ ALIGNED
                    </span>
                )}
            </h4>

            {/* Timeframe Grid */}
            <div className="grid grid-cols-5 gap-2 mb-3">
                {timeframeData.map((tf) => (
                    <div
                        key={tf.timeframe}
                        className={`p-2 rounded text-center border ${tf.trend === 'BULLISH' ? 'bg-green-500/10 border-green-500/30' :
                            tf.trend === 'BEARISH' ? 'bg-red-500/10 border-red-500/30' :
                                'bg-gray-500/10 border-gray-500/30'
                            }`}
                    >
                        <div className="text-xs font-semibold text-muted-foreground mb-1">{tf.timeframe}</div>
                        <div className="flex items-center justify-center">
                            {tf.trend === 'BULLISH' && <TrendingUp className="w-3 h-3 text-green-500" />}
                            {tf.trend === 'BEARISH' && <TrendingDown className="w-3 h-3 text-red-500" />}
                            {tf.trend === 'NEUTRAL' && <Minus className="w-3 h-3 text-gray-500" />}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">{tf.strength}%</div>
                    </div>
                ))}
            </div>

            {/* Dominant Trend */}
            <div className="flex items-center justify-between p-3 bg-background/50 rounded-lg mb-3">
                <span className="text-xs text-muted-foreground">Dominant Trend:</span>
                <span className={`text-sm font-bold flex items-center gap-1 ${dominantTrend === 'BULLISH' ? 'text-green-500' :
                    dominantTrend === 'BEARISH' ? 'text-red-500' :
                        'text-gray-500'
                    }`}>
                    {dominantTrend === 'BULLISH' && <TrendingUp className="w-4 h-4" />}
                    {dominantTrend === 'BEARISH' && <TrendingDown className="w-4 h-4" />}
                    {dominantTrend === 'NEUTRAL' && <Minus className="w-4 h-4" />}
                    {dominantTrend}
                </span>
            </div>

            {/* Alignment Strength */}
            <div className="mb-3">
                <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-muted-foreground">Alignment Strength</span>
                    <span className="font-semibold">{strength}%</span>
                </div>
                <div className="h-2 bg-background rounded-full overflow-hidden">
                    <div
                        className={`h-full transition-all ${strength >= 75 ? 'bg-green-500' :
                            strength >= 50 ? 'bg-yellow-500' :
                                'bg-red-500'
                            }`}
                        style={{ width: `${strength}%` }}
                    />
                </div>
            </div>

            {/* Divergences/Warnings */}
            {
                divergences.length > 0 && (
                    <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                        <div className="flex items-center gap-2 text-xs font-semibold text-yellow-500 mb-2">
                            <AlertTriangle className="w-3 h-3" />
                            Divergences Detected
                        </div>
                        <div className="space-y-1">
                            {divergences.slice(0, 3).map((div, index) => (
                                <div key={index} className="text-xs text-muted-foreground">
                                    • {div}
                                </div>
                            ))}
                        </div>
                    </div>
                )
            }
        </div >
    );
}
