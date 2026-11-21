// ICT / Smart Money Concepts engine - TypeScript port of the engine that
// runs on the amg-eight deployment's Scalping V2 page (extracted verbatim
// from its production bundle and ported 1:1; see
// ~/workspace/amg-analysis/scalping-v2-report.md for the reconstruction).
//
// The decision logic below is the original engine's, unchanged, EXCEPT for
// the fixes mandated by the audit (also listed in SCALPING-V2-REPORT.md):
//
//  1. GRADE THRESHOLDS RECALIBRATED. The original issued only ELITE (>= 90)
//     and A+ (>= 82). The score components sum to 100 and the maximum
//     attainable score WITHOUT a liquidity sweep is 80 - below the old A+
//     cutoff - so a sweep was mathematically mandatory and the full
//     combination never occurred in 48h x 12 pairs of real data
//     (0 signals in ~1,556 reconstructed scans). Issuance is now
//     ELITE >= 88 and A+ >= 75, which a strong no-sweep setup (max 80) or
//     a swept setup can actually reach.
//  2. The hard-coded `riskRewardRatio: 1.5` is gone. The signal exposes
//     its real R ladder: TP1 = 1.5R, TP2 = 3R, TP3 = riskRewardToFinal
//     (5R, or the swing extreme when the original logic substitutes it -
//     the actual multiple is computed and reported, never rounded to a
//     marketing number).
//  3. No data handling lives here at all: this module is pure. The
//     original page silently substituted Math.random() simulated candles
//     when data failed; the caller (scalpingV2.ts) fetches real candles,
//     freshness-checks them, and never calls this engine without them.
//
// Diagnostics: evaluateICT() returns the stage at which each scan stopped
// (the "gate funnel") alongside the signal, so callers can prove the
// engine ran on real data and show where pairs were filtered out.

export interface ICTCandle {
    timestamp: number; // ms
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

export interface SwingPoint {
    price: number;
    index: number;
    type: 'HIGH' | 'LOW';
    timestamp: number;
}

export interface StructureBreak {
    type: 'BOS' | 'CHoCH';
    direction: 'BULLISH' | 'BEARISH';
    price: number;
    index: number;
    brokenLevel: number;
    timestamp: number;
}

export type MarketStructure = 'BULLISH' | 'BEARISH' | 'NEUTRAL';

export interface FVG {
    type: 'BULLISH' | 'BEARISH';
    high: number;
    low: number;
    midpoint: number;
    index: number;
    filled: boolean;
    timestamp: number;
}

export interface OrderBlock {
    type: 'BULLISH' | 'BEARISH';
    high: number;
    low: number;
    midpoint: number;
    index: number;
    mitigated: boolean;
    volume: number;
    timestamp: number;
}

export interface LiquiditySweep {
    type: 'BUYSIDE' | 'SELLSIDE';
    sweptLevel: number;
    sweepPrice: number;
    index: number;
    confirmed: boolean;
    timestamp: number;
}

export interface PremiumDiscount {
    premiumZoneHigh: number;
    premiumZoneLow: number;
    equilibrium: number;
    discountZoneHigh: number;
    discountZoneLow: number;
    currentZone: 'PREMIUM' | 'DISCOUNT' | 'EQUILIBRIUM';
    swingHigh: number;
    swingLow: number;
}

export interface OTEZone {
    fib62: number;
    fib705: number;
    fib79: number;
    inZone: boolean;
    direction: 'BUY' | 'SELL';
}

export interface DailyBias {
    bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    dailyOpen: number;
    priceAboveOpen: boolean;
    marketStructure: MarketStructure;
    recentBOS: StructureBreak | null;
    confidence: number; // 0 / 50 / 75 / 100 (quantised vote share, as original)
}

export interface SessionInfo {
    currentSession: 'LONDON_NY_OVERLAP' | 'LONDON' | 'NEW_YORK' | 'ASIAN' | 'CLOSED';
    isAllowed: boolean;
    sessionName: string;
}

export type ICTGrade = 'ELITE' | 'A+' | 'A' | 'B' | 'IGNORE';

export interface ICTScore {
    dailyBias: number;
    liquiditySweep: number;
    orderBlock: number;
    fvg: number;
    ote: number;
    choch: number;
    volume: number;
    session: number;
    total: number;
    grade: ICTGrade;
}

export interface ICTSignal {
    type: 'BUY' | 'SELL';
    score: ICTScore;
    entry: number;
    stopLoss: number;
    tp1: number; // 1.5R
    tp2: number; // 3R
    tp3: number; // final target: 5R, or the swing extreme when farther than 3R
    riskDistance: number;
    riskRewardToFinal: number; // actual |tp3 - entry| / riskDistance
    dailyBias: DailyBias;
    liquiditySweep: LiquiditySweep | null;
    oteConfirmation: OTEZone | null;
    orderBlockConfirmation: OrderBlock | null;
    fvgConfirmation: FVG | null;
    volumeConfirmation: boolean;
    sessionConfirmation: SessionInfo;
    premiumDiscount: PremiumDiscount;
    chochConfirmation: StructureBreak | null;
    engulfingConfirmation: boolean;
    timestamp: number;
    pair: string;
}

export type ICTFunnelStage =
    | 'insufficient-data'
    | 'ranging'
    | 'no-bias'
    | 'no-ltf-break'
    | 'wrong-zone'
    | 'confluence'
    | 'below-grade'
    | 'issued';

export interface ICTDiagnostic {
    stage: ICTFunnelStage;
    score?: number;
    grade?: ICTGrade;
}

export interface ICTEvaluation {
    signal: ICTSignal | null;
    diagnostic: ICTDiagnostic;
}

// Grade thresholds - recalibrated (see header). Only ELITE and A+ issue.
export const ICT_GRADE_THRESHOLDS = {
    ELITE: 88,
    A_PLUS: 75,
    A: 65,
    B: 55
} as const;

// How far back (in LTF candles) a structure break still counts as fresh.
// Unchanged from the original engine.
export const LTF_BREAK_RECENCY = 5;

export class ICTEngine {
    static detectSwingPoints(candles: ICTCandle[], lookback: number = 3): SwingPoint[] {
        const points: SwingPoint[] = [];
        if (candles.length < 2 * lookback + 1) return points;
        for (let l = lookback; l < candles.length - lookback; l++) {
            let isHigh = true;
            let isLow = true;
            for (let i = 1; i <= lookback; i++) {
                if (candles[l].high <= candles[l - i].high || candles[l].high <= candles[l + i].high) {
                    isHigh = false;
                }
                if (candles[l].low >= candles[l - i].low || candles[l].low >= candles[l + i].low) {
                    isLow = false;
                }
            }
            if (isHigh) {
                points.push({ price: candles[l].high, index: l, type: 'HIGH', timestamp: candles[l].timestamp });
            }
            if (isLow) {
                points.push({ price: candles[l].low, index: l, type: 'LOW', timestamp: candles[l].timestamp });
            }
        }
        return points.sort((a, b) => a.index - b.index);
    }

