import { NextResponse } from 'next/server';
import { getFlowMap } from '@/lib/signals/flowMap';

export const dynamic = 'force-dynamic';

/**
 * GET /api/flow-map
 *
 * The Money Flow Map snapshot: per-asset price, % change and z-score
 * (σ) across crypto, US stocks, metals, oil, bonds, the dollar and
 * stablecoin supply, plus a computed risk-on/risk-off meter, a
 * "what the flow says" summary and the next scheduled FOMC decision.
 * All values are computed server-side from public data (see
 * lib/signals/flowMap.ts for sources) and cached for 5 minutes.
 *
 * Assets whose source fails come back individually as
 * { status: 'unavailable' } - they are never faked. Only if EVERY
 * source fails does this route answer 502.
 */
export async function GET() {
    const data = await getFlowMap();

    if (data.assets.every(a => a.status === 'unavailable')) {
        return NextResponse.json(
            { error: 'Live market data unavailable' },
            { status: 502 }
        );
    }

    return NextResponse.json(data);
}
