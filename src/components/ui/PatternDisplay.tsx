// Pattern Detection Display Component
// Shows detected candlestick patterns with strength indicators

'use client';

import { CandlestickPattern } from '@/lib/signals/types';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface PatternDisplayProps {
    patterns?: CandlestickPattern[];
}

export function PatternDisplay({ patterns }: PatternDisplayProps) {
    if (!patterns || patterns.length === 0) return null;

    return (
        <div className="mt-4 p-4 glass rounded-lg border border-border/50">
            <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                <svg className="w-4 h-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                Detected Patterns ({patterns.length})
            </h4>

            <div className="space-y-2">
                {patterns.slice(0, 5).map((pattern, index) => (
                    <div
                        key={index}
                        className="p-3 bg-background/50 rounded-lg border border-border/30 hover:border-primary/50 transition-colors"
                    >
                        <div className="flex items-start justify-between mb-2">
                            <div className="flex items-center gap-2">
                                {pattern.sentiment === 'BULLISH' && (
                                    <TrendingUp className="w-4 h-4 text-green-500 flex-shrink-0" />
                                )}
                                {pattern.sentiment === 'BEARISH' && (
                                    <TrendingDown className="w-4 h-4 text-red-500 flex-shrink-0" />
                                )}
                                {pattern.sentiment === 'NEUTRAL' && (
                                    <Minus className="w-4 h-4 text-gray-500 flex-shrink-0" />
                                )}
                                <span className="font-semibold text-sm text-foreground">{pattern.name}</span>
                            </div>
                            <span className={`text-xs font-semibold px-2 py-1 rounded ${pattern.sentiment === 'BULLISH' ? 'bg-green-500/20 text-green-500' :
                                    pattern.sentiment === 'BEARISH' ? 'bg-red-500/20 text-red-500' :
                                        'bg-gray-500/20 text-gray-500'
                                }`}>
                                {pattern.sentiment}
                            </span>
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-xs">
                            <div>
                                <span className="text-muted-foreground">Strength:</span>
                                <div className="mt-1 h-1.5 bg-background rounded-full overflow-hidden">
                                    <div
                                        className={`h-full transition-all ${pattern.sentiment === 'BULLISH' ? 'bg-green-500' :
                                                pattern.sentiment === 'BEARISH' ? 'bg-red-500' :
                                                    'bg-gray-500'
                                            }`}
                                        style={{ width: `${pattern.strength}%` }}
                                    />
                                </div>
                                <span className="text-xs text-muted-foreground mt-0.5 block">{pattern.strength}%</span>
                            </div>
                            <div>
                                <span className="text-muted-foreground">Reliability:</span>
                                <div className="mt-1 h-1.5 bg-background rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-blue-500 transition-all"
                                        style={{ width: `${pattern.reliability}%` }}
                                    />
                                </div>
                                <span className="text-xs text-muted-foreground mt-0.5 block">{pattern.reliability}%</span>
                            </div>
                        </div>

                        {pattern.priceTarget && (
                            <div className="mt-2 pt-2 border-t border-border/30 text-xs">
                                <span className="text-muted-foreground">Price Target:</span>
                                <span className="ml-2 font-semibold text-foreground">
                                    ${pattern.priceTarget.toLocaleString()}
                                </span>
                                <span className="ml-2 text-muted-foreground">
                                    ({pattern.expectedOutcome})
                                </span>
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {patterns.length > 5 && (
                <div className="mt-2 text-xs text-center text-muted-foreground">
                    +{patterns.length - 5} more patterns detected
                </div>
            )}
        </div>
    );
}