    static analyzeMarketStructure(
        candles: ICTCandle[],
        swings: SwingPoint[]
    ): { structure: MarketStructure; breaks: StructureBreak[] } {
        const breaks: StructureBreak[] = [];
        if (swings.length < 4) return { structure: 'NEUTRAL', breaks };

        const highs = swings.filter(s => s.type === 'HIGH');
        const lows = swings.filter(s => s.type === 'LOW');
        let bullPoints = 0;
        let bearPoints = 0;
        const recentHighs = highs.slice(-4);
        const recentLows = lows.slice(-4);

        for (let i = 1; i < recentHighs.length; i++) {
            const weight = i >= recentHighs.length - 2 ? 2 : 1;
            if (recentHighs[i].price > recentHighs[i - 1].price) bullPoints += weight;
            else bearPoints += weight;
        }
        for (let i = 1; i < recentLows.length; i++) {
            const weight = i >= recentLows.length - 2 ? 2 : 1;
            if (recentLows[i].price > recentLows[i - 1].price) bullPoints += weight;
            else bearPoints += weight;
        }

        const swingStructure: MarketStructure =
            bullPoints > bearPoints ? 'BULLISH' : bearPoints > bullPoints ? 'BEARISH' : 'NEUTRAL';

        const lookback = Math.min(15, candles.length);
        for (let t = candles.length - lookback; t < candles.length; t++) {
            if (t < 0) continue;
            const candle = candles[t];
            const body = Math.abs(candle.close - candle.open);
            const range = candle.high - candle.low;
            if (range <= 0 || body / range < 0.5) continue;

            // Bullish break: close above a recent swing high
            const priorHighs = highs.filter(s => s.index < t && s.index > t - 20);
            let brokenHigh: SwingPoint | null = null;
            for (const s of priorHighs) {
                if (candle.close > s.price && (!brokenHigh || s.price > brokenHigh.price)) {
                    brokenHigh = s;
                }
            }
            if (brokenHigh) {
                const level = brokenHigh.price;
                const type: 'BOS' | 'CHoCH' = swingStructure === 'BEARISH' ? 'CHoCH' : 'BOS';
                const already = breaks.find(
                    b => Math.abs(b.brokenLevel - level) < 0.0005 * level && b.direction === 'BULLISH'
                );
                if (!already) {
                    let valid = true;
                    if (t + 1 < candles.length && candles[t + 1].close < level) valid = false;
                    if (valid) {
                        breaks.push({
                            type,
                            direction: 'BULLISH',
                            price: candle.close,
                            index: t,
                            brokenLevel: level,
                            timestamp: candle.timestamp
                        });
                    }
                }
            }

            // Bearish break: close below a recent swing low
            const priorLows = lows.filter(s => s.index < t && s.index > t - 20);
            let brokenLow: SwingPoint | null = null;
            for (const s of priorLows) {
                if (candle.close < s.price && (!brokenLow || s.price < brokenLow.price)) {
                    brokenLow = s;
                }
            }
            if (brokenLow) {
                const level = brokenLow.price;
                const type: 'BOS' | 'CHoCH' = swingStructure === 'BULLISH' ? 'CHoCH' : 'BOS';
                const already = breaks.find(
                    b => Math.abs(b.brokenLevel - level) < 0.0005 * level && b.direction === 'BEARISH'
                );
                if (!already) {
                    let valid = true;
                    if (t + 1 < candles.length && candles[t + 1].close > level) valid = false;
                    if (valid) {
                        breaks.push({
                            type,
                            direction: 'BEARISH',
                            price: candle.close,
                            index: t,
                            brokenLevel: level,
                            timestamp: candle.timestamp
                        });
                    }
                }
            }
        }

        const lastThree = breaks.slice(-3);
        const bullBreaks = lastThree.filter(b => b.direction === 'BULLISH').length;
        const bearBreaks = lastThree.filter(b => b.direction === 'BEARISH').length;
        let structure = swingStructure;
        if (bullBreaks > bearBreaks) structure = 'BULLISH';
        else if (bearBreaks > bullBreaks) structure = 'BEARISH';

        return { structure, breaks };
    }

