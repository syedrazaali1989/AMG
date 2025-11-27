'use client';

import { motion } from 'framer-motion';
import { TrendingUp } from 'lucide-react';

export type ConfidenceLevel = 'ALL' | '60+' | '70+' | '80+' | '90+';

interface ConfidenceFilterProps {
    selectedConfidence: ConfidenceLevel;
    onConfidenceChange: (confidence: ConfidenceLevel) => void;
}

const confidenceLevels: { value: ConfidenceLevel; label: string; minValue: number }[] = [
    { value: 'ALL', label: 'All Signals', minValue: 0 },
    { value: '60+', label: '60%+', minValue: 60 },
    { value: '70+', label: '70%+', minValue: 70 },
    { value: '80+', label: '80%+', minValue: 80 },
    { value: '90+', label: '90%+', minValue: 90 },
];

export function ConfidenceFilter({ selectedConfidence, onConfidenceChange }: ConfidenceFilterProps) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass rounded-lg p-4 mb-6"
        >
            <div className="flex items-center gap-2 mb-3">
                <TrendingUp className="w-5 h-5 text-primary" />
                <h3 className="font-semibold text-foreground">Confidence Filter</h3>
            </div>

            <div className="flex flex-wrap gap-2">
                {confidenceLevels.map((level) => (
                    <button
                        key={level.value}
                        onClick={() => onConfidenceChange(level.value)}
                        className={`px-4 py-2 rounded-lg font-medium transition-all ${selectedConfidence === level.value
                                ? 'bg-gradient-primary text-white shadow-lg shadow-primary/30'
                                : 'bg-muted/20 text-muted-foreground hover:bg-muted/40 hover:text-foreground'
                            }`}
                    >
                        {level.label}
                    </button>
                ))}
            </div>

            <p className="text-xs text-muted-foreground mt-3">
                Filter signals by minimum confidence level to view high-quality opportunities
            </p>
        </motion.div>
    );
}

// Helper function to filter signals by confidence
export function filterSignalsByConfidence(signals: any[], confidenceLevel: ConfidenceLevel): any[] {
    const level = confidenceLevels.find(l => l.value === confidenceLevel);
    if (!level || level.value === 'ALL') {
        return signals;
    }
    return signals.filter(signal => signal.confidence >= level.minValue);
}
