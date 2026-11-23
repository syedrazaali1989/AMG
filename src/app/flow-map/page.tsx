import type { Metadata } from 'next';
import { Navbar } from '@/components/layout/Navbar';
import { getFlowMap } from '@/lib/signals/flowMap';
import { FlowMapClient } from '@/components/ui/FlowMapClient';

// Server-rendered first snapshot from public data; the client then
// polls /api/flow-map every 5 minutes (the server cache TTL matches).
export const revalidate = 300;

export const metadata: Metadata = {
    title: 'Money Flow Map - Where Money Is Moving | AMG Trading',
    description:
        'Where money is moving across crypto, stocks, gold, silver, oil, bonds, the dollar and stablecoins: live prices, z-scores, a risk-on/risk-off meter and the next Fed decision, computed from public market data.'
};

export default async function FlowMapPage() {
    const data = await getFlowMap();

    return (
        <div className="min-h-screen bg-background">
            <Navbar />
            <div className="container mx-auto px-4 py-8">
                <h1 className="text-3xl md:text-4xl font-bold mb-6">Money Flow Map</h1>
                <FlowMapClient initialData={data} />
            </div>
        </div>
    );
}