    static detectFVGs(candles: ICTCandle[]): FVG[] {
        const fvgs: FVG[] = [];
        if (candles.length < 3) return fvgs;
        const start = Math.max(2, candles.length - 30);
        for (let l = start; l < candles.length; l++) {
            const first = candles[l - 2];
            const third = candles[l];

            // Bullish FVG: third candle's low above first candle's high
            if (third.low > first.high) {
                const gapHigh = third.low;
                const gapLow = first.high;
                if (gapHigh - gapLow >= 0.0005 * first.high) {
                    let filled = false;
                    for (let t = l + 1; t < candles.length; t++) {
                        if (candles[t].low <= gapLow) { filled = true; break; }
                    }
                    fvgs.push({
                        type: 'BULLISH',
                        high: gapHigh,
                        low: gapLow,
                        midpoint: (gapHigh + gapLow) / 2,
                        index: l - 1,
                        filled,
                        timestamp: candles[l - 1].timestamp
                    });
                }
            }

            // Bearish FVG: third candle's high below first candle's low
            if (third.high < first.low) {
                const gapHigh = first.low;
                const gapLow = third.high;
                if (gapHigh - gapLow >= 0.0005 * first.low) {
                    let filled = false;
                    for (let t = l + 1; t < candles.length; t++) {
                        if (candles[t].high >= gapHigh) { filled = true; break; }
                    }
                    fvgs.push({
                        type: 'BEARISH',
                        high: gapHigh,
                        low: gapLow,
                        midpoint: (gapHigh + gapLow) / 2,
                        index: l - 1,
                        filled,
                        timestamp: candles[l - 1].timestamp
                    });
                }
            }
        }
        return fvgs;
    }

