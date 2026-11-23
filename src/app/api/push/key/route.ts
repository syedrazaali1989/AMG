import { NextResponse } from 'next/server';
import { getVapidPublicKey } from '@/lib/push/store';

export const dynamic = 'force-dynamic';

/**
 * GET /api/push/key
 *
 * Returns the VAPID public key the browser needs to subscribe, or null
 * when push notifications have not been configured on this deployment.
 * The public key is not a secret; the private key never leaves the
 * server environment.
 */
export async function GET() {
    return NextResponse.json({ publicKey: getVapidPublicKey() });
}
