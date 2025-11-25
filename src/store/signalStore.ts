// Zustand Store for Signal Management

import { create } from 'zustand';
import { Signal, MarketType, SignalType } from '@/lib/signals/types';

interface SignalStore {
    signals: Signal[];
    filteredSignals: Signal[];
    filters: {
        marketType: MarketType | 'ALL';
        signalType: SignalType | 'ALL';
        searchQuery: string;
    };
    addSignal: (signal: Signal) => void;
    updateSignal: (id: string, updates: Partial<Signal>) => void;
    removeSignal: (id: string) => void;
    setSignals: (signals: Signal[]) => void;
    setMarketTypeFilter: (marketType: MarketType | 'ALL') => void;
    setSignalTypeFilter: (signalType: SignalType | 'ALL') => void;
    setSearchQuery: (query: string) => void;
    applyFilters: () => void;
}

export const useSignalStore = create<SignalStore>((set, get) => ({
    signals: [],
    filteredSignals: [],
    filters: {
        marketType: 'ALL',
        signalType: 'ALL',
        searchQuery: ''
    },

    addSignal: (signal) => {
        set((state) => ({
            signals: [signal, ...state.signals]
        }));
        get().applyFilters();
    },

    updateSignal: (id, updates) => {
        set((state) => ({
            signals: state.signals.map((signal) =>
                signal.id === id ? { ...signal, ...updates } : signal
            )
        }));
        get().applyFilters();
    },

    removeSignal: (id) => {
        set((state) => ({
            signals: state.signals.filter((signal) => signal.id !== id)
        }));
        get().applyFilters();
    },

    setSignals: (signals) => {
        set({ signals });
        get().applyFilters();
    },

    setMarketTypeFilter: (marketType) => {
        set((state) => ({
            filters: { ...state.filters, marketType }
        }));
        get().applyFilters();
    },

    setSignalTypeFilter: (signalType) => {
        set((state) => ({
            filters: { ...state.filters, signalType }
        }));
        get().applyFilters();
    },

    setSearchQuery: (query) => {
        set((state) => ({
            filters: { ...state.filters, searchQuery: query }
        }));
        get().applyFilters();
    },

    applyFilters: () => {
        const { signals, filters } = get();

        let filtered = [...signals];

        // Filter by market type
        if (filters.marketType !== 'ALL') {
            filtered = filtered.filter((signal) => signal.marketType === filters.marketType);
        }

        // Filter by signal type
        if (filters.signalType !== 'ALL') {
            filtered = filtered.filter((signal) => signal.signalType === filters.signalType);
        }

        // Filter by search query
        if (filters.searchQuery) {
            const query = filters.searchQuery.toLowerCase();
            filtered = filtered.filter((signal) =>
                signal.pair.toLowerCase().includes(query)
            );
        }

        set({ filteredSignals: filtered });
    }
}));