    static detectOrderBlocks(candles: ICTCandle[], breaks: StructureBreak[]): OrderBlock[] {
        const blocks: OrderBlock[] = [];
        if (candles.length < 5) return blocks;
        for (const brk of breaks) {
            // Original: only breaks in the last 40 candles produce blocks
            if (brk.index < candles.length - 40) continue;
            for (let t = brk.index - 1; t >= Math.max(0, brk.index - 10); t--) {
                const candle = candles[t];
                if (brk.direction === 'BULLISH') {
                    if (candle.close < candle.open) {
                        let mitigated = false;
                        for (let i = t + 1; i < candles.length; i++) {
                            if (candles[i].low <= candle.high && candles[i].low >= candle.low) {
                                const touches = candles
                                    .slice(t + 1)
                                    .filter(c => c.low <= candle.high && c.low >= candle.low).length;
                                if (touches >= 2) mitigated = true;
                                break;
                            }
                        }
                        blocks.push({
                            type: 'BULLISH',
                            high: candle.high,
                            low: candle.low,
                            midpoint: (candle.high + candle.low) / 2,
                            index: t,
                            mitigated,
                            volume: candle.volume,
                            timestamp: candle.timestamp
                        });
                        break;
                    }
                } else if (candle.close > candle.open) {
                    let mitigated = false;
                    for (let i = t + 1; i < candles.length; i++) {
                        if (candles[i].high >= candle.low && candles[i].high <= candle.high) {
                            const touches = candles
                                .slice(t + 1)
                                .filter(c => c.high >= candle.low && c.high <= candle.high).length;
                            if (touches >= 2) mitigated = true;
                            break;
                        }
                    }
                    blocks.push({
                        type: 'BEARISH',
                        high: candle.high,
                        low: candle.low,
                        midpoint: (candle.high + candle.low) / 2,
                        index: t,
                        mitigated,
                        volume: candle.volume,
                        timestamp: candle.timestamp
                    });
                    break;
                }
            }
        }
        return blocks;
    }

    static detectLiquiditySweeps(candles: ICTCandle[], swings: SwingPoint[]): LiquiditySweep[] {
        const sweeps: LiquiditySweep[] = [];
        if (candles.length < 5 || swings.length < 2) return sweeps;
        const windowSize = Math.min(10, candles.length);
        const recent = candles.slice(-windowSize);
        const offset = candles.length - windowSize;
        const highs = swings.filter(s => s.type === 'HIGH');
        const lows = swings.filter(s => s.type === 'LOW');

        for (let i = 0; i < recent.length; i++) {
            const candle = recent[i];
            const idx = offset + i;

            for (const s of highs) {
                if (s.index >= idx) continue;
                if (candle.high > s.price && candle.close < s.price) {
                    const tol = 0.001 * s.price;
                    if (!sweeps.find(sw => Math.abs(sw.sweptLevel - s.price) < tol && sw.type === 'BUYSIDE')) {
                        sweeps.push({
                            type: 'BUYSIDE',
                            sweptLevel: s.price,
                            sweepPrice: candle.high,
                            index: idx,
                            confirmed: true,
                            timestamp: candle.timestamp
                        });
                    }
                }
            }
            for (const s of lows) {
                if (s.index >= idx) continue;
                if (candle.low < s.price && candle.close > s.price) {
                    const tol = 0.001 * s.price;
                    if (!sweeps.find(sw => Math.abs(sw.sweptLevel - s.price) < tol && sw.type === 'SELLSIDE')) {
                        sweeps.push({
                            type: 'SELLSIDE',
                            sweptLevel: s.price,
                            sweepPrice: candle.low,
                            index: idx,
                            confirmed: true,
                            timestamp: candle.timestamp
                        });
                    }
                }
            }
        }
        return sweeps;
    }

    static calculatePremiumDiscount(candles: ICTCandle[], swings: SwingPoint[]): PremiumDiscount {
        const lastClose = candles[candles.length - 1].close;
        const recentHighs = swings.filter(s => s.type === 'HIGH' && s.index > candles.length - 40);
        const recentLows = swings.filter(s => s.type === 'LOW' && s.index > candles.length - 40);
        const swingHigh = recentHighs.length > 0
            ? Math.max(...recentHighs.map(s => s.price))
            : Math.max(...candles.slice(-40).map(c => c.high));
        const swingLow = recentLows.length > 0
            ? Math.min(...recentLows.map(s => s.price))
            : Math.min(...candles.slice(-40).map(c => c.low));
        const range = swingHigh - swingLow;
        const equilibrium = swingLow + 0.5 * range;
        const currentZone: PremiumDiscount['currentZone'] =
            lastClose > equilibrium + 0.05 * range
                ? 'PREMIUM'
                : lastClose < equilibrium - 0.05 * range
                    ? 'DISCOUNT'
                    : 'EQUILIBRIUM';
        return {
            premiumZoneHigh: swingHigh,
            premiumZoneLow: swingLow + 0.5 * range,
            equilibrium,
            discountZoneHigh: swingLow + 0.5 * range,
            discountZoneLow: swingLow,
            currentZone,
            swingHigh,
            swingLow
        };
    }

