import type { Metadata } from 'next';
import Link from 'next/link';
import { Navbar } from '@/components/layout/Navbar';
import { getCoinList, formatCoinPrice } from '@/lib/signals/coinData';
import { formatPercentage } from '@/lib/utils';

// Server-rendered from one live Binance call, refreshed at most once
// a minute.
export const revalidate = 60;

export const metadata: Metadata = {
    title: 'All Coins - Live Prices, Technical Analysis & Signals | AMG Trading',
    description:
        'Every pair the AMG Trading engines scan, with live Binance price and 24h change. Open a coin for its technical snapshot, price chart and active signals.'
};

export default async function CoinsPage() {
    const result = await getCoinList();

    return (
        <div className="min-h-screen bg-background">
            <Navbar />
            <div className="container mx-auto px-4 py-8">
                <h1 className="text-3xl md:text-4xl font-bold mb-6">Coins</h1>

                {result.status === 'unavailable' && (
                    <div className="glass rounded-lg p-6 text-center">
                        <div className="font-semibold mb-1">Live data unavailable</div>
                        <p className="text-sm text-muted-foreground">
                            Binance market data could not be reached just now, so no prices are
                            shown. Nothing on this page is ever simulated.
                        </p>
                    </div>
                )}

                {result.status === 'ok' && (
                    <div className="glass rounded-lg overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-border text-left text-muted-foreground">
                                    <th className="px-4 py-3 font-medium">Pair</th>
                                    <th className="px-4 py-3 font-medium text-right">Price</th>
                                    <th className="px-4 py-3 font-medium text-right">24h Change</th>
                                </tr>
                            </thead>
                            <tbody>
                                {result.rows.map(row => (
                                    <tr
                                        key={row.info.symbol}
                                        className="border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors"
                                    >
                                        <td className="px-4 py-3">
                                            <Link
                                                href={`/coin/${row.info.symbol}`}
                                                className="font-semibold text-[#D4AF37] hover:text-[#FFD700] transition-colors"
                                            >
                                                {row.info.pair}
                                            </Link>
                                        </td>
                                        {row.stale ? (
                                            <>
                                                <td className="px-4 py-3 font-mono text-right text-muted-foreground">
                                                    -
                                                </td>
                                                <td className="px-4 py-3 text-right">
                                                    <span className="text-xs font-semibold text-yellow-500">
                                                        DATA FROZEN
                                                    </span>
                                                </td>
                                            </>
                                        ) : (
                                            <>
                                                <td className="px-4 py-3 font-mono text-right">
                                                    ${formatCoinPrice(row.price)}
                                                </td>
                                                <td
                                                    className={`px-4 py-3 font-mono text-right ${
                                                        row.changePct24h >= 0
                                                            ? 'text-green-500'
                                                            : 'text-red-500'
                                                    }`}
                                                >
                                                    {formatPercentage(row.changePct24h)}
                                                </td>
                                            </>
                                        )}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
