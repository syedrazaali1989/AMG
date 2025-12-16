import { useState, useEffect } from 'react';
import { Signal } from '../lib/signals/types';
import { SignalManager } from '../lib/services/signalManager';

/**
 * Custom hook to sync signals across components
 * Automatically refreshes signals from localStorage
 */
export function useSignals(type: 'standard' | 'scalping' | 'onchain') {
    const [signals, setSignals] = useState<Signal[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        // Load initial signals
        const loadSignals = () => {
            const activeSignals = SignalManager.getActiveSignals(type);
            setSignals(activeSignals);
        };

        loadSignals();

        // Refresh signals every second to catch updates from background monitor
        const interval = setInterval(() => {
            loadSignals();
        }, 1000);

        return () => clearInterval(interval);
    }, [type]);

    return { signals, isLoading, setIsLoading };
}