    static calculateOTE(candles: ICTCandle[], swings: SwingPoint[], direction: 'BUY' | 'SELL'): OTEZone {
        const lastClose = candles[candles.length - 1].close;
        const recentHighs = swings.filter(s => s.type === 'HIGH' && s.index > candles.length - 40);
        const recentLows = swings.filter(s => s.type === 'LOW' && s.index > candles.length - 40);
        const swingHigh = recentHighs.length > 0
            ? Math.max(...recentHighs.map(s => s.price))
            : Math.max(...candles.slice(-40).map(c => c.high));
        const swingLow = recentLows.length > 0
            ? Math.min(...recentLows.map(s => s.price))
            : Math.min(...candles.slice(-40).map(c => c.low));
        const range = swingHigh - swingLow;

        let fib62: number, fib705: number, fib79: number;
        if (direction === 'BUY') {
            fib62 = swingHigh - 0.62 * range;
            fib705 = swingHigh - 0.705 * range;
            fib79 = swingHigh - 0.79 * range;
        } else {
            fib62 = swingLow + 0.62 * range;
            fib705 = swingLow + 0.705 * range;
            fib79 = swingLow + 0.79 * range;
        }
        const inZone = direction === 'BUY'
            ? lastClose <= fib62 && lastClose >= fib79
            : lastClose >= fib62 && lastClose <= fib79;
        return { fib62, fib705, fib79, inZone, direction };
    }

    static calculateDailyBias(
        candles: ICTCandle[],
        structure: MarketStructure,
        breaks: StructureBreak[],
        dailyOpen?: number
    ): DailyBias {
        const lastClose = candles[candles.length - 1].close;
        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        const todaysCandles = candles.filter(c => c.timestamp >= startOfDay);
        const open = dailyOpen
            || (todaysCandles.length > 0 ? todaysCandles[0].open : candles[Math.max(0, candles.length - 60)].open);
        const priceAboveOpen = lastClose > open;

        const recentFrom = candles.length - 15;
        const recentBullBOS = breaks
            .filter(b => b.direction === 'BULLISH' && b.type === 'BOS' && b.index >= recentFrom)
            .slice(-1)[0] || null;
        const recentBearBOS = breaks
            .filter(b => b.direction === 'BEARISH' && b.type === 'BOS' && b.index >= recentFrom)
            .slice(-1)[0] || null;

        const momentumFrom = Math.max(0, candles.length - 20);
        const momentum = ((lastClose - candles[momentumFrom].close) / candles[momentumFrom].close) * 100;

        const bullVotes = [priceAboveOpen, structure === 'BULLISH', recentBullBOS !== null, momentum > 0.3]
            .filter(Boolean).length;
        const bearVotes = [!priceAboveOpen, structure === 'BEARISH', recentBearBOS !== null, momentum < -0.3]
            .filter(Boolean).length;

        let bias: DailyBias['bias'] = 'NEUTRAL';
        let confidence = 0;
        let recentBOS: StructureBreak | null = null;
        if (bullVotes >= 3) {
            bias = 'BULLISH'; confidence = (bullVotes / 4) * 100; recentBOS = recentBullBOS;
        } else if (bearVotes >= 3) {
            bias = 'BEARISH'; confidence = (bearVotes / 4) * 100; recentBOS = recentBearBOS;
        } else if (bullVotes >= 2 && bearVotes <= 1) {
            bias = 'BULLISH'; confidence = (bullVotes / 4) * 100; recentBOS = recentBullBOS;
        } else if (bearVotes >= 2 && bullVotes <= 1) {
            bias = 'BEARISH'; confidence = (bearVotes / 4) * 100; recentBOS = recentBearBOS;
        }

        return {
            bias,
            dailyOpen: open,
            priceAboveOpen,
            marketStructure: structure,
            recentBOS,
            confidence
        };
    }

    static getCurrentSession(): SessionInfo {
        const now = new Date();
        const utc = now.getUTCHours() + now.getUTCMinutes() / 60;
        if (utc >= 13 && utc < 16) {
            return { currentSession: 'LONDON_NY_OVERLAP', isAllowed: true, sessionName: 'London / New York Overlap' };
        }
        if (utc >= 7 && utc < 13) {
            return { currentSession: 'LONDON', isAllowed: true, sessionName: 'London Open' };
        }
        if (utc >= 13 && utc < 22) {
            return { currentSession: 'NEW_YORK', isAllowed: true, sessionName: 'New York Open' };
        }
        if (utc >= 0 && utc < 7) {
            return { currentSession: 'ASIAN', isAllowed: false, sessionName: 'Asian Session' };
        }
        return { currentSession: 'CLOSED', isAllowed: false, sessionName: 'Market Closed' };
    }

