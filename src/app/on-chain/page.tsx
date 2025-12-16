
'use client';

import { useEffect, useState, useCallback } from 'react';
import { Navbar } from '@/components/layout/Navbar';
import { SignalList } from '@/components/ui/SignalList';
import { StatsCard } from '@/components/ui/StatsCard';
import { MessageBox, useMessages } from '@/components/ui/MessageBox';
import { Signal, SignalDirection } from '@/lib/signals/types';
import { SignalDirectionFilter } from '@/components/ui/SignalDirectionFilter';
import { OnChainSignalGenerator } from '@/lib/signals/onChainGenerator';
import { SignalManager } from '@/lib/services/signalManager';
import { AutoGenerator } from '@/lib/services/autoGenerator';
import { TrendingUp, Target, Activity, Award, Database, Clock, Waves } from 'lucide-react';
import { motion } from 'framer-motion';

export default function OnChainPage() {
    const [signals, setSignals] = useState<Signal[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [selectedDirections, setSelectedDirections] = useState<SignalDirection[]>([
        SignalDirection.LONG,
        SignalDirection.SHORT
    ]);
    const [autoGenEnabled, setAutoGenEnabled] = useState(false);
    const [nextGenTime, setNextGenTime] = useState(0);
    const { showSuccess, showError, showInfo } = useMessages();

    // Load signals from SignalManager
    useEffect(() => {
        const loadSignals = () => {
            const activeSignals = SignalManager.getActiveSignals('onchain');
            setSignals(activeSignals);
        };

        loadSignals();
        const interval = setInterval(loadSignals, 1000);
        return () => clearInterval(interval);
    }, []);

    // Check auto-generation status
    useEffect(() => {
        const prefs = SignalManager.getAutoGenPreferences();
        setAutoGenEnabled(prefs.onchain.enabled);
    }, []);

    // Update next generation countdown
    useEffect(() => {
        if (!autoGenEnabled) return;

        const interval = setInterval(() => {
            const timeLeft = AutoGenerator.timeUntilNext('onchain');
            setNextGenTime(timeLeft);
        }, 1000);

        return () => clearInterval(interval);
    }, [autoGenEnabled]);

    // AUTO-START: On-chain signals auto-generate on page load
    useEffect(() => {
        // Check if we already have signals
        const existingSignals = SignalManager.getActiveSignals('onchain');

        // If no signals, generate them automatically
        if (existingSignals.length === 0) {
            console.log('🤖 Auto-starting on-chain signal generation...');
            generateSignals();
        }

        // Auto-enable auto-generation if not already enabled
        if (!autoGenEnabled) {
            console.log('🤖 Auto-enabling auto-generation for on-chain...');
            AutoGenerator.startAutoGeneration('onchain', {
                market: 'CRYPTO',
                signalType: 'FUTURE',
                enabled: true
            });
            setAutoGenEnabled(true);
        }
    }, []); // Run once on mount

    // Generate signals
    const generateSignals = useCallback(async () => {
        setIsLoading(true);

        try {
            const generatedSignals = await OnChainSignalGenerator.generateOnChainSignals();

            // Save to SignalManager instead of local state
            SignalManager.setActiveSignals(generatedSignals, 'onchain');
            setIsLoading(false);

            if (generatedSignals.length > 0) {
                showSuccess(
                    `🐋 ${generatedSignals.length} On-Chain Signals`,
                    'Whale movements detected!'
                );
            } else {
                showInfo('No Signals', 'Waiting for whale activity...');
            }
        } catch (error) {
            console.error('Error:', error);
            setIsLoading(false);
            showError('Generation Failed', 'Please try again');
        }
    }, [showSuccess, showError, showInfo]);

    // Calculate stats
    const filteredSignals = signals.filter(signal =>
        selectedDirections.includes(signal.direction)
    );

    const stats = {
        totalSignals: filteredSignals.length,
        activeSignals: filteredSignals.filter(s => s.status === 'ACTIVE').length,
        completedSignals: filteredSignals.filter(s => s.tp2Hit || s.tp3Hit).length,
        avgConfidence: filteredSignals.reduce((acc, s) => acc + s.confidence, 0) / (filteredSignals.length || 1)
    };

    return (
        <div className="min-h-screen bg-background">
            <Navbar />

            <div className="container mx-auto px-4 py-8">
                {/* On-Chain Mode Badge */}
                <div className="flex items-center justify-center mb-6">
                    <div className="bg-blue-500/10 border border-blue-500/30 rounded-full px-6 py-3 flex items-center gap-3">
                        <Waves className="w-5 h-5 text-blue-500 animate-pulse" />
                        <span className="text-blue-500 font-bold text-lg">🐋 ON-CHAIN ANALYSIS</span>
                        <span className="text-sm text-muted-foreground">Whale Movements • Technical Indicators</span>
                    </div>
                </div>

                {/* Header */}
                <motion.div
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-center mb-8"
                >
                    <h1 className="text-4xl font-bold mb-4 bg-gradient-primary bg-clip-text text-transparent">
                        On-Chain + Technical Signals
                    </h1>
                    <p className="text-muted-foreground mb-2">
                        High-confidence signals combining whale movements with technical analysis
                    </p>
                    <div className="flex items-center justify-center gap-4 text-sm">
                        <span className="px-3 py-1 rounded-full bg-blue-500/10 text-blue-500">
                            CRYPTO FUTURES Only
                        </span>
                        <span className="px-3 py-1 rounded-full bg-green-500/10 text-green-500">
                            Auto-refresh: 30s
                        </span>
                        <span className="px-3 py-1 rounded-full bg-purple-500/10 text-purple-500">
                            Min Transaction: {'$1M'}
                        </span>
                    </div>
                </motion.div>

                {/* Signal Direction Filter */}
                <div className="mb-6">
                    <SignalDirectionFilter
                        selectedDirections={selectedDirections}
                        onDirectionsChange={setSelectedDirections}
                        signalType="FUTURE"
                    />
                </div>

                {/* Stats */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                    <StatsCard title="Total Signals" value={stats.totalSignals} icon={TrendingUp} />
                    <StatsCard title="Active Signals" value={stats.activeSignals} icon={Activity} />
                    <StatsCard
                        title="Completed"
                        value={stats.completedSignals}
                        icon={Award}
                        trend={{ value: (stats.completedSignals / (stats.totalSignals || 1)) * 100, isPositive: true }}
                    />
                    <StatsCard
                        title="Avg Confidence"
                        value={`${stats.avgConfidence.toFixed(0)}%`}
                        icon={Target}
                        trend={{ value: stats.avgConfidence, isPositive: stats.avgConfidence >= 75 }}
                    />
                </div>

                {/* Auto-Generation Toggle */}
                <div className="glass rounded-lg p-4 mb-6">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <Clock className="w-5 h-5 text-purple-500" />
                            <div>
                                <h3 className="font-semibold">Auto-Generate Signals</h3>
                                <p className="text-sm text-muted-foreground">
                                    {autoGenEnabled
                                        ? `Next generation in ${Math.floor(nextGenTime / 60)}m ${nextGenTime % 60}s`
                                        : 'Generate signals every 45 minutes automatically'
                                    }
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={() => {
                                if (autoGenEnabled) {
                                    AutoGenerator.stopAutoGeneration('onchain');
                                    setAutoGenEnabled(false);
                                    showInfo('Auto-Gen Stopped', 'Stopped automatic generation');
                                } else {
                                    AutoGenerator.startAutoGeneration('onchain', {
                                        market: 'CRYPTO',
                                        signalType: 'FUTURE',
                                        enabled: true
                                    });
                                    setAutoGenEnabled(true);
                                    showSuccess('Auto-Gen Started', 'Signals will generate every 45 mins');
                                }
                            }}
                            className={`px-4 py-2 rounded-lg font-semibold transition-all ${autoGenEnabled
                                ? 'bg-red-500/20 text-red-500 hover:bg-red-500/30'
                                : 'bg-green-500/20 text-green-500 hover:bg-green-500/30'
                                }`}
                        >
                            {autoGenEnabled ? 'Stop Auto-Gen' : 'Enable Auto-Gen'}
                        </button>
                    </div>
                </div>

                {/* Generate Button */}
                <div className="flex justify-center mb-6">
                    <button
                        onClick={generateSignals}
                        disabled={isLoading}
                        className="px-8 py-3 bg-gradient-primary text-white rounded-lg font-bold text-lg hover:shadow-lg transition-all disabled:opacity-50 flex items-center gap-2"
                    >
                        <Waves className="w-5 h-5" />
                        {isLoading ? 'Analyzing...' : 'Refresh Signals'}
                    </button>
                </div>

                {/* Info Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                    <div className="glass rounded-lg p-4">
                        <h3 className="font-semibold mb-2 flex items-center gap-2">
                            <span className="text-2xl">🐋</span>
                            Whale Movements
                        </h3>
                        <p className="text-sm text-muted-foreground">
                            Tracks large transactions ({'>'}$1M) for aggressive 5-12% profit targets
                        </p>
                    </div>
                    <div className="glass rounded-lg p-4">
                        <h3 className="font-semibold mb-2 flex items-center gap-2">
                            <span className="text-2xl">📊</span>
                            Technical Analysis
                        </h3>
                        <p className="text-sm text-muted-foreground">
                            RSI, MACD, and trend analysis for entry/exit timing
                        </p>
                    </div>
                    <div className="glass rounded-lg p-4">
                        <h3 className="font-semibold mb-2 flex items-center gap-2">
                            <span className="text-2xl">💱</span>
                            Exchange Flow
                        </h3>
                        <p className="text-sm text-muted-foreground">
                            Monitors inflow (selling) vs outflow (accumulation)
                        </p>
                    </div>
                </div>

                {/* Loading or Signals List */}
                {isLoading ? (
                    <div className="text-center py-12">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
                        <p className="text-muted-foreground">Analyzing whale movements...</p>
                    </div>
                ) : filteredSignals.length > 0 ? (
                    <SignalList signals={filteredSignals} />
                ) : (
                    <div className="text-center py-12">
                        <Waves className="w-16 h-16 mx-auto mb-4 text-muted-foreground opacity-50" />
                        <h3 className="text-xl font-semibold mb-2">No Signals Yet</h3>
                        <p className="text-muted-foreground">
                            Waiting for significant whale activity...
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
