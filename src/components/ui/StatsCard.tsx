'use client';

import { motion } from 'framer-motion';
import { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StatsCardProps {
    title: string;
    value: string | number;
    icon: LucideIcon;
    trend?: {
        value: number;
        isPositive: boolean;
    };
    className?: string;
}

export function StatsCard({ title, value, icon: Icon, trend, className }: StatsCardProps) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            whileHover={{ scale: 1.05 }}
            transition={{ duration: 0.2 }}
            className={cn(
                'glass rounded-lg p-6 border border-border hover:border-primary/50 transition-all',
                className
            )}
        >
            <div className="flex items-start justify-between">
                <div className="flex-1">
                    <p className="text-sm text-muted-foreground mb-1">{title}</p>
                    <motion.h3
                        initial={{ scale: 0.5 }}
                        animate={{ scale: 1 }}
                        transition={{ type: 'spring', stiffness: 200, damping: 10 }}
                        className="text-3xl font-bold text-gradient"
                    >
                        {value}
                    </motion.h3>
                    {trend && (
                        <div className={cn(
                            'text-xs font-semibold mt-2',
                            trend.isPositive ? 'text-success' : 'text-danger'
                        )}>
                            {trend.isPositive ? '+' : ''}{trend.value}%
                        </div>
                    )}
                </div>
                <div className="p-3 rounded-lg bg-primary/20 border border-primary/30">
                    <Icon className="w-6 h-6 text-primary" />
                </div>
            </div>
        </motion.div>
    );
}