    static checkVolumeFilter(ltf: ICTCandle[]): boolean {
        if (ltf.length < 20) return false;
        const lastVolume = ltf[ltf.length - 1].volume;
        const avg20 = ltf.slice(-20).reduce((sum, c) => sum + c.volume, 0) / 20;
        const avg5 = ltf.slice(-5).reduce((sum, c) => sum + c.volume, 0) / 5;
        return lastVolume > avg20 && lastVolume > avg5;
    }

    static detectEngulfing(ltf: ICTCandle[]): { bullish: boolean; bearish: boolean } {
        if (ltf.length < 2) return { bullish: false, bearish: false };
        const prev = ltf[ltf.length - 2];
        const last = ltf[ltf.length - 1];
        return {
            bullish: prev.close < prev.open && last.close > last.open && last.close > prev.open && last.open < prev.close,
            bearish: prev.close > prev.open && last.close < last.open && last.close < prev.open && last.open > prev.close
        };
    }

    static calculateATR(candles: ICTCandle[], period: number = 14): number {
        if (candles.length < period + 1) return 0.002 * candles[candles.length - 1].close;
        const trueRanges: number[] = [];
        for (let i = 1; i < candles.length; i++) {
            trueRanges.push(Math.max(
                candles[i].high - candles[i].low,
                Math.abs(candles[i].high - candles[i - 1].close),
                Math.abs(candles[i].low - candles[i - 1].close)
            ));
        }
        return trueRanges.slice(-period).reduce((sum, tr) => sum + tr, 0) / period;
    }

    static isRangingMarket(htf: ICTCandle[]): boolean {
        if (htf.length < 20) return true;
        const atr = this.calculateATR(htf, 14);
        if (atr <= 0) return true;
        const reference = htf[htf.length - 20].close;
        return Math.abs(htf[htf.length - 1].close - reference) / atr < 1;
    }

    static scoreSignal(
        bias: DailyBias,
        sweep: LiquiditySweep | null,
        orderBlock: OrderBlock | null,
        fvg: FVG | null,
        ote: OTEZone,
        structureBreak: StructureBreak | null,
        volumeConfirmed: boolean,
        session: SessionInfo
    ): ICTScore {
        const dailyBias = bias.bias !== 'NEUTRAL' ? Math.round(0.15 * bias.confidence) : 0;
        const liquiditySweep = sweep && sweep.confirmed ? 20 : 0;
        const orderBlockPts = orderBlock && !orderBlock.mitigated ? 15 : 0;
        const fvgPts = fvg && !fvg.filled ? 10 : 0;
        const otePts = ote && ote.inZone ? 15 : 0;
        const chochPts = structureBreak
            ? structureBreak.type === 'CHoCH' ? 10 : 6
            : 0;
        const volumePts = volumeConfirmed ? 10 : 0;
        const sessionPts = session.currentSession === 'LONDON_NY_OVERLAP'
            ? 5
            : session.isAllowed ? 3 : 0;

        const total = dailyBias + liquiditySweep + orderBlockPts + fvgPts + otePts + chochPts + volumePts + sessionPts;
        const grade: ICTGrade =
            total >= ICT_GRADE_THRESHOLDS.ELITE ? 'ELITE'
                : total >= ICT_GRADE_THRESHOLDS.A_PLUS ? 'A+'
                    : total >= ICT_GRADE_THRESHOLDS.A ? 'A'
                        : total >= ICT_GRADE_THRESHOLDS.B ? 'B'
                            : 'IGNORE';

        return {
            dailyBias,
            liquiditySweep,
            orderBlock: orderBlockPts,
            fvg: fvgPts,
            ote: otePts,
            choch: chochPts,
            volume: volumePts,
            session: sessionPts,
            total,
            grade
        };
    }

    static getMinSLBuffer(pair: string, price: number): number {
        const p = pair.toUpperCase();
        if (p.includes('XAU')) return 0.0008 * price;
        if (p.includes('XAG')) return 0.0015 * price;
        if (
            p.includes('EUR') || p.includes('GBP') || p.includes('JPY') || p.includes('CHF')
            || p.includes('AUD') || p.includes('CAD') || p.includes('NZD')
        ) {
            return 0.0008 * price;
        }
        return 0.004 * price; // crypto: 0.4% of price
    }

