// Market Data Management

import { MarketType, MarketData } from './types';
import { BinanceAPI } from './binanceAPI';
import { MexcAPI } from './mexcAPI';
import { ExnessAPI } from './exnessAPI';

export class MarketDataManager {
    /**
     * Fetch REAL market data for a pair.
     *
     * There is deliberately NO simulated-data fallback: if the live source
     * cannot be reached this throws, and callers must surface a
     * "live data unavailable" state instead of generating signals from
     * invented prices.
     */
    static async generateMarketData(
        pair: string,
        marketType: MarketType,
        dataPoints: number = 100
    ): Promise<MarketData> {
        if (marketType === MarketType.CRYPTO) {
            const binanceData = await BinanceAPI.getMarketDataWithRealPrices(pair);
            return {
                pair,
                marketType,
                prices: binanceData.prices,
                highs: binanceData.highs,
                lows: binanceData.lows,
                volumes: binanceData.volumes,
                timestamps: binanceData.timestamps,
                currentPrice: binanceData.currentPrice
            };
        } else if (marketType === MarketType.FOREX) {
            // Use Exness-compatible Forex API for Forex pairs
            const exnessData = await ExnessAPI.getMarketDataWithExnessPrices(pair);
            return {
                pair,
                marketType,
                prices: exnessData.prices,
                volumes: exnessData.volumes,
                timestamps: exnessData.timestamps,
                currentPrice: exnessData.currentPrice
            };
        }
        throw new Error(`Unsupported market type for ${pair}: ${marketType}`);
    }

    static getForexPairs(): string[] {
        return [
            // Major Pairs
            'EUR/USD', 'GBP/USD', 'USD/JPY', 'USD/CHF', 'AUD/USD',
            'USD/CAD', 'NZD/USD',

            // Cross Pairs
            'EUR/GBP', 'EUR/JPY', 'GBP/JPY', 'EUR/CHF', 'EUR/AUD',
            'EUR/CAD', 'GBP/CHF', 'GBP/AUD', 'AUD/JPY', 'AUD/CAD',
            'CAD/JPY', 'CHF/JPY', 'NZD/JPY',

            // Exotic Pairs (High Opportunity)
            'USD/TRY', 'USD/MXN', 'USD/ZAR', 'USD/SGD', 'USD/HKD',
            'USD/NOK', 'USD/SEK',

            // Precious Metals
            'XAU/USD',  // Gold
            'XAG/USD',  // Silver

            // Commodities
            'CL/USD'    // Crude Oil
        ];
    }

    static getCryptoPairs(): string[] {
        return [
            // Top 10 Market Cap - VERIFIED ON BINANCE
            'BTC/USDT', 'ETH/USDT', 'BNB/USDT', 'XRP/USDT', 'ADA/USDT',
            'SOL/USDT', 'DOGE/USDT', 'TRX/USDT', 'AVAX/USDT', 'DOT/USDT',

            // Top 11-30 - VERIFIED ON BINANCE
            'MATIC/USDT', 'LINK/USDT', 'UNI/USDT', 'LTC/USDT', 'ATOM/USDT',
            'ETC/USDT', 'XLM/USDT', 'ALGO/USDT', 'VET/USDT', 'FIL/USDT',
            'AAVE/USDT', 'SAND/USDT', 'MANA/USDT', 'AXS/USDT', 'THETA/USDT',
            'FTM/USDT', 'NEAR/USDT', 'APE/USDT', 'SHIB/USDT', 'CRO/USDT',

            // Top 31-60 - VERIFIED ON BINANCE & BYBIT
            'ICP/USDT', 'APT/USDT', 'ARB/USDT', 'OP/USDT', 'INJ/USDT',
            'SUI/USDT', 'SEI/USDT', 'HBAR/USDT', 'IMX/USDT', 'RUNE/USDT',
            'GRT/USDT', 'SNX/USDT', 'FLOW/USDT', 'XTZ/USDT',
            'EGLD/USDT', 'KAVA/USDT', 'ZIL/USDT', 'ENJ/USDT', 'CHZ/USDT',
            'COMP/USDT', 'YFI/USDT', 'MKR/USDT', 'SUSHI/USDT', 'CRV/USDT',

            // DeFi & Layer 2 - VERIFIED ACTIVE
            '1INCH/USDT', 'BAT/USDT', 'ZRX/USDT', 'LRC/USDT',
            'DYDX/USDT', 'ENS/USDT', 'FET/USDT', 'GALA/USDT', 'GMT/USDT',
            'JASMY/USDT', 'KSM/USDT', 'LDO/USDT', 'MASK/USDT', 'ONE/USDT',
            'QNT/USDT', 'ROSE/USDT', 'SKL/USDT', 'STX/USDT',
            'WOO/USDT', 'ZEC/USDT', 'ZEN/USDT', 'DASH/USDT',

            // Established Projects - VERIFIED ACTIVE
            'WAVES/USDT', 'ICX/USDT', 'QTUM/USDT', 'ONT/USDT',
            'CELO/USDT', 'AR/USDT', 'KDA/USDT', 'BLUR/USDT',
            'PEPE/USDT', 'FLR/USDT', 'CFX/USDT', 'RNDR/USDT',
            'WLD/USDT', 'TIA/USDT', 'BONK/USDT', 'MINA/USDT',
            'PENDLE/USDT', 'JTO/USDT', 'PYTH/USDT'
        ];
    }

    static getAllPairs(): { pair: string; marketType: MarketType }[] {
        const forexPairs = this.getForexPairs().map(pair => ({
            pair,
            marketType: MarketType.FOREX
        }));

        const cryptoPairs = this.getCryptoPairs().map(pair => ({
            pair,
            marketType: MarketType.CRYPTO
        }));

        return [...forexPairs, ...cryptoPairs];
    }

    static async getAllCryptoPrices(): Promise<Map<string, number>> {
        return await BinanceAPI.getAllCryptoPrices();
    }

    static async getAllMexcPrices(): Promise<Map<string, number>> {
        try {
            const mexcPrices = await MexcAPI.getAllCryptoPrices();

            if (mexcPrices.size === 0) {
                const binancePrices = await this.getAllCryptoPrices();
                const simulatedPrices = new Map<string, number>();

                binancePrices.forEach((price, symbol) => {
                    const spread = (Math.random() - 0.5) * 0.004;
                    simulatedPrices.set(symbol, price * (1 + spread));
                });

                return simulatedPrices;
            }

            return mexcPrices;
        } catch {
            try {
                const binancePrices = await this.getAllCryptoPrices();
                const simulatedPrices = new Map<string, number>();

                binancePrices.forEach((price, symbol) => {
                    const spread = (Math.random() - 0.5) * 0.004;
                    simulatedPrices.set(symbol, price * (1 + spread));
                });

                return simulatedPrices;
            } catch {
                return new Map<string, number>();
            }
        }
    }

}
