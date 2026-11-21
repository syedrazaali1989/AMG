'use client';

import { useState, useEffect, useCallback } from 'react';
import { Navbar } from '@/components/layout/Navbar';
import { SignalList } from '@/components/ui/SignalList';
import { StatsCard } from '@/components/ui/StatsCard';
import { Signal, SignalStatus } from '@/lib/signals/types';
import type { LargeTransaction } from '@/lib/signals/blockchainInfoAPI';
import type { OnChainDiagnostics } from '@/lib/signals/onChainGenerator';
import { SignalManager } from '@/lib/services/signalManager';
import { SignalCatchup } from '@/lib/services/signalCatchup';
import { SignalGenerator } from '@/lib/signals/generator';
import { fetchBinancePrice } from '@/lib/utils/binancePrices';
import { TrendingUp, Activity, Award, Waves, RefreshCw } from 'lucide-react';

interface CompletedRecord {
    id: string;
    pair: string;
    direction: string;
    status: string;
    entryPrice: number;
    exitPrice?: number;
    profitLossPercentage?: number;
    tp1Hit?: boolean;
    tp2Hit?: boolean;
    tp3Hit?: boolean;
    completedAt?: string;
    isOnChain?: boolean;
}

function shortAddr(addr: string): string {
    return addr.length > 16 ? `${addr.slice(0, 8)}…${addr.slice(-6)}` : addr;
}

function fmtUSD(n: number): string {
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
    return `$${n.toFixed(0)}`;
}