    /**
     * Full ICT evaluation with gate-funnel diagnostics. Control flow mirrors
     * the original generateICTSignal exactly; the diagnostic records the
     * deepest stage reached so callers can report the funnel.
     */
    static evaluateICT(
        htf: ICTCandle[],
        ltf: ICTCandle[],
        pair: string,
        dailyOpen?: number
    ): ICTEvaluation {
        if (htf.length < 30 || ltf.length < 30) {
            return { signal: null, diagnostic: { stage: 'insufficient-data' } };
        }
        if (this.isRangingMarket(htf)) {
            return { signal: null, diagnostic: { stage: 'ranging' } };
        }

        const session = this.getCurrentSession();
        const htfSwings = this.detectSwingPoints(htf, 2);
        const { structure, breaks: htfBreaks } = this.analyzeMarketStructure(htf, htfSwings);
        const bias = this.calculateDailyBias(htf, structure, htfBreaks, dailyOpen);
        const ltfSwings = this.detectSwingPoints(ltf, 2);
        const { breaks: ltfBreaks } = this.analyzeMarketStructure(ltf, ltfSwings);
        const fvgs = this.detectFVGs(htf);
        const sweeps = this.detectLiquiditySweeps(htf, htfSwings);
        const orderBlocks = this.detectOrderBlocks(htf, htfBreaks);
        const premiumDiscount = this.calculatePremiumDiscount(htf, htfSwings);
        const volumeConfirmed = this.checkVolumeFilter(ltf);
        const engulfing = this.detectEngulfing(ltf);
        const entry = ltf[ltf.length - 1].close;

        if (bias.bias === 'NEUTRAL') {
            return { signal: null, diagnostic: { stage: 'no-bias' } };
        }

        const isBuy = bias.bias === 'BULLISH';
        const breakCutoff = ltf.length - LTF_BREAK_RECENCY;

        if (isBuy) {
            const choch = ltfBreaks.find(
                b => b.type === 'CHoCH' && b.direction === 'BULLISH' && b.index >= breakCutoff
            );
            const bos = ltfBreaks.find(
                b => b.type === 'BOS' && b.direction === 'BULLISH' && b.index >= breakCutoff
            );
            const freshBreak = choch || bos;
            if (!freshBreak) {
                return { signal: null, diagnostic: { stage: 'no-ltf-break' } };
            }

            const sweep = sweeps.find(s => s.type === 'SELLSIDE') || null;
            const orderBlock = orderBlocks.find(ob => {
                if (ob.type !== 'BULLISH' || ob.mitigated) return false;
                const tol = Math.max(0.2 * (ob.high - ob.low), 0.0015 * entry);
                return entry >= ob.low - tol && entry <= ob.high + tol;
            }) || null;
            const fvg = fvgs.find(f => {
                if (f.type !== 'BULLISH' || f.filled) return false;
                const tol = Math.max(0.2 * (f.high - f.low), 0.0015 * entry);
                return entry >= f.low - tol && entry <= f.high + tol;
            }) || null;
            const ote = this.calculateOTE(htf, htfSwings, 'BUY');
            const confluences = [true, !!(orderBlock || fvg), !!sweep].filter(Boolean).length;

            if (premiumDiscount.currentZone !== 'DISCOUNT' && premiumDiscount.currentZone !== 'EQUILIBRIUM') {
                return { signal: null, diagnostic: { stage: 'wrong-zone' } };
            }
            if (confluences < 2) {
                return { signal: null, diagnostic: { stage: 'confluence' } };
            }

            const score = this.scoreSignal(bias, sweep, orderBlock, fvg, ote, freshBreak, volumeConfirmed, session);
            if (score.grade !== 'ELITE' && score.grade !== 'A+') {
                return { signal: null, diagnostic: { stage: 'below-grade', score: score.total, grade: score.grade } };
            }

            const sweptLevel = sweep ? sweep.sweepPrice : premiumDiscount.swingLow;
            const minBuffer = this.getMinSLBuffer(pair, entry);
            const risk = Math.max(entry - sweptLevel, minBuffer);
            const tps = [
                entry + 1.5 * risk,
                entry + 3 * risk,
                premiumDiscount.swingHigh > entry + 3 * risk ? premiumDiscount.swingHigh : entry + 5 * risk
            ].sort((a, b) => a - b);

            return {
                signal: {
                    type: 'BUY',
                    score,
                    entry,
                    stopLoss: entry - risk,
                    tp1: tps[0],
                    tp2: tps[1],
                    tp3: tps[2],
                    riskDistance: risk,
                    riskRewardToFinal: (tps[2] - entry) / risk,
                    dailyBias: bias,
                    liquiditySweep: sweep,
                    oteConfirmation: ote.inZone ? ote : null,
                    orderBlockConfirmation: orderBlock,
                    fvgConfirmation: fvg,
                    volumeConfirmation: volumeConfirmed,
                    sessionConfirmation: session,
                    premiumDiscount,
                    chochConfirmation: freshBreak,
                    engulfingConfirmation: engulfing.bullish,
                    timestamp: Date.now(),
                    pair
                },
                diagnostic: { stage: 'issued', score: score.total, grade: score.grade }
            };
        }

        // BEARISH bias
        const choch = ltfBreaks.find(
            b => b.type === 'CHoCH' && b.direction === 'BEARISH' && b.index >= breakCutoff
        );
        const bos = ltfBreaks.find(
            b => b.type === 'BOS' && b.direction === 'BEARISH' && b.index >= breakCutoff
        );
        const freshBreak = choch || bos;
        if (!freshBreak) {
            return { signal: null, diagnostic: { stage: 'no-ltf-break' } };
        }

        const sweep = sweeps.find(s => s.type === 'BUYSIDE') || null;
        const orderBlock = orderBlocks.find(ob => {
            if (ob.type !== 'BEARISH' || ob.mitigated) return false;
            const tol = Math.max(0.2 * (ob.high - ob.low), 0.0015 * entry);
            return entry >= ob.low - tol && entry <= ob.high + tol;
        }) || null;
        const fvg = fvgs.find(f => {
            if (f.type !== 'BEARISH' || f.filled) return false;
            const tol = Math.max(0.2 * (f.high - f.low), 0.0015 * entry);
            return entry >= f.low - tol && entry <= f.high + tol;
        }) || null;
        const ote = this.calculateOTE(htf, htfSwings, 'SELL');
        const confluences = [true, !!(orderBlock || fvg), !!sweep].filter(Boolean).length;

        if (premiumDiscount.currentZone !== 'PREMIUM' && premiumDiscount.currentZone !== 'EQUILIBRIUM') {
            return { signal: null, diagnostic: { stage: 'wrong-zone' } };
        }
        if (confluences < 2) {
            return { signal: null, diagnostic: { stage: 'confluence' } };
        }

        const score = this.scoreSignal(bias, sweep, orderBlock, fvg, ote, freshBreak, volumeConfirmed, session);
        if (score.grade !== 'ELITE' && score.grade !== 'A+') {
            return { signal: null, diagnostic: { stage: 'below-grade', score: score.total, grade: score.grade } };
        }

        const sweptLevel = sweep ? sweep.sweepPrice : premiumDiscount.swingHigh;
        const minBuffer = this.getMinSLBuffer(pair, entry);
        const risk = Math.max(sweptLevel - entry, minBuffer);
        const tps = [
            entry - 1.5 * risk,
            entry - 3 * risk,
            premiumDiscount.swingLow < entry - 3 * risk ? premiumDiscount.swingLow : entry - 5 * risk
        ].sort((a, b) => b - a);

        return {
            signal: {
                type: 'SELL',
                score,
                entry,
                stopLoss: entry + risk,
                tp1: tps[0],
                tp2: tps[1],
                tp3: tps[2],
                riskDistance: risk,
                riskRewardToFinal: (entry - tps[2]) / risk,
                dailyBias: bias,
                liquiditySweep: sweep,
                oteConfirmation: ote.inZone ? ote : null,
                orderBlockConfirmation: orderBlock,
                fvgConfirmation: fvg,
                volumeConfirmation: volumeConfirmed,
                sessionConfirmation: session,
                premiumDiscount,
                chochConfirmation: freshBreak,
                engulfingConfirmation: engulfing.bearish,
                timestamp: Date.now(),
                pair
            },
            diagnostic: { stage: 'issued', score: score.total, grade: score.grade }
        };
    }

    /** Original-shaped convenience wrapper: signal or null. */
    static generateICTSignal(
        htf: ICTCandle[],
        ltf: ICTCandle[],
        pair: string,
        dailyOpen?: number
    ): ICTSignal | null {
        return this.evaluateICT(htf, ltf, pair, dailyOpen).signal;
    }
}
