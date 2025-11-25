'use client';

import { Signal } from '@/lib/signals/types';
import { Newspaper, TrendingUp, TrendingDown, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';

interface NewsIndicatorProps {
    signal: Signal;
}

export function NewsIndicator({ signal }: NewsIndicatorProps) {
    const hasNews = (signal.newsEvents && signal.newsEvents.length > 0) ||
        (signal.economicEvents && signal.economicEvents.length > 0);

    if (!hasNews) return null;

    const sentimentScore = signal.sentimentScore || 0;
    const isBullish = sentimentScore > 20;
    const isBearish = sentimentScore < -20;
    const isNeutral = !isBullish && !isBearish;

    return (
        <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-3 space-y-2"
        >
            {/* Sentiment Badge */}
            <div className="flex items-center gap-2">
                <div className={cn(
                    'flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-semibold',
                    isBullish && 'bg-success/20 text-success',
                    isBearish && 'bg-danger/20 text-danger',
                    isNeutral && 'bg-muted/30 text-muted-foreground'
                )}>
                    {isBullish && <TrendingUp className="w-3 h-3" />}
                    {isBearish && <TrendingDown className="w-3 h-3" />}
                    {isNeutral && <AlertCircle className="w-3 h-3" />}
                    <span>
                        {isBullish && 'Bullish News'}
                        {isBearish && 'Bearish News'}
                        {isNeutral && 'Neutral News'}
                    </span>
                    <span className="opacity-70">({sentimentScore > 0 ? '+' : ''}{sentimentScore})</span>
                </div>
            </div>

            {/* News Events */}
            {signal.newsEvents && signal.newsEvents.length > 0 && (
                <div className="glass-dark rounded-lg p-2 space-y-1">
                    <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                        <Newspaper className="w-3 h-3" />
                        <span className="font-semibold">Market News</span>
                    </div>
                    {signal.newsEvents.slice(0, 2).map((news, index) => (
                        <div key={index} className="text-xs text-foreground/80 pl-4">
                            • {news}
                        </div>
                    ))}
                </div>
            )}

            {/* Economic Events */}
            {signal.economicEvents && signal.economicEvents.length > 0 && (
                <div className="glass-dark rounded-lg p-2 space-y-1">
                    <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                        <TrendingUp className="w-3 h-3" />
                        <span className="font-semibold">Economic Data</span>
                    </div>
                    {signal.economicEvents.slice(0, 2).map((event, index) => (
                        <div key={index} className="text-xs text-foreground/80 pl-4">
                            • {event}
                        </div>
                    ))}
                </div>
            )}
        </motion.div>
    );
}
