// Scalping V2 generation service (server-side).
//
// Ports the amg-eight Scalping V2 page's ICT scan to the server so every
// visitor sees the same signals for the same market state, with the
// audit's mandatory fixes applied:
//
//  - REAL DATA ONLY. Candles come from Binance (data-api.binance.vision)
//    via BinanceAPI. There is NO simulated-candle fallback and no stale
//    hard-coded price anchor anywhere in this path: a pair whose data
//    cannot be fetched is skipped, and if no pair loads at all the
//    caller returns "live data unavailable".
//  - FRESHNESS GATE. Both candle series must pass
//    BinanceAPI.isCandleSeriesFresh. The original page analysed the
//    frozen 2024 series of delisted MATIC/RNDR as if live; here a stale
//    series is rejected and counted in the funnel, never analysed.
//  - UPDATED UNIVERSE. The original 54-pair list with the two delisted
//    names replaced: MATIC/USDT -> POL/USDT, RNDR/USDT -> RENDER/USDT.
//  - HONEST ACCOUNTING downstream: signals are issued with
//    takeProfit = TP3 (the trade's final target). TP1 (1.5R) and TP2 (3R)
//    are milestones only - the shared SignalGenerator.updateSignal rules
//    close a trade as COMPLETED only at the full final target, STOPPED
//    at the stop loss, EXPIRED at expiry (4h for these scalping setups).

import { BinanceAPI } from './binanceAPI';
import { ICTEngine, ICTGrade, ICTSignal } from './ictEngine';
import {
    MarketType,
    Signal,
    SignalDirection,
    SignalStatus,
    SignalType,
    Timeframe
} from './types';

// The original Scalping V2 scan universe (54 USDT pairs), with delisted
// MATIC -> POL and RNDR -> RENDER.
export const SCALPING_V2_PAIRS: string[] = [
    'AAVE/USDT', 'ADA/USDT', 'AEVO/USDT', 'APE/USDT', 'APT/USDT', 'ARB/USDT',
    'ATOM/USDT', 'AVAX/USDT', 'AXS/USDT', 'BCH/USDT', 'BNB/USDT', 'BTC/USDT',
    'DOGE/USDT', 'DOT/USDT', 'DYDX/USDT', 'EGLD/USDT', 'ENA/USDT', 'ETC/USDT',
    'ETH/USDT', 'FET/USDT', 'FIL/USDT', 'FLOW/USDT', 'FTM/USDT', 'GALA/USDT',
    'GRT/USDT', 'ICP/USDT', 'IMX/USDT', 'INJ/USDT', 'JTO/USDT', 'JUP/USDT',
    'LDO/USDT', 'LINK/USDT', 'LTC/USDT', 'POL/USDT', 'NEAR/USDT', 'OP/USDT',
    'PEPE/USDT', 'PYTH/USDT', 'RENDER/USDT', 'RUNE/USDT', 'SAND/USDT', 'SHIB/USDT',
    'SOL/USDT', 'STRK/USDT', 'STX/USDT', 'SUI/USDT', 'THETA/USDT', 'TIA/USDT',
    'TRX/USDT', 'UNI/USDT', 'W/USDT', 'WLD/USDT', 'XRP/USDT'
];

// Scalping setups expire 4h after issuance if neither the final target
// nor the stop loss is reached (they then close as EXPIRED at the last
// price, per the shared honest accounting rules).
export const SCALPING_V2_EXPIRY_MS = 4 * 60 * 60 * 1000;

const HTF_INTERVAL = '5m';
const LTF_INTERVAL = '1m';
const HTF_INTERVAL_MS = 5 * 60 * 1000;
const LTF_INTERVAL_MS = 60 * 1000;
const CANDLE_LIMIT = 100;

export interface ScalpingV2Funnel {
    pairsRequested: number;
    pairsLoaded: number;
    pairsStale: number;
    pairsFailed: number;
    ranging: number;
    noBias: number;
    noLtfBreak: number;
    wrongZone: number;
    confluence: number;
    belowGrade: number;
    issued: number;
    /** Highest scores observed this scan (issued or not), best first. */
    topScores: { pair: string; score: number; grade: ICTGrade }[];
}

export interface ScalpingV2Result {
    signals: Signal[];
    funnel: ScalpingV2Funnel;
    generatedAt: string;
}

function emptyFunnel(pairsRequested: number): ScalpingV2Funnel {
    return {
        pairsRequested,
        pairsLoaded: 0,
        pairsStale: 0,
        pairsFailed: 0,
        ranging: 0,
        noBias: 0,
        noLtfBreak: 0,
        wrongZone: 0,
        confluence: 0,
        belowGrade: 0,
        issued: 0,
        topScores: []
    };
}

/**
 * Generate Scalping V2 (ICT) signals for the scan universe from live data.
 * Throws only when NO pair could be loaded with fresh data at all.
 */