export default function OnChainPage() {
    const [signals, setSignals] = useState<Signal[]>([]);
    const [history, setHistory] = useState<CompletedRecord[]>([]);
    const [transactions, setTransactions] = useState<LargeTransaction[]>([]);
    const [diagnostics, setDiagnostics] = useState<OnChainDiagnostics | null>(null);
    const [issuedThisScan, setIssuedThisScan] = useState(0);
    const [isLoading, setIsLoading] = useState(false);
    const [dataUnavailable, setDataUnavailable] = useState(false);
    const [lastScan, setLastScan] = useState<string | null>(null);

    // Migrate any pre-SignalManager on-chain signals (legacy localStorage key)
    useEffect(() => {
        try {
            const oldSignals = localStorage.getItem('onchainSignals');
            if (oldSignals && oldSignals !== '[]') {
                const parsed = JSON.parse(oldSignals);
                if (SignalManager.getActiveSignals('onchain').length === 0 && parsed.length > 0) {
                    SignalManager.setActiveSignals(parsed, 'onchain');
                }
                localStorage.removeItem('onchainSignals');
            }
        } catch {
            // Migration is best-effort
        }
    }, []);

    const loadStored = useCallback(() => {
        setSignals(SignalManager.getActiveSignals('onchain'));
        const completed = SignalManager.getCompletedSignals() as CompletedRecord[];
        setHistory(completed.filter(c => c.isOnChain).slice(-50).reverse());
    }, []);

    // Fetch the server-side scan: signals + the real large-transaction
    // feed + scoring diagnostics, all from one shared generation pass.
    const fetchScan = useCallback(async () => {
        setIsLoading(true);
        try {
            const response = await fetch('/api/on-chain/signals');
            if (!response.ok) {
                setDataUnavailable(true);
                return;
            }
            const data = await response.json();
            setDataUnavailable(false);
            setTransactions(data.transactions ?? []);
            setDiagnostics(data.diagnostics ?? null);
            setLastScan(data.generatedAt ?? null);

            const incoming: Signal[] = (data.signals ?? []).map((s: Signal) => ({
                ...s,
                timestamp: new Date(s.timestamp),
                expiresAt: s.expiresAt ? new Date(s.expiresAt) : undefined
            }));
            setIssuedThisScan(incoming.length);
            const active = SignalManager.getActiveSignals('onchain');
            const activePairs = new Set(active.map(s => s.pair));
            const activeIds = new Set(active.map(s => s.id));
            const fresh = incoming.filter(s => !activePairs.has(s.pair) && !activeIds.has(s.id));
            if (fresh.length > 0) {
                SignalManager.addSignals(fresh, 'onchain');
            }
            loadStored();
        } catch {
            setDataUnavailable(true);
        } finally {
            setIsLoading(false);
        }
    }, [loadStored]);

    // Poll live prices for open on-chain signals and apply the shared
    // honest outcome rules (full final TP = COMPLETED, SL = STOPPED,
    // expiry = EXPIRED; TP1/TP2 are milestones only).
    const pollPrices = useCallback(async () => {
        const active = SignalManager.getActiveSignals('onchain');
        for (const signal of active) {
            try {
                const price = await fetchBinancePrice(signal.pair);
                if (!price) continue;
                const updated = SignalGenerator.updateSignal(signal, price);
                if (updated.status !== SignalStatus.ACTIVE) {
                    SignalManager.updateSignal(updated, 'onchain');
                    SignalManager.completeSignal(signal.id, 'onchain');
                } else {
                    SignalManager.updateSignal(updated, 'onchain');
                }
            } catch {
                // Keep last known state on a failed price fetch
            }
        }
        loadStored();
    }, [loadStored]);

    useEffect(() => {
        SignalCatchup.catchupAllSignals()
            .catch(() => { /* catch-up is best-effort */ })
            .finally(() => loadStored());
        fetchScan();
        const scanInterval = setInterval(fetchScan, 60 * 1000);
        const priceInterval = setInterval(pollPrices, 30 * 1000);
        return () => {
            clearInterval(scanInterval);
            clearInterval(priceInterval);
        };
    }, [fetchScan, pollPrices, loadStored]);

    const wins = history.filter(h => h.status === 'COMPLETED').length;
    const losses = history.filter(h => h.status === 'STOPPED').length;
    const winRate = wins + losses > 0 ? (wins / (wins + losses)) * 100 : 0;

    const stats = {
        active: signals.length,
        issuedThisScan,
        completed: history.length,
        winRate
    };

    return (
        <div className="min-h-screen bg-background">
            <Navbar />
            <div className="container mx-auto px-4 py-8">
                {/* Header */}
                <div className="flex items-center justify-center mb-6">
                    <div className="bg-blue-500/10 border border-blue-500/30 rounded-full px-6 py-3 flex items-center gap-3">
                        <Waves className="w-5 h-5 text-blue-500 animate-pulse" />
                        <span className="text-blue-500 font-bold text-lg">ON-CHAIN ANALYSIS</span>
                        <span className="text-sm text-muted-foreground">Large BTC Transfers • Technical Indicators</span>
                    </div>
                </div>

                <div className="max-w-3xl mx-auto text-center mb-8">
                    <h1 className="text-4xl font-bold mb-4 bg-gradient-primary bg-clip-text text-transparent">
                        On-Chain + Technical Signals
                    </h1>
                    <p className="text-muted-foreground">
                        Generated server-side from the most recent confirmed Bitcoin blocks (via
                        Blockchain.info) and live Binance
                        prices - the same signals for every visitor. Large BTC transfers (&ge; $500K) are
                        scored for exchange inflow (selling pressure) vs outflow (accumulation) and combined
                        50/50 with a technical RSI/MACD score; a BTC signal is issued only when the combined
                        score reaches &plusmn;10. Altcoin signals are derived from the BTC signal by historical
                        correlation and are labelled CORRELATED - they are not independent whale signals.
                        Trades complete only at the final target (TP3); TP1/TP2 are milestones, and unfilled
                        setups expire after 48 hours. If a live source is unavailable, no signals are shown -
                        transactions and signals are never simulated.
                    </p>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                    <StatsCard title="Active Signals" value={stats.active} icon={Activity} />
                    <StatsCard title="Issued This Scan" value={stats.issuedThisScan} icon={TrendingUp} />
                    <StatsCard title="Closed (This Browser)" value={stats.completed} icon={Award} />
                    <StatsCard
                        title="Win Rate (Full TP)"
                        value={`${stats.winRate.toFixed(1)}%`}
                        icon={Waves}
                        trend={{ value: stats.winRate, isPositive: stats.winRate >= 50 }}
                    />
                </div>

                {/* Scan diagnostics */}
                {diagnostics && (
                    <div className="glass rounded-lg p-6 mb-8">
                        <div className="flex items-center justify-between mb-3">
                            <h2 className="text-lg font-bold">Last Scan - On-Chain Evidence</h2>
                            <button
                                onClick={fetchScan}
                                disabled={isLoading}
                                className="px-4 py-2 rounded-lg font-semibold bg-gradient-primary text-white hover:shadow-lg transition-all disabled:opacity-50 flex items-center gap-2"
                            >
                                <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                                Rescan
                            </button>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                            <div>Large transfers analysed: <b>{diagnostics.transactionsAnalyzed}</b></div>
                            <div>To exchanges (inflow): <b>{diagnostics.exchangeInflowCount}</b> ({fmtUSD(diagnostics.exchangeInflowUSD)})</div>
                            <div>From exchanges (outflow): <b>{diagnostics.exchangeOutflowCount}</b> ({fmtUSD(diagnostics.exchangeOutflowUSD)})</div>
                            <div>Wallet-to-wallet (unknown): <b>{diagnostics.unknownCount}</b></div>
                            <div>Net exchange flow: <b>{fmtUSD(Math.abs(diagnostics.netFlowUSD))}</b> ({diagnostics.flowSentiment})</div>
                            <div>On-chain score: <b>{diagnostics.onChainScore}</b></div>
                            <div>Technical score: <b>{diagnostics.technicalScore ?? '-'}</b>{diagnostics.rsi !== null ? ` (RSI ${diagnostics.rsi})` : ''}</div>
                            <div>Combined: <b>{diagnostics.combinedScore !== null ? diagnostics.combinedScore.toFixed(1) : '-'}</b> (needs &plusmn;{diagnostics.threshold})</div>
                        </div>
                        <p className="text-sm text-muted-foreground mt-3">
                            BTC signal issued this scan: <b>{diagnostics.btcSignalIssued ? 'yes' : 'no'}</b>
                            {' • '}Correlated alt signals: <b>{diagnostics.correlatedIssued}</b>
                            {lastScan ? ` • scan at ${new Date(lastScan).toLocaleTimeString()}` : ''}
                        </p>
                    </div>
                )}

                {/* Signals / states */}
                {dataUnavailable ? (
                    <div className="glass rounded-lg p-12 text-center mb-8">
                        <div className="space-y-4">
                            <div className="text-2xl font-bold text-danger">Live Data Unavailable</div>
                            <div className="text-muted-foreground">
                                A live data source (Blockchain.info or Binance) could not be reached, so no
                                signals are shown. Transactions and signals are never generated from
                                simulated data - please try again shortly.
                            </div>
                        </div>
                    </div>
                ) : isLoading && signals.length === 0 ? (
                    <div className="text-center py-12">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
                        <p className="text-muted-foreground">Analysing live large transfers...</p>
                    </div>
                ) : signals.length === 0 ? (
                    <div className="glass rounded-lg p-12 text-center mb-8">
                        <div className="text-xl font-bold mb-2">No on-chain signal right now</div>
                        <div className="text-muted-foreground">
                            {diagnostics && diagnostics.transactionsAnalyzed === 0
                                ? 'The most recent confirmed blocks currently contain no BTC transfers at or above $500K. The scan repeats every minute.'
                                : 'The scan ran on live data (see the evidence panel above) but the combined score did not reach the ±10 threshold. The scan repeats every minute.'}
                        </div>
                    </div>
                ) : (
                    <div className="mb-8">
                        <SignalList signals={signals} />
                    </div>
                )}

                {/* Real large-transaction feed */}
                <div className="glass rounded-lg p-6 mb-8">
                    <h2 className="text-lg font-bold mb-2">Large BTC Transfers - Live Feed</h2>
                    <p className="text-sm text-muted-foreground mb-4">
                        Confirmed BTC transfers of $500K or more from the most recent Bitcoin blocks,
                        via Blockchain.info - every row is a real transaction (click a hash to verify it). A transfer is
                        labelled exchange inflow/outflow only when a known exchange wallet address takes
                        part; exchange labelling uses a small built-in address set, so most large transfers
                        are wallet-to-wallet and shown as Unknown. This is public blockchain data, not a
                        paid whale-alert service.
                    </p>
                    {transactions.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                            No large transfers in the most recent blocks right now.
                        </p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="text-left text-muted-foreground border-b border-border">
                                        <th className="py-2 pr-4">Time</th>
                                        <th className="py-2 pr-4">Transaction</th>
                                        <th className="py-2 pr-4">Value</th>
                                        <th className="py-2 pr-4">From → To</th>
                                        <th className="py-2">Flow</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {transactions.map(tx => (
                                        <tr key={tx.hash} className="border-b border-border/50">
                                            <td className="py-2 pr-4 whitespace-nowrap">
                                                {new Date(tx.timestamp * 1000).toLocaleTimeString()}
                                                {tx.blockHeight ? (
                                                    <span className="block text-xs text-muted-foreground">Block {tx.blockHeight.toLocaleString()}</span>
                                                ) : null}
                                            </td>
                                            <td className="py-2 pr-4">
                                                <a
                                                    href={`https://www.blockchain.com/explorer/transactions/btc/${tx.hash}`}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="text-blue-400 hover:underline font-mono"
                                                >
                                                    {tx.hash.slice(0, 10)}…
                                                </a>
                                            </td>
                                            <td className="py-2 pr-4 whitespace-nowrap">
                                                {tx.valueBTC.toFixed(2)} BTC • {fmtUSD(tx.valueUSD)}
                                            </td>
                                            <td className="py-2 pr-4 font-mono text-xs">
                                                {tx.from.length > 0 ? shortAddr(tx.from[0]) : '-'}
                                                {' → '}
                                                {tx.to.length > 0 ? shortAddr(tx.to[0]) : '-'}
                                            </td>
                                            <td className="py-2">
                                                <span className={
                                                    tx.type === 'exchange_inflow' ? 'text-danger'
                                                        : tx.type === 'exchange_outflow' ? 'text-success'
                                                            : 'text-muted-foreground'
                                                }>
                                                    {tx.type === 'exchange_inflow' ? 'To exchange'
                                                        : tx.type === 'exchange_outflow' ? 'From exchange'
                                                            : 'Unknown'}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

                {/* History (this browser) */}
                {history.length > 0 && (
                    <div className="glass rounded-lg p-6">
                        <h2 className="text-lg font-bold mb-4">Closed Signals (this browser)</h2>
                        <p className="text-sm text-muted-foreground mb-4">
                            Completed = final target (TP3) reached before the stop loss. TP1/TP2 are shown as
                            milestones only and never complete a trade. Expired setups closed at the last price
                            after 48 hours and are excluded from the win rate.
                        </p>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="text-left text-muted-foreground border-b border-border">
                                        <th className="py-2 pr-4">Pair</th>
                                        <th className="py-2 pr-4">Direction</th>
                                        <th className="py-2 pr-4">Result</th>
                                        <th className="py-2 pr-4">Entry</th>
                                        <th className="py-2 pr-4">Exit</th>
                                        <th className="py-2 pr-4">Realised P/L</th>
                                        <th className="py-2">Milestones</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {history.map(h => (
                                        <tr key={h.id} className="border-b border-border/50">
                                            <td className="py-2 pr-4 font-semibold">{h.pair}</td>
                                            <td className="py-2 pr-4">{h.direction}</td>
                                            <td className="py-2 pr-4">
                                                <span className={
                                                    h.status === 'COMPLETED' ? 'text-success'
                                                        : h.status === 'STOPPED' ? 'text-danger'
                                                            : 'text-muted-foreground'
                                                }>
                                                    {h.status}
                                                </span>
                                            </td>
                                            <td className="py-2 pr-4">{h.entryPrice}</td>
                                            <td className="py-2 pr-4">{h.exitPrice ?? '-'}</td>
                                            <td className="py-2 pr-4">
                                                {h.profitLossPercentage !== undefined
                                                    ? `${h.profitLossPercentage >= 0 ? '+' : ''}${h.profitLossPercentage.toFixed(2)}%`
                                                    : '-'}
                                            </td>
                                            <td className="py-2">
                                                {[h.tp1Hit ? 'TP1' : null, h.tp2Hit ? 'TP2' : null, h.tp3Hit ? 'TP3' : null]
                                                    .filter(Boolean).join(', ') || '-'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
