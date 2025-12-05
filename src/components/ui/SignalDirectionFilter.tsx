'use client';

import { SignalDirection } from '@/lib/signals/types';
import { Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SignalDirectionFilterProps {
    selectedDirections: SignalDirection[];
    onDirectionsChange: (directions: SignalDirection[]) => void;
    signalType: 'SPOT' | 'FUTURE';
}

export function SignalDirectionFilter({ selectedDirections, onDirectionsChange, signalType }: SignalDirectionFilterProps) {
    const allDirections = [
        { value: SignalDirection.BUY, label: 'BUY', color: 'text-success border-success/30 bg-success/10', type: 'SPOT' },
        // SELL removed - SPOT only supports BUY (entry), sell happens automatically at TP
        { value: SignalDirection.LONG, label: 'LONG', color: 'text-success border-success/30 bg-success/10', type: 'FUTURE' },
        { value: SignalDirection.SHORT, label: 'SHORT', color: 'text-danger border-danger/30 bg-danger/10', type: 'FUTURE' },
    ];

    // Filter directions based on signal type
    const directions = allDirections.filter(d => d.type === signalType);

    const toggleDirection = (direction: SignalDirection) => {
        if (selectedDirections.includes(direction)) {
            onDirectionsChange(selectedDirections.filter(d => d !== direction));
        } else {
            onDirectionsChange([...selectedDirections, direction]);
        }
    };

    const selectAll = () => {
        // Select all directions for the current signal type
        const relevantDirections = directions.map(d => d.value);
        onDirectionsChange(relevantDirections);
    };

    const clearAll = () => {
        onDirectionsChange([]);
    };

    return (
        <div className="glass rounded-lg p-4 mb-6">
            <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                    <svg className="w-4 h-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                    </svg>
                    Signal Direction Filter
                </h3>
                <div className="flex gap-2">
                    <button
                        onClick={selectAll}
                        className="text-xs px-3 py-1 rounded-md bg-primary/20 text-primary hover:bg-primary/30 transition-colors"
                    >
                        Select All
                    </button>
                    <button
                        onClick={clearAll}
                        className="text-xs px-3 py-1 rounded-md bg-muted/20 text-muted-foreground hover:bg-muted/30 transition-colors"
                    >
                        Clear All
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {directions.map((direction) => {
                    const isSelected = selectedDirections.includes(direction.value);

                    return (
                        <button
                            key={direction.value}
                            onClick={() => toggleDirection(direction.value)}
                            className={cn(
                                'relative flex items-center justify-between p-3 rounded-lg border-2 transition-all',
                                isSelected
                                    ? direction.color
                                    : 'border-border/30 bg-muted/5 text-muted-foreground hover:border-border/50'
                            )}
                        >
                            <span className="font-bold text-sm">{direction.label}</span>
                            <div className={cn(
                                'w-5 h-5 rounded flex items-center justify-center border-2',
                                isSelected
                                    ? 'border-current bg-current/20'
                                    : 'border-muted-foreground/30'
                            )}>
                                {isSelected && <Check className="w-3 h-3" />}
                            </div>
                        </button>
                    );
                })}
            </div>

            {selectedDirections.length === 0 && (
                <div className="mt-3 text-xs text-center text-muted-foreground flex items-center justify-center gap-2">
                    <X className="w-4 h-4" />
                    No directions selected - all signals hidden
                </div>
            )}
            {selectedDirections.length > 0 && selectedDirections.length < directions.length && (
                <div className="mt-3 text-xs text-center text-muted-foreground">
                    Showing {selectedDirections.length} of {directions.length} signal types
                </div>
            )}
        </div>
    );
}
