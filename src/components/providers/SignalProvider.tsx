'use client';

import { useEffect } from 'react';
import { BackgroundMonitor } from '@/lib/services/backgroundMonitor';
import { AutoGenerator } from '@/lib/services/autoGenerator';

/**
 * Signal Provider
 * Starts background services when app loads
 */

interface SignalProviderProps {
    children: React.ReactNode;
}

export function SignalProvider({ children }: SignalProviderProps) {
    useEffect(() => {
        console.log('🚀 Initializing signal services...');

        // Start background monitor
        BackgroundMonitor.start();

        // Request notification permission
        if (typeof window !== 'undefined' && 'Notification' in window) {
            if (Notification.permission === 'default') {
                Notification.requestPermission().then(permission => {
                    if (permission === 'granted') {
                        console.log('✅ Notification permission granted');
                    }
                });
            }
        }

        // Cleanup on unmount
        return () => {
            BackgroundMonitor.stop();
            AutoGenerator.stopAll();
            console.log('🛑 Signal services stopped');
        };
    }, []);

    return <>{children}</>;
}