export async function generateScalpingV2Signals(
    pairs: string[] = SCALPING_V2_PAIRS
): Promise<ScalpingV2Result> {
    const funnel = emptyFunnel(pairs.length);
    const scored: { pair: string; score: number; grade: ICTGrade }[] = [];

    // Rolling 24h opens for the daily-bias vote (the original page used
    // the 24h ticker's openPrice). One bulk call; pairs missing from it
    // fall back to the engine's own open derivation.
    const dailyOpens = new Map<string, number>();
    try {
        const tickers = await BinanceAPI.getAll24hTickers();
        for (const t of tickers) {
            const open = parseFloat(t.openPrice);
            if (isFinite(open) && open > 0) dailyOpens.set(t.symbol, open);
        }
    } catch {
        console.warn('24h tickers unavailable for Scalping V2 (bias falls back to candle-derived open)');
    }

    const perPair = await Promise.allSettled(
        pairs.map(async (pair): Promise<Signal | null> => {
            const [htf, ltf] = await Promise.all([
                BinanceAPI.getCandles(pair, HTF_INTERVAL, CANDLE_LIMIT),
                BinanceAPI.getCandles(pair, LTF_INTERVAL, CANDLE_LIMIT)
            ]);

            const fresh =
                BinanceAPI.isCandleSeriesFresh(htf, HTF_INTERVAL_MS) &&
                BinanceAPI.isCandleSeriesFresh(ltf, LTF_INTERVAL_MS);
            if (!fresh) {
                funnel.pairsStale++;
                return null;
            }
            funnel.pairsLoaded++;

            const symbol = BinanceAPI.pairToBinanceSymbol(pair);
            const { signal, diagnostic } = ICTEngine.evaluateICT(
                htf,
                ltf,
                pair,
                dailyOpens.get(symbol)
            );

            switch (diagnostic.stage) {
                case 'ranging': funnel.ranging++; break;
                case 'no-bias': funnel.noBias++; break;
                case 'no-ltf-break': funnel.noLtfBreak++; break;
                case 'wrong-zone': funnel.wrongZone++; break;
                case 'confluence': funnel.confluence++; break;
                case 'below-grade': funnel.belowGrade++; break;
                case 'issued': funnel.issued++; break;
                default: break; // 'insufficient-data' cannot occur with 100 fresh candles
            }
            if (diagnostic.score !== undefined && diagnostic.grade) {
                scored.push({ pair, score: diagnostic.score, grade: diagnostic.grade });
            }

            if (!signal) return null;
            return ictToSignal(signal);
        })
    );

    const signals: Signal[] = [];
    for (const result of perPair) {
        if (result.status === 'fulfilled') {
            if (result.value) signals.push(result.value);
        } else {
            funnel.pairsFailed++;
        }
    }

    funnel.topScores = scored.sort((a, b) => b.score - a.score).slice(0, 5);

    if (funnel.pairsLoaded === 0) {
        // Live data is down (or every series was stale): say so, never
        // fall back to simulated candles.
        throw new Error('Live market data unavailable');
    }

    return {
        signals,
        funnel,
        generatedAt: new Date().toISOString()
    };
}

/** Convert an ICT signal into the repo's shared Signal shape. */
function ictToSignal(ict: ICTSignal): Signal {
    const isBuy = ict.type === 'BUY';
    const timestamp = new Date(ict.timestamp);

    const rationale: string[] = [
        `ICT grade ${ict.score.grade} - score ${ict.score.total}/100 (issuance: A+ >= 75, ELITE >= 88)`,
        `Daily bias ${ict.dailyBias.bias} (confidence ${ict.dailyBias.confidence}%), session: ${ict.sessionConfirmation.sessionName}`,
        `Zone: ${ict.premiumDiscount.currentZone.toLowerCase()} (swing ${ict.premiumDiscount.swingLow.toFixed(6)} - ${ict.premiumDiscount.swingHigh.toFixed(6)})`
    ];
    if (ict.chochConfirmation) {
        rationale.push(`${ict.chochConfirmation.type} on 1m at ${ict.chochConfirmation.brokenLevel.toFixed(6)}`);
    }
    if (ict.liquiditySweep) {
        rationale.push(`Liquidity sweep (${ict.liquiditySweep.type.toLowerCase()}) of ${ict.liquiditySweep.sweptLevel.toFixed(6)}`);
    }
    if (ict.orderBlockConfirmation) {
        rationale.push(`Unmitigated order block ${ict.orderBlockConfirmation.low.toFixed(6)} - ${ict.orderBlockConfirmation.high.toFixed(6)}`);
    }
    if (ict.fvgConfirmation) {
        rationale.push(`Unfilled FVG ${ict.fvgConfirmation.low.toFixed(6)} - ${ict.fvgConfirmation.high.toFixed(6)}`);
    }
    if (ict.oteConfirmation) {
        rationale.push('Price inside the OTE zone (62-79% retracement)');
    }
    if (ict.volumeConfirmation) {
        rationale.push('Volume confirmation: last 1m volume above its 5- and 20-candle averages');
    }
    rationale.push(
        `Targets: TP1 = 1.5R, TP2 = 3R, final TP3 = ${ict.riskRewardToFinal.toFixed(2)}R. ` +
        'TP1/TP2 are milestones only - the trade completes only at the final target.'
    );

    const signal: Signal = {
        id: `ictv2-${BinanceAPI.pairToBinanceSymbol(ict.pair)}-${ict.timestamp}`,
        marketType: MarketType.CRYPTO,
        signalType: SignalType.FUTURE,
        direction: isBuy ? SignalDirection.LONG : SignalDirection.SHORT,
        status: SignalStatus.ACTIVE,
        pair: ict.pair,
        entryPrice: ict.entry,
        currentPrice: ict.entry,
        stopLoss: ict.stopLoss,
        // The trade's target is the FINAL take profit (TP3). TP1/TP2 are
        // partial milestones and never complete the trade.
        takeProfit: ict.tp3,
        takeProfit1: ict.tp1,
        takeProfit2: ict.tp2,
        takeProfit3: ict.tp3,
        confidence: ict.score.total,
        timestamp,
        expiresAt: new Date(ict.timestamp + SCALPING_V2_EXPIRY_MS),
        timeframe: Timeframe.ONE_MINUTE,
        rationalePoints: rationale
    };

    // Markers for the Scalping V2 store/history views.
    (signal as unknown as Record<string, unknown>).isScalpingV2 = true;
    (signal as unknown as Record<string, unknown>).ictGrade = ict.score.grade;
    (signal as unknown as Record<string, unknown>).ictScore = ict.score;

    return signal;
}
