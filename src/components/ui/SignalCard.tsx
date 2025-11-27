'use client';

import { Signal, SignalDirection, SignalStatus } from '@/lib/signals/types';
import { formatPrice, formatPercentage, formatTimeAgo, cn } from '@/lib/utils';
import { TrendingUp, TrendingDown, Clock, Target, Shield, DollarSign } from 'lucide-react';
import { motion } from 'framer-motion';
import { NewsIndicator } from './NewsIndicator';
import { MarketAnalysisDisplay } from './MarketAnalysisDisplay';
import { Countdown } from './Countdown';

interface SignalCardProps {
    signal: Signal;
    onClick?: () => void;
}

export function SignalCard({ signal, onClick }: SignalCardProps) {
    const isBuy = signal.direction === SignalDirection.BUY || signal.direction === SignalDirection.LONG;
    const isActive = signal.status === SignalStatus.ACTIVE;
    const isProfit = (signal.profitLossPercentage || 0) > 0;

    const statusColors = {
        [SignalStatus.ACTIVE]: 'border-primary/50 bg-primary/5',
        [SignalStatus.COMPLETED]: isProfit ? 'border-success/50 bg-success/5' : 'border-muted/50 bg-muted/5',
        [SignalStatus.STOPPED]: 'border-danger/50 bg-danger/5'
    };

    const directionColors = isBuy
        ? 'bg-success/20 text-success border-success/30'
        : 'bg-danger/20 text-danger border-danger/30';

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            whileHover={{ scale: 1.01 }}
            transition={{ duration: 0.2 }}
            className={cn(
                'relative overflow-hidden rounded-lg border-2 p-4 transition-all',
                'glass hover:shadow-lg hover:shadow-primary/20',
                statusColors[signal.status]
            )}
        >
            {/* Header */}
            <div className="mb-4" onClick={onClick}>
                {/* Direction Badge - Prominent */}
                <div className="mb-3">
                    <div className={cn(
                        'inline-flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-sm border-2',
                        isBuy
                            ? 'bg-success/20 text-success border-success/40'
                            : 'bg-danger/20 text-danger border-danger/40'
                    )}>
                        {isBuy ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                        <span className="text-base font-extrabold tracking-wide">
                            {signal.direction}
                        </span>
                        {signal.isCounterTrend && (
                            <span className="ml-1 text-orange-500">⚠️</span>
                        )}
                    </div>

                    {/* Timeframe Info */}
                    <div className="flex items-center gap-2">
                        <div className="glass-dark rounded-lg px-3 py-1.5 flex items-center gap-2 border border-primary/20">
                            <Clock className="w-3.5 h-3.5 text-primary" />
                            <span className="text-xs font-bold text-foreground">{signal.timeframe}</span>
                        </div>
                        {signal.nextCandleTime && (
                            <div className="glass-dark rounded-lg px-3 py-1.5 flex items-center gap-1.5 border border-border/50">
                                <span className="text-[10px] text-muted-foreground">Next:</span>
                                <Countdown targetTime={signal.nextCandleTime} />
                            </div>
                        )}
                    </div>
                </div>

                {/* Counter-Trend Warning Banner */}
                {signal.isCounterTrend && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        className="mb-3 bg-orange-500/10 border-2 border-orange-500/30 rounded-lg p-3"
                    >
                        <div className="flex items-start gap-2">
                            <span className="text-orange-500 text-lg flex-shrink-0">⚠️</span>
                            <div className="flex-1">
                                <div className="font-bold text-orange-500 text-xs mb-1">COUNTER-TREND SIGNAL</div>
                                <div className="text-[11px] text-orange-500/90">
                                    Trading against overall market trend ({signal.marketTrend}). Higher risk - use tight stops and smaller position size.
                                </div>
                            </div>
                        </div>
                    </motion.div>
                )}

                <div className="flex justify-between items-start mb-3 cursor-pointer">
                    <div className="flex items-center gap-3">
                        <div className={cn('p-2.5 rounded-xl border shadow-sm', directionColors)}>
                            {isBuy ? <TrendingUp className="w-6 h-6" /> : <TrendingDown className="w-6 h-6" />}
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h3 className="text-xl font-bold tracking-tight">{signal.pair}</h3>
                                <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground uppercase tracking-wider">
                                    {signal.marketType}
                                </span>
                            </div>
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                                <span className="text-primary flex items-center gap-1 font-medium">
                                    <span className="relative flex h-2 w-2">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                                        <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                                    </span>
                                    Live Market
                                </span>
                            </div>
                        </div>
                    </div>

                    <div className="flex flex-col items-end gap-1.5">
                        <div className={cn(
                            'px-3 py-1 rounded-full text-xs font-bold whitespace-nowrap shadow-sm',
                            isActive ? 'bg-primary/10 text-primary border border-primary/20' :
                                isProfit ? 'bg-success/10 text-success border border-success/20' :
                                    'bg-muted/50 text-muted-foreground border border-muted/20'
                        )}>
                            {signal.status}
                        </div>
                        <span className="text-[10px] text-muted-foreground font-medium">
                            {new Date(signal.timestamp).toLocaleTimeString()}
                        </span>
                        <span className="px-2 py-0.5 rounded bg-muted/50 text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
                            {signal.signalType}
                        </span>
                    </div>
                </div>

                {/* Price Card */}
                <div className="flex justify-between items-center bg-muted/30 rounded-xl p-3 border border-border/50 cursor-pointer">
                    <div className="flex flex-col gap-1.5">
                        <div className="flex items-center gap-2">
                            <div className="flex items-center gap-1.5 min-w-[80px]">
                                <span className="w-1.5 h-1.5 rounded-full bg-[#F3BA2F]"></span>
                                <span className="text-xs font-medium text-muted-foreground">Binance</span>
                            </div>
                            <span className="text-sm font-bold font-mono tracking-tight">
                                {formatPrice(signal.currentPrice, 5)}
                            </span>
                        </div>

                        {signal.mexcPrice && (
                            <div className="flex items-center gap-2">
                                <div className="flex items-center gap-1.5 min-w-[80px]">
                                    <span className="w-1.5 h-1.5 rounded-full bg-[#2B77F9]"></span>
                                    <span className="text-xs font-bold text-blue-500">MEXC</span>
                                </div>
                                <span className="text-sm font-bold font-mono tracking-tight text-blue-500">
                                    {formatPrice(signal.mexcPrice, 5)}
                                </span>
                            </div>
                        )}
                    </div>

                    <div className={cn(
                        'text-xl font-black px-6 py-2 rounded-lg border-2 shadow-sm whitespace-nowrap tracking-wide',
                        isBuy ? 'text-success border-success/20 bg-success/5' : 'text-danger border-danger/20 bg-danger/5'
                    )}>
                        {signal.direction}
                    </div>
                </div>
            </div>

            {/* Confidence Score */}
            <div className="mb-3">
                <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-muted-foreground">Confidence</span>
                    <span className="font-bold text-primary">{signal.confidence}%</span>
                </div>
                <div className="h-2 bg-muted/30 rounded-full overflow-hidden">
                    <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${signal.confidence}%` }}
                        transition={{ duration: 1, ease: 'easeOut' }}
                        className={cn(
                            'h-full rounded-full',
                            signal.confidence >= 80 ? 'bg-success' :
                                signal.confidence >= 60 ? 'bg-primary' : 'bg-danger'
                        )}
                    />
                </div>
            </div>


            {/* Price Information */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                <div className="glass-dark rounded-lg p-2">
                    <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                        <DollarSign className="w-3 h-3" />
                        Entry Price
                    </div>
                    <div className="font-bold">{formatPrice(signal.entryPrice, 5)}</div>
                </div>
                <div className="glass-dark rounded-lg p-2">
                    <div className="text-xs text-muted-foreground mb-1">Current Price</div>
                    <div className="font-bold">{formatPrice(signal.currentPrice, 5)}</div>
                </div>
            </div>

            {/* Highest/Lowest Price Tracking */}
            {(signal.highestPrice || signal.lowestPrice) && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                    {signal.highestPrice && (
                        <div className="glass-dark rounded-lg p-2 border border-success/20">
                            <div className="text-xs text-success mb-1 flex items-center gap-1">
                                <TrendingUp className="w-3 h-3" />
                                Highest Reached
                            </div>
                            <div className="font-bold text-sm">{formatPrice(signal.highestPrice, 5)}</div>
                        </div>
                    )}
                    {signal.lowestPrice && (
                        <div className="glass-dark rounded-lg p-2 border border-danger/20">
                            <div className="text-xs text-danger mb-1 flex items-center gap-1">
                                <TrendingDown className="w-3 h-3" />
                                Lowest Reached
                            </div>
                            <div className="font-bold text-sm">{formatPrice(signal.lowestPrice, 5)}</div>
                        </div>
                    )}
                </div>
            )}

            {/* Partial Take Profits */}
            {signal.takeProfit1 && signal.takeProfit2 && signal.takeProfit3 ? (
                <div className="mb-3">
                    <div className="text-xs text-muted-foreground mb-2 font-medium">Take Profit Levels</div>
                    <div className="grid grid-cols-3 gap-2 mb-2">
                        <div className={cn(
                            "glass-dark rounded-lg p-2 border transition-all",
                            signal.tp1Hit ? "border-success bg-success/10" : "border-border/50"
                        )}>
                            <div className="text-xs text-success mb-1 flex items-center justify-between">
                                <span>TP1 (30%)</span>
                                {signal.tp1Hit && <span className="text-success">✓</span>}
                            </div>
                            <div className="font-bold text-xs">{formatPrice(signal.takeProfit1, 5)}</div>
                        </div>
                        <div className={cn(
                            "glass-dark rounded-lg p-2 border transition-all",
                            signal.tp2Hit ? "border-success bg-success/10" : "border-border/50"
                        )}>
                            <div className="text-xs text-success mb-1 flex items-center justify-between">
                                <span>TP2 (60%)</span>
                                {signal.tp2Hit && <span className="text-success">✓</span>}
                            </div>
                            <div className="font-bold text-xs">{formatPrice(signal.takeProfit2, 5)}</div>
                        </div>
                        <div className={cn(
                            "glass-dark rounded-lg p-2 border transition-all",
                            signal.tp3Hit ? "border-success bg-success/10" : "border-border/50"
                        )}>
                            <div className="text-xs text-success mb-1 flex items-center justify-between">
                                <span>TP3 (100%)</span>
                                {signal.tp3Hit && <span className="text-success">✓</span>}
                            </div>
                            <div className="font-bold text-xs">{formatPrice(signal.takeProfit3, 5)}</div>
                        </div>
                    </div>
                    <div className="glass-dark rounded-lg p-2 border border-danger/30">
                        <div className="text-xs text-danger mb-1 flex items-center gap-1">
                            <Shield className="w-3 h-3" />
                            Stop Loss
                        </div>
                        <div className="font-bold text-sm">{formatPrice(signal.stopLoss, 5)}</div>
                    </div>
                </div>
            ) : (
                // Fallback for old signals without partial TPs
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                    <div className="glass-dark rounded-lg p-2">
                        <div className="text-xs text-success mb-1 flex items-center gap-1">
                            <Target className="w-3 h-3" />
                            Take Profit
                        </div>
                        <div className="font-bold text-sm">{formatPrice(signal.takeProfit, 5)}</div>
                    </div>
                    <div className="glass-dark rounded-lg p-2">
                        <div className="text-xs text-danger mb-1 flex items-center gap-1">
                            <Shield className="w-3 h-3" />
                            Stop Loss
                        </div>
                        <div className="font-bold text-sm">{formatPrice(signal.stopLoss, 5)}</div>
                    </div>
                </div>
            )}

            {/* P/L Display */}
            {signal.profitLossPercentage !== undefined && (
                <div className={cn(
                    'rounded-lg p-2 text-center font-bold mb-3',
                    isProfit ? 'bg-success/20 text-success' : 'bg-danger/20 text-danger'
                )}>
                    {formatPercentage(signal.profitLossPercentage)}
                </div>
            )}

            {/* Advanced Market Analysis */}
            <MarketAnalysisDisplay signal={signal} />

            {/* News and Economic Events */}
            <NewsIndicator signal={signal} />

            {/* Footer Time */}
            <div className="flex items-center justify-end mt-2 pt-2 border-t border-border/30">
                <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {formatTimeAgo(signal.timestamp)}
                </div>
            </div>
        </motion.div>
    );
}
