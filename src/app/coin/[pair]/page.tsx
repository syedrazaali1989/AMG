import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Navbar } from '@/components/layout/Navbar';
import { CoinClient } from '@/components/ui/CoinClient';
import { CoinLivePrice } from '@/components/ui/CoinLivePrice';
import { findCoin, getCoinMarketData, formatCoinPrice } from '@/lib/signals/coinData';
import { formatPercentage, formatVolume } from '@/lib/utils';

// Server-rendered with real Binance data, refreshed at most once a
// minute, so search engines and visitors see actual content.
export const revalidate = 60;

interface CoinPageProps {
    params: Promise<{ pair: string }>;
}

export async function generateMetadata({ params }: CoinPageProps): Promise<Metadata> {
    const { pair } = await params;
    const coin = findCoin(pair);
    if (!coin) {
        return { title: 'Coin Not Found | AMG Trading' };
    }
    return {
        title: `${coin.pair} Price, Technical Analysis & Trading Signals | AMG Trading`,
        description: `${coin.pair} live price and 24h change, RSI (14), SMA 50, SMA 200, EMA 50 and ATR technical snapshot, 1H price chart and active AMG Trading signals - all computed from live Binance data.`
    };
}

export default async function CoinPage({ params }: CoinPageProps) {
    const { pair } = await params;
    const coin = findCoin(pair);
    if (!coin) notFound();

    const result = await getCoinMarketData(coin);

    return (
        <div className="min-h-screen bg-background">
            <Navbar />
            <div className="container mx-auto px-4 py-8">
                <div className="flex flex-wrap items-end gap-x-4 gap-y-2 mb-6">
                    <h1 className="text-3xl md:text-4xl font-bold">{coin.pair}</h1>
                    <span className="text-sm text-muted-foreground pb-1">
                        {coin.symbol} · Binance Spot · 1H
                    </span>
                </div>

                {result.status === 'stale' && (
                    <div className="glass rounded-lg p-6 text-center">
                        <div className="font-semibold mb-1">Live data unavailable for {coin.pair}</div>
                        <p className="text-sm text-muted-foreground">
                            Binance spot data for this pair is frozen - its last candle is months
                            old - so no prices or indicators are shown rather than stale data
                            presented as live.
                        </p>
                    </div>
                )}

                {result.status === 'unavailable' && (
                    <div className="glass rounded-lg p-6 text-center">
                        <div className="font-semibold mb-1">Live data unavailable</div>
                        <p className="text-sm text-muted-foreground">
                            Binance market data could not be reached just now, so no prices or
                            indicators are shown. Nothing on this page is ever simulated.
                        </p>
                    </div>
                )}

                {result.status === 'ok' && (
                    <>
                        {/* Price + 24h stats */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6 mb-8">
                            <div className="glass rounded-lg p-6 border border-border">
                                <p className="text-sm text-muted-foreground mb-1">Price</p>
                                <CoinLivePrice symbol={coin.symbol} initialPrice={result.data.price} />
                                <p
                                    className={`text-sm font-semibold mt-1 ${
                                        result.data.changePct24h >= 0 ? 'text-green-500' : 'text-red-500'
                                    }`}
                                >
                                    {formatPercentage(result.data.changePct24h)} · 24h
                                </p>
                            </div>
                            <div className="glass rounded-lg p-6 border border-border">
                                <p className="text-sm text-muted-foreground mb-1">24h High</p>
                                <p className="text-2xl md:text-3xl font-bold">
                                    ${formatCoinPrice(result.data.high24h)}
                                </p>
                            </div>
                            <div className="glass rounded-lg p-6 border border-border">
                                <p className="text-sm text-muted-foreground mb-1">24h Low</p>
                                <p className="text-2xl md:text-3xl font-bold">
                                    ${formatCoinPrice(result.data.low24h)}
                                </p>
                            </div>
                            <div className="glass rounded-lg p-6 border border-border">
                                <p className="text-sm text-muted-foreground mb-1">24h Volume (USDT)</p>
                                <p className="text-2xl md:text-3xl font-bold">
                                    ${formatVolume(result.data.quoteVolume24h)}
                                </p>
                            </div>
                        </div>

                        {/* Technical snapshot - computed from the last 250 1H candles */}
                        <h2 className="text-xl font-bold mb-4">Technical Snapshot · 1H</h2>
                        <div className="glass rounded-lg overflow-x-auto mb-8">
                            <table className="w-full text-sm">
                                <tbody>
                                    <tr className="border-b border-border/50">
                                        <td className="px-4 py-3 text-muted-foreground">RSI (14)</td>
                                        <td className="px-4 py-3 font-mono text-right">
                                            {result.data.technicals.rsi14.toFixed(1)}
                                        </td>
                                    </tr>
                                    <tr className="border-b border-border/50">
                                        <td className="px-4 py-3 text-muted-foreground">SMA 50</td>
                                        <td className="px-4 py-3 font-mono text-right">
                                            ${formatCoinPrice(result.data.technicals.sma50)}
                                        </td>
                                    </tr>
                                    <tr className="border-b border-border/50">
                                        <td className="px-4 py-3 text-muted-foreground">SMA 200</td>
                                        <td className="px-4 py-3 font-mono text-right">
                                            ${formatCoinPrice(result.data.technicals.sma200)}
                                        </td>
                                    </tr>
                                    <tr className="border-b border-border/50">
                                        <td className="px-4 py-3 text-muted-foreground">EMA 50</td>
                                        <td className="px-4 py-3 font-mono text-right">
                                            ${formatCoinPrice(result.data.technicals.ema50)}
                                        </td>
                                    </tr>
                                    <tr className="border-b border-border/50">
                                        <td className="px-4 py-3 text-muted-foreground">ATR (14)</td>
                                        <td className="px-4 py-3 font-mono text-right">
                                            ${formatCoinPrice(result.data.technicals.atr14)}
                                        </td>
                                    </tr>
                                    <tr>
                                        <td className="px-4 py-3 text-muted-foreground">Price vs SMA 200</td>
                                        <td
                                            className={`px-4 py-3 font-semibold text-right ${
                                                result.data.technicals.priceVsSma200 === 'ABOVE'
                                                    ? 'text-green-500'
                                                    : 'text-red-500'
                                            }`}
                                        >
                                            {result.data.technicals.priceVsSma200}
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>

                        <CoinClient pair={coin.pair} />
                    </>
                )}
            </div>
        </div>
    );
}
