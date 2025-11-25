'use client';

import { Signal } from '@/lib/signals/types';
import { TrendingUp, TrendingDown, AlertTriangle, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MarketAnalysisDisplayProps {
    signal: Signal;
}

export function MarketAnalysisDisplay({ signal }: MarketAnalysisDisplayProps) {
    if (!signal.marketTrend || !signal.marketAnalysis) {
        return null;
    }

    const getTrendColor = (trend: string) => {
        if (trend.includes('STRONG_BULLISH')) return 'text-success border-success/30 bg-success/10';
        if (trend.includes('BULLISH')) return 'text-success/80 border-success/20 bg-success/5';
        if (trend.includes('BEARISH') && trend.includes('STRONG')) return 'text-danger border-danger/30 bg-danger/10';
        if (trend.includes('BEARISH')) return 'text-danger/80 border-danger/20 bg-danger/5';
        return 'text-muted-foreground border-border/30 bg-muted/5';
    };

    const getRiskColor = (risk: number) => {
        if (risk >= 80) return 'text-danger';
        if (risk >= 60) return 'text-orange-500';
        if (risk >= 40) return 'text-yellow-500';
        if (risk >= 20) return 'text-blue-500';
        return 'text-success';
    };

    const getRiskLabel = (risk: number) => {
        if (risk >= 80) return 'Extreme Risk';
        if (risk >= 60) return 'High Risk';
        if (risk >= 40) return 'Moderate Risk';
        if (risk >= 20) return 'Low Risk';
        return 'Ultra Low Risk';
    };

    const trendDisplay = signal.marketTrend.replace(/_/g, ' ');

    return (
        <div className="mt-3 space-y-3">
            {/* Market Trend & Risk Score */}
            <div className="grid grid-cols-2 gap-2">
                <div className={cn(
                    'glass-dark rounded-lg p-2 border',
                    getTrendColor(signal.marketTrend)
                )}>
                    <div className="text-xs mb-1 flex items-center gap-1 opacity-80">
                        {signal.marketTrend.includes('BULLISH') ? (
                            <TrendingUp className="w-3 h-3" />
                        ) : signal.marketTrend.includes('BEARISH') ? (
                            <TrendingDown className="w-3 h-3" />
                        ) : (
                            <Activity className="w-3 h-3" />
                        )}
                        Market Trend
                    </div>
                    <div className="font-bold text-xs capitalize">{trendDisplay}</div>
                </div>

                {signal.riskScore !== undefined && (
                    <div className="glass-dark rounded-lg p-2 border border-border/30">
                        <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" />
                            Risk Level
                        </div>
                        <div className={cn('font-bold text-xs', getRiskColor(signal.riskScore))}>
                            {getRiskLabel(signal.riskScore)} ({signal.riskScore})
                        </div>
                    </div>
                )}
            </div>

            {/* Market Analysis Points */}
            {signal.marketAnalysis && signal.marketAnalysis.length > 0 && (
                <div className="glass-dark rounded-lg p-3 border border-primary/20">
                    <div className="text-xs font-bold text-primary mb-2">📊 Market Analysis</div>
                    <ul className="space-y-1.5">
                        {signal.marketAnalysis.slice(0, 4).map((point, index) => (
                            <li key={index} className="text-[10px] text-muted-foreground flex items-start gap-1.5">
                                <span className="text-primary mt-0.5">•</span>
                                <span className="flex-1">{point}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Liquidation Zones */}
            {signal.liquidityZones && signal.liquidityZones.length > 0 && (
                <div className="glass-dark rounded-lg p-2 border border-border/30">
                    <div className="text-xs font-bold mb-2 flex items-center gap-1">
                        <Activity className="w-3 h-3 text-primary" />
                        Liquidation Zones
                    </div>
                    <div className="space-y-1">
                        {signal.liquidityZones
                            .sort((a, b) => b.strength - a.strength)
                            .slice(0, 2)
                            .map((zone, index) => (
                                <div key={index} className="flex items-center justify-between text-[10px]">
                                    <span className={cn(
                                        'font-medium',
                                        zone.type === 'LONG' ? 'text-danger' : 'text-success'
                                    )}>
                                        {zone.type} Liq
                                    </span>
                                    <span className="font-mono">${zone.price.toFixed(2)}</span>
                                    <div className="flex-1 mx-2 h-1 bg-muted/30 rounded-full overflow-hidden">
                                        <div
                                            className={cn(
                                                'h-full rounded-full',
                                                zone.type === 'LONG' ? 'bg-danger/50' : 'bg-success/50'
                                            )}
                                            style={{ width: `${zone.strength}%` }}
                                        />
                                    </div>
                                </div>
                            ))}
                    </div>
                </div>
            )}
        </div>
    );
}
