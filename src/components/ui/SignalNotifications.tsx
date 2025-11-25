'use client';

import { Signal, SignalDirection } from '@/lib/signals/types';
import { X, TrendingUp, TrendingDown, Bell } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn, formatPrice } from '@/lib/utils';
import { useEffect } from 'react';

export interface SignalNotification {
    id: string;
    signal: Signal;
    timestamp: number;
}

interface SignalNotificationsProps {
    notifications: SignalNotification[];
    onDismiss: (id: string) => void;
}

export function SignalNotifications({ notifications, onDismiss }: SignalNotificationsProps) {
    return (
        <div className="fixed top-20 right-0 left-0 sm:left-auto sm:right-4 z-50 space-y-3 px-4 sm:px-0 max-w-full sm:max-w-sm">
            <AnimatePresence>
                {notifications.map((notification) => (
                    <NotificationCard
                        key={notification.id}
                        notification={notification}
                        onDismiss={onDismiss}
                    />
                ))}
            </AnimatePresence>
        </div>
    );
}

interface NotificationCardProps {
    notification: SignalNotification;
    onDismiss: (id: string) => void;
}

function NotificationCard({ notification, onDismiss }: NotificationCardProps) {
    const { signal } = notification;
    const isBuy = signal.direction === SignalDirection.BUY || signal.direction === SignalDirection.LONG;

    // Auto-dismiss after 5 seconds
    useEffect(() => {
        const timer = setTimeout(() => {
            onDismiss(notification.id);
        }, 5000);

        return () => clearTimeout(timer);
    }, [notification.id, onDismiss]);

    return (
        <motion.div
            initial={{ opacity: 0, x: 100, scale: 0.8 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 100, scale: 0.8 }}
            transition={{ type: 'spring', damping: 20, stiffness: 300 }}
            className="relative overflow-hidden rounded-lg border-2 shadow-2xl glass backdrop-blur-xl"
            style={{
                borderColor: isBuy ? 'rgba(34, 197, 94, 0.5)' : 'rgba(239, 68, 68, 0.5)',
            }}
        >
            {/* Animated background gradient */}
            <div className={cn(
                'absolute inset-0 opacity-20',
                isBuy ? 'bg-gradient-to-br from-success/30 to-transparent' : 'bg-gradient-to-br from-danger/30 to-transparent'
            )} />

            <div className="relative p-4">
                {/* Header */}
                <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                        <div className={cn(
                            'p-2 rounded-lg',
                            isBuy ? 'bg-success/20 text-success' : 'bg-danger/20 text-danger'
                        )}>
                            <Bell className="w-4 h-4 animate-pulse" />
                        </div>
                        <div>
                            <div className="text-xs text-muted-foreground font-medium">New Signal</div>
                            <div className="text-sm font-bold text-foreground">{signal.signalType} Trading</div>
                        </div>
                    </div>
                    <button
                        onClick={() => onDismiss(notification.id)}
                        className="p-1 rounded-md hover:bg-muted/20 transition-colors"
                    >
                        <X className="w-4 h-4 text-muted-foreground" />
                    </button>
                </div>

                {/* Signal Details */}
                <div className="space-y-2">
                    {/* Pair */}
                    <div className="text-lg font-bold text-foreground">{signal.pair}</div>

                    {/* Direction Badge */}
                    <div className={cn(
                        'inline-flex items-center gap-2 px-3 py-1.5 rounded-md font-bold text-xs border',
                        isBuy
                            ? 'bg-success/20 text-success border-success/40'
                            : 'bg-danger/20 text-danger border-danger/40'
                    )}>
                        {isBuy ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                        {signal.direction}
                    </div>

                    {/* Entry Price */}
                    <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">Entry Price:</span>
                        <span className="font-mono font-bold text-foreground">{formatPrice(signal.entryPrice)}</span>
                    </div>

                    {/* Confidence */}
                    <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">Confidence:</span>
                        <span className={cn(
                            'font-bold',
                            signal.confidence >= 80 ? 'text-success' : signal.confidence >= 60 ? 'text-primary' : 'text-muted-foreground'
                        )}>
                            {signal.confidence}%
                        </span>
                    </div>
                </div>

                {/* Progress bar for auto-dismiss */}
                <motion.div
                    className={cn(
                        'absolute bottom-0 left-0 h-1',
                        isBuy ? 'bg-success' : 'bg-danger'
                    )}
                    initial={{ width: '100%' }}
                    animate={{ width: '0%' }}
                    transition={{ duration: 5, ease: 'linear' }}
                />
            </div>
        </motion.div>
    );
}
