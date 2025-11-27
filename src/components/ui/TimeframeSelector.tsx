'use client';

import { Timeframe } from '@/lib/signals/types';
import { Clock } from 'lucide-react';
import { motion } from 'framer-motion';

interface TimeframeSelectorProps {
    selectedTimeframe: Timeframe;
    onTimeframeChange: (timeframe: Timeframe) => void;
}

const timeframes: { value: Timeframe; label: string; desc: string }[] = [
    { value: Timeframe.ONE_MINUTE, label: '1m', desc: 'Scalping' },
    { value: Timeframe.FIVE_MINUTES, label: '5m', desc: 'Scalping' },
    { value: Timeframe.FIFTEEN_MINUTES, label: '15m', desc: 'Day Trading' },
    { value: Timeframe.ONE_HOUR, label: '1h', desc: 'Swing' },
    { value: Timeframe.FOUR_HOURS, label: '4h', desc: 'Swing' },
    { value: Timeframe.ONE_DAY, label: '1D', desc: 'Position' }
];

export function TimeframeSelector({ selectedTimeframe, onTimeframeChange }: TimeframeSelectorProps) {
    return (
        <div className="glass rounded-lg p-4 mb-4">
            <div className="flex items-center gap-2 mb-3">
                <Clock className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">Timeframe</h3>
            </div>

            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                {timeframes.map((tf) => (
                    <motion.button
                        key={tf.value}
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={() => onTimeframeChange(tf.value)}
                        className={`
                            relative px-3 py-2 rounded-lg font-medium text-sm transition-all
                            ${selectedTimeframe === tf.value
                                ? 'bg-gradient-primary text-white shadow-lg shadow-primary/30'
                                : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground'
                            }
                        `}
                    >
                        <div className="font-bold">{tf.label}</div>
                        <div className="text-[10px] opacity-75">{tf.desc}</div>
                    </motion.button>
                ))}
            </div>
        </div>
    );
}
