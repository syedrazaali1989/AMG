'use client';

import { Signal, MarketType, SignalType } from '@/lib/signals/types';
import { SignalCard } from './SignalCard';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Filter } from 'lucide-react';
import { useState } from 'react';

interface SignalListProps {
    signals: Signal[];
    onSignalClick?: (signal: Signal) => void;
    onFilterChange?: (filters: { marketType: MarketType | 'ALL'; signalType: SignalType | 'ALL' }) => void;
}

export function SignalList({ signals, onSignalClick, onFilterChange }: SignalListProps) {
    const [marketFilter, setMarketFilter] = useState<MarketType | 'ALL'>('ALL');
    const [signalFilter, setSignalFilter] = useState<SignalType | 'ALL'>('ALL');
    const [searchQuery, setSearchQuery] = useState('');

    const handleMarketFilterChange = (value: MarketType | 'ALL') => {
        setMarketFilter(value);
        onFilterChange?.({ marketType: value, signalType: signalFilter });
    };

    const handleSignalFilterChange = (value: SignalType | 'ALL') => {
        setSignalFilter(value);
        onFilterChange?.({ marketType: marketFilter, signalType: value });
    };

    const filteredSignals = signals.filter(signal => {
        const matchesMarket = marketFilter === 'ALL' || signal.marketType === marketFilter;
        const matchesType = signalFilter === 'ALL' || signal.signalType === signalFilter;
        const matchesSearch = searchQuery === '' ||
            signal.pair.toLowerCase().includes(searchQuery.toLowerCase());

        return matchesMarket && matchesType && matchesSearch;
    });

    return (
        <div className="space-y-4">
            {/* Filters */}
            <div className="glass rounded-lg p-4">
                <div className="flex items-center gap-2 mb-3">
                    <Filter className="w-5 h-5 text-primary" />
                    <h3 className="font-bold">Filters</h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {/* Search */}
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <input
                            type="text"
                            placeholder="Search pairs..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                    </div>

                    {/* Market Type Filter */}
                    <select
                        value={marketFilter}
                        onChange={(e) => handleMarketFilterChange(e.target.value as MarketType | 'ALL')}
                        className="px-4 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                        <option value="ALL">All Markets</option>
                        <option value={MarketType.FOREX}>Forex</option>
                        <option value={MarketType.CRYPTO}>Crypto</option>
                    </select>

                    {/* Signal Type Filter */}
                    <select
                        value={signalFilter}
                        onChange={(e) => handleSignalFilterChange(e.target.value as SignalType | 'ALL')}
                        className="px-4 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                        <option value="ALL">All Types</option>
                        <option value={SignalType.SPOT}>Spot</option>
                        <option value={SignalType.FUTURE}>Future</option>
                    </select>
                </div>
            </div>

            {/* Signal Count */}
            <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>Showing {filteredSignals.length} signal{filteredSignals.length !== 1 ? 's' : ''}</span>
            </div>

            {/* Signals Grid */}
            {filteredSignals.length === 0 ? (
                <div className="glass rounded-lg p-12 text-center">
                    <div className="text-muted-foreground">
                        <Filter className="w-12 h-12 mx-auto mb-3 opacity-50" />
                        <p className="text-lg font-semibold mb-1">No signals found</p>
                        <p className="text-sm">Try adjusting your filters or check back later for new signals</p>
                    </div>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <AnimatePresence mode="popLayout">
                        {filteredSignals.map((signal) => (
                            <SignalCard
                                key={signal.id}
                                signal={signal}
                                onClick={() => onSignalClick?.(signal)}
                            />
                        ))}
                    </AnimatePresence>
                </div>
            )}
        </div>
    );
}
